// HeatmapControl data aggregation & rendering logic (HeatmapManager).
import {
  METHOD as CLASSIFY_METHOD,
  CLASS_COUNT,
  type ClassifyMethod,
  isClassifyMethod,
} from "#core/classify.js";
import { generateId } from "#core/component.js";
import {
  EVENTS,
  type EventBus,
  SettledOperation,
  ensureEvents,
  publish,
} from "#core/event/index.js";
import { bareFieldName } from "#core/label/index.js";
import {
  type LayerFilter,
  type LayerFilterModel,
  type LayerSnapshot,
  NO_FEATURE_TREE_KINDS,
  buildFilterModel,
  dropFilterForField,
  filterKey,
  normalizeFilter,
  parsePersistedFilter,
  pickFilterField,
  revalidateStoredFilter,
  selectIndices,
  serializedFilters,
  snapshotFromPoints,
  storeFilter,
} from "#core/layer/index.js";
import { bindMapSync } from "#core/leaflet/index.js";
import { SCHEME_FALLBACK_COLOR } from "#core/palette.js";
import type { NumberStyle } from "#foliplus/config-schema.js";
import { getLayerAlpha, setLayerAlpha } from "#common/canvasAlpha.js";
import { type Debounced, debounce } from "#common/debounce.js";
import {
  BORDER_WEIGHT,
  clampBorderWeight,
  clampLabelSize,
  normalizeHexColor,
} from "#common/form.js";
import { NUMBER_FORMAT } from "#common/format.js";
import { createLogger } from "#common/log.js";
import { type Persisted, createPersisted, saveRecord } from "#common/storage.js";
import type { CanvasLabelStyle, Logger } from "#common/type.js";
import * as CONST from "./const.js";
import {
  aggregateData as aggregateDataFn,
  binPoints as binPointsFn,
  buildFeatures as buildFeaturesFn,
  getH3Res,
  readMarkerField,
} from "./data.js";
import * as SVGs from "./icon.js";
import {
  applySavedConfig as applySavedConfigFn,
  clearSavedConfig as clearSavedConfigFn,
  loadSavedConfig as loadSavedConfigFn,
} from "./persistence.js";
import {
  drawHexLabel as drawHexLabelFn,
  drawHexagon as drawHexagonFn,
  resolveLabelStyle as resolveLabelStyleFn,
} from "./render.js";
import type {
  AggregatedData,
  HeatmapPointMarker,
  HexFeature,
  SavedConfig,
  SelectedPoint,
} from "./type.js";
import { type HeatmapControlUI, rebuildLayerDropdown, resetPanel } from "./ui.js";

/** Adopt a method name only when it is one of the four the classifier
 *  implements; anything else falls back to the documented default. The Python
 *  declaration is typed, so this only fires for a hand-edited config - and
 *  keeping it here makes the manager's `method` a closed value, which is what
 *  lets `computeBreaks` reject an unknown name instead of silently running
 *  the equal split. */
const resolveClassifyMethod = (value: unknown): ClassifyMethod =>
  isClassifyMethod(value) ? value : CLASSIFY_METHOD.JENKS;

/** A point layer collected from LayerControl. */
interface PointLayerInfo {
  id: string;
  name: string;
  layer: L.Layer | null;
  count: number;
}

type HeatmapManagerEnv = {
  readonly T: (key: string) => string;
  readonly log: Logger;
};

const NO_OP_ENV: HeatmapManagerEnv = {
  T: key => `HeatmapControl.${key}`,
  log: createLogger("HeatmapControl"),
};

// ==================== Core: Data Aggregation & Rendering ====================
class HeatmapManager {
  map: L.Map;
  /** Translator handed in via env, assigned once in the constructor — same
   *  shape as MeasureControl / ExportControl managers. */
  T: (key: string) => string;
  private readonly log: Logger;
  /** Per-map event bus — bound once in the constructor (ensure-style getters
   *  return the cached instance, so hold it like the logger does). */
  declare events: EventBus;
  selectedLayerId: string | null;
  pointLayers: PointLayerInfo[];
  /** Python-declared starting layer name (`HeatmapControl(layer=...)`). A
   *  starting selection only: a persisted record consumed the `hasScanned`
   *  guard before the first rebuild, so a user's earlier choice wins. */
  declare declaredLayer: string | null;
  /** Python-declared starting aggregation field (`HeatmapControl(field=...)`).
   *  A read-time default, not a record: it applies whenever the user has no
   *  stored field of their own (see {@link effectiveField}), so a declaration
   *  can never be persisted as if the user had chosen it. */
  declare declaredField: string | null;
  /** Declaration names already warned about — one warning per missing name,
   *  not one per rebuild on the way to the first render. */
  declare declarationWarned: Set<string>;
  agg: string;
  /** The aggregation field the USER picked — empty means "nothing picked".
   *  Never holds a guess or a Python declaration: those are resolved at read
   *  time by {@link effectiveField}, so a data-derived default can never be
   *  persisted as if the user had chosen it. A stored pick the current data no
   *  longer offers stays here untouched — it is the user's intent, and it
   *  comes back when the data does. */
  field: string;
  /** Numeric fields the current scan offers, in first-seen order. Published by
   *  the panel's field row through {@link setAvailableFields}. */
  availableFields: string[];
  /** Memoised {@link effectiveField} result. `null` = recompute. Invalidated
   *  by a new field list, a persistence write (the user's pick just moved) and
   *  Reset — and nowhere else, so the per-feature read path never re-resolves. */
  effectiveFieldCache: string | null;
  scheme: string;
  method: ClassifyMethod;
  numClasses: number;
  borderWeight: number;
  borderColor: string;
  labelShow: boolean;
  /** Runtime label color/size — heatmap panel and layer drawer both write these. */
  labelColor: string;
  labelSize: number;
  /** Runtime label number format — heatmap panel and layer drawer both write
   *  this; Python CONFIG only seeds the initial value. */
  labelFormat: NumberStyle;
  /** Style provider — shared by the layer drawer and the heatmap panel's
   *  label controls (core/labelControl). Reads live state; the drawer refreshes on
   *  LAYER_STYLE_CHANGE. */
  declare styleProvider: () => Record<string, unknown>;
  /** Style setters — shared by the layer drawer and the heatmap panel's
   *  label controls. Each setter updates state, renders, persists, and emits
   *  LAYER_STYLE_CHANGE so the other panel's refresh fires. */
  declare styleSetters: Record<string, (v: unknown) => void>;
  valueFallbackWarned: boolean;
  declare overlay: CreateCanvasAPI;
  /**
   * Mutable metadata published to LayerControl's attributes panel (source
   * layer name + aggregation field). Created once and handed to createCanvas
   * so later in-place updates ride the same object the registry holds.
   */
  sourceMeta: Record<string, string | number>;
  /**
   * This manager viewed as a `HeatmapControlUI`: the UI helpers take the
   * manager and read/write sibling fields through that shape, so it is typed
   * here as the partial it actually holds (only `ctrl` at construction) rather
   * than cast to `HeatmapControlUI` at every use site.
   */
  declare ui: HeatmapControlUI | null;
  declare cachedPoints: { key: string; pts: SelectedPoint[] } | null;
  declare cachedFeatures: HexFeature[] | null;
  /** Cache of the bin map (h3 cell → point-index list) keyed by the source
   *  layer + resolution. Independent of the filter: `binPoints` is the only
   *  h3 call, so a filter change reuses the bins and only reruns the pure
   *  `aggregateBins` arithmetic. Invalidation: `onLayerChange` /
   *  `clearHeatmapCanvas`. */
  declare cachedBins: { key: string; bins: Map<string, number[]> } | null;
  declare cachedAgg: { key: string; data: AggregatedData } | null;
  declare cachedLabelStyle: CanvasLabelStyle | null;
  /** Snapshot cache — built once per source layer, reused across filter
   *  changes. `buildLayerSnapshot` walks the layer tree and normalises
   *  fields; the filter evaluator (`matches`) reads `fields` directly.
   *  Invalidation: `onLayerChange` / `clearHeatmapCanvas`. */
  declare cachedSnapshot: LayerSnapshot | null;
  declare cachedSnapshotLayerId: string | null;
  /** The filter store — this manager is the filter's single owner. Keyed
   *  by source layer id, so a source switch keeps each source's filter
   *  attributed correctly (A → B → A restores A's filter) and the render
   *  path reads `layerFilters.get(selectedLayerId)`. Absent = no filter.
   *  The LayerControl panel writes through the `filterSetter` capability;
   *  LAYER_FILTER_CHANGE is published *after* the state here is settled. */
  declare layerFilters: Map<string, LayerFilter>;
  /** The Python-declared starting filter (CONFIG.filter), parsed once through
   *  the same tolerant AST reader a persisted record uses. Undefined means
   *  "not declared" — or a declaration the reader could not understand, in
   *  which case {@link declaredFilterInvalid} is true and the seed reports it
   *  once. */
  declare declaredFilter: LayerFilter;
  declare declaredFilterInvalid: boolean;
  /** Whether the user owns the filter slot (see SavedConfig.filtersTouched).
   *  A declaration seeds only while this is false; the factory Reset clears
   *  it so the declaration returns with the rest of the defaults. */
  declare filtersTouched: boolean;
  declare renderAll: boolean;
  /**
   * One-shot guard for the single-layer auto-select in buildLayerListItems.
   * Set to true in initScan after the first successful rebuild (or the
   * terminal no-layer hint), and also true in applySavedConfig when a
   * persisted record is loaded — a record means the user already spoke in a
   * previous session (picked a layer, or explicitly cleared it), and neither
   * that choice nor the clear should be overridden by auto-select on reload.
   * Only the absence of any record keeps the guard open, so a genuinely first
   * open still auto-selects when there is exactly one point layer. Reset
   * (clearSavedConfig) deletes the record and takes the manager back to the
   * Python-declared state, so auto-select may fire again after that.
   */
  declare hasScanned: boolean;
  declare mapCleanup: () => void;
  declare onZoomEnd: Debounced;
  declare onLayerChange: Debounced;
  /** Coalesces the per-feature content signals (`createLayers` add/remove)
   *  into one re-render. The cache drop happens synchronously on the signal
   *  itself, so a panel read between the signal and the repaint already sees
   *  the fresh snapshot. */
  declare onSourceContentChange: Debounced;
  declare removeLayerChangeListener: () => void;
  declare removeLayerDeletedListener: () => void;
  declare removeContentChangeListener: () => void;
  declare removeExportListener: () => void;

  /** The layer id used to register this manager's heatmap canvas. */
  layerId: string;

  /** Persisted-config binding — write-through (no debounce window). Owns the
   *  save entry point so teardown flush is idempotent. The flat inline-version
   *  record stays as-is (no envelope), matching the pre-existing shape. */
  declare private persist: Persisted;

  /**
   * @param mapInstance - Leaflet map instance.
   * @param env - Manager environment (translator + logger). Defaults to
   *   NO_OP_ENV when omitted.
   * @param opts - Optional configuration.
   * @param opts.id - Optional namespace for the layer ID. When provided,
   *   the canvas is registered as "{ID}_{id}" to support multi-instance maps.
   */
  constructor(
    mapInstance: L.Map,
    env: HeatmapManagerEnv = NO_OP_ENV,
    opts?: { id?: string },
  ) {
    this.map = mapInstance;
    this.T = env.T;
    this.log = env.log;
    this.layerId = generateId(CONST.ID, opts?.id);

    // State management
    this.selectedLayerId = null;
    this.pointLayers = [];
    this.agg = CONFIG.agg ?? CONST.AGG.COUNT;
    this.field = "";
    this.availableFields = [];
    this.effectiveFieldCache = null;
    // Python declarations: starting selections only. `applySavedConfig`
    // consumes the hasScanned guard when a persisted record exists, so the
    // user's earlier choice (or explicit clear) always wins over these.
    this.declaredLayer =
      typeof CONFIG.layer === "string" && CONFIG.layer ? CONFIG.layer : null;
    this.declaredField =
      typeof CONFIG.field === "string" && CONFIG.field ? CONFIG.field : null;
    // Declared filter: a starting condition, never user intent. Parsed here so
    // the seed can report an unreadable payload once instead of per rebuild.
    const rawDeclaredFilter: unknown = CONFIG.filter;
    this.declaredFilter = parsePersistedFilter(rawDeclaredFilter);
    this.declaredFilterInvalid = rawDeclaredFilter != null && !this.declaredFilter;
    this.filtersTouched = false;
    this.declarationWarned = new Set();
    this.scheme = CONFIG.color_scheme ?? "Reds";
    this.method = resolveClassifyMethod(CONFIG.method);
    this.numClasses = CONFIG.num_classes ?? CLASS_COUNT.DEFAULT;
    this.borderColor = CONFIG.border_color ?? SCHEME_FALLBACK_COLOR;
    this.borderWeight = CONFIG.border_weight ?? BORDER_WEIGHT.DEFAULT;
    // Python default is True; only an explicit false turns labels off — same
    // `!== false` rule MeasureControl uses for label_show / label_collide.
    this.labelShow = CONFIG.label_show !== false;
    // Color inputs require #rrggbb — normalize the short #fff Python default.
    this.labelColor = normalizeHexColor(
      CONFIG.label_color ?? CONST.LABEL.COLOR_DEFAULT,
    );
    this.labelSize = clampLabelSize(CONFIG.label_size ?? CONST.LABEL.SIZE_DEFAULT);
    this.labelFormat = (CONFIG.label_format ?? NUMBER_FORMAT.AUTO) as NumberStyle;
    this.valueFallbackWarned = false;
    this.sourceMeta = {};
  }

  /**
   * Init phase — persist binding, style delegation, overlay construction,
   * export listener, cache resets, and map event wiring. Split out of the
   * constructor so deps wiring and state assembly are separate phases
   * (mirrors MeasureManager). Called by the lazy createManager factory in
   * index.ts.
   */
  init() {
    // Write-through binding: config is durable the moment a UI change lands,
    // so there is nothing to coalesce. Flush on teardown stays idempotent.
    this.persist = createPersisted({
      save: () =>
        saveRecord(
          CONST.STORAGE.KEY,
          {
            version: CONST.RECORD_VERSION,
            layerId: this.selectedLayerId,
            agg: this.agg,
            method: this.method,
            scheme: this.scheme,
            numClasses: this.numClasses,
            borderWeight: this.borderWeight,
            borderColor: this.borderColor,
            labelShow: this.labelShow,
            labelColor: this.labelColor,
            labelSize: this.labelSize,
            labelFormat: this.labelFormat,
            field: this.field,
            // A seeded declaration lands here on any unrelated save (a colour
            // change), so it is restored as a per-source filter even after the
            // author changes or drops the declaration: a user who once saved
            // another setting keeps hitting the restored filter first. Accepted
            // (see seedDeclaredFilter): the record is visible in
            // the panel (the slider sits on the range) and Clear or Reset
            // removes it, while a seeded-vs-user marker on disk would be a
            // second ownership signal beside filtersTouched.
            filters: serializedFilters(this.layerFilters),
            filtersTouched: this.filtersTouched,
          } satisfies SavedConfig,
          CONFIG.name,
        ),
    });
    // Snapshot the Python CONFIG style defaults before any runtime toggle so
    // Reset restores exactly what construction started from (never localStorage).
    const defaultLabelShow = this.labelShow;
    const defaultLabelColor = this.labelColor;
    const defaultLabelSize = this.labelSize;
    const defaultLabelFormat = this.labelFormat;
    const defaultBorderWeight = this.borderWeight;
    const defaultBorderColor = this.borderColor;
    // Style delegation for the layer style drawer. The drawer mirrors every
    // presentation style (labels + hexagon border); aggregation field stays
    // data config on the heatmap panel. Stored on the manager so the drawer
    // dispatches changes through the same setters and refreshes from the same
    // provider.
    this.styleProvider = () => ({
      labelShow: this.labelShow,
      labelColor: this.labelColor,
      labelSize: this.labelSize,
      labelFormat: this.labelFormat,
      borderWeight: this.borderWeight,
      borderColor: this.borderColor,
    });
    this.styleSetters = {
      labelShow: v => {
        this.labelShow = v === true;
        this.renderHexagons();
        this.saveConfig();
        this.map.foliplus?.LayerAPI?.touchLayer?.(this.layerId);
        publish(this.events, EVENTS.LAYER_STYLE_CHANGE, { id: this.layerId });
      },
      // Size/color only rewrite label paint — drop the cached style and
      // redraw from the feature cache.
      labelColor: v => {
        this.labelColor =
          typeof v === "string" ? normalizeHexColor(v) : this.labelColor;
        this.cachedLabelStyle = null;
        this.redrawHeatmap();
        this.saveConfig();
        this.map.foliplus?.LayerAPI?.touchLayer?.(this.layerId);
        publish(this.events, EVENTS.LAYER_STYLE_CHANGE, { id: this.layerId });
      },
      labelSize: v => {
        const nextSize = typeof v === "number" && !Number.isNaN(v) ? v : this.labelSize;
        this.labelSize = clampLabelSize(nextSize);
        this.cachedLabelStyle = null;
        this.redrawHeatmap();
        this.saveConfig();
        this.map.foliplus?.LayerAPI?.touchLayer?.(this.layerId);
        publish(this.events, EVENTS.LAYER_STYLE_CHANGE, { id: this.layerId });
      },
      // Format only rewrites the label text — redraw from cache, skip the
      // H3 re-aggregation that labelShow triggers.
      labelFormat: v => {
        this.labelFormat = (
          typeof v === "string" ? v : NUMBER_FORMAT.AUTO
        ) as NumberStyle;
        this.redrawHeatmap();
        this.saveConfig();
        this.map.foliplus?.LayerAPI?.touchLayer?.(this.layerId);
        publish(this.events, EVENTS.LAYER_STYLE_CHANGE, { id: this.layerId });
      },
      // Border weight only redraws the hexagon strokes — the H3 aggregation
      // result is unaffected.
      borderWeight: v => {
        const nextWeight =
          typeof v === "number" && !Number.isNaN(v) ? v : this.borderWeight;
        this.borderWeight = clampBorderWeight(nextWeight);
        this.redrawHeatmap();
        this.saveConfig();
        this.map.foliplus?.LayerAPI?.touchLayer?.(this.layerId);
        publish(this.events, EVENTS.LAYER_STYLE_CHANGE, { id: this.layerId });
      },
      borderColor: v => {
        this.borderColor =
          typeof v === "string" ? normalizeHexColor(v) : this.borderColor;
        this.redrawHeatmap();
        this.saveConfig();
        this.map.foliplus?.LayerAPI?.touchLayer?.(this.layerId);
        publish(this.events, EVENTS.LAYER_STYLE_CHANGE, { id: this.layerId });
      },
    };
    this.overlay = map.foliplus!.LayerAPI!.createCanvas({
      id: this.layerId,
      name: this.T("title"),
      iconSvg: SVGs.ICON_HEXAGON,
      featureCountProvider: () => this.cachedFeatures?.length ?? 0,
      getBounds: () => this.computeBounds(),
      // Shared with the registry — syncSourceMeta mutates it in place so the
      // attrs panel always reads the latest source layer / field.
      meta: this.sourceMeta,
      styleProvider: this.styleProvider,
      styleSetters: this.styleSetters,
      // Filter capability: this manager is the filter's
      // owner; the LayerControl panel reads and writes through these.
      // Bound methods: the capability functions are the manager methods
      // themselves, so the two call sites stay covered and there is no
      // per-manager closure pair in the bundle.
      filterProvider: this.getFilterModel.bind(this),
      filterSetter: this.setFilter.bind(this),
      // Snapshot taken at construction — Reset restores this, never the
      // live toggle or the localStorage-persisted config.
      styleDefaultsProvider: () => ({
        labelShow: defaultLabelShow,
        labelColor: defaultLabelColor,
        labelSize: defaultLabelSize,
        labelFormat: defaultLabelFormat,
        borderWeight: defaultBorderWeight,
        borderColor: defaultBorderColor,
      }),
      // R11 dual path (`opacityBake: "redraw"` — the default): the slider
      // commit keeps CSS `opacity` for live feedback and does NOT force a
      // full hexagon redraw (measured 8ms warm / 30-320ms under load on a
      // stub ctx @5k, over a 16ms frame). The bake lands on the next
      // pan/zoom redraw: draws read `getLayerAlpha`, and `redrawHeatmap`
      // drops the CSS so the two carriers never compound.
      opacityBake: "redraw",
      onOpacity: () => {
        // Opacity-change repaint: drop the slider's CSS carrier first so
        // drawHexagon bakes layerAlpha into pixels and the two never compound.
        if (this.overlay.canvas) this.overlay.canvas.style.opacity = "";
        this.redrawHeatmap();
      },
    });
    // ExportControl publishes BEFORE/AFTER_EXPORT to request a full-resolution
    // capture pass: un-clip the render (renderAll) so out-of-bounds hexes
    // recompute, then clip again afterwards.  Named methods rather than
    // arrow literals so the two unsubs stay bound to stable identities and
    // removeExportListener below can release both as one pair.
    this.events = ensureEvents(this.map);
    this.removeExportListener = (() => {
      const unsubs = [
        this.events.on(EVENTS.BEFORE_EXPORT, () => this.onBeforeExport()),
        this.events.on(EVENTS.AFTER_EXPORT, () => this.onAfterExport()),
      ];
      return () => unsubs.forEach(unsub => unsub());
    })();
    this.ui = null;
    this.cachedPoints = null;
    this.cachedFeatures = null;
    this.cachedBins = null;
    this.cachedAgg = null;
    this.cachedLabelStyle = null;
    this.cachedSnapshot = null;
    this.cachedSnapshotLayerId = null;
    this.layerFilters = new Map();
    this.renderAll = false;
    this.hasScanned = false;

    this.bindMapEvents();
  }

  bindMapEvents() {
    // Hide canvas during zoom to avoid flicker, RAF-throttled redraw during pan.
    // zoomend triggers full re-render (renderHexagons) via separate handler
    // because it needs debounced H3 hexbin recalculation, not just cache redraw.
    this.mapCleanup = bindMapSync({
      map: this.map,
      hideEvents: ["zoomstart"],
      showEvents: ["zoomend"],
      onMove: () => {
        if (this.overlay.canvas && this.cachedFeatures) this.redrawHeatmap();
      },
      // Anti-flicker: the painted bitmap is borrowed away for the zoom and
      // handed back on zoomend. This rides the element's own `visibility`
      // style, NOT the HIDDEN class: that class is the LayerControl intent
      // channel (the executor is its single writer), and a temp-hide that
      // stamped it cannot tell "user hid it" apart from "zoom hid it" at
      // restore time.
      onHide: () => {
        const el = this.overlay.canvas;
        if (el) el.style.visibility = "hidden";
      },
      onShow: () => {
        const el = this.overlay.canvas;
        if (el) el.style.visibility = "";
      },
    });

    this.onZoomEnd = debounce(() => {
      if (this.selectedLayerId) {
        this.renderHexagons();
        // Safety clear in case a rebuild swapped the canvas between the
        // immediate handler and this debounced one; the style write is
        // idempotent and never touches the HIDDEN class.
        const el = this.overlay.canvas;
        if (el) el.style.visibility = "";
      }
    }, CONST.TIMING.ZOOM_DEBOUNCE);
    this.map.on("zoomend", this.onZoomEnd);

    this.onLayerChange = debounce(() => {
      this.cachedPoints = null;
      this.cachedAgg = null;
      this.cachedBins = null;
      this.cachedSnapshot = null;
      this.cachedSnapshotLayerId = null;
      this.scanMapLayers();
      // A deleted source has to take its derived view with it. The heatmap
      // draws another layer's points, so unregistering that layer must drop
      // the selection and wipe the canvas in this pass — a clear deferred to
      // the next zoom leaves the old render painted until something
      // re-aggregates. Deliberately outside `if (this.ui)`: the canvas is map
      // state, and a map can lose a source layer before (or without) a panel.
      if (
        this.selectedLayerId &&
        !this.pointLayers.some(p => p.id === this.selectedLayerId)
      ) {
        const departed = this.selectedLayerId;
        // Record the filter before deleting the entry: `Map.delete` is what
        // answers "was this source filtered", and the notification below must
        // still fire after the local cleanup has run.
        const hadFilter = this.layerFilters.delete(departed);
        this.selectedLayerId = null;
        if (hadFilter) this.saveConfig();
        // Local state and canvas converge first; the notification is
        // published through one operation so a throwing terminal count
        // consumer cannot cut the filter signal off.
        const operation = new SettledOperation(this.events);
        this.clearHeatmapCanvas(operation);
        if (hadFilter) {
          operation.emit(EVENTS.LAYER_FILTER_CHANGE, { id: this.layerId });
        }
        operation.throwIfFailed();
      }
      if (this.ui) rebuildLayerDropdown(this.ui);
    }, CONST.TIMING.LAYER_SCAN_DEBOUNCE);
    // Subscribe to the semantic registry-change event instead of raw Leaflet
    // layeradd/layerremove — LayerController emits EVENTS.LAYER_CHANGE on
    // register/unregister/reorder/membership, so unrelated map activity is
    // filtered out and callback-only registrations (no map.addLayer) are
    // covered too. The payload carries the changed layer's kind, so a layer
    // that cannot hold point markers is dropped without a map walk: a tile
    // basemap, a solid color face, and a self-drawn canvas all come back
    // "base"/null from getLayerType, so scanMapLayers would have filtered them
    // out and the source list would come out identical.
    this.removeLayerChangeListener = this.events.on(EVENTS.LAYER_CHANGE, payload => {
      // Guard: third-party or historical bare emit (no payload).
      // All product emit sites carry {id, kind} — a missing payload here
      // means an external caller fired the event without the contract.
      // Fallback: treat as a full layer change and rescan.
      if (!payload) {
        this.onLayerChange();
        return;
      }
      const { kind } = payload;
      if (NO_FEATURE_TREE_KINDS.has(kind)) return;
      this.onLayerChange();
    });
    // Runtime content changes on a registered source (`createLayers`
    // addLayer/removeLayer/clearLayers) publish LAYER_ITEM_COUNT_CHANGE, not
    // LAYER_CHANGE: membership is unchanged, only the data moved. The heatmap
    // draws that data, so the selected source's signal has to invalidate the
    // extraction/snapshot/bins pipeline — without it the next render keeps
    // painting the old snapshot. Filter `this.layerId` out: this manager
    // publishes the same event for its own output row after every render, and
    // consuming it would make the render self-trigger.
    this.onSourceContentChange = debounce(() => {
      if (!this.selectedLayerId) return;
      const operation = new SettledOperation(this.events);
      this.renderHexagons(operation, true);
      operation.throwIfFailed();
    }, CONST.TIMING.LAYER_SCAN_DEBOUNCE);
    this.removeContentChangeListener = this.events.on(
      EVENTS.LAYER_ITEM_COUNT_CHANGE,
      payload => {
        const { id } = payload;
        if (!id || id === this.layerId) return;
        if (id !== this.selectedLayerId) return;
        // Drop the caches synchronously: the panel's provider read between
        // this signal and the debounced repaint must not answer from the old
        // snapshot. `getSelectedPoints` rebuilds from the live layer walk.
        this.cachedPoints = null;
        this.cachedAgg = null;
        this.cachedBins = null;
        this.cachedSnapshot = null;
        this.cachedSnapshotLayerId = null;
        this.onSourceContentChange();
      },
      "internal",
    );
    // LayerControl's deleteLayer emits LAYER_DELETED for component-owned layers
    // instead of retiring the id in removedIds, so the heatmap can clear its
    // data and stay registerable for the next source pick. The clear resets
    // the panel to its initial state (the panel's Clear button is the same
    // operation), then persists the now-empty selection: a record with
    // layerId: null consumes the one-shot auto-select guard, so a reload does
    // not re-render the very heatmap the user just deleted. Persisting rather
    // than clearing the record is what makes this stick — dropping it would
    // make the store look like a first open and let the single-layer
    // auto-select fire again.
    this.removeLayerDeletedListener = this.events.on(
      EVENTS.LAYER_DELETED,
      ({ id }) => {
        if (id !== this.layerId) return;
        if (this.ui) {
          resetPanel(this.ui);
        } else {
          // No panel (control removed, or never built): reset state and wipe the
          // canvas directly so a re-add does not render the stale selection.
          this.resetState(CONFIG);
          this.clearHeatmapCanvas();
          this.syncSourceMeta();
        }
        this.saveConfig();
      },
      "internal",
    );
  }

  /** Drop out of export clip mode: redraw with the full feature set. */
  onBeforeExport() {
    this.renderAll = true;
    this.redrawHeatmap();
  }

  /** Restore normal clip mode after export capture. */
  onAfterExport() {
    this.renderAll = false;
    this.redrawHeatmap();
  }

  /** Redraw the heatmap canvas from cached features. */
  redrawHeatmap() {
    if (!this.overlay.canvas || !this.cachedFeatures) return;
    // R11 dual-path handoff. Two cases:
    //
    //  1. CSS empty (default, or cleared by `onOpacity`): bake layerAlpha
    //     into the pixel draws — the normal repaint path.
    //
    //  2. CSS set AND layerAlpha ≠ 1: an external writer (LayerControl
    //     replay on reload, or a slider commit still inside its debounce
    //     window) has set both carriers to the same value. Baking
    //     layerAlpha into pixels AND keeping CSS would compound
    //     (0.35 × 0.35). Instead, draw at full strength and let CSS
    //     carry the opacity — visually identical, no double-counting.
    //     Restore layerAlpha after the pass so the next repaint that does
    //     bake (post-debounce `onOpacity`) sees the slider value.
    const layerAlpha = getLayerAlpha(this.overlay.canvas);
    const preserveCss = this.overlay.canvas.style.opacity !== "" && layerAlpha !== 1;
    if (preserveCss) {
      setLayerAlpha(this.overlay.canvas, 1);
    } else {
      this.overlay.canvas.style.opacity = "";
    }
    const ctx = this.overlay.ctx;
    if (!ctx) return;
    const container = this.map.getContainer();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);

    const labelCfg = this.resolveLabelStyle();
    const bounds = this.renderAll ? null : this.map.getBounds();
    const isVisible = (feat: HexFeature) => {
      if (!bounds) return true;
      const pt = feat.properties.centroid;
      return !!pt && bounds.contains(L.latLng(pt[0], pt[1]));
    };

    this.cachedFeatures.forEach(feat => {
      if (!isVisible(feat)) return;
      this.drawHexagon(ctx, feat);
      if (this.labelShow) this.drawHexLabel(ctx, feat, labelCfg);
    });
    if (preserveCss) setLayerAlpha(this.overlay.canvas, layerAlpha);
  }

  /** Draw a single hexagon polygon (fill + stroke). */
  drawHexagon(ctx: CanvasRenderingContext2D, feat: HexFeature) {
    drawHexagonFn(ctx, feat, this.map, this.borderWeight, this.borderColor);
  }

  /** Resolve label styling from the shared --foliplus-label-* tokens (cached once). The
   *  values are the same the label canvas reads — both go through
   *  common/canvasLabel — so a hex value and an annotation label render as one
   *  language. */
  resolveLabelStyle(): CanvasLabelStyle {
    if (this.cachedLabelStyle) return this.cachedLabelStyle;
    this.cachedLabelStyle = resolveLabelStyleFn(
      this.ui!.ctrl,
      this.labelSize,
      this.labelColor,
    );
    return this.cachedLabelStyle;
  }

  /** Draw a formatted value label centered on the hexagon. */
  drawHexLabel(
    ctx: CanvasRenderingContext2D,
    feat: HexFeature,
    style: CanvasLabelStyle,
  ) {
    drawHexLabelFn(ctx, feat, style, this.map, this.labelFormat);
  }

  // --- Data Extraction ---

  /** Geographic extent of the heatmap, so LayerControl can focus this canvas
   *  layer (it has no Leaflet layer to derive bounds from). Uses the hexagon
   *  polygon rings when rendered (exact, includes the hexagon radius that the
   *  centroid alone would omit); falls back to the source point layers. */
  computeBounds(): L.LatLngBounds | null {
    const acc = L.latLngBounds([]);
    if (this.cachedFeatures?.length) {
      for (const feat of this.cachedFeatures) {
        const ring = feat.geometry?.coordinates?.[0];
        if (ring?.length) {
          // GeoJSON order [lng, lat].
          for (const [lng, lat] of ring) acc.extend([lat, lng]);
        } else {
          const pt = feat.properties.centroid;
          if (pt) acc.extend([pt[0], pt[1]]);
        }
      }
    } else {
      for (const info of this.pointLayers) {
        const layer = info.layer as L.Layer & { getBounds?: () => L.LatLngBounds };
        const b = layer?.getBounds?.();
        if (b?.isValid()) acc.extend(b);
      }
    }
    return acc.isValid() ? acc : null;
  }

  scanMapLayers() {
    this.pointLayers = [];
    const pointLayersInfo = map.foliplus!.LayerAPI!.getLayersByType("point");
    if (!pointLayersInfo.length) return;

    const seenIds: Record<string, boolean> = {};
    for (const info of pointLayersInfo) {
      if (seenIds[info.id]) continue;
      seenIds[info.id] = true;

      const pts = map.foliplus!.LayerAPI!.extractPoints(info.id);
      if (pts.length === 0) continue;
      this.pointLayers.push({
        id: info.id,
        name: info.name,
        layer: info.layer,
        count: pts.length,
      });
    }
  }

  /** Numeric property keys on the source points — bare `feature.properties`
   *  keys plus the two foliplus data-contract shapes (`value`, `options.value`).
   *  Same contract as LayerControl's annotation field picker for the bare keys. */
  /** Resolve the Python-declared starting layer against the scanned point
   *  layers. Null when nothing was declared, when the name matches no point
   *  layer (warned once — the panel then falls back to its normal
   *  auto-selection), or after a persisted record consumed the guard. */
  resolveDeclaredLayer(): string | null {
    if (!this.declaredLayer || this.hasScanned) return null;
    const hit = this.pointLayers.find(info => info.name === this.declaredLayer);
    if (!hit) {
      this.warnDeclaration("layer", this.declaredLayer);
      return null;
    }
    return hit.id;
  }

  /** Resolve the aggregation field for `fields`, without touching the cache:
   *  the user's stored pick while the data still offers it, else the Python
   *  declaration, else the first numeric field. Pure — it never writes to
   *  {@link field}, so neither the guess nor the declaration can become a
   *  persisted record. Public so the cache test can count resolutions.
   *
   *  With no field list (before the first scan, or a caller driving the
   *  manager directly) the stored names are trusted as-is. */
  resolveEffectiveField(fields: readonly string[]): string {
    if (fields.length === 0) {
      // "" is "no user pick", not a pick: fall through to the declaration.
      // (?? would stop at the empty string and hide the declared field.)
      if (this.field !== "") return this.field;
      return this.declaredField ?? "";
    }
    if (this.field && fields.includes(this.field)) return this.field;
    if (this.declaredField) {
      if (fields.includes(this.declaredField)) return this.declaredField;
      this.warnDeclaration("field", this.declaredField);
    }
    return fields[0] ?? "";
  }

  /** The field the render actually aggregates by — see
   *  {@link resolveEffectiveField} for the precedence. Memoised because
   *  `getPointValue` runs once per feature: re-resolving a list scan for 20k
   *  points would cost more than the guess it replaces. */
  effectiveField(): string {
    return (this.effectiveFieldCache ??= this.resolveEffectiveField(
      this.availableFields,
    ));
  }

  /** Publish the fields the current scan offers and resolve the effective
   *  field once. Returns it so the panel can render the same value it just
   *  handed over (one resolver, no second opinion). */
  setAvailableFields(fields: readonly string[]): string {
    this.availableFields = [...fields];
    this.effectiveFieldCache = this.resolveEffectiveField(this.availableFields);
    return this.effectiveFieldCache;
  }

  /** Drop the memoised field (next read re-resolves). Called wherever the
   *  inputs move: a new field list, a persistence write, Reset. */
  invalidateEffectiveField(): void {
    this.effectiveFieldCache = null;
  }

  /** One warning per missing declared name: the scan runs more than once on
   *  the way to the first render, and a per-rebuild warn would flood. */
  private warnDeclaration(kind: "layer" | "field", name: string): void {
    const key = kind + ":" + name;
    if (this.declarationWarned.has(key)) return;
    this.declarationWarned.add(key);
    this.log.warn("declared " + kind + " not found:", name);
  }

  collectFields(layers: Array<{ id: string }>): string[] {
    const fields: string[] = [];
    const seen = new Set<string>();
    const api = map.foliplus!.LayerAPI!;
    // forEachPoint is the lazy twin of extractPoints: the scan only reads
    // markers, so it must not allocate a {lat, lng, marker} per point (or
    // call getLatLng) just to drop the coordinates again. An older common
    // bundle (or a test stub) may not expose it yet — fall back to the
    // extracting form there, keeping the scan correct if slower.
    const eachPoint = (id: string, fn: (marker: L.Marker | L.CircleMarker) => void) => {
      if (api.forEachPoint) api.forEachPoint(id, fn);
      else api.extractPoints(id).forEach(pt => fn(pt.marker));
    };
    layers.forEach(info => {
      eachPoint(info.id, marker => {
        const extended = marker as HeatmapPointMarker;
        if (typeof extended.value === "number" && !seen.has("value")) {
          seen.add("value");
          fields.push("value");
        }
        if (typeof extended.options?.value === "number" && !seen.has("options.value")) {
          seen.add("options.value");
          fields.push("options.value");
        }
        const props = marker.feature?.properties;
        if (!props) return;
        // `feature.properties` is the JSON-deserialized GeoJSON payload: a
        // plain object whose prototype has no enumerable keys, so `for...in`
        // visits exactly the own keys Object.keys would allocate an array for.
        // (A non-JSON carrier that injected enumerable prototype keys would
        // widen this — the field scan is fed by the GeoJSON reader, not by
        // arbitrary objects.)
        for (const fieldName in props) {
          if (typeof props[fieldName] === "number" && !seen.has(fieldName)) {
            seen.add(fieldName);
            fields.push(fieldName);
          }
        }
      });
    });
    return fields;
  }

  getPointValue(marker: L.Marker | L.CircleMarker): number {
    if (this.agg === CONST.AGG.COUNT) return 1;
    // Memoised: this runs once per feature (20k points on a large layer).
    const key = this.effectiveField();
    const val = readMarkerField(marker, key);
    if (val === undefined || isNaN(val)) {
      if (!this.valueFallbackWarned) {
        this.valueFallbackWarned = true;
        this.log.warn("value fallback to 1", key);
      }
      return 1;
    }
    return Number(val);
  }

  getSelectedPoints(): SelectedPoint[] {
    this.valueFallbackWarned = false;
    const key = `${this.selectedLayerId}|${this.agg}|${this.effectiveField()}`;
    if (this.cachedPoints?.key === key) {
      return this.cachedPoints.pts;
    }

    const pts: SelectedPoint[] = [];
    if (!this.selectedLayerId) return pts;
    const info = this.pointLayers.find(i => i.id === this.selectedLayerId);
    if (!info) return pts;

    const rawPts = map.foliplus!.LayerAPI!.extractPoints(info.id);
    rawPts.forEach(p => {
      pts.push({
        lat: p.lat,
        lng: p.lng,
        value: this.getPointValue(p.marker),
        marker: p.marker as L.Marker,
      });
    });
    this.cachedPoints = { key, pts };
    // Build/cache the snapshot from the already-extracted points — same
    // order as `pts`, so filter indices align. We do NOT walk the layer
    // tree (buildLayerSnapshot uses `instanceof L.Marker`, which fails
    // under vitest's plain-object mocks). Instead we extract fields
    // directly from each marker's folium contract.
    if (this.cachedSnapshotLayerId !== this.selectedLayerId) {
      this.cachedSnapshot = snapshotFromPoints(rawPts, this.log);
      this.cachedSnapshotLayerId = this.selectedLayerId;
    }
    return pts;
  }

  // --- Filter capability ---
  //
  // This manager owns the filter: the LayerControl panel reads
  // `getFilterModel` and writes `setFilter` through the registry
  // capabilities; there is no second write path and no second copy of
  // the state (the old runtime-store + payload + manager-map trio is
  // gone). LAYER_FILTER_CHANGE is a notification published after the
  // local state and render have settled.

  /** Follow an aggregation-field change: a stored filter belongs to the field
   *  it was written for, so a different effective field drops it. The caller
   *  repaints and publishes LAYER_FILTER_CHANGE (the panel re-reads the model,
   *  which is now a different shape, and rebuilds its rail/extent). */
  syncFilterField(): void {
    const sourceId = this.selectedLayerId;
    if (!sourceId) return;
    const field = pickFilterField(this.cachedSnapshot, this.effectiveField());
    if (!dropFilterForField(this.layerFilters, sourceId, field)) return;
    this.cachedAgg = null;
    this.saveConfig();
  }

  /** The filter panel's view of this row's filter state, computed from
   *  this manager's own state — the single read path. Returns null when
   *  the row has no filterable data (no source selected, or no numeric
   *  field on the snapshot). */
  getFilterModel(): LayerFilterModel | null {
    const sourceId = this.selectedLayerId;
    if (!sourceId) return null;
    this.getSelectedPoints(); // ensures cachedSnapshot is built for this source
    // The filtered unit is the heatmap's own output — hex cells, not source
    // points: a filter that drops points inside a cell keeps the cell. The
    // bins cache is the unfiltered cell set; the drawn features are what the
    // committed filter kept.
    const total = this.cachedBins?.bins.size ?? 0;
    const kept = this.cachedFeatures?.length ?? 0;
    return buildFilterModel(
      this.cachedSnapshot,
      this.layerFilters.get(sourceId),
      this.effectiveField(),
      { kept, total },
    );
  }
  /** Write path for the filter panel. Validates the incoming atom against
   *  the current snapshot (unknown field or non-atom → no filter; range
   *  clamped into the field's extent; a range equal to the full extent
   *  means "no filter" — a full-range atom would still exclude points
   *  missing the field, which is not what dragging back to the ends
   *  means). No-op when the validated filter equals the stored one.
   *  Re-renders from the bins cache (zero h3 calls) and publishes
   *  LAYER_FILTER_CHANGE once the render has settled.
   *
   *  The render's terminal count signal and the filter notification are
   *  fan out through one SettledOperation: a throwing count consumer is
   *  raised only after the filter notification has reached its observers,
   *  so a broken subscriber cannot leave the UI reading an old model. */
  setFilter(filter: LayerFilter | undefined) {
    const sourceId = this.selectedLayerId;
    if (!sourceId) return;
    // The panel may write before any render ran (open → drag). The snapshot
    // is the validation baseline, so build it here — cached after the first
    // call, so the steady path is free.
    this.getSelectedPoints();
    if (
      !storeFilter(
        this.layerFilters,
        sourceId,
        normalizeFilter(filter, this.cachedSnapshot),
      )
    ) {
      return;
    }
    // The user owns the filter slot from here on, including when the write
    // cleared it: a declaration must not resurrect itself on the next load.
    this.filtersTouched = true;
    this.saveConfig();
    // The filter is part of the agg key — drop the agg cache. cachedPoints
    // and cachedBins survive: filtering changes neither geometry nor point
    // identity, so the bins are reused and no h3 call runs.
    this.cachedAgg = null;
    const operation = new SettledOperation(this.events);
    this.renderHexagons(operation);
    operation.emit(EVENTS.LAYER_FILTER_CHANGE, { id: this.layerId });
    operation.throwIfFailed();
  }

  /** One warning per declared-filter problem: the seed runs again on every
   *  rebuild of the first open, and a per-rebuild warn would flood. */
  private warnDeclaredFilter(reason: string): void {
    const key = "filter:" + reason;
    if (this.declarationWarned.has(key)) return;
    this.declarationWarned.add(key);
    this.log.warn("declared filter ignored:", reason);
  }

  /** Seed the Python-declared filter as the starting condition.
   *
   *  Called from the layer-list build once the source is settled and before
   *  the first render. Two gates keep it from overriding the user: a persisted
   *  record that already owns the filter slot (filtersTouched — including a
   *  record that says "cleared"), and a restored per-source filter. The
   *  factory Reset drops the ownership, so the declaration returns with the
   *  rest of the declared defaults.
   *
   *  Validation is the runtime's, not the declaration's: the AST was parsed by
   *  the same tolerant reader a stored record uses, then it is clamped to the
   *  snapshot and bound to the dimension the panel can actually edit. A
   *  declaration the panel cannot represent (an enum atom, a field the
   *  dimension does not carry, no numeric extent) is reported once and
   *  ignored — never turned into a filter that hides the layer.
   *
   *  Persistence caveat (deliberate, pinned by a test): the seeded filter
   *  lives in the same per-source store a panel write uses, so any later save
   *  of an unrelated setting (a colour, a class count) persists it with the
   *  rest of the record. If the author then changes the declaration, a user
   *  who has ever saved another setting still hits the restored per-source
   *  filter first — the seed is skipped by layerFilters.has(sourceId) — until
   *  Clear or Reset. That is the cost of "the declaration is a starting
   *  condition and the user owns the slot from the first write"; a second,
   *  declaration-only store would make Reset and the filter panel disagree. */
  seedDeclaredFilter(): void {
    if (this.filtersTouched) return;
    const sourceId = this.selectedLayerId;
    if (!sourceId || this.layerFilters.has(sourceId)) return;
    if (!this.declaredFilter) {
      if (this.declaredFilterInvalid) {
        this.warnDeclaredFilter("unreadable declaration");
      }
      return;
    }
    this.getSelectedPoints();
    const snapshot = this.cachedSnapshot;
    // An empty (or not-yet-built) snapshot is a *timing* state, not a data
    // defect: the seed runs from the panel build, which can precede the
    // source's first paint, and getSelectedPoints rebuilds the snapshot only
    // when the source id changed — a cache cleared by a content change can
    // still be null here. Nothing below can be judged without data: the field
    // binding would compare against an empty field list and the extent against
    // a missing range. Stay quiet (debug only) and let the next rebuild retry;
    // a report now would blame the author's declaration for an empty read and,
    // being remembered in declarationWarned, would silence the real problem
    // once the data lands.
    if (!snapshot || snapshot.points.length === 0) {
      this.log.debug("declared filter: the source snapshot is not populated yet");
      return;
    }
    const field = pickFilterField(snapshot, this.effectiveField());
    const declared = this.declaredFilter;
    if (declared.kind !== "atom") {
      // The panel's only dimension is a numeric range; a declared enum/logical
      // node has no row to show it on (task-102 covers that dimension).
      this.warnDeclaredFilter("the panel filters a numeric range only");
      return;
    }
    if (declared.field !== field) {
      this.warnDeclaredFilter(
        `bound to "${declared.field}", the panel filters "${field}"`,
      );
      return;
    }
    // The panel needs a numeric extent to render a range on: the source has
    // points but this field carries no value on any of them, so there is no
    // row to show the declaration in — a data problem worth reporting. A
    // declaration that spans the whole extent is different — the runtime reads
    // that as "no filter" (a full-range atom would still exclude points
    // missing the field), so it is a legal no-op, not a defect.
    const bounds = snapshot.ranges[field];
    if (!bounds) {
      this.warnDeclaredFilter(`"${field}" has no usable extent`);
      return;
    }
    // A range that does not intersect the extent can never keep a point;
    // normalising it would collapse it onto one bound and silently hide the
    // data. Report it and start unfiltered — "declared" must never mean
    // "filtered to empty".
    if (declared.range) {
      const [lo, hi] = declared.range;
      if (hi < bounds[0] || lo > bounds[1]) {
        this.warnDeclaredFilter(
          `[${lo}, ${hi}] is outside "${field}"'s extent [${bounds[0]}, ${bounds[1]}]`,
        );
        return;
      }
    }
    const next = normalizeFilter(declared, snapshot);
    // Undefined here means the declaration covers the whole extent: the same
    // state as "no filter", so store nothing and stay quiet.
    if (!next) return;
    storeFilter(this.layerFilters, sourceId, next);
  }

  /** Align the stored filter for the selected source with the freshly
   *  built snapshot — the shared tail of every content/identity change
   *  (source switch, feature add/remove, data update). Clamps a between
   *  range into the field's current extent and drops the filter when its
   *  field disappeared. Returns true when the stored filter changed, so
   *  the render tail can publish the notification. */
  private revalidateFilter(): boolean {
    const sourceId = this.selectedLayerId;
    const snapshot = this.cachedSnapshot;
    if (!sourceId || !snapshot) return false;
    if (!revalidateStoredFilter(this.layerFilters, sourceId, snapshot)) return false;
    this.cachedAgg = null;
    this.saveConfig();
    return true;
  }

  /** Render the selected source into hexagons.
   *
   *  `operation` is supplied by a wider write (the filter setter, a content
   *  invalidation) that owes a LAYER_FILTER_CHANGE *after* this render. When
   *  given, this method only queues the terminal count signal on it and lets
   *  the caller raise failures once the whole fan-out is done — so a throwing
   *  count consumer cannot interrupt before the filter notification. Without
   *  one, a local operation is created and settled here, preserving the
   *  existing raise-at-the-end-of-render contract.
   *
   *  `contentChanged` marks a render driven by a source content signal rather
   *  than a filter write. The model (extent, kept/total) is derived from that
   *  content, so the notification must go out even when the stored filter
   *  itself survived revalidation unchanged — otherwise an open panel keeps
   *  showing counts that no longer match the map. */
  renderHexagons(operation?: SettledOperation, contentChanged = false) {
    if (!this.map || !this.overlay) return;
    const op = operation ?? new SettledOperation(this.events);
    if (!this.selectedLayerId) {
      this.clearHeatmapCanvas(op);
      if (!operation) op.throwIfFailed();
      return;
    }
    const allPts = this.getSelectedPoints();
    // Content or identity may have moved under the stored filter (source
    // switch, data update) — align it with the fresh snapshot before the
    // include set is computed, and publish once the render has settled.
    const filterRevalidated = this.revalidateFilter();
    const zoom = this.map.getZoom();
    const res = getH3Res(zoom);
    const fKey = filterKey(this.layerFilters.get(this.selectedLayerId!));
    const includeSet = selectIndices(
      this.cachedSnapshot,
      this.layerFilters.get(this.selectedLayerId!),
      allPts.length,
    );
    // Bins cache: geometry only, independent of the filter. A filter
    // change reuses the bins and only reruns aggregateBins.
    const binsKey = `${this.selectedLayerId}|${res}`;
    let bins: Map<string, number[]> | undefined;
    if (this.cachedBins?.key === binsKey) {
      bins = this.cachedBins.bins;
    } else {
      bins = binPointsFn(allPts, res, this.log);
      this.cachedBins = { key: binsKey, bins };
    }
    // Agg cache: includes the filter key. A filter change invalidates
    // this, but the bins cache above still hits — zero h3 calls.
    const aggKey = `${binsKey}|${this.agg}|${this.effectiveField()}|${this.method}|${this.scheme}|${this.numClasses}|${fKey}`;
    let aggregated: AggregatedData | undefined;
    if (this.cachedAgg?.key === aggKey) {
      aggregated = this.cachedAgg.data;
    } else {
      aggregated =
        this.aggregateData(allPts, res, includeSet, bins, () =>
          // An empty aggregate (the committed filter kept no cell) clears the
          // canvas but must keep the geometry: the model total is the
          // unfiltered cell count, so the result readout still reads
          // "0 of N". The bins are keyed to the current points, and any
          // content/identity change drops them through
          // onSourceContentChange/onLayerChange.
          this.clearHeatmapCanvas(op, true),
        ) ?? undefined;
      if (aggregated) this.cachedAgg = { key: aggKey, data: aggregated };
    }
    if (!aggregated) {
      if (filterRevalidated || contentChanged) {
        op.emit(EVENTS.LAYER_FILTER_CHANGE, { id: this.layerId });
      }
      if (!operation) op.throwIfFailed();
      return;
    }
    const features = this.buildFeatures(aggregated);
    this.renderFeatures(features, op);
    if (filterRevalidated || contentChanged) {
      op.emit(EVENTS.LAYER_FILTER_CHANGE, { id: this.layerId });
    }
    if (!operation) op.throwIfFailed();
  }

  aggregateData(
    pts: SelectedPoint[],
    res: number,
    include?: Set<number>,
    precomputedBins?: Map<string, number[]>,
    onEmpty?: () => void,
  ): AggregatedData | null {
    return aggregateDataFn(
      pts,
      res,
      this.agg,
      this.numClasses,
      this.method,
      this.scheme,
      onEmpty ?? (() => this.clearHeatmapCanvas()),
      this.log,
      include,
      precomputedBins,
    );
  }

  buildFeatures(agg: AggregatedData): HexFeature[] {
    return buildFeaturesFn(agg, this.log);
  }

  renderFeatures(features: HexFeature[], operation?: SettledOperation) {
    if (!features.length) {
      this.clearHeatmapCanvas(operation);
      return;
    }
    this.cachedFeatures = features;
    this.overlay.register();
    this.redrawHeatmap();
    // Notify LayerControl to refresh the count column for this layer. Queued
    // on the caller's operation when there is one, so a throwing terminal
    // consumer cannot cut off the filter notification that follows.
    this.publishCount(operation);
  }

  clearHeatmapCanvas(operation?: SettledOperation, keepBins = false) {
    this.cachedFeatures = null;
    this.cachedAgg = null;
    // keepBins is for the empty-aggregate path only: the drawn features are
    // gone but the cell set is still the unfiltered total the filter model
    // reports. A real teardown (departure, reset, empty selection) drops it.
    if (!keepBins) this.cachedBins = null;
    // cachedSnapshot and layerFilters are keyed by source id and survive a
    // canvas clear: switching source (or clearing the canvas on an empty
    // render) must not silently drop another source's committed filter —
    // A → B → A re-selects the same filter the user set. They are wiped
    // with the row itself (resetState / the departing-source branch of
    // onLayerChange), not with every canvas repaint.
    if (this.overlay) this.overlay.unregister();
    // The panel row is gone and the next draw is new content: drop this id
    // from the stored order so the next registration lands at the top of the
    // overlay stack instead of returning to the slot the user arranged.
    // Without this, insertOverlayAt would find a stored rank and placeBeforeSavedNeighbor
    // would put the redrawn heatmap back where it was, not on top.
    this.map.foliplus?.LayerAPI?.forgetSavedOrder?.(this.layerId);
    this.ui?.schemeBarCleanup?.();
    // Notify LayerControl to refresh the count column (now 0).
    this.publishCount(operation);
  }

  /** Publish this row's count signal. Routed through the caller's operation
   *  when one exists so a later notification on the same operation still
   *  fans out before the terminal count failure is raised. */
  private publishCount(operation?: SettledOperation): void {
    if (operation) operation.emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: this.layerId });
    else publish(this.events, EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: this.layerId });
  }

  /** Reset selection + style state to the defaults declared in `config`. Both
   *  clear entries (the panel's Clear button and LayerControl's more-menu
   *  delete) go through here, so the two can never drift apart. */
  resetState(config: ComponentConfig) {
    const clearedFilter = this.layerFilters.size > 0;
    this.selectedLayerId = null;
    this.agg = config.agg ?? CONST.AGG.COUNT;
    this.field = "";
    // Reset returns to the declared state: the field list belongs to the
    // selection that just went away, and the resolved field must come from
    // the declaration (or stay empty), never from a stale scan.
    this.availableFields = [];
    this.invalidateEffectiveField();
    this.numClasses = config.num_classes ?? CLASS_COUNT.DEFAULT;
    this.method = resolveClassifyMethod(config.method);
    this.scheme = config.color_scheme ?? "Reds";
    // The clear wipes the row's data — every source's filter is a statement
    // about data that no longer exists.
    this.layerFilters.clear();
    this.cachedSnapshot = null;
    this.cachedSnapshotLayerId = null;
    // Reset returns the manager to the Python-declared starting state: the
    // record is about to be deleted, so re-open the one-shot guard and let
    // the declaration (and the single-layer auto-select) apply again. The
    // filter slot's ownership goes with it — the declared filter is part of
    // the declared state Reset returns to.
    this.hasScanned = false;
    this.filtersTouched = false;
    if (clearedFilter) {
      publish(this.events, EVENTS.LAYER_FILTER_CHANGE, { id: this.layerId });
    }
  }

  /** Load saved configuration from localStorage into this manager's state. */
  loadSavedConfig(): SavedConfig | null {
    return loadSavedConfigFn();
  }

  /** Save the current manager state to localStorage through the write-through
   *  binding, so the flat inline-version record stays durable the moment a UI
   *  change lands. The binding reads live state at save time, so callers just
   *  signal a change without restating the fields. */
  saveConfig() {
    // The record carries `field`, so a write can be the moment the user's
    // pick changed: re-resolve on the next read instead of trusting a value
    // computed before the pick moved.
    this.invalidateEffectiveField();
    this.persist.schedule();
  }

  /** Flush any pending write through the binding — idempotent and teardown-safe. */
  flush() {
    this.persist.flush();
  }

  /** Remove persisted configuration from localStorage. */
  clearSavedConfig() {
    clearSavedConfigFn();
  }

  /** Drop the LayerControl-side record this draw left behind — visibility,
   *  opacity, zoom range with their provenance, plus the stored order slot —
   *  so a fresh draw of the same id starts from the author's defaults instead
   *  of inheriting the tuning the user arranged for the previous one.
   *
   * Only the panel's Clear button calls it. LayerControl's overflow Clear Data
   * reaches the same prune from `deleteLayer`, and the reload path must never
   * run it — a reload is not a clear.
   */
  clearLayerState() {
    this.map.foliplus?.LayerAPI?.dropPersistedLayerState?.(this.layerId);
  }

  /**
   * Publish the current source layer name + aggregation field into
   * `sourceMeta` (the object createCanvas registered), so LayerControl's
   * attributes panel can answer "where did this heatmap come from?".
   * Empty values are written too — the attrs panel drops blank rows.
   * `touchLayer` fires only when a published value actually changed, so a
   * no-op dropdown rebuild does not bump the panel's Updated stamp.
   */
  syncSourceMeta() {
    const layerName = this.selectedLayerId
      ? (this.pointLayers.find(i => i.id === this.selectedLayerId)?.name ?? "")
      : "";
    let fieldLabel = "";
    if (this.selectedLayerId && this.agg !== CONST.AGG.COUNT) {
      const key = this.effectiveField();
      if (key) fieldLabel = bareFieldName(key);
    }

    const sourceKey = this.T("meta_source_layer");
    const fieldKey = this.T("meta_agg_field");
    const changed =
      this.sourceMeta[sourceKey] !== layerName ||
      this.sourceMeta[fieldKey] !== fieldLabel;
    this.sourceMeta[sourceKey] = layerName;
    this.sourceMeta[fieldKey] = fieldLabel;

    if (!changed) return;
    // Stamp updatedAt so the panel's "Updated" row tracks the latest binding.
    // Free `map` (window.map) — same channel createCanvas / scanMapLayers use;
    // `this.map` is the Leaflet instance and may not carry the foliplus namespace.
    map.foliplus?.LayerAPI?.touchLayer?.(this.layerId);
  }

  /** Apply a loaded config object to the manager's state. */
  applySavedConfig(saved: SavedConfig) {
    applySavedConfigFn(this, saved);
  }
}

export { HeatmapManager };

// HeatmapControl data aggregation & rendering logic (HeatmapManager).
import {
  METHOD as CLASSIFY_METHOD,
  computeBreaks as computeBreaksFn,
} from "#core/classify.js";
import { generateId } from "#core/component.js";
import { EVENTS, type EventBus, ensureEvents } from "#core/event/index.js";
import { bareFieldName } from "#core/labelField.js";
import { NO_FEATURE_TREE_KINDS } from "#core/layer/index.js";
import { bindMapSync } from "#core/leaflet/index.js";
import { type CanvasLabelStyle } from "#common/canvasLabel.js";
import { type Debounced, debounce } from "#common/debounce.js";
import { BORDER_WEIGHT, clampLabelSize, normalizeHexColor } from "#common/form.js";
import { NUMBER_FORMAT, type NumberStyle } from "#common/format.js";
import { type Logger, createLogger } from "#common/log.js";
import { type Persisted, makePersisted } from "#common/storage.js";
import * as Storage from "#common/storage.js";
import * as CONST from "./const.js";
import {
  aggregateData as aggregateDataFn,
  buildFeatures as buildFeaturesFn,
  getColorScale as getColorScaleFn,
  getH3Res as getH3ResFn,
  pickAutoField as pickAutoFieldFn,
  readMarkerField as readMarkerFieldFn,
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
  HexCell,
  HexFeature,
  PointLayerInfo,
  SavedConfig,
  SelectedPoint,
} from "./type.js";
import { type HeatmapControlUI, rebuildLayerDropdown, resetPanel } from "./ui.js";

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
  events: EventBus;
  selectedLayerId: string | null;
  pointLayers: PointLayerInfo[];
  currentAgg: string;
  /** Selected aggregation field — starts empty (no Python-side declaration),
   *  becomes the first numeric property name in auto mode, or whatever the
   *  user picked from the field dropdown. */
  currentField: string;
  currentScheme: string;
  currentMethod: string;
  autoFieldKey: string | null;
  numClasses: number;
  borderWeight: number;
  borderColor: string;
  currentLabelShow: boolean;
  /** Runtime label color/size — heatmap panel and layer drawer both write these. */
  currentLabelColor: string;
  currentLabelSize: number;
  /** Runtime label number format — heatmap panel and layer drawer both write
   *  this; Python CONFIG only seeds the initial value. */
  currentLabelFormat: NumberStyle;
  /** Style provider — shared by the layer drawer and the heatmap panel's
   *  label controls (core/labelControl). Reads live state; the drawer refreshes on
   *  LAYER_STYLE_CHANGE. */
  styleProvider: () => Record<string, unknown>;
  /** Style setters — shared by the layer drawer and the heatmap panel's
   *  label controls. Each setter updates state, renders, persists, and emits
   *  LAYER_STYLE_CHANGE so the other panel's refresh fires. */
  styleSetters: Record<string, (v: unknown) => void>;
  valueFallbackWarned: boolean;
  overlay: CreateCanvasAPI;
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
  ui: HeatmapControlUI | null;
  cachedPoints: { key: string; pts: SelectedPoint[] } | null;
  cachedFeatures: HexFeature[] | null;
  cachedAgg: { key: string; data: AggregatedData } | null;
  cachedLabelStyle: CanvasLabelStyle | null;
  renderAll: boolean;
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
  hasScanned: boolean;
  declare mapCleanup: () => void;
  declare onZoomEnd: Debounced;
  declare onLayerChange: Debounced;
  declare removeLayerChangeListener: () => void;
  declare removeLayerDeletedListener: () => void;
  declare removeExportListener: () => void;

  /** The layer id used to register this manager's heatmap canvas. */
  layerId: string;

  /** Persisted-config binding — write-through (no debounce window). Owns the
   *  save entry point so teardown flush is idempotent. The flat inline-version
   *  record stays as-is (no envelope), matching the pre-existing shape. */
  private persist: Persisted;

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
    this.currentAgg = CONFIG.agg ?? CONST.AGG.COUNT;
    this.currentField = "";
    this.currentScheme = CONFIG.color_scheme ?? "Reds";
    this.currentMethod = CONFIG.method ?? CLASSIFY_METHOD.JENKS;
    this.autoFieldKey = null;
    this.numClasses = CONFIG.n_classes ?? CONST.CLASS_COUNT.DEFAULT;
    this.borderWeight = CONFIG.border_weight ?? BORDER_WEIGHT.DEFAULT;
    this.borderColor = CONFIG.border_color ?? CONST.GRAY;
    // Python default is True; only an explicit false turns labels off — same
    // `!== false` rule MeasureControl uses for label_show / label_collide.
    this.currentLabelShow = CONFIG.label_show !== false;
    // Color inputs require #rrggbb — normalize the short #fff Python default.
    this.currentLabelColor = normalizeHexColor(
      CONFIG.label_color ?? CONST.LABEL.COLOR_DEFAULT,
    );
    this.currentLabelSize = clampLabelSize(
      CONFIG.label_size ?? CONST.LABEL.SIZE_DEFAULT,
    );
    this.currentLabelFormat = (CONFIG.label_format ??
      NUMBER_FORMAT.AUTO) as NumberStyle;
    this.valueFallbackWarned = false;
    this.sourceMeta = {};
    // Write-through binding: config is durable the moment a UI change lands,
    // so there is nothing to coalesce. Flush on teardown stays idempotent.
    this.persist = makePersisted({
      save: () =>
        Storage.saveRecord(
          CONST.STORAGE.KEY,
          {
            version: CONST.RECORD_VERSION,
            layerId: this.selectedLayerId,
            agg: this.currentAgg,
            method: this.currentMethod,
            scheme: this.currentScheme,
            numClasses: this.numClasses,
            borderWeight: this.borderWeight,
            borderColor: this.borderColor,
            labelShow: this.currentLabelShow,
            labelColor: this.currentLabelColor,
            labelSize: this.currentLabelSize,
            labelFormat: this.currentLabelFormat,
            field: this.currentField,
          } satisfies SavedConfig,
          CONFIG.name,
        ),
    });
    // Snapshot the Python CONFIG style defaults before any runtime toggle so
    // Reset restores exactly what construction started from (never localStorage).
    const defaultLabelShow = this.currentLabelShow;
    const defaultLabelColor = this.currentLabelColor;
    const defaultLabelSize = this.currentLabelSize;
    const defaultLabelFormat = this.currentLabelFormat;
    const defaultBorderWeight = this.borderWeight;
    const defaultBorderColor = this.borderColor;
    // Style delegation for the layer style drawer. The drawer mirrors every
    // presentation style (labels + hexagon border); aggregation field stays
    // data config on the heatmap panel. Stored on the manager so the drawer
    // dispatches changes through the same setters and refreshes from the same
    // provider.
    this.styleProvider = () => ({
      labelShow: this.currentLabelShow,
      labelColor: this.currentLabelColor,
      labelSize: this.currentLabelSize,
      labelFormat: this.currentLabelFormat,
      borderWeight: this.borderWeight,
      borderColor: this.borderColor,
    });
    this.styleSetters = {
      labelShow: v => {
        this.currentLabelShow = v === true;
        this.renderHexagons();
        this.saveConfig();
        this.map.foliplus?.LayerAPI?.touchLayer?.(this.layerId);
        this.events.emit(EVENTS.LAYER_STYLE_CHANGE, { id: this.layerId });
      },
      // Size/color only rewrite label paint — drop the cached style and
      // redraw from the feature cache.
      labelColor: v => {
        this.currentLabelColor =
          typeof v === "string" ? normalizeHexColor(v) : this.currentLabelColor;
        this.cachedLabelStyle = null;
        this.redrawHeatmap();
        this.saveConfig();
        this.map.foliplus?.LayerAPI?.touchLayer?.(this.layerId);
        this.events.emit(EVENTS.LAYER_STYLE_CHANGE, { id: this.layerId });
      },
      labelSize: v => {
        const n = typeof v === "number" && !Number.isNaN(v) ? v : this.currentLabelSize;
        this.currentLabelSize = clampLabelSize(n);
        this.cachedLabelStyle = null;
        this.redrawHeatmap();
        this.saveConfig();
        this.map.foliplus?.LayerAPI?.touchLayer?.(this.layerId);
        this.events.emit(EVENTS.LAYER_STYLE_CHANGE, { id: this.layerId });
      },
      // Format only rewrites the label text — redraw from cache, skip the
      // H3 re-aggregation that labelShow triggers.
      labelFormat: v => {
        this.currentLabelFormat = (
          typeof v === "string" ? v : NUMBER_FORMAT.AUTO
        ) as NumberStyle;
        this.redrawHeatmap();
        this.saveConfig();
        this.map.foliplus?.LayerAPI?.touchLayer?.(this.layerId);
        this.events.emit(EVENTS.LAYER_STYLE_CHANGE, { id: this.layerId });
      },
      // Border weight only redraws the hexagon strokes — the H3 aggregation
      // result is unaffected.
      borderWeight: v => {
        const n = typeof v === "number" && !Number.isNaN(v) ? v : this.borderWeight;
        this.borderWeight = Math.min(BORDER_WEIGHT.MAX, Math.max(BORDER_WEIGHT.MIN, n));
        this.redrawHeatmap();
        this.saveConfig();
        this.map.foliplus?.LayerAPI?.touchLayer?.(this.layerId);
        this.events.emit(EVENTS.LAYER_STYLE_CHANGE, { id: this.layerId });
      },
      borderColor: v => {
        this.borderColor =
          typeof v === "string" ? normalizeHexColor(v) : this.borderColor;
        this.redrawHeatmap();
        this.saveConfig();
        this.map.foliplus?.LayerAPI?.touchLayer?.(this.layerId);
        this.events.emit(EVENTS.LAYER_STYLE_CHANGE, { id: this.layerId });
      },
    };
    this.overlay = map.foliplus!.LayerAPI!.createCanvas({
      id: this.layerId,
      name: this.T("title"),
      iconSvg: SVGs.HEXAGON,
      featureCountProvider: () => this.cachedFeatures?.length ?? 0,
      getBounds: () => this.computeBounds(),
      // Shared with the registry — syncSourceMeta mutates it in place so the
      // attrs panel always reads the latest source layer / field.
      meta: this.sourceMeta,
      styleProvider: this.styleProvider,
      styleSetters: this.styleSetters,
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
    this.cachedAgg = null;
    this.cachedLabelStyle = null;
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
        const c = this.overlay.canvas;
        if (c) c.style.visibility = "hidden";
      },
      onShow: () => {
        const c = this.overlay.canvas;
        if (c) c.style.visibility = "";
      },
    });

    this.onZoomEnd = debounce(() => {
      if (this.selectedLayerId) {
        this.renderHexagons();
        // Safety clear in case a rebuild swapped the canvas between the
        // immediate handler and this debounced one; the style write is
        // idempotent and never touches the HIDDEN class.
        const c = this.overlay.canvas;
        if (c) c.style.visibility = "";
      }
    }, CONST.TIMING.ZOOM_DEBOUNCE);
    this.map.on("zoomend", this.onZoomEnd);

    this.onLayerChange = debounce(() => {
      this.cachedPoints = null;
      this.cachedAgg = null;
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
        this.selectedLayerId = null;
        this.clearHeatmapCanvas();
      }
      if (this.ui) rebuildLayerDropdown(this.ui);
    }, CONST.TIMING.LAYER_SCAN_DEBOUNCE);
    // Subscribe to the semantic registry-change event instead of raw Leaflet
    // layeradd/layerremove — LayerManager emits EVENTS.LAYER_CHANGE on
    // register/unregister/reorder/membership, so unrelated map activity is
    // filtered out and callback-only registrations (no map.addLayer) are
    // covered too. The payload carries the changed layer's kind, so a layer
    // that cannot hold point markers is dropped without a map walk: a tile
    // basemap, a solid colour face, and a self-drawn canvas all come back
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
    // LayerControl's deleteLayer emits LAYER_DELETED for component-owned layers
    // instead of retiring the id in removedIds, so the heatmap can clear its
    // data and stay registerable for the next source pick. The clear resets
    // the panel to its initial state (the panel's Clear button is the same
    // operation) and drops the persisted record so a reload does not
    // resurrect the cleared layer — same teardown as MeasureControl's
    // LAYER_DELETED -> clearAll.
    this.removeLayerDeletedListener = this.events.on(EVENTS.LAYER_DELETED, ({ id }) => {
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
      this.clearSavedConfig();
    });
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
    // R11 dual-path handoff: the slider may have left CSS `opacity` on for
    // live feedback. This paint bakes layerAlpha into the draws, so drop
    // the CSS first — the two carriers must never compound.
    this.overlay.canvas.style.opacity = "";
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
      const c = feat.properties.centroid;
      return !!c && bounds.contains(L.latLng(c[0], c[1]));
    };

    this.cachedFeatures.forEach(feat => {
      if (!isVisible(feat)) return;
      this.drawHexagon(ctx, feat);
      if (this.currentLabelShow) this.drawHexLabel(ctx, feat, labelCfg);
    });
  }

  /** Draw a single hexagon polygon (fill + stroke). */
  drawHexagon(ctx: CanvasRenderingContext2D, feat: HexFeature) {
    drawHexagonFn(ctx, feat, this.map, this.borderWeight, this.borderColor);
  }

  /** Resolve label styling from the shared --foliplus-label-* tokens (cached once). The
   *  values are the same the annotation canvas reads — both go through
   *  common/canvasLabel — so a hex value and an annotation label render as one
   *  language. */
  resolveLabelStyle(): CanvasLabelStyle {
    if (this.cachedLabelStyle) return this.cachedLabelStyle;
    this.cachedLabelStyle = resolveLabelStyleFn(
      this.ui!.ctrl,
      this.currentLabelSize,
      this.currentLabelColor,
    );
    return this.cachedLabelStyle;
  }

  /** Draw a formatted value label centered on the hexagon. */
  drawHexLabel(
    ctx: CanvasRenderingContext2D,
    feat: HexFeature,
    style: CanvasLabelStyle,
  ) {
    drawHexLabelFn(ctx, feat, style, this.map, this.currentLabelFormat);
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
          const c = feat.properties.centroid;
          if (c) acc.extend([c[0], c[1]]);
        }
      }
    } else {
      for (const info of this.pointLayers) {
        const layer = info.layer as L.Layer & { getBounds?: () => L.LatLngBounds };
        const b = layer?.getBounds?.();
        if (b && b.isValid()) acc.extend(b);
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
  collectFields(layers: Array<{ id: string }>): string[] {
    const fields: string[] = [];
    const seen = new Set<string>();
    layers.forEach(info => {
      map.foliplus!.LayerAPI!.extractPoints(info.id).forEach(pt => {
        const marker = pt.marker;
        if (!marker) return;
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
        Object.keys(props).forEach(k => {
          if (typeof props[k] === "number" && !seen.has(k)) {
            seen.add(k);
            fields.push(k);
          }
        });
      });
    });
    return fields;
  }

  /** The field to use when the user has not picked one. */
  pickAutoField(fields: string[] | null): string | null {
    return pickAutoFieldFn(fields);
  }

  /**
   * Read a numeric field off a point marker (foliplus data contract).
   * Supported field syntax: "value", "options.value", and a bare
   * `feature.properties` key. A legacy `"properties.<key>"` id is accepted
   * and stripped so older saved configs keep working.
   */
  readMarkerField(
    marker: L.Marker | L.CircleMarker,
    field: string | null,
  ): number | undefined {
    return readMarkerFieldFn(marker, field);
  }

  getPointValue(marker: L.Marker | L.CircleMarker): number {
    if (this.currentAgg === CONST.AGG.COUNT) return 1;
    const key = this.currentField || this.autoFieldKey;
    const val = this.readMarkerField(marker, key);
    if (val === undefined || isNaN(val)) {
      if (!this.valueFallbackWarned) {
        this.valueFallbackWarned = true;
        this.log.warn("value fallback to 1", this.currentField);
      }
      return 1;
    }
    return Number(val);
  }

  getSelectedPoints(): SelectedPoint[] {
    this.valueFallbackWarned = false;
    const key = `${this.selectedLayerId}|${this.currentAgg}|${this.currentField}`;
    if (this.cachedPoints && this.cachedPoints.key === key) {
      return this.cachedPoints.pts;
    }

    const pts: SelectedPoint[] = [];
    if (!this.selectedLayerId) return pts;
    const info = this.pointLayers.find(i => i.id === this.selectedLayerId);
    if (!info) return pts;

    map.foliplus!.LayerAPI!.extractPoints(info.id).forEach(p => {
      pts.push({
        lat: p.lat,
        lng: p.lng,
        value: this.getPointValue(p.marker),
        marker: p.marker as L.Marker,
      });
    });
    this.cachedPoints = { key, pts };
    return pts;
  }

  getH3Res(zoom: number): number {
    return getH3ResFn(zoom);
  }

  getColorScale(name: string, n: number): string[] {
    return getColorScaleFn(name, n);
  }

  computeBreaks(data: number[], nClasses: number, method: string): number[] {
    return computeBreaksFn(data, nClasses, method);
  }

  renderHexagons() {
    if (!this.map || !this.overlay) return;
    if (!this.selectedLayerId) {
      this.clearHeatmapCanvas();
      return;
    }
    const pts = this.getSelectedPoints();
    const zoom = this.map.getZoom();
    const res = this.getH3Res(zoom);
    const aggKey = `${this.selectedLayerId}|${this.currentAgg}|${this.currentField}|${res}|${this.currentMethod}|${this.currentScheme}|${this.numClasses}`;
    let aggregated: AggregatedData | undefined;
    if (this.cachedAgg && this.cachedAgg.key === aggKey) {
      aggregated = this.cachedAgg.data;
    } else {
      aggregated = this.aggregateData(pts, res) ?? undefined;
      if (aggregated) this.cachedAgg = { key: aggKey, data: aggregated };
    }
    if (!aggregated) return;
    const features = this.buildFeatures(aggregated);
    this.renderFeatures(features);
  }

  aggregateData(pts: SelectedPoint[], res: number): AggregatedData | null {
    return aggregateDataFn(
      pts,
      res,
      this.currentAgg,
      this.numClasses,
      this.currentMethod,
      this.currentScheme,
      () => this.clearHeatmapCanvas(),
      this.log,
    );
  }

  buildFeatures(agg: AggregatedData): HexFeature[] {
    return buildFeaturesFn(agg, this.log);
  }

  renderFeatures(features: HexFeature[]) {
    if (!features.length) {
      this.clearHeatmapCanvas();
      return;
    }
    this.cachedFeatures = features;
    this.overlay.register();
    this.redrawHeatmap();
    // Notify LayerControl to refresh the count column for this layer.
    this.events.emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: this.layerId });
  }

  clearHeatmapCanvas() {
    this.cachedFeatures = null;
    this.cachedAgg = null;
    if (this.overlay) this.overlay.unregister();
    // The panel row is gone and the next draw is new content: drop this id
    // from the stored order so the next registration lands at the top of the
    // overlay stack instead of returning to the slot the user arranged.
    // Without this, insertOverlayAt would find a stored rank and placeBeforeSavedNeighbor
    // would put the redrawn heatmap back where it was, not on top.
    this.map.foliplus?.LayerAPI?.forgetSavedOrder?.(this.layerId);
    this.ui?.schemeBarCleanup?.();
    this.ui?.dropdownCleanup?.();
    // Notify LayerControl to refresh the count column (now 0).
    this.events.emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: this.layerId });
  }

  /** Reset selection + style state to the defaults declared in `config`. Both
   *  clear entries (the panel's Clear button and LayerControl's more-menu
   *  delete) go through here, so the two can never drift apart. */
  resetState(config: ComponentConfig) {
    this.selectedLayerId = null;
    this.autoFieldKey = null;
    this.currentAgg = config.agg ?? CONST.AGG.COUNT;
    this.currentField = "";
    this.numClasses = config.n_classes ?? CONST.CLASS_COUNT.DEFAULT;
    this.currentMethod = config.method ?? CLASSIFY_METHOD.JENKS;
    this.currentScheme = config.color_scheme ?? "Reds";
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
    if (this.selectedLayerId && this.currentAgg !== CONST.AGG.COUNT) {
      const key = this.currentField || this.autoFieldKey;
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

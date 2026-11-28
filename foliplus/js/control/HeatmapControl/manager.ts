// HeatmapControl manager — class skeleton; extract/state/filter/canvas/lifecycle/init
// bodies live in their own modules as arrow functions taking the manager, and the
// prototype methods below delegate to them so method names and this.x() call-through
// stay identical to the pre-split surface.
//
// Fields marked internal below are read by the mixin modules in this directory;
// they are not part of the control public surface.
import { canvasMethods } from "./canvas.js";
import * as CONST from "./const.js";
import { extractMethods } from "./extract.js";
import { filterMethods } from "./filter.js";
import { initMethods } from "./init.js";
import { lifecycleMethods } from "./lifecycle.js";
import { resolveClassifyMethod } from "./persistence.js";
import { stateMethods } from "./state.js";
import type {
  AggregatedData,
  HexFeature,
  SavedConfig,
  SelectedPoint,
  StyleDefaults,
} from "./type.js";
import type { HeatmapControlUI } from "./ui.js";
import type { EventBus, SettledOperation } from "#core/event/index.js";
import {
  type FilterSourceHost,
  type FilterStore,
  type LayerFilter,
  type LayerFilterModel,
  type LayerSnapshot,
  parsePersistedFilter,
} from "#core/layer/index.js";
import { generateId } from "#core/lifecycle/index.js";
import type { ClassifyMethod } from "#core/value/index.js";
import { DEFAULT_CONFIG } from "#foliplus/config-default.js";
import type { NumberStyle } from "#foliplus/config-schema.js";
import { normalizeHexColor } from "#platform/color.js";
import type { Debounced } from "#platform/debounce.js";
import { createLogger } from "#platform/log.js";
import type { Persisted } from "#platform/storage.js";
import type { Logger } from "#platform/type.js";
import { type CanvasLabelStyle, clampLabelSize } from "#ui/index.js";

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

class HeatmapManager {
  map: L.Map;
  /** Translator handed in via env, assigned once in the constructor — same
   *  shape as MeasureControl / ExportControl managers. */
  T: (key: string) => string;
  /** Internal: read by the mixin modules in this directory. */
  readonly log: Logger;
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
  /** The shared filter store — one per-map singleton, this manager is the
   *  Heatmap's single filter owner. Keyed by (this.layerId, source id), so a
   *  source switch keeps each source's filter attributed correctly (A → B →
   *  A restores A's filter) and the render path reads
   *  `getFilter(this.layerId, selectedLayerId)`. Absent = no filter. The
   *  LayerControl panel writes through the `filterSetter` capability;
   *  LAYER_FILTER_CHANGE is published *after* the state here is settled. */
  declare filterStore: FilterStore;
  /** The shared host object registered under every source's (layerId,
   *  sourceId) key — its normalize/apply read the current selection at
   *  call time, so one instance serves every source. */
  declare filterHost: FilterSourceHost;
  /** The Python-declared starting filter (CONFIG.filter), parsed once through
   *  the same tolerant AST reader a persisted record uses. Undefined means
   *  "not declared" — or a declaration the reader could not understand, in
   *  which case {@link declaredFilterInvalid} is true and the seed reports it
   *  once. */
  declare declaredFilter: LayerFilter;
  declare declaredFilterInvalid: boolean;
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
  /** Internal: read by the mixin modules in this directory. */
  declare persist: Persisted;

  // ---- Mixin surface (installed via Object.assign at the bottom) ----
  initPersistence(): void {
    return initMethods.initPersistence(this);
  }
  initStyleDelegation(): StyleDefaults {
    return initMethods.initStyleDelegation(this);
  }
  initOverlay(defaults: StyleDefaults): void {
    return initMethods.initOverlay(this, defaults);
  }
  initEventSubscriptions(): void {
    return initMethods.initEventSubscriptions(this);
  }
  initCaches(): void {
    return initMethods.initCaches(this);
  }
  initFilterHost(): void {
    return initMethods.initFilterHost(this);
  }
  bindMapEvents(): void {
    return lifecycleMethods.bindMapEvents(this);
  }
  onBeforeExport(): void {
    return lifecycleMethods.onBeforeExport(this);
  }
  onAfterExport(): void {
    return lifecycleMethods.onAfterExport(this);
  }
  redrawHeatmap(): void {
    return canvasMethods.redrawHeatmap(this);
  }
  drawHexagon(ctx: CanvasRenderingContext2D, feat: HexFeature): void {
    return canvasMethods.drawHexagon(this, ctx, feat);
  }
  resolveLabelStyle(): CanvasLabelStyle {
    return canvasMethods.resolveLabelStyle(this);
  }
  drawHexLabel(
    ctx: CanvasRenderingContext2D,
    feat: HexFeature,
    style: CanvasLabelStyle,
  ): void {
    return canvasMethods.drawHexLabel(this, ctx, feat, style);
  }
  computeBounds(): L.LatLngBounds | null {
    return extractMethods.computeBounds(this);
  }
  scanMapLayers(): void {
    return extractMethods.scanMapLayers(this);
  }
  resolveDeclaredLayer(): string | null {
    return extractMethods.resolveDeclaredLayer(this);
  }
  resolveEffectiveField(fields: readonly string[]): string {
    return extractMethods.resolveEffectiveField(this, fields);
  }
  effectiveField(): string {
    return extractMethods.effectiveField(this);
  }
  setAvailableFields(fields: readonly string[]): string {
    return extractMethods.setAvailableFields(this, fields);
  }
  invalidateEffectiveField(): void {
    return extractMethods.invalidateEffectiveField(this);
  }
  warnDeclaration(kind: "layer" | "field", name: string): void {
    return extractMethods.warnDeclaration(this, kind, name);
  }
  collectFields(layers: Array<{ id: string }>): string[] {
    return extractMethods.collectFields(this, layers);
  }
  getPointValue(marker: L.Marker | L.CircleMarker): number {
    return extractMethods.getPointValue(this, marker);
  }
  getSelectedPoints(): SelectedPoint[] {
    return extractMethods.getSelectedPoints(this);
  }
  ensureFilterHost(sourceId: string): void {
    return filterMethods.ensureFilterHost(this, sourceId);
  }
  syncFilterField(): void {
    return filterMethods.syncFilterField(this);
  }
  getFilterModel(): LayerFilterModel | null {
    return filterMethods.getFilterModel(this);
  }
  setFilter(filter: LayerFilter | undefined): void {
    return filterMethods.setFilter(this, filter);
  }
  warnDeclaredFilter(reason: string): void {
    return filterMethods.warnDeclaredFilter(this, reason);
  }
  seedDeclaredFilter(): void {
    return filterMethods.seedDeclaredFilter(this);
  }
  revalidateFilter(): boolean {
    return filterMethods.revalidateFilter(this);
  }
  renderHexagons(operation?: SettledOperation, contentChanged?: boolean): void {
    return canvasMethods.renderHexagons(this, operation, contentChanged);
  }
  aggregateData(
    pts: SelectedPoint[],
    res: number,
    include?: Set<number>,
    precomputedBins?: Map<string, number[]>,
    onEmpty?: () => void,
  ): AggregatedData | null {
    return canvasMethods.aggregateData(
      this,
      pts,
      res,
      include,
      precomputedBins,
      onEmpty,
    );
  }
  buildFeatures(agg: AggregatedData): HexFeature[] {
    return canvasMethods.buildFeatures(this, agg);
  }
  renderFeatures(features: HexFeature[], operation?: SettledOperation): void {
    return canvasMethods.renderFeatures(this, features, operation);
  }
  clearHeatmapCanvas(operation?: SettledOperation, keepBins?: boolean): void {
    return canvasMethods.clearHeatmapCanvas(this, operation, keepBins);
  }
  publishCount(operation?: SettledOperation): void {
    return canvasMethods.publishCount(this, operation);
  }
  resetState(config: ComponentConfig): void {
    return stateMethods.resetState(this, config);
  }
  loadSavedConfig(): SavedConfig | null {
    return stateMethods.loadSavedConfig(this);
  }
  saveConfig(): void {
    return stateMethods.saveConfig(this);
  }
  flush(): void {
    return stateMethods.flush(this);
  }
  clearSavedConfig(): void {
    return stateMethods.clearSavedConfig(this);
  }
  clearLayerState(): void {
    return stateMethods.clearLayerState(this);
  }
  syncSourceMeta(): void {
    return stateMethods.syncSourceMeta(this);
  }
  applySavedConfig(saved: SavedConfig): void {
    return stateMethods.applySavedConfig(this, saved);
  }

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
    this.agg = CONFIG.agg ?? DEFAULT_CONFIG.HeatmapControl.agg;
    this.field = "";
    this.availableFields = [];
    this.effectiveFieldCache = null;
    // Python declarations: starting selections only. `applySavedConfig`
    // consumes the hasScanned guard when a persisted record exists, so the
    // user's earlier choice (or the filter row's Clear) always wins over these.
    this.declaredLayer =
      typeof CONFIG.layer === "string" && CONFIG.layer ? CONFIG.layer : null;
    this.declaredField =
      typeof CONFIG.field === "string" && CONFIG.field ? CONFIG.field : null;
    // Declared filter: a starting condition, never user intent. Parsed here so
    // the seed can report an unreadable payload once instead of per rebuild.
    const rawDeclaredFilter: unknown = CONFIG.filter;
    this.declaredFilter = parsePersistedFilter(rawDeclaredFilter);
    this.declaredFilterInvalid = rawDeclaredFilter != null && !this.declaredFilter;
    this.declarationWarned = new Set();
    this.scheme = CONFIG.color_scheme ?? DEFAULT_CONFIG.HeatmapControl.color_scheme;
    this.method = resolveClassifyMethod(
      CONFIG.method ?? DEFAULT_CONFIG.HeatmapControl.method,
    );
    this.numClasses = CONFIG.num_classes ?? DEFAULT_CONFIG.HeatmapControl.num_classes;
    this.borderColor =
      CONFIG.border_color ?? DEFAULT_CONFIG.HeatmapControl.border_color;
    this.borderWeight =
      CONFIG.border_weight ?? DEFAULT_CONFIG.HeatmapControl.border_weight;
    // The Python default is the generated one; an explicit false still wins
    // (the field is a boolean, so `??` and the old `!== false` agree).
    this.labelShow = CONFIG.label_show ?? DEFAULT_CONFIG.HeatmapControl.label_show;
    // Color inputs require #rrggbb — normalize the short #fff Python default.
    this.labelColor = normalizeHexColor(
      CONFIG.label_color ?? DEFAULT_CONFIG.HeatmapControl.label_color,
    );
    this.labelSize = clampLabelSize(
      CONFIG.label_size ?? DEFAULT_CONFIG.HeatmapControl.label_size,
    );
    this.labelFormat = (CONFIG.label_format ??
      DEFAULT_CONFIG.HeatmapControl.label_format) as NumberStyle;
    this.valueFallbackWarned = false;
    this.sourceMeta = {};
  }

  init() {
    // Write-through binding: config is durable the moment a UI change lands,
    // so there is nothing to coalesce. Flush on teardown stays idempotent.
    this.initPersistence();
    // Snapshot the Python CONFIG style defaults before any runtime toggle so
    // Reset restores exactly what construction started from (never localStorage).
    const defaults = this.initStyleDelegation();
    // Style delegation for the layer style drawer. The drawer mirrors every
    // presentation style (labels + hexagon border); aggregation field stays
    // data config on the heatmap panel. Stored on the manager so the drawer
    // dispatches changes through the same setters and refreshes from the same
    // provider.
    this.initOverlay(defaults);
    // ExportControl publishes BEFORE/AFTER_EXPORT to request a full-resolution
    // capture pass: un-clip the render (renderAll) so out-of-bounds hexes
    // recompute, then clip again afterwards.  Named methods rather than
    // arrow literals so the two unsubs stay bound to stable identities and
    // removeExportListener below can release both as one pair.
    this.initEventSubscriptions();
    this.initCaches();
    this.initFilterHost();
    this.renderAll = false;
    this.hasScanned = false;

    this.bindMapEvents();
  }
}

export { HeatmapManager };

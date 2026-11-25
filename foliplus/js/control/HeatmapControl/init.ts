// HeatmapControl init phases — the constructor-time wiring, split out of init().
// Function expressions are installed on HeatmapManager.prototype so this is
// the manager and instance spies stay interceptable.
import * as SVGs from "./icon.js";
import type { HeatmapManager } from "./manager.js";
import { saveSavedConfig as saveSavedConfigFn } from "./persistence.js";
import type { StyleDefaults } from "./type.js";
import { EVENTS, SettledOperation, ensureEvents, publish } from "#core/event/index.js";
import {
  ensureFilterStore,
  filterStep,
  normalizeFilter,
  pickFilterField,
} from "#core/layer/index.js";
import type { NumberStyle } from "#foliplus/config-schema.js";
import { normalizeHexColor } from "#platform/color.js";
import { NUMBER_FORMAT } from "#platform/format.js";
import { createPersisted } from "#platform/storage.js";
import { clampBorderWeight, clampLabelSize } from "#ui/index.js";

const initPersistence = function (this: HeatmapManager) {
  // Write-through binding: config is durable the moment a UI change lands,
  // so there is nothing to coalesce. Flush on teardown stays idempotent.
  this.persist = createPersisted({
    save: () => saveSavedConfigFn(this),
  });
};

const initStyleDelegation = function (this: HeatmapManager): StyleDefaults {
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
      publish(
        this.events,
        EVENTS.LAYER_STYLE_CHANGE,
        { id: this.layerId },
        { kind: "user", via: "panel" },
      );
    },
    // Size/color only rewrite label paint — drop the cached style and
    // redraw from the feature cache.
    labelColor: v => {
      this.labelColor = typeof v === "string" ? normalizeHexColor(v) : this.labelColor;
      this.cachedLabelStyle = null;
      this.redrawHeatmap();
      this.saveConfig();
      this.map.foliplus?.LayerAPI?.touchLayer?.(this.layerId);
      publish(
        this.events,
        EVENTS.LAYER_STYLE_CHANGE,
        { id: this.layerId },
        { kind: "user", via: "panel" },
      );
    },
    labelSize: v => {
      const nextSize = typeof v === "number" && !Number.isNaN(v) ? v : this.labelSize;
      this.labelSize = clampLabelSize(nextSize);
      this.cachedLabelStyle = null;
      this.redrawHeatmap();
      this.saveConfig();
      this.map.foliplus?.LayerAPI?.touchLayer?.(this.layerId);
      publish(
        this.events,
        EVENTS.LAYER_STYLE_CHANGE,
        { id: this.layerId },
        { kind: "user", via: "panel" },
      );
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
      publish(
        this.events,
        EVENTS.LAYER_STYLE_CHANGE,
        { id: this.layerId },
        { kind: "user", via: "panel" },
      );
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
      publish(
        this.events,
        EVENTS.LAYER_STYLE_CHANGE,
        { id: this.layerId },
        { kind: "user", via: "panel" },
      );
    },
    borderColor: v => {
      this.borderColor =
        typeof v === "string" ? normalizeHexColor(v) : this.borderColor;
      this.redrawHeatmap();
      this.saveConfig();
      this.map.foliplus?.LayerAPI?.touchLayer?.(this.layerId);
      publish(
        this.events,
        EVENTS.LAYER_STYLE_CHANGE,
        { id: this.layerId },
        { kind: "user", via: "panel" },
      );
    },
  };
  const styleDefaults = {
    labelShow: defaultLabelShow,
    labelColor: defaultLabelColor,
    labelSize: defaultLabelSize,
    labelFormat: defaultLabelFormat,
    borderWeight: defaultBorderWeight,
    borderColor: defaultBorderColor,
  };
  return styleDefaults;
};

const initOverlay = function (this: HeatmapManager, defaults: StyleDefaults) {
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
      labelShow: defaults.labelShow,
      labelColor: defaults.labelColor,
      labelSize: defaults.labelSize,
      labelFormat: defaults.labelFormat,
      borderWeight: defaults.borderWeight,
      borderColor: defaults.borderColor,
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
};

const initEventSubscriptions = function (this: HeatmapManager) {
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
};

const initCaches = function (this: HeatmapManager) {
  this.ui = null;
  this.cachedPoints = null;
  this.cachedFeatures = null;
  this.cachedBins = null;
  this.cachedAgg = null;
  this.cachedLabelStyle = null;
  this.cachedSnapshot = null;
  this.cachedSnapshotLayerId = null;
};

const initFilterHost = function (this: HeatmapManager) {
  this.filterStore = ensureFilterStore(this.map);
  // One host for every source this heatmap touches: the variant bits
  // (normalize/apply/dimensions/counts) read the CURRENT selection at
  // call time, so a single host object is registered under every source
  // name — the store looks it up by (this.layerId, sourceId), and a
  // source is only ever written while it is the selected one (the panel
  // edits the selected row). The store owns the orchestration (normalize
  // → compare → commit → apply → publish) and the persistence; the host
  // owns only the Heatmap's domain. The render-coupled publish
  // (SettledOperation → renderHexagons → LAYER_FILTER_CHANGE →
  // throwIfFailed) is the host's `apply`: the store calls it after
  // committing, exactly where the old setFilter ran the render tail.
  this.filterHost = {
    normalize: filter => {
      // The snapshot is the validation baseline — build it here, cached
      // after the first call, so the steady path is free.
      this.getSelectedPoints();
      return normalizeFilter(filter, this.cachedSnapshot);
    },
    // The filter is part of the agg key — drop the agg cache. cachedPoints
    // and cachedBins survive: filtering changes neither geometry nor point
    // identity, so the bins are reused and no h3 call runs.
    apply: () => {
      this.cachedAgg = null;
      const operation = new SettledOperation(this.events);
      this.renderHexagons(operation);
      operation.emit(
        EVENTS.LAYER_FILTER_CHANGE,
        { id: this.layerId },
        { kind: "user", via: "panel" },
      );
      operation.throwIfFailed();
    },
    dimensions: () => {
      const snapshot = this.cachedSnapshot;
      const field = pickFilterField(snapshot, this.effectiveField());
      const range = snapshot!.ranges[field];
      return [{ kind: "range", field, range, step: filterStep(range) }];
    },
    // The filtered unit is the heatmap's own output — hex cells, not source
    // points: a filter that drops points inside a cell keeps the cell. The
    // bins cache is the unfiltered cell set; the drawn features are what the
    // committed filter kept.
    counts: () => ({
      kept: this.cachedFeatures?.length ?? 0,
      total: this.cachedBins?.bins.size ?? 0,
    }),
  };
};

const initMethods = {
  initCaches,
  initEventSubscriptions,
  initFilterHost,
  initOverlay,
  initPersistence,
  initStyleDelegation,
};

export { initMethods };

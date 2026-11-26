// HeatmapControl init — arrow functions that take the manager as their first argument.
// HeatmapManager's prototype methods delegate to them, so instance spies stay interceptable.
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

const initPersistence = (m: HeatmapManager) => {
  // Write-through binding: config is durable the moment a UI change lands,
  // so there is nothing to coalesce. Flush on teardown stays idempotent.
  m.persist = createPersisted({
    save: () => saveSavedConfigFn(m),
  });
};

const initStyleDelegation = (m: HeatmapManager) => {
  // Snapshot the Python CONFIG style defaults before any runtime toggle so
  // Reset restores exactly what construction started from (never localStorage).
  const defaultLabelShow = m.labelShow;
  const defaultLabelColor = m.labelColor;
  const defaultLabelSize = m.labelSize;
  const defaultLabelFormat = m.labelFormat;
  const defaultBorderWeight = m.borderWeight;
  const defaultBorderColor = m.borderColor;
  // Style delegation for the layer style drawer. The drawer mirrors every
  // presentation style (labels + hexagon border); aggregation field stays
  // data config on the heatmap panel. Stored on the manager so the drawer
  // dispatches changes through the same setters and refreshes from the same
  // provider.
  m.styleProvider = () => ({
    labelShow: m.labelShow,
    labelColor: m.labelColor,
    labelSize: m.labelSize,
    labelFormat: m.labelFormat,
    borderWeight: m.borderWeight,
    borderColor: m.borderColor,
  });
  m.styleSetters = {
    labelShow: v => {
      m.labelShow = v === true;
      m.renderHexagons();
      m.saveConfig();
      m.map.foliplus?.LayerAPI?.touchLayer?.(m.layerId);
      publish(
        m.events,
        EVENTS.LAYER_STYLE_CHANGE,
        { id: m.layerId },
        { kind: "user", via: "panel" },
      );
    },
    // Size/color only rewrite label paint — drop the cached style and
    // redraw from the feature cache.
    labelColor: v => {
      m.labelColor = typeof v === "string" ? normalizeHexColor(v) : m.labelColor;
      m.cachedLabelStyle = null;
      m.redrawHeatmap();
      m.saveConfig();
      m.map.foliplus?.LayerAPI?.touchLayer?.(m.layerId);
      publish(
        m.events,
        EVENTS.LAYER_STYLE_CHANGE,
        { id: m.layerId },
        { kind: "user", via: "panel" },
      );
    },
    labelSize: v => {
      const nextSize = typeof v === "number" && !Number.isNaN(v) ? v : m.labelSize;
      m.labelSize = clampLabelSize(nextSize);
      m.cachedLabelStyle = null;
      m.redrawHeatmap();
      m.saveConfig();
      m.map.foliplus?.LayerAPI?.touchLayer?.(m.layerId);
      publish(
        m.events,
        EVENTS.LAYER_STYLE_CHANGE,
        { id: m.layerId },
        { kind: "user", via: "panel" },
      );
    },
    // Format only rewrites the label text — redraw from cache, skip the
    // H3 re-aggregation that labelShow triggers.
    labelFormat: v => {
      m.labelFormat = (typeof v === "string" ? v : NUMBER_FORMAT.AUTO) as NumberStyle;
      m.redrawHeatmap();
      m.saveConfig();
      m.map.foliplus?.LayerAPI?.touchLayer?.(m.layerId);
      publish(
        m.events,
        EVENTS.LAYER_STYLE_CHANGE,
        { id: m.layerId },
        { kind: "user", via: "panel" },
      );
    },
    // Border weight only redraws the hexagon strokes — the H3 aggregation
    // result is unaffected.
    borderWeight: v => {
      const nextWeight = typeof v === "number" && !Number.isNaN(v) ? v : m.borderWeight;
      m.borderWeight = clampBorderWeight(nextWeight);
      m.redrawHeatmap();
      m.saveConfig();
      m.map.foliplus?.LayerAPI?.touchLayer?.(m.layerId);
      publish(
        m.events,
        EVENTS.LAYER_STYLE_CHANGE,
        { id: m.layerId },
        { kind: "user", via: "panel" },
      );
    },
    borderColor: v => {
      m.borderColor = typeof v === "string" ? normalizeHexColor(v) : m.borderColor;
      m.redrawHeatmap();
      m.saveConfig();
      m.map.foliplus?.LayerAPI?.touchLayer?.(m.layerId);
      publish(
        m.events,
        EVENTS.LAYER_STYLE_CHANGE,
        { id: m.layerId },
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

const initOverlay = (m: HeatmapManager, defaults: StyleDefaults) => {
  m.overlay = map.foliplus!.LayerAPI!.createCanvas({
    id: m.layerId,
    name: m.T("title"),
    iconSvg: SVGs.ICON_HEXAGON,
    featureCountProvider: () => m.cachedFeatures?.length ?? 0,
    getBounds: () => m.computeBounds(),
    // Shared with the registry — syncSourceMeta mutates it in place so the
    // attrs panel always reads the latest source layer / field.
    meta: m.sourceMeta,
    styleProvider: m.styleProvider,
    styleSetters: m.styleSetters,
    // Filter capability: this manager is the filter's
    // owner; the LayerControl panel reads and writes through these.
    // Bound methods: the capability functions are the manager methods
    // themselves, so the two call sites stay covered and there is no
    // per-manager closure pair in the bundle.
    filterProvider: m.getFilterModel.bind(m),
    filterSetter: m.setFilter.bind(m),
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
    // The author's folder declaration (CONFIG.folder) reaches the registry
    // so the controller seeds the layout from it on registration.
    folder: typeof CONFIG.folder === "string" ? CONFIG.folder : null,
    onOpacity: () => {
      // Opacity-change repaint: drop the slider's CSS carrier first so
      // drawHexagon bakes layerAlpha into pixels and the two never compound.
      if (m.overlay.canvas) m.overlay.canvas.style.opacity = "";
      m.redrawHeatmap();
    },
  });
};

const initEventSubscriptions = (m: HeatmapManager) => {
  // ExportControl publishes BEFORE/AFTER_EXPORT to request a full-resolution
  // capture pass: un-clip the render (renderAll) so out-of-bounds hexes
  // recompute, then clip again afterwards.  Named methods rather than
  // arrow literals so the two unsubs stay bound to stable identities and
  // removeExportListener below can release both as one pair.
  m.events = ensureEvents(m.map);
  m.removeExportListener = (() => {
    const unsubs = [
      m.events.on(EVENTS.BEFORE_EXPORT, () => m.onBeforeExport()),
      m.events.on(EVENTS.AFTER_EXPORT, () => m.onAfterExport()),
    ];
    return () => unsubs.forEach(unsub => unsub());
  })();
};

const initCaches = (m: HeatmapManager) => {
  m.ui = null;
  m.cachedPoints = null;
  m.cachedFeatures = null;
  m.cachedBins = null;
  m.cachedAgg = null;
  m.cachedLabelStyle = null;
  m.cachedSnapshot = null;
  m.cachedSnapshotLayerId = null;
};

const initFilterHost = (m: HeatmapManager) => {
  m.filterStore = ensureFilterStore(m.map);
  // One host for every source this heatmap touches: the variant bits
  // (normalize/apply/dimensions/counts) read the CURRENT selection at
  // call time, so a single host object is registered under every source
  // name — the store looks it up by (m.layerId, sourceId), and a
  // source is only ever written while it is the selected one (the panel
  // edits the selected row). The store owns the orchestration (normalize
  // → compare → commit → apply → publish) and the persistence; the host
  // owns only the Heatmap's domain. The render-coupled publish
  // (SettledOperation → renderHexagons → LAYER_FILTER_CHANGE →
  // throwIfFailed) is the host's `apply`: the store calls it after
  // committing, exactly where the old setFilter ran the render tail.
  m.filterHost = {
    normalize: filter => {
      // The snapshot is the validation baseline — build it here, cached
      // after the first call, so the steady path is free.
      m.getSelectedPoints();
      return normalizeFilter(filter, m.cachedSnapshot);
    },
    // The filter is part of the agg key — drop the agg cache. cachedPoints
    // and cachedBins survive: filtering changes neither geometry nor point
    // identity, so the bins are reused and no h3 call runs.
    apply: () => {
      m.cachedAgg = null;
      const operation = new SettledOperation(m.events);
      m.renderHexagons(operation);
      operation.emit(
        EVENTS.LAYER_FILTER_CHANGE,
        { id: m.layerId },
        { kind: "user", via: "panel" },
      );
      operation.throwIfFailed();
    },
    dimensions: () => {
      const snapshot = m.cachedSnapshot;
      const field = pickFilterField(snapshot, m.effectiveField());
      const range = snapshot!.ranges[field];
      return [{ kind: "range", field, range, step: filterStep(range) }];
    },
    // The filtered unit is the heatmap's own output — hex cells, not source
    // points: a filter that drops points inside a cell keeps the cell. The
    // bins cache is the unfiltered cell set; the drawn features are what the
    // committed filter kept.
    counts: () => ({
      kept: m.cachedFeatures?.length ?? 0,
      total: m.cachedBins?.bins.size ?? 0,
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

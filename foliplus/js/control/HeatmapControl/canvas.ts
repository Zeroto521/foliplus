// HeatmapControl canvas — arrow functions that take the manager as their first argument.
// HeatmapManager's prototype methods delegate to them, so instance spies stay interceptable.
import {
  aggregateData as aggregateDataFn,
  binPoints as binPointsFn,
  buildFeatures as buildFeaturesFn,
  getH3Res,
} from "./data.js";
import type { HeatmapManager } from "./manager.js";
import {
  drawHexLabel as drawHexLabelFn,
  drawHexagon as drawHexagonFn,
  resolveLabelStyle as resolveLabelStyleFn,
} from "./render.js";
import type { AggregatedData, HexFeature, SelectedPoint } from "./type.js";
import { EVENTS, SettledOperation, publish } from "#core/event/index.js";
import {
  filterKey,
  getLayerAlpha,
  selectIndices,
  setLayerAlpha,
} from "#core/layer/index.js";
import type { CanvasLabelStyle } from "#ui/index.js";

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
const renderHexagons = (
  m: HeatmapManager,
  operation?: SettledOperation,
  contentChanged = false,
) => {
  if (!m.map || !m.overlay) return;
  const op = operation ?? new SettledOperation(m.events);
  if (!m.selectedLayerId) {
    m.clearHeatmapCanvas(op);
    if (!operation) op.throwIfFailed();
    return;
  }
  const allPts = m.getSelectedPoints();
  // Content or identity may have moved under the stored filter (source
  // switch, data update) — align it with the fresh snapshot before the
  // include set is computed, and publish once the render has settled.
  const filterRevalidated = m.revalidateFilter();
  const zoom = m.map.getZoom();
  const res = getH3Res(zoom);
  const sourceId = m.selectedLayerId;
  const fKey = filterKey(m.filterStore.getFilter(m.layerId, sourceId!));
  const includeSet = selectIndices(
    m.cachedSnapshot,
    m.filterStore.getFilter(m.layerId, sourceId!),
    allPts.length,
  );
  // Bins cache: geometry only, independent of the filter. A filter
  // change reuses the bins and only reruns aggregateBins.
  const binsKey = `${m.selectedLayerId}|${res}`;
  let bins: Map<string, number[]> | undefined;
  if (m.cachedBins?.key === binsKey) {
    bins = m.cachedBins.bins;
  } else {
    bins = binPointsFn(allPts, res, m.log);
    m.cachedBins = { key: binsKey, bins };
  }
  // Agg cache: includes the filter key. A filter change invalidates
  // this, but the bins cache above still hits — zero h3 calls.
  const aggKey = `${binsKey}|${m.agg}|${m.effectiveField()}|${m.method}|${m.scheme}|${m.numClasses}|${fKey}`;
  let aggregated: AggregatedData | undefined;
  if (m.cachedAgg?.key === aggKey) {
    aggregated = m.cachedAgg.data;
  } else {
    aggregated =
      m.aggregateData(allPts, res, includeSet, bins, () =>
        // An empty aggregate (the committed filter kept no cell) clears the
        // canvas but must keep the geometry: the model total is the
        // unfiltered cell count, so the result readout still reads
        // "0 of N". The bins are keyed to the current points, and any
        // content/identity change drops them through
        // onSourceContentChange/onLayerChange.
        m.clearHeatmapCanvas(op, true),
      ) ?? undefined;
    if (aggregated) m.cachedAgg = { key: aggKey, data: aggregated };
  }
  if (!aggregated) {
    if (filterRevalidated || contentChanged) {
      op.emit(
        EVENTS.LAYER_FILTER_CHANGE,
        { id: m.layerId },
        { kind: "user", via: "panel" },
      );
    }
    if (!operation) op.throwIfFailed();
    return;
  }
  const features = m.buildFeatures(aggregated);
  m.renderFeatures(features, op);
  if (filterRevalidated || contentChanged) {
    op.emit(
      EVENTS.LAYER_FILTER_CHANGE,
      { id: m.layerId },
      { kind: "user", via: "panel" },
    );
  }
  if (!operation) op.throwIfFailed();
};

/** Redraw the heatmap canvas from cached features. */
const redrawHeatmap = (m: HeatmapManager) => {
  if (!m.overlay.canvas || !m.cachedFeatures) return;
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
  const layerAlpha = getLayerAlpha(m.overlay.canvas);
  const preserveCss = m.overlay.canvas.style.opacity !== "" && layerAlpha !== 1;
  if (preserveCss) {
    setLayerAlpha(m.overlay.canvas, 1);
  } else {
    m.overlay.canvas.style.opacity = "";
  }
  const ctx = m.overlay.ctx;
  if (!ctx) return;
  const container = m.map.getContainer();
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);

  const labelCfg = m.resolveLabelStyle();
  const bounds = m.renderAll ? null : m.map.getBounds();
  const isVisible = (feat: HexFeature) => {
    if (!bounds) return true;
    const pt = feat.properties.centroid;
    return !!pt && bounds.contains(L.latLng(pt[0], pt[1]));
  };

  m.cachedFeatures.forEach(feat => {
    if (!isVisible(feat)) return;
    m.drawHexagon(ctx, feat);
    if (m.labelShow) m.drawHexLabel(ctx, feat, labelCfg);
  });
  if (preserveCss) setLayerAlpha(m.overlay.canvas, layerAlpha);
};

const clearHeatmapCanvas = (
  m: HeatmapManager,
  operation?: SettledOperation,
  keepBins = false,
) => {
  m.cachedFeatures = null;
  m.cachedAgg = null;
  // keepBins is for the empty-aggregate path only: the drawn features are
  // gone but the cell set is still the unfiltered total the filter model
  // reports. A real teardown (departure, reset, empty selection) drops it.
  if (!keepBins) m.cachedBins = null;
  // cachedSnapshot and layerFilters are keyed by source id and survive a
  // canvas clear: switching source (or clearing the canvas on an empty
  // render) must not silently drop another source's committed filter —
  // A → B → A re-selects the same filter the user set. They are wiped
  // with the row itself (resetState / the departing-source branch of
  // onLayerChange), not with every canvas repaint.
  if (m.overlay) m.overlay.unregister();
  // The panel row is gone and the next draw is new content: drop this id
  // from the stored order so the next registration lands at the top of the
  // overlay stack instead of returning to the slot the user arranged.
  // Without this, insertOverlayAt would find a stored rank and placeBeforeSavedNeighbor
  // would put the redrawn heatmap back where it was, not on top.
  m.map.foliplus?.LayerAPI?.forgetSavedOrder?.(m.layerId);
  m.ui?.schemePicker?.close({ restoreFocus: false });
  // Notify LayerControl to refresh the count column (now 0).
  m.publishCount(operation);
};

const aggregateData = (
  m: HeatmapManager,
  pts: SelectedPoint[],
  res: number,
  include?: Set<number>,
  precomputedBins?: Map<string, number[]>,
  onEmpty?: () => void,
) => {
  return aggregateDataFn(
    pts,
    res,
    m.agg,
    m.numClasses,
    m.method,
    m.scheme,
    onEmpty ?? (() => m.clearHeatmapCanvas()),
    m.log,
    include,
    precomputedBins,
  );
};

/** Publish this row's count signal. Routed through the caller's operation
 *  when one exists so a later notification on the same operation still
 *  fans out before the terminal count failure is raised. */
const publishCount = (m: HeatmapManager, operation?: SettledOperation) => {
  if (operation) {
    operation.emit(
      EVENTS.LAYER_ITEM_COUNT_CHANGE,
      { id: m.layerId },
      { kind: "programmatic", via: "refresh" },
    );
  } else {
    publish(
      m.events,
      EVENTS.LAYER_ITEM_COUNT_CHANGE,
      { id: m.layerId },
      { kind: "programmatic", via: "refresh" },
    );
  }
};

const renderFeatures = (
  m: HeatmapManager,
  features: HexFeature[],
  operation?: SettledOperation,
) => {
  if (!features.length) {
    m.clearHeatmapCanvas(operation);
    return;
  }
  m.cachedFeatures = features;
  m.overlay.register();
  m.redrawHeatmap();
  // Notify LayerControl to refresh the count column for this layer. Queued
  // on the caller's operation when there is one, so a throwing terminal
  // consumer cannot cut off the filter notification that follows.
  m.publishCount(operation);
};

/** Resolve label styling from the shared --foliplus-label-* tokens (cached once). The
 *  values are the same the label canvas reads — both go through
 *  ui/canvasLabel — so a hex value and an label label render as one
 *  language. */
const resolveLabelStyle = (m: HeatmapManager) => {
  if (m.cachedLabelStyle) return m.cachedLabelStyle;
  m.cachedLabelStyle = resolveLabelStyleFn(m.ui!.ctrl, m.labelSize, m.labelColor);
  return m.cachedLabelStyle;
};

/** Draw a formatted value label centered on the hexagon. */
const drawHexLabel = (
  m: HeatmapManager,
  ctx: CanvasRenderingContext2D,
  feat: HexFeature,
  style: CanvasLabelStyle,
) => {
  drawHexLabelFn(ctx, feat, style, m.map, m.labelFormat);
};

/** Draw a single hexagon polygon (fill + stroke). */
const drawHexagon = (
  m: HeatmapManager,
  ctx: CanvasRenderingContext2D,
  feat: HexFeature,
) => {
  drawHexagonFn(ctx, feat, m.map, m.borderWeight, m.borderColor);
};

const buildFeatures = (m: HeatmapManager, agg: AggregatedData) => {
  return buildFeaturesFn(agg, m.log);
};

const canvasMethods = {
  renderHexagons,
  redrawHeatmap,
  clearHeatmapCanvas,
  aggregateData,
  publishCount,
  renderFeatures,
  resolveLabelStyle,
  drawHexLabel,
  drawHexagon,
  buildFeatures,
};

export { canvasMethods };

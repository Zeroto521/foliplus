// HeatmapControl lifecycle — arrow functions that take the manager as their first argument.
// HeatmapManager's prototype methods delegate to them, so instance spies stay interceptable.
import * as CONST from "./const.js";
import type { HeatmapManager } from "./manager.js";
import { rebuildLayerDropdown, resetPanel } from "./ui.js";
import { EVENTS, SettledOperation } from "#core/event/index.js";
import { NO_FEATURE_TREE_KINDS } from "#core/layer/index.js";
import { bindMapSync } from "#core/leaflet/index.js";
import { debounce } from "#platform/debounce.js";

const bindMapEvents = (m: HeatmapManager) => {
  // Hide canvas during zoom to avoid flicker, RAF-throttled redraw during pan.
  // zoomend triggers full re-render (renderHexagons) via separate handler
  // because it needs debounced H3 hexbin recalculation, not just cache redraw.
  m.mapCleanup = bindMapSync({
    map: m.map,
    hideEvents: ["zoomstart"],
    showEvents: ["zoomend"],
    onMove: () => {
      if (m.overlay.canvas && m.cachedFeatures) m.redrawHeatmap();
    },
    // Anti-flicker: the painted bitmap is borrowed away for the zoom and
    // handed back on zoomend. This rides the element's own `visibility`
    // style, NOT the HIDDEN class: that class is the LayerControl intent
    // channel (the executor is its single writer), and a temp-hide that
    // stamped it cannot tell "user hid it" apart from "zoom hid it" at
    // restore time.
    onHide: () => {
      const el = m.overlay.canvas;
      if (el) el.style.visibility = "hidden";
    },
    onShow: () => {
      const el = m.overlay.canvas;
      if (el) el.style.visibility = "";
    },
  });

  m.onZoomEnd = debounce(() => {
    if (m.selectedLayerId) {
      m.renderHexagons();
      // Safety clear in case a rebuild swapped the canvas between the
      // immediate handler and this debounced one; the style write is
      // idempotent and never touches the HIDDEN class.
      const el = m.overlay.canvas;
      if (el) el.style.visibility = "";
    }
  }, CONST.TIMING.ZOOM_DEBOUNCE);
  m.map.on("zoomend", m.onZoomEnd);

  m.onLayerChange = debounce(() => {
    m.cachedPoints = null;
    m.cachedAgg = null;
    m.cachedBins = null;
    m.cachedSnapshot = null;
    m.cachedSnapshotLayerId = null;
    m.scanMapLayers();
    // A deleted source has to take its derived view with it. The heatmap
    // draws another layer's points, so unregistering that layer must drop
    // the selection and wipe the canvas in this pass — a clear deferred to
    // the next zoom leaves the old render painted until something
    // re-aggregates. Deliberately outside `if (m.ui)`: the canvas is map
    // state, and a map can lose a source layer before (or without) a panel.
    if (m.selectedLayerId && !m.pointLayers.some(p => p.id === m.selectedLayerId)) {
      const departed = m.selectedLayerId;
      // Record whether the departed source carried a filter before the
      // store drops it: the notification below must still fire after the
      // local cleanup has run. A departed source must not re-render the
      // heatmap, so the store's drop removes the record without applying.
      const hadFilter =
        m.filterStore.isOwned(m.layerId, departed) ||
        m.filterStore.getFilter(m.layerId, departed) !== undefined;
      m.selectedLayerId = null;
      m.filterStore.drop(m.layerId, departed);
      if (hadFilter) m.saveConfig();
      // published through one operation so a throwing terminal count
      // consumer cannot cut the filter signal off.
      const operation = new SettledOperation(m.events);
      m.clearHeatmapCanvas(operation);
      if (hadFilter) {
        operation.emit(
          EVENTS.LAYER_FILTER_CHANGE,
          { id: m.layerId },
          { kind: "user", via: "panel" },
        );
      }
      operation.throwIfFailed();
    }
    if (m.ui) rebuildLayerDropdown(m.ui);
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
  m.removeLayerChangeListener = m.events.on(EVENTS.LAYER_CHANGE, payload => {
    // Guard: third-party or historical bare emit (no payload).
    // All product emit sites carry {id, kind} — a missing payload here
    // means an external caller fired the event without the contract.
    // Fallback: treat as a full layer change and rescan.
    if (!payload) {
      m.onLayerChange();
      return;
    }
    const { kind } = payload;
    if (NO_FEATURE_TREE_KINDS.has(kind)) return;
    m.onLayerChange();
  });
  // Runtime content changes on a registered source (`createLayers`
  // addLayer/removeLayer/clearLayers) publish LAYER_ITEM_COUNT_CHANGE, not
  // LAYER_CHANGE: membership is unchanged, only the data moved. The heatmap
  // draws that data, so the selected source's signal has to invalidate the
  // extraction/snapshot/bins pipeline — without it the next render keeps
  // painting the old snapshot. Filter `m.layerId` out: this manager
  // publishes the same event for its own output row after every render, and
  // consuming it would make the render self-trigger.
  m.onSourceContentChange = debounce(() => {
    if (!m.selectedLayerId) return;
    // A clearLayers retires the source: the registry no longer carries the
    // id, and the onLayerChange departed branch owns the single
    // notification (it drops the record and emits exactly once). Rendering
    // here would revalidate + emit a second time — the double notify this
    // guard removes. addLayer/removeLayer keep the row registered, so they
    // still flow through this content render. The lightweight LayerAPI stub
    // has no registry to consult (isLayerControl false), so it always
    // renders — the stub has no departure semantics to coordinate with.
    const api = map.foliplus!.LayerAPI!;
    const stillRegistered =
      !api.isLayerControl || api.layers.some(info => info.id === m.selectedLayerId);
    if (!stillRegistered) return;
    const operation = new SettledOperation(m.events);
    m.renderHexagons(operation, true);
    operation.throwIfFailed();
  }, CONST.TIMING.LAYER_SCAN_DEBOUNCE);
  m.removeContentChangeListener = m.events.on(
    EVENTS.LAYER_ITEM_COUNT_CHANGE,
    payload => {
      const { id } = payload;
      if (!id || id === m.layerId) return;
      if (id !== m.selectedLayerId) return;
      // Drop the caches synchronously: the panel's provider read between
      // this signal and the debounced repaint must not answer from the old
      // snapshot. `getSelectedPoints` rebuilds from the live layer walk.
      m.cachedPoints = null;
      m.cachedAgg = null;
      m.cachedBins = null;
      m.cachedSnapshot = null;
      m.cachedSnapshotLayerId = null;
      m.onSourceContentChange();
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
  m.removeLayerDeletedListener = m.events.on(
    EVENTS.LAYER_DELETED,
    ({ id }) => {
      if (id !== m.layerId) return;
      if (m.ui) {
        resetPanel(m.ui);
      } else {
        // No panel (control removed, or never built): reset state and wipe the
        // canvas directly so a re-add does not render the stale selection.
        m.resetState(m.config);
        m.clearHeatmapCanvas();
        m.syncSourceMeta();
      }
      m.saveConfig();
    },
    "internal",
  );
};

/** Drop out of export clip mode: redraw with the full feature set. */
const onBeforeExport = (m: HeatmapManager) => {
  m.renderAll = true;
  m.redrawHeatmap();
};

/** Restore normal clip mode after export capture. */
const onAfterExport = (m: HeatmapManager) => {
  m.renderAll = false;
  m.redrawHeatmap();
};

const lifecycleMethods = {
  bindMapEvents,
  onBeforeExport,
  onAfterExport,
};

export { lifecycleMethods };

// HeatmapControl map/event lifecycle — map sync, debounced handlers, semantic subscriptions.
// Function expressions are installed on HeatmapManager.prototype so this is
// the manager and instance spies stay interceptable.
import * as CONST from "./const.js";
import type { HeatmapManager } from "./manager.js";
import { rebuildLayerDropdown, resetPanel } from "./ui.js";
import { EVENTS, SettledOperation } from "#core/event/index.js";
import { NO_FEATURE_TREE_KINDS } from "#core/layer/index.js";
import { bindMapSync } from "#core/leaflet/index.js";
import { debounce } from "#platform/debounce.js";

const bindMapEvents = function (this: HeatmapManager) {
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
      // Record whether the departed source carried a filter before the
      // store drops it: the notification below must still fire after the
      // local cleanup has run. A departed source must not re-render the
      // heatmap, so the store's drop removes the record without applying.
      const hadFilter =
        this.filterStore.isOwned(this.layerId, departed) ||
        this.filterStore.getFilter(this.layerId, departed) !== undefined;
      this.selectedLayerId = null;
      this.filterStore.drop(this.layerId, departed);
      if (hadFilter) this.saveConfig();
      // published through one operation so a throwing terminal count
      // consumer cannot cut the filter signal off.
      const operation = new SettledOperation(this.events);
      this.clearHeatmapCanvas(operation);
      if (hadFilter) {
        operation.emit(
          EVENTS.LAYER_FILTER_CHANGE,
          { id: this.layerId },
          { kind: "user", via: "panel" },
        );
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
      !api.isLayerControl || api.layers.some(info => info.id === this.selectedLayerId);
    if (!stillRegistered) return;
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
};

/** Drop out of export clip mode: redraw with the full feature set. */
const onBeforeExport = function (this: HeatmapManager) {
  this.renderAll = true;
  this.redrawHeatmap();
};

/** Restore normal clip mode after export capture. */
const onAfterExport = function (this: HeatmapManager) {
  this.renderAll = false;
  this.redrawHeatmap();
};

const lifecycleMethods = {
  bindMapEvents,
  onBeforeExport,
  onAfterExport,
};

export { lifecycleMethods };

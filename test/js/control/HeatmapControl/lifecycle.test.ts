// Unit tests for HeatmapControl/lifecycle — the lifecycle mixin methods.
import {
  makeConfig,
  makeCtrl,
  makeManager,
} from "./fixture.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents } from "#core/event/index.js";
import { PANEL_CLASS } from "#ui/index.js";
import type { HeatmapManager } from "#control/HeatmapControl/manager.js";
import * as CONST from "#control/HeatmapControl/const.js";

afterEach(() => {
  delete globalThis.h3;
  delete globalThis.chroma;
});

describe("HeatmapManager — export event subscriptions", () => {
  // The two export handlers are named methods, so the tests below assert on
  // them.  A bus that stopped delivering — or a subscription that went
  // unbound — flips toHaveBeenCalled to toHaveBeenCalledTimes(0), which is the
  // regression this block is guarding.  (Spying on redrawHeatmap alone would
  // still pass with an empty bus, because vi.fn().mockClear() clears the spy
  // but not any subscription-level bookkeeping.)
  it("BEFORE_EXPORT flips to export mode via onBeforeExport", () => {
    const m = makeManager();
    const beforeSpy = vi.spyOn(m, "onBeforeExport");
    ensureEvents(m.map).publish(EVENTS.BEFORE_EXPORT, { component: "ExportControl" });
    expect(beforeSpy).toHaveBeenCalledTimes(1);
    expect(m.renderAll).toBe(true);
  });

  it("AFTER_EXPORT returns to clip mode via onAfterExport", () => {
    const m = makeManager();
    const afterSpy = vi.spyOn(m, "onAfterExport");
    ensureEvents(m.map).emit(EVENTS.AFTER_EXPORT, { component: "ExportControl" });
    expect(afterSpy).toHaveBeenCalledTimes(1);
    expect(m.renderAll).toBe(false);
  });

  it("removeExportListener stops BOTH events, and only those", () => {
    const m = makeManager();
    m.removeExportListener();
    const bus = ensureEvents(m.map);
    const beforeSpy = vi.spyOn(m, "onBeforeExport");
    const afterSpy = vi.spyOn(m, "onAfterExport");
    // Independent listener proves the bus is alive on both events — the
    // negative assertion cannot pass merely because the bus is dead.
    const probeBefore = vi.fn();
    const probeAfter = vi.fn();
    bus.on(EVENTS.BEFORE_EXPORT, probeBefore);
    bus.on(EVENTS.AFTER_EXPORT, probeAfter);

    bus.publish(EVENTS.BEFORE_EXPORT, { component: "ExportControl" });
    bus.emit(EVENTS.AFTER_EXPORT, { component: "ExportControl" });

    expect(beforeSpy).not.toHaveBeenCalled();
    expect(afterSpy).not.toHaveBeenCalled();
    expect(m.renderAll).toBe(false);
    expect(probeBefore).toHaveBeenCalledTimes(1);
    expect(probeAfter).toHaveBeenCalledTimes(1);
    bus.off(EVENTS.BEFORE_EXPORT, probeBefore);
    bus.off(EVENTS.AFTER_EXPORT, probeAfter);
  });

  it("removeExportListener is idempotent — a second call does not throw", () => {
    const m = makeManager();
    m.removeExportListener();
    expect(() => m.removeExportListener()).not.toThrow();
  });

  it("each export event is delivered exactly once (no double subscription)", () => {
    const m = makeManager();
    const beforeSpy = vi.spyOn(m, "onBeforeExport");
    const afterSpy = vi.spyOn(m, "onAfterExport");
    const bus = ensureEvents(m.map);

    bus.publish(EVENTS.BEFORE_EXPORT, { component: "ExportControl" });
    expect(beforeSpy).toHaveBeenCalledTimes(1);
    expect(afterSpy).not.toHaveBeenCalled();

    bus.publish(EVENTS.BEFORE_EXPORT, { component: "ExportControl" });
    bus.emit(EVENTS.AFTER_EXPORT, { component: "ExportControl" });
    expect(beforeSpy).toHaveBeenCalledTimes(2);
    expect(afterSpy).toHaveBeenCalledTimes(1);
  });

  it("onBeforeExport and onAfterExport set renderAll and redraw", () => {
    const m = makeManager();
    m.renderAll = false;
    const redrawSpy = vi.spyOn(m, "redrawHeatmap");

    m.onBeforeExport();
    expect(m.renderAll).toBe(true);
    expect(redrawSpy).toHaveBeenCalledTimes(1);

    m.onAfterExport();
    expect(m.renderAll).toBe(false);
    expect(redrawSpy).toHaveBeenCalledTimes(2);
  });

  it("removeLayerChangeListener stops LAYER_CHANGE fan-out", () => {
    const m = makeManager();
    const scanSpy = vi.spyOn(m, "scanMapLayers");
    m.removeLayerChangeListener();
    const bus = ensureEvents(m.map);
    // Independent listener: proves the bus still fans out LAYER_CHANGE.
    const probe = vi.fn();
    bus.on(EVENTS.LAYER_CHANGE, probe);

    bus.emit(EVENTS.LAYER_CHANGE, { id: "pts", kind: "vector" });

    expect(scanSpy).not.toHaveBeenCalled();
    expect(probe).toHaveBeenCalledTimes(1);
    bus.off(EVENTS.LAYER_CHANGE, probe);
  });

  it("destroy releases every subscription and the canvas, in that order", () => {
    const m = makeManager();
    const destroySpy = vi.fn();
    m.overlay = {
      canvas: {},
      ctx: null,
      register: vi.fn(),
      unregister: vi.fn(),
      setVisible: vi.fn(),
      hooks: { before: [], after: [] },
      destroy: destroySpy,
    };
    const bus = ensureEvents(m.map);
    const beforeProbe = vi.fn();
    const afterProbe = vi.fn();
    const layerProbe = vi.fn();
    bus.on(EVENTS.BEFORE_EXPORT, beforeProbe);
    bus.on(EVENTS.AFTER_EXPORT, afterProbe);
    bus.on(EVENTS.LAYER_CHANGE, layerProbe);

    // Mirror HeatmapControl#destroy: subscribers out, then content, then overlay.
    m.mapCleanup();
    m.onZoomEnd.cancel();
    m.map.off("zoomend", m.onZoomEnd);
    m.onLayerChange.cancel();
    m.removeLayerChangeListener();
    m.removeExportListener();
    m.clearHeatmapCanvas();
    m.overlay.destroy();

    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(m.map.off).toHaveBeenCalledWith("zoomend", m.onZoomEnd);
    expect(m.cachedFeatures).toBeNull();
    expect(m.overlay.unregister).toHaveBeenCalled();

    bus.publish(EVENTS.BEFORE_EXPORT, { component: "ExportControl" });
    bus.emit(EVENTS.AFTER_EXPORT, { component: "ExportControl" });
    bus.emit(EVENTS.LAYER_CHANGE, { id: "pts", kind: "vector" });
    expect(m.renderAll).toBe(false);
    // The manager's own handlers are gone; only the probe listeners remain.
    expect(beforeProbe).toHaveBeenCalledTimes(1);
    expect(afterProbe).toHaveBeenCalledTimes(1);
    expect(layerProbe).toHaveBeenCalledTimes(1);
    bus.off(EVENTS.BEFORE_EXPORT, beforeProbe);
    bus.off(EVENTS.AFTER_EXPORT, afterProbe);
    bus.off(EVENTS.LAYER_CHANGE, layerProbe);
  });
});

describe("event-bus bindings", () => {
  it("LAYER_CHANGE on the bound bus clears the render caches", async () => {
    const m = makeManager();
    m.cachedAgg = { key: "k", data: null! } as HeatmapManager["cachedAgg"];
    m.cachedPoints = { key: "p", pts: [] } as HeatmapManager["cachedPoints"];

    vi.useFakeTimers();
    ensureEvents(m.map).emit(EVENTS.LAYER_CHANGE, { id: "pts", kind: "vector" });
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    expect(m.cachedAgg).toBeNull();
    expect(m.cachedPoints).toBeNull();
  });

  it("a bare LAYER_CHANGE (no payload) still triggers onLayerChange", async () => {
    // Defense branch for the handler's `!payload` fallback: third-party or
    // legacy code may emit LAYER_CHANGE with no payload (the pre-refactor
    // shape). The handler can't gate on kind — it falls through to the
    // full onLayerChange sweep. Pins the fallback so a future refactor
    // can't accidentally drop it. `as never` marks the deliberate breach
    // of the typed emit contract — the same way an untyped third-party
    // caller would fire it.
    const m = makeManager();
    m.cachedAgg = { key: "k", data: null! } as HeatmapManager["cachedAgg"];
    m.cachedPoints = { key: "p", pts: [] } as HeatmapManager["cachedPoints"];

    vi.useFakeTimers();
    ensureEvents(m.map).emit(EVENTS.LAYER_CHANGE as string);
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    expect(m.cachedAgg).toBeNull();
    expect(m.cachedPoints).toBeNull();
  });

  it.each(["tile", "solid", "canvas"])(
    "ignores a LAYER_CHANGE whose kind (%s) can never hold point markers",
    async (kind: any) => {
      // A tile basemap, a solid color face and a self-drawn canvas all answer
      // "base"/null from getLayerType, so getLayersByType("point") never
      // returned them — their churn cannot change the source list. The payload
      // lets the handler skip the scan outright; without the skip every
      // basemap toggle would walk the map for an identical answer.
      const m = makeManager();
      m.cachedAgg = { key: "k", data: null! } as HeatmapManager["cachedAgg"];
      m.cachedPoints = { key: "p", pts: [] } as HeatmapManager["cachedPoints"];

      vi.useFakeTimers();
      ensureEvents(m.map).emit(EVENTS.LAYER_CHANGE, { id: "basemap", kind });
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();

      expect(m.cachedAgg).not.toBeNull();
      expect(m.cachedPoints).not.toBeNull();
    },
  );

  it("deleting the selected source layer clears the heatmap immediately", async () => {
    // The heatmap draws another layer's points, so deleting that layer has to
    // drop the selection and wipe the canvas in the same LAYER_CHANGE pass.
    // Deferring the clear to the next zoom leaves the old render painted on
    // the map: `renderHexagons` only reaches `aggregateData`'s empty-input
    // clear once something re-aggregates. Regression pin for the stale canvas.
    const m = makeManager();
    m.ui = makeCtrl(m);
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => [
      { id: "pts", name: "Points", layer: {}, count: 2 },
    ]);
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 26, lng: 119, marker: {} },
      { lat: 26.1, lng: 119.1, marker: {} },
    ]);
    m.scanMapLayers();
    m.selectedLayerId = "pts";
    const clearSpy = vi.spyOn(m, "clearHeatmapCanvas");

    // The source leaves the registry; LayerControl then emits LAYER_CHANGE.
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => []);
    vi.useFakeTimers();
    ensureEvents(m.map).emit(EVENTS.LAYER_CHANGE, { id: "pts", kind: "vector" });
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    expect(m.selectedLayerId).toBeNull();
    expect(clearSpy).toHaveBeenCalled();
  });

  it("deletes the source even with no panel attached", async () => {
    // The canvas is map state: a map can lose a source layer before (or
    // without) a panel. The clear must not sit behind `if (this.ui)`.
    const m = makeManager();
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => [
      { id: "pts", name: "Points", layer: {}, count: 1 },
    ]);
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 26, lng: 119, marker: {} },
    ]);
    m.scanMapLayers();
    m.selectedLayerId = "pts";
    const clearSpy = vi.spyOn(m, "clearHeatmapCanvas");

    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => []);
    vi.useFakeTimers();
    ensureEvents(m.map).emit(EVENTS.LAYER_CHANGE, { id: "pts", kind: "vector" });
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    expect(m.ui).toBeNull();
    expect(m.selectedLayerId).toBeNull();
    expect(clearSpy).toHaveBeenCalled();
  });

  it("keeps the selection when the source layer survives a LAYER_CHANGE", async () => {
    // A registration or a reorder also emits LAYER_CHANGE. Dropping the
    // selection there would blank a perfectly good heatmap.
    const m = makeManager();
    m.ui = makeCtrl(m);
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => [
      { id: "pts", name: "Points", layer: {}, count: 1 },
      { id: "other", name: "Other", layer: {}, count: 1 },
    ]);
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 26, lng: 119, marker: {} },
    ]);
    m.scanMapLayers();
    m.selectedLayerId = "pts";
    const clearSpy = vi.spyOn(m, "clearHeatmapCanvas");

    vi.useFakeTimers();
    ensureEvents(m.map).emit(EVENTS.LAYER_CHANGE, { id: "pts", kind: "vector" });
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    expect(m.selectedLayerId).toBe("pts");
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("leaves the selection alone when nothing is selected", async () => {
    // No selection means no derived view to clear — the empty-input clear
    // belongs to `aggregateData`, not to the layer-change reconcile.
    const m = makeManager();
    m.ui = makeCtrl(m);
    m.selectedLayerId = null;
    const clearSpy = vi.spyOn(m, "clearHeatmapCanvas");

    vi.useFakeTimers();
    ensureEvents(m.map).emit(EVENTS.LAYER_CHANGE, { id: "pts", kind: "vector" });
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    expect(m.selectedLayerId).toBeNull();
    expect(clearSpy).not.toHaveBeenCalled();
  });
});

describe("HeatmapManager — EVENTS.LAYER_DELETED auto-clear", () => {
  it("clears the heatmap canvas when own layer is deleted via LAYER_DELETED", () => {
    const m = makeManager();
    const clearSpy = vi.spyOn(m, "clearHeatmapCanvas");

    ensureEvents(m.map).emit(EVENTS.LAYER_DELETED, { id: m.layerId });

    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT clear when a different layer is deleted", () => {
    const m = makeManager();
    const clearSpy = vi.spyOn(m, "clearHeatmapCanvas");

    ensureEvents(m.map).emit(EVENTS.LAYER_DELETED, { id: "some_other_layer" });

    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("resets the panel to its initial state when own layer is deleted", () => {
    const config = makeConfig({
      color_scheme: "Blues",
      num_classes: 4,
      method: "equal",
    });
    const m = makeManager();
    const ctrl = makeCtrl(m, config);
    // The fixture's selects are bare elements: without options, `el.value`
    // falls back to "" regardless of what was assigned.
    const addOptions = (el: HTMLSelectElement, values: string[]) => {
      values.forEach(value => {
        const option = document.createElement("option");
        option.value = value;
        el.appendChild(option);
      });
    };
    addOptions(ctrl.aggSelect, [CONST.AGG.COUNT, CONST.AGG.SUM]);
    addOptions(ctrl.methodSelect, ["equal", "jenks"]);
    addOptions(ctrl.classSelect, ["4", "6"]);
    addOptions(ctrl.schemeSelectHidden, ["Blues", "Reds"]);
    // The panel still shows the deleted layer's id when the clear lands —
    // that is the stale state this reset has to undo.
    addOptions(ctrl.layerSelect, ["", "pts"]);
    ctrl.layerSelect.value = "pts";
    m.ui = ctrl;
    m.selectedLayerId = "pts";
    m.agg = CONST.AGG.SUM;
    m.field = "price";
    m.scheme = "Greens";
    m.numClasses = 8;
    m.method = "quantile";
    const clearSpy = vi.spyOn(m, "clearHeatmapCanvas");
    const saveSpy = vi.spyOn(m, "saveConfig");
    const clearSaved = vi.spyOn(m, "clearSavedConfig");

    ensureEvents(m.map).emit(EVENTS.LAYER_DELETED, { id: m.layerId });

    // State back to the declared defaults, no stale selection left behind.
    expect(m.selectedLayerId).toBeNull();
    expect(m.agg).toBe(CONST.AGG.COUNT);
    expect(m.field).toBe("");
    expect(m.method).toBe(config.method);
    expect(m.scheme).toBe(config.color_scheme);
    expect(m.numClasses).toBe(config.num_classes);
    expect(m.cachedFeatures).toBeNull();
    // Every dropdown reflects the reset — the reported bug was the panel
    // still showing the cleared layer and field.
    expect(ctrl.layerSelect.value).toBe("");
    expect(ctrl.aggSelect.value).toBe(CONST.AGG.COUNT);
    expect(ctrl.methodSelect.value).toBe(config.method);
    expect(ctrl.classSelect.value).toBe(String(config.num_classes));
    expect(ctrl.schemeSelectHidden.value).toBe(config.color_scheme);
    expect(ctrl.extraBody.classList.contains(PANEL_CLASS.HIDDEN)).toBe(true);
    // The cleared selection is persisted rather than the record dropped: a
    // stored layerId: null consumes the one-shot auto-select guard, so a reload
    // cannot resurrect the deleted layer. Dropping the record would make the
    // store look like a first open and let the auto-select fire again.
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(clearSaved).not.toHaveBeenCalled();
    // resetPanel owns the single canvas wipe — the event handler must not add
    // another one on top of it.
    expect(clearSpy).toHaveBeenCalledTimes(1);
    // Only the contents reset — the panel stays open for the next pick.
    expect(ctrl.ctrl.classList.contains(PANEL_CLASS.COLLAPSED)).toBe(false);
  });

  it("resets state and persists the cleared selection when own layer is deleted with no panel", () => {
    const m = makeManager();
    m.ui = null;
    m.selectedLayerId = "pts";
    m.agg = CONST.AGG.SUM;
    m.field = "price";
    m.scheme = "Greens";
    m.numClasses = 8;
    const clearSpy = vi.spyOn(m, "clearHeatmapCanvas");
    const saveSpy = vi.spyOn(m, "saveConfig");
    const clearSaved = vi.spyOn(m, "clearSavedConfig");

    ensureEvents(m.map).emit(EVENTS.LAYER_DELETED, { id: m.layerId });

    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(clearSaved).not.toHaveBeenCalled();
    expect(m.selectedLayerId).toBeNull();
    expect(m.agg).toBe(CONST.AGG.COUNT);
    expect(m.field).toBe("");
    expect(m.scheme).toBe("Reds");
    expect(m.method).toBe("jenks");
    expect(m.numClasses).toBe(6);
  });
});

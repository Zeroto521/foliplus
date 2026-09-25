import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents } from "#core/event/index.js";
import * as CONST from "#foliplus/HeatmapControl/const.js";
import { HeatmapManager } from "#foliplus/HeatmapControl/manager.js";
import { rebuildLayerDropdown } from "#foliplus/HeatmapControl/ui.js";
import { BORDER_WEIGHT } from "#foliplus/common/form.js";
import { makeConf, makeCtrl, makeManager } from "./fixture.js";

afterEach(() => {
  delete globalThis.h3;
  delete globalThis.chroma;
});

describe("getPointValue", () => {
  let m;

  beforeEach(() => {
    m = makeManager();
  });

  it("returns 1 when agg is COUNT", () => {
    m.currentAgg = CONST.AGG.COUNT;
    expect(m.getPointValue({})).toBe(1);
  });

  it("returns 1 as fallback for missing field", () => {
    m.currentAgg = CONST.AGG.SUM;
    m.currentField = "nonexistent";
    expect(m.getPointValue({})).toBe(1);
  });
});

describe("getPointValue — additional gaps", () => {
  it("uses autoFieldKey when currentField is empty", () => {
    const m = makeManager();
    m.currentAgg = CONST.AGG.SUM;
    m.currentField = "";
    m.autoFieldKey = "value";
    expect(m.getPointValue({ value: 42 })).toBe(42);
  });

  it("uses currentField when it is set", () => {
    const m = makeManager();
    m.currentAgg = CONST.AGG.SUM;
    m.currentField = "options.value";
    expect(m.getPointValue({ options: { value: 99 } })).toBe(99);
  });

  it("warns on value fallback (once per render)", () => {
    const m = makeManager();
    m.currentAgg = CONST.AGG.SUM;
    m.currentField = "bad_field";
    m.valueFallbackWarned = false;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(m.getPointValue({})).toBe(1);
    expect(m.valueFallbackWarned).toBe(true);
    expect(m.getPointValue({})).toBe(1); // no additional warn
    warnSpy.mockRestore();
  });
});

describe("HeatmapManager — caching & lifecycle", () => {
  it("clearHeatmapCanvas resets autoFieldKey and all caches", () => {
    const m = makeManager();
    m.autoFieldKey = "price";
    m.cachedFeatures = { f: 1 } as any;
    m.cachedAgg = { key: "k", data: "d" } as any;
    m.cachedPoints = { key: "p", pts: [] } as any;
    m.clearHeatmapCanvas();
    expect(m.cachedFeatures).toBeNull();
    expect(m.cachedAgg).toBeNull();
    expect(m.overlay.unregister).toHaveBeenCalled();
  });

  it("clearHeatmapCanvas runs the UI listener cleanups so detached handlers die with the canvas", () => {
    const m = makeManager();
    const schemeBarCleanup = vi.fn();
    const dropdownCleanup = vi.fn();
    m.ui = {
      ...makeCtrl(m, makeConf()),
      schemeBarCleanup,
      dropdownCleanup,
    };
    m.clearHeatmapCanvas();
    expect(schemeBarCleanup).toHaveBeenCalledTimes(1);
    expect(dropdownCleanup).toHaveBeenCalledTimes(1);
  });

  it("clearHeatmapCanvas survives a null ui (control removed before teardown)", () => {
    const m = makeManager();
    m.ui = null;
    expect(() => m.clearHeatmapCanvas()).not.toThrow();
  });

  it("clearHeatmapCanvas emits LAYER_ITEM_COUNT_CHANGE so LayerControl refreshes count to 0", () => {
    const m = makeManager();
    const bus = ensureEvents(m.map);
    const handler = vi.fn();
    bus.on(EVENTS.LAYER_ITEM_COUNT_CHANGE, handler);
    m.clearHeatmapCanvas();
    expect(handler).toHaveBeenCalledWith({ id: m.layerId });
  });

  it("renderHexagons clears canvas when no layer selected", () => {
    const m = makeManager();
    m.selectedLayerId = null;
    const clearSpy = vi.spyOn(m, "clearHeatmapCanvas");
    m.map = { _container: {}, getZoom: () => 5 };
    m.renderHexagons();
    expect(clearSpy).toHaveBeenCalled();
  });

  it("renderHexagons returns early when map or overlay missing", () => {
    const m = makeManager();
    m.map = null;
    expect(() => m.renderHexagons()).not.toThrow();
  });

  it("resolveLabelStyle caches the computed style", () => {
    const m = makeManager();
    m.ui = { ctrl: document.createElement("div") };
    const style1 = m.resolveLabelStyle();
    const style2 = m.resolveLabelStyle();
    expect(style1).toBe(style2);
    expect(m.cachedLabelStyle).toBe(style1);
  });

  it("resolveLabelStyle picks up a runtime size change after cache clear", () => {
    const m = makeManager();
    m.ui = { ctrl: document.createElement("div") };
    m.resolveLabelStyle();
    m.currentLabelSize = 18;
    m.cachedLabelStyle = null;
    expect(m.resolveLabelStyle().font).toContain("18px");
  });

  it("collectFields gathers numeric properties once", () => {
    const m = makeManager();
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { marker: { feature: { properties: { price: 1, name: "x" } } } },
      { marker: { feature: { properties: { price: 2 } } } },
    ]);
    const fields = m.collectFields([{ id: "a" }, { id: "b" }]);
    expect(fields).toContain("price");
    expect(fields).not.toContain("name");
    expect(fields.filter(f => f === "price")).toHaveLength(1);
  });

  it("collectFields enumerates numeric value on extended marker", () => {
    const m = makeManager();
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { marker: { value: 42, feature: { properties: { price: 1 } } } },
    ]);
    const fields = m.collectFields([{ id: "a" }]);
    expect(fields).toContain("value");
    expect(fields).toContain("price");
  });

  it("collectFields enumerates numeric options.value on extended marker", () => {
    const m = makeManager();
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { marker: { options: { value: 99 }, feature: { properties: {} } } },
    ]);
    const fields = m.collectFields([{ id: "a" }]);
    expect(fields).toContain("options.value");
  });

  it("collectFields skips non-numeric value and options.value", () => {
    const m = makeManager();
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      {
        marker: {
          value: "not-a-number",
          options: { value: undefined },
          feature: { properties: { price: 1 } },
        },
      },
    ]);
    const fields = m.collectFields([{ id: "a" }]);
    expect(fields).not.toContain("value");
    expect(fields).not.toContain("options.value");
    expect(fields).toContain("price");
  });

  it("collectFields deduplicates value and options.value across markers", () => {
    const m = makeManager();
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { marker: { value: 1, feature: { properties: {} } } },
      { marker: { value: 2, options: { value: 3 }, feature: { properties: {} } } },
    ]);
    const fields = m.collectFields([{ id: "a" }]);
    expect(fields.filter(f => f === "value")).toHaveLength(1);
    expect(fields.filter(f => f === "options.value")).toHaveLength(1);
  });

  it("collectFields skips markers with no marker object", () => {
    const m = makeManager();
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { marker: null },
      { marker: { feature: { properties: { price: 1 } } } },
    ]);
    const fields = m.collectFields([{ id: "a" }]);
    expect(fields).toContain("price");
  });

  it("collectFields still enumerates value when feature.properties is absent", () => {
    const m = makeManager();
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { marker: { value: 7 } },
    ]);
    const fields = m.collectFields([{ id: "a" }]);
    expect(fields).toContain("value");
  });
});

describe("HeatmapManager — layer visibility vs zoom", () => {
  // createCanvas is called once in the constructor; recover the onToggle the
  // manager passed in so LayerControl's hide/show callbacks can be replayed.
  const onToggleOf = (m: HeatmapManager): ((visible: boolean) => void) =>
    window.map.foliplus.LayerAPI.createCanvas.mock.calls[0][0].onToggle;

  const zoomendHandlers = (m: HeatmapManager): Array<() => void> =>
    m.map.on.mock.calls
      .filter(([evt]: [string]) => evt === "zoomend")
      .map(([, fn]: [string, () => void]) => fn);

  const zoomstartHandler = (m: HeatmapManager): (() => void) =>
    m.map.on.mock.calls.filter(([evt]: [string]) => evt === "zoomstart")[0][1];

  it("onToggle(false) mirrors a LayerControl hide into manager state", () => {
    const m = makeManager();
    onToggleOf(m)(false);
    expect(m.layerVisible).toBe(false);
    expect(m.overlay.setVisible).toHaveBeenCalledWith(false);
  });

  it("onToggle(true) restores visibility after the layer is re-checked", () => {
    const m = makeManager();
    const onToggle = onToggleOf(m);
    onToggle(false);
    m.overlay.setVisible.mockClear();

    onToggle(true);

    expect(m.layerVisible).toBe(true);
    expect(m.overlay.setVisible).toHaveBeenCalledWith(true);
  });

  it("zoomstart hides the canvas even when the layer is logically visible", () => {
    const m = makeManager();
    m.overlay.setVisible.mockClear();
    zoomstartHandler(m)();
    expect(m.overlay.setVisible).toHaveBeenCalledWith(false);
  });

  it("zoomend does not re-show a layer the user hid in LayerControl", () => {
    const m = makeManager();
    m.layerVisible = false;
    m.overlay.setVisible.mockClear();
    // zoomend fires two handlers: bindMapSync.onShow (immediate) and the
    // debounced onZoomEnd. Neither may re-show a hidden layer.
    zoomendHandlers(m).forEach(fn => fn());
    expect(m.overlay.setVisible).not.toHaveBeenCalledWith(true);
  });

  it("zoomend re-shows a still-visible layer after the zoomstart hide", () => {
    const m = makeManager();
    m.overlay.setVisible.mockClear();
    zoomendHandlers(m).forEach(fn => fn());
    expect(m.overlay.setVisible).toHaveBeenCalledWith(true);
  });

  it("onZoomEnd re-renders a hidden layer but does not re-show it", () => {
    const m = makeManager();
    m.selectedLayerId = "layer1";
    m.layerVisible = false;
    const renderSpy = vi.spyOn(m, "renderHexagons").mockImplementation(() => {});
    m.overlay.setVisible.mockClear();

    m.onZoomEnd();
    m.onZoomEnd.flush();

    expect(renderSpy).toHaveBeenCalled();
    expect(m.overlay.setVisible).not.toHaveBeenCalledWith(true);
  });

  it("hide → zoom → re-check → zoom obeys the latest LayerControl state", () => {
    const m = makeManager();
    const onToggle = onToggleOf(m);

    onToggle(false);
    m.overlay.setVisible.mockClear();
    zoomendHandlers(m).forEach(fn => fn());
    expect(m.overlay.setVisible).not.toHaveBeenCalledWith(true);

    onToggle(true);
    m.overlay.setVisible.mockClear();
    zoomendHandlers(m).forEach(fn => fn());
    expect(m.overlay.setVisible).toHaveBeenCalledWith(true);
  });
});

describe("scanMapLayers", () => {
  it("extracts point layers from LayerAPI", () => {
    const m = makeManager();
    const info = { id: "layer1", name: "Points", layer: {} };
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => [info]);
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { id: "p1", marker: { feature: { properties: { price: 1 } } } },
    ]);
    m.scanMapLayers();
    expect(m.pointLayers).toHaveLength(1);
    expect(m.pointLayers[0].id).toBe("layer1");
  });

  it("deduplicates point layers by id", () => {
    const m = makeManager();
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => [
      { id: "dup", name: "A", layer: {} },
      { id: "dup", name: "B", layer: {} },
    ]);
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [{ marker: {} }]);
    m.scanMapLayers();
    expect(m.pointLayers).toHaveLength(1);
  });

  it("skips layers with no extractable points", () => {
    const m = makeManager();
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => [
      { id: "empty", name: "Empty", layer: {} },
    ]);
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => []);
    m.scanMapLayers();
    expect(m.pointLayers).toHaveLength(0);
  });
});

describe("getSelectedPoints", () => {
  it("returns cached points when key matches", () => {
    const m = makeManager();
    m.selectedLayerId = "layer1";
    m.cachedPoints = { key: "layer1|count|", pts: [{ lat: 1 }] } as any;
    const pts = m.getSelectedPoints();
    expect(pts).toHaveLength(1);
  });

  it("returns empty when no layer selected", () => {
    const m = makeManager();
    m.selectedLayerId = null;
    expect(m.getSelectedPoints()).toEqual([]);
  });

  it("returns empty when layer not found in pointLayers", () => {
    const m = makeManager();
    m.selectedLayerId = "missing";
    m.pointLayers = [{ id: "other", name: "O", layer: {}, count: 1 }];
    expect(m.getSelectedPoints()).toEqual([]);
  });

  it("extracts points from LayerAPI and caches them", () => {
    const m = makeManager();
    m.selectedLayerId = "layer1";
    m.pointLayers = [{ id: "layer1", name: "P", layer: {}, count: 2 }];
    m.currentAgg = CONST.AGG.COUNT;
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 2, marker: {} },
      { lat: 3, lng: 4, marker: {} },
    ]);
    const pts = m.getSelectedPoints();
    expect(pts).toHaveLength(2);
    expect(m.cachedPoints).toBeDefined();
    expect(m.cachedPoints.key).toContain("layer1");
  });
});

describe("renderFeatures", () => {
  it("calls clearHeatmapCanvas for empty features", () => {
    const m = makeManager();
    const clearSpy = vi.spyOn(m, "clearHeatmapCanvas");
    m.renderFeatures([]);
    expect(clearSpy).toHaveBeenCalled();
  });

  it("caches features, registers overlay, and redraws", () => {
    const m = makeManager();
    m.overlay.register = vi.fn();
    m.redrawHeatmap = vi.fn();
    const features = [{ type: "Feature" }] as any;
    m.renderFeatures(features);
    expect(m.cachedFeatures).toBe(features);
    expect(m.overlay.register).toHaveBeenCalled();
    expect(m.redrawHeatmap).toHaveBeenCalled();
  });

  it("emits LAYER_ITEM_COUNT_CHANGE so LayerControl refreshes the count column", () => {
    const m = makeManager();
    m.overlay.register = vi.fn();
    m.redrawHeatmap = vi.fn();
    const bus = ensureEvents(m.map);
    const handler = vi.fn();
    bus.on(EVENTS.LAYER_ITEM_COUNT_CHANGE, handler);
    m.renderFeatures([{ type: "Feature" }] as any);
    expect(handler).toHaveBeenCalledWith({ id: m.layerId });
  });
});

describe("renderHexagons", () => {
  it("clears canvas when no layer selected", () => {
    const m = makeManager();
    m.selectedLayerId = null;
    m.map = { _container: {}, getZoom: () => 5 };
    const clearSpy = vi.spyOn(m, "clearHeatmapCanvas");
    m.renderHexagons();
    expect(clearSpy).toHaveBeenCalled();
  });

  it("reuses cachedAgg when key matches", () => {
    const m = makeManager();
    m.selectedLayerId = "layer1";
    m.map = { _container: {}, getZoom: () => 5 };
    m.pointLayers = [{ id: "layer1", name: "P", layer: {}, count: 1 }];
    m.cachedAgg = {
      key: "layer1|count||2|jenks|Reds|6",
      data: {
        hexCells: {},
        getAggValue: () => 0,
        valueToClassIdx: () => 0,
        classColors: [],
      },
    };
    const spy = vi.spyOn(m, "aggregateData");
    m.renderHexagons();
    expect(spy).not.toHaveBeenCalled();
  });
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
    ensureEvents(m.map).emit(EVENTS.BEFORE_EXPORT, { component: "ExportControl" });
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

    bus.emit(EVENTS.BEFORE_EXPORT, { component: "ExportControl" });
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

    bus.emit(EVENTS.BEFORE_EXPORT, { component: "ExportControl" });
    expect(beforeSpy).toHaveBeenCalledTimes(1);
    expect(afterSpy).not.toHaveBeenCalled();

    bus.emit(EVENTS.BEFORE_EXPORT, { component: "ExportControl" });
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

    bus.emit(EVENTS.LAYER_CHANGE);

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

    bus.emit(EVENTS.BEFORE_EXPORT, { component: "ExportControl" });
    bus.emit(EVENTS.AFTER_EXPORT, { component: "ExportControl" });
    bus.emit(EVENTS.LAYER_CHANGE);
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

describe("rebuildLayerDropdown — single-layer auto-select gating", () => {
  // buildLayerListItems calls scanMapLayers internally; stub it so the
  // pre-seeded pointLayers state used by these tests survives the rebuild.
  beforeEach(() => {
    vi.spyOn(HeatmapManager.prototype, "scanMapLayers").mockImplementation(function () {
      // no-op: keep the manually seeded pointLayers
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("auto-selects the only point layer on the first scan", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "lonely", name: "Lonely", layer: {}, count: 1 }];
    const ctrl = makeCtrl(m);
    const renderSpy = vi.spyOn(m, "renderHexagons");

    rebuildLayerDropdown(ctrl);

    expect(m.selectedLayerId).toBe("lonely");
    expect(renderSpy).toHaveBeenCalled();
  });

  it("does not re-auto-select after a user clears the selection", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "lonely", name: "Lonely", layer: {}, count: 1 }];
    m.hasScanned = true;
    // Simulate the post-init state: the single layer was auto-selected
    // during initScan, then the user cleared the heatmap.
    m.selectedLayerId = null;
    const ctrl = makeCtrl(m);
    const renderSpy = vi.spyOn(m, "renderHexagons");

    // Subsequent rebuilds (zoomend, layeradd/layerremove) must not re-fire
    // the auto-select and must not draw the heatmap again.
    rebuildLayerDropdown(ctrl);

    expect(m.selectedLayerId).toBeNull();
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it("keeps a user-selected layer stable across rebuilds", () => {
    const m = makeManager();
    m.pointLayers = [
      { id: "a", name: "A", layer: {}, count: 2 },
      { id: "b", name: "B", layer: {}, count: 3 },
    ];
    const ctrl = makeCtrl(m);
    m.selectedLayerId = "b";

    rebuildLayerDropdown(ctrl);

    expect(m.selectedLayerId).toBe("b");
  });

  it("stays cleared across repeated rebuilds (zoom + layer-churn)", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "lonely", name: "Lonely", layer: {}, count: 1 }];
    m.hasScanned = true;
    m.selectedLayerId = null;
    const ctrl = makeCtrl(m);
    const renderSpy = vi.spyOn(m, "renderHexagons");

    // Simulate a session of zoom + layer-add/remove rebuilds after the clear.
    for (let i = 0; i < 5; i++) rebuildLayerDropdown(ctrl);

    expect(m.selectedLayerId).toBeNull();
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it("zoomend re-render does not resurrect a cleared single layer", () => {
    const m = makeManager();
    m.selectedLayerId = null;
    m.pointLayers = [{ id: "lonely", name: "Lonely", layer: {}, count: 1 }];
    m.map = { _container: {}, getZoom: () => 6 } as any;
    const renderSpy = vi.spyOn(m, "renderHexagons");

    // Zoomend debounced handler: with nothing selected it must stay cleared.
    m.renderHexagons();

    expect(m.selectedLayerId).toBeNull();
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });
});

describe("initScan — single-layer auto-select on first scan only", () => {
  beforeEach(() => {
    window.map.foliplus.LayerAPI = {
      ...window.map.foliplus.LayerAPI,
      getLayersByType: vi.fn(() => []),
      extractPoints: vi.fn(() => []),
      createCanvas: vi.fn(() => ({
        register: vi.fn(),
        unregister: vi.fn(),
        setVisible: vi.fn(),
        hooks: { before: [], after: [] },
        canvas: null,
        ctx: null,
      })),
    };
  });

  it("auto-selects and renders a single layer on first initScan", async () => {
    const { initScan } = await import("#foliplus/HeatmapControl/ui.js");
    const m = makeManager();
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => [
      { id: "lonely", name: "Lonely", layer: {} },
    ]);
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 2, marker: {} },
    ]);
    const ctrl = makeCtrl(m);
    const renderSpy = vi.spyOn(m, "renderHexagons");

    initScan(ctrl);

    expect(m.hasScanned).toBe(true);
    expect(m.selectedLayerId).toBe("lonely");
    expect(renderSpy).toHaveBeenCalled();
  });

  it("auto-selects a single layer that appears when a control attaches", async () => {
    const { initScan } = await import("#foliplus/HeatmapControl/ui.js");
    const m = makeManager();
    // First scan finds nothing; a layer appears once LayerControl finishes
    // attaching (CONTROL_ATTACHED). This is still the initial scan phase
    // (hasScanned not yet set), so it auto-selects.
    window.map.foliplus.LayerAPI.isLayerControl = true;
    let calls = 0;
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => {
      calls++;
      return calls === 1 ? [] : [{ id: "late", name: "Late", layer: {} }];
    });
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 2, marker: {} },
    ]);
    const ctrl = makeCtrl(m);

    initScan(ctrl);
    expect(m.hasScanned).toBe(false);

    // LayerControl (or any control) finishing attach re-triggers the scan.
    ensureEvents(m.map).emit(EVENTS.CONTROL_ATTACHED, {
      component: "LayerControl",
    });

    expect(m.hasScanned).toBe(true);
    expect(m.selectedLayerId).toBe("late");
  });

  it("settles the no-layer hint after the synchronous attach sequence", async () => {
    const { initScan } = await import("#foliplus/HeatmapControl/ui.js");
    const m = makeManager();
    window.map.foliplus.showHint = vi.fn();
    window.map.foliplus.LayerAPI.isLayerControl = false;
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => []);
    const ctrl = makeCtrl(m);

    vi.useFakeTimers();
    initScan(ctrl);
    // The final pass fires one macrotask later — after the synchronous
    // attach sequence, when the layer set is final.
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    expect(m.hasScanned).toBe(true);
    expect(m.selectedLayerId).toBeNull();
  });

  it("cleanup unsubscribes CONTROL_ATTACHED and is idempotent", async () => {
    const { initScan } = await import("#foliplus/HeatmapControl/ui.js");
    const m = makeManager();
    window.map.foliplus.LayerAPI.isLayerControl = true;
    let calls = 0;
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => {
      calls++;
      return [];
    });
    const ctrl = makeCtrl(m);

    vi.useFakeTimers();
    const cleanup = initScan(ctrl);
    expect(calls).toBe(1); // immediate first pass only

    cleanup();
    cleanup(); // second call is a no-op

    ensureEvents(m.map).emit(EVENTS.CONTROL_ATTACHED, {
      component: "LayerControl",
    });
    // Unsubscribed — no further scan ran, and no late settle.
    expect(calls).toBe(1);
    expect(m.hasScanned).toBe(false);

    await vi.runOnlyPendingTimersAsync();
    expect(calls).toBe(1); // settled pass also skipped (done)
    vi.useRealTimers();
  });

  it("restores a previously saved layer selection on reload", async () => {
    // Reload path: the manager restored a saved layerId from localStorage,
    // so initScan must redraw that layer without re-auto-selecting.
    const { initScan } = await import("#foliplus/HeatmapControl/ui.js");
    const m = makeManager();
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => [
      { id: "p1", name: "P1", layer: {} },
    ]);
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 2, marker: {} },
    ]);
    m.selectedLayerId = "p1";
    // A non-count agg exercises the full field-selector refresh path.
    m.currentAgg = CONST.AGG.SUM;
    const ctrl = makeCtrl(m);
    const renderSpy = vi.spyOn(m, "renderHexagons");
    const fieldSpy = vi.spyOn(m, "collectFields");

    initScan(ctrl);

    expect(m.hasScanned).toBe(true);
    expect(m.selectedLayerId).toBe("p1");
    expect(fieldSpy).toHaveBeenCalled(); // field selector refreshed for the layer
    expect(renderSpy).toHaveBeenCalled(); // saved layer drawn without interaction
    expect(ctrl.ctrl.getAttribute("data-ready")).toBe("true");
  });

  // Gates below drive the reload path as it happens in production:
  // a new manager against the same localStorage — same instance would
  // not surface the bug this round is fixing, since the guard state
  // never leaves the object. makeManager replaces window.map.foliplus
  // wholesale, so LayerAPI mocks must be re-applied after each call.
  const seedLonely = () => {
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => [
      { id: "lonely", name: "Lonely", layer: {} },
    ]);
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 2, marker: {} },
    ]);
  };

  it("suppresses auto-select across a reload after the user cleared it explicitly", async () => {
    // Pre-fix, hasScanned is runtime-only; a persisted record with
    // layerId: null was restored by applySavedConfig without closing the
    // guard, so the reload looked like a first open and re-fired.
    const { initScan } = await import("#foliplus/HeatmapControl/ui.js");
    window.localStorage.clear();

    // Session 1: user opens the heatmap (single-layer auto-select fires),
    // then clears the dropdown.  The clear is user-initiated so it
    // persists — the record carries layerId: null on disk.
    const m1 = makeManager();
    seedLonely();
    const c1 = makeCtrl(m1);
    initScan(c1);
    expect(m1.selectedLayerId).toBe("lonely");
    m1.selectedLayerId = null;
    m1.saveConfig();
    m1.flush();

    // Session 2: fresh manager on the same localStorage — the recorded
    // clear must survive the reload, not be overridden by auto-select.
    const m2 = makeManager();
    seedLonely();
    const saved = m2.loadSavedConfig();
    expect(saved).not.toBeNull();
    expect(saved!.layerId).toBeNull();
    m2.applySavedConfig(saved!);
    const c2 = makeCtrl(m2);
    const renderSpy = vi.spyOn(m2, "renderHexagons");
    initScan(c2);

    expect(m2.selectedLayerId).toBeNull();
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it("never auto-selects with two point layers, with or without a saved record", async () => {
    const { initScan } = await import("#foliplus/HeatmapControl/ui.js");
    window.localStorage.clear();

    // No persisted record here — the guard is open on first open, so
    // this case is the pure test of the length rule itself.  If the
    // length === 1 check regresses, the first layer would be picked.
    const m = makeManager();
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => [
      { id: "a", name: "A", layer: {} },
      { id: "b", name: "B", layer: {} },
    ]);
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 2, marker: {} },
    ]);
    expect(m.loadSavedConfig()).toBeNull();
    const ctrl = makeCtrl(m);
    const renderSpy = vi.spyOn(m, "renderHexagons");
    initScan(ctrl);

    expect(m.selectedLayerId).toBeNull();
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it("allows auto-select again after Reset deleted the record", async () => {
    // Reset (clearSavedConfig) deletes the record entirely — this is the
    // deliberate back-to-declared-state path. Gate 3 proves the fix does
    // not conflate explicit-clear with Reset.
    const { initScan } = await import("#foliplus/HeatmapControl/ui.js");
    window.localStorage.clear();

    const m1 = makeManager();
    seedLonely();
    m1.selectedLayerId = "lonely";
    m1.saveConfig();
    m1.flush();
    m1.clearSavedConfig();
    expect(window.localStorage.getItem(CONST.STORAGE.KEY)).toBeNull();

    // Fresh manager, no record → applySavedConfig never runs → guard stays
    // open → the first open's single-layer auto-select fires.
    const m2 = makeManager();
    seedLonely();
    expect(m2.loadSavedConfig()).toBeNull();
    const c2 = makeCtrl(m2);
    const renderSpy = vi.spyOn(m2, "renderHexagons");
    initScan(c2);

    expect(m2.selectedLayerId).toBe("lonely");
    expect(renderSpy).toHaveBeenCalled();
  });
});

describe("event-bus bindings", () => {
  it("LAYER_CHANGE on the bound bus clears the render caches", async () => {
    const m = makeManager();
    m.cachedAgg = { key: "k", data: null! } as HeatmapManager["cachedAgg"];
    m.cachedPoints = { key: "p", pts: [] } as HeatmapManager["cachedPoints"];

    vi.useFakeTimers();
    ensureEvents(m.map).emit(EVENTS.LAYER_CHANGE);
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    expect(m.cachedAgg).toBeNull();
    expect(m.cachedPoints).toBeNull();
  });

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
    ensureEvents(m.map).emit(EVENTS.LAYER_CHANGE);
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
    ensureEvents(m.map).emit(EVENTS.LAYER_CHANGE);
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
    ensureEvents(m.map).emit(EVENTS.LAYER_CHANGE);
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
    ensureEvents(m.map).emit(EVENTS.LAYER_CHANGE);
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    expect(m.selectedLayerId).toBeNull();
    expect(clearSpy).not.toHaveBeenCalled();
  });
});

describe("HeatmapManager — style delegation", () => {
  function getCanvasOpts() {
    const createCanvas = (
      window.map.foliplus!.LayerAPI as unknown as {
        createCanvas: ReturnType<typeof vi.fn>;
      }
    ).createCanvas;
    return createCanvas.mock.calls[0][0] as {
      styleProvider?: () => Record<string, unknown>;
      styleSetters?: Record<string, (v: unknown) => void>;
      styleDefaults?: () => Record<string, unknown>;
    };
  }

  it("createCanvas receives styleProvider and styleSetters (no field)", () => {
    makeManager();
    const opts = getCanvasOpts();
    expect(typeof opts.styleProvider).toBe("function");
    expect(typeof opts.styleSetters?.labelShow).toBe("function");
    expect(typeof opts.styleSetters?.labelColor).toBe("function");
    expect(typeof opts.styleSetters?.labelSize).toBe("function");
    expect(typeof opts.styleSetters?.labelFormat).toBe("function");
    // Aggregation field is data config — not delegated into the style drawer.
    expect(opts.styleSetters?.field).toBeUndefined();
    expect(opts.fieldOptions).toBeUndefined();
  });

  it("styleProvider returns the live labelShow, color, size and format values", () => {
    const m = makeManager();
    const opts = getCanvasOpts();
    expect(opts.styleProvider!()).toEqual({
      labelShow: true,
      labelColor: "#ffffff",
      labelSize: 11,
      labelFormat: "auto",
      borderWeight: 1.5,
      borderColor: "#333333",
    });

    m.currentLabelShow = false;
    m.currentLabelColor = "#ff0000";
    m.currentLabelSize = 16;
    m.currentLabelFormat = "comma";
    expect(opts.styleProvider!()).toEqual({
      labelShow: false,
      labelColor: "#ff0000",
      labelSize: 16,
      labelFormat: "comma",
      borderWeight: 1.5,
      borderColor: "#333333",
    });
  });

  it("constructs with empty field when CONF.field is absent", () => {
    delete (window.CONF as Record<string, unknown>).field;
    const m = makeManager();
    expect(m.currentField).toBe("");
  });

  it("labelShow setter flips state, re-renders and persists", () => {
    const m = makeManager();
    const renderSpy = vi.spyOn(m, "renderHexagons");
    const saveSpy = vi.spyOn(m, "saveConfig");
    const opts = getCanvasOpts();

    opts.styleSetters!.labelShow!(false);

    expect(m.currentLabelShow).toBe(false);
    expect(renderSpy).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalled();
  });

  it("labelShow setter touches the layer and emits LAYER_STYLE_CHANGE", () => {
    const m = makeManager();
    // makeManager builds a bare map stub; the setter reaches LayerAPI through
    // this.map.foliplus (makeCtrl wires the same object).
    (m.map as unknown as { foliplus: unknown }).foliplus = window.map.foliplus;
    const touchLayer = window.map.foliplus.LayerAPI.touchLayer;
    const emitSpy = vi.spyOn(m.events, "emit");
    const opts = getCanvasOpts();

    opts.styleSetters!.labelShow!(true);

    expect(touchLayer).toHaveBeenCalledWith(m.layerId);
    expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_STYLE_CHANGE, {
      id: m.layerId,
    });
  });

  it("labelFormat setter touches the layer and emits LAYER_STYLE_CHANGE", () => {
    const m = makeManager();
    (m.map as unknown as { foliplus: unknown }).foliplus = window.map.foliplus;
    const touchLayer = window.map.foliplus.LayerAPI.touchLayer;
    const emitSpy = vi.spyOn(m.events, "emit");
    const opts = getCanvasOpts();

    opts.styleSetters!.labelFormat!("comma");

    expect(touchLayer).toHaveBeenCalledWith(m.layerId);
    expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_STYLE_CHANGE, {
      id: m.layerId,
    });
  });

  it("styleDefaults returns the Python CONF snapshot for the drawer Reset", () => {
    const m = makeManager();
    const opts = getCanvasOpts() as {
      styleDefaults?: () => Record<string, unknown>;
    };
    expect(typeof opts.styleDefaults).toBe("function");
    expect(opts.styleDefaults!()).toEqual({
      labelShow: true,
      labelColor: "#ffffff",
      labelSize: 11,
      labelFormat: "auto",
      borderWeight: 1.5,
      borderColor: "#333333",
    });

    // Runtime toggles must not leak into the Reset snapshot.
    m.currentLabelShow = false;
    m.currentLabelColor = "#00ff00";
    m.currentLabelSize = 20;
    m.currentLabelFormat = "comma";
    expect(opts.styleDefaults!()).toEqual({
      labelShow: true,
      labelColor: "#ffffff",
      labelSize: 11,
      labelFormat: "auto",
      borderWeight: 1.5,
      borderColor: "#333333",
    });
  });

  it("labelColor and labelSize setters update state, clear the style cache and persist", () => {
    const m = makeManager();
    const redrawSpy = vi.spyOn(m, "redrawHeatmap");
    const saveSpy = vi.spyOn(m, "saveConfig");
    const opts = getCanvasOpts();

    opts.styleSetters!.labelColor!("#00ff00");
    expect(m.currentLabelColor).toBe("#00ff00");
    expect(m.cachedLabelStyle).toBeNull();

    opts.styleSetters!.labelSize!(18);
    expect(m.currentLabelSize).toBe(18);
    expect(redrawSpy).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalled();
  });

  it("labelSize setter clamps out-of-range values", () => {
    const m = makeManager();
    const opts = getCanvasOpts();

    opts.styleSetters!.labelSize!(99);
    expect(m.currentLabelSize).toBe(CONST.LABEL.SIZE_MAX);

    opts.styleSetters!.labelSize!(1);
    expect(m.currentLabelSize).toBe(CONST.LABEL.SIZE_MIN);
  });

  it("labelColor setter ignores non-string values and normalizes #rgb", () => {
    const m = makeManager();
    const opts = getCanvasOpts();

    opts.styleSetters!.labelColor!(42);
    expect(m.currentLabelColor).toBe("#ffffff");

    opts.styleSetters!.labelColor!("#abc");
    expect(m.currentLabelColor).toBe("#aabbcc");
  });

  it("labelSize setter ignores NaN and non-number values", () => {
    const m = makeManager();
    const opts = getCanvasOpts();

    opts.styleSetters!.labelSize!(Number.NaN);
    expect(m.currentLabelSize).toBe(11);

    opts.styleSetters!.labelSize!("18" as unknown as number);
    expect(m.currentLabelSize).toBe(11);
  });

  it("labelColor and labelSize setters work without a bound panel", () => {
    const m = makeManager();
    // ui is null — the setters own state only; panels refresh via
    // LAYER_STYLE_CHANGE, so no panel sync happens here.
    expect(() => {
      getCanvasOpts().styleSetters!.labelColor!("#00ff00");
      getCanvasOpts().styleSetters!.labelSize!(20);
    }).not.toThrow();
    expect(m.currentLabelColor).toBe("#00ff00");
    expect(m.currentLabelSize).toBe(20);
  });

  it("labelFormat setter updates state, redraws labels and persists", () => {
    const m = makeManager();
    const redrawSpy = vi.spyOn(m, "redrawHeatmap");
    const saveSpy = vi.spyOn(m, "saveConfig");
    const opts = getCanvasOpts();

    opts.styleSetters!.labelFormat!("comma");

    expect(m.currentLabelFormat).toBe("comma");
    expect(redrawSpy).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalled();
  });

  it("labelFormat setter falls back to auto for non-string values", () => {
    const m = makeManager();
    const opts = getCanvasOpts();

    opts.styleSetters!.labelFormat!(42);

    expect(m.currentLabelFormat).toBe("auto");
  });

  it("currentLabelFormat seeds from CONF.label_format", () => {
    const m = makeManager({ label_format: "percent" });
    expect(m.currentLabelFormat).toBe("percent");
  });

  it("labelFormat defaults to auto when CONF omits label_format", () => {
    const m = makeManager({ label_format: undefined });
    expect(m.currentLabelFormat).toBe("auto");
  });

  it("labelShow defaults to true when CONF omits label_show", () => {
    // Python serializes label_show=True by default; a missing key must not
    // silently flip labels off — the same `!== false` rule MeasureControl uses.
    const m = makeManager({ label_show: undefined });
    const opts = getCanvasOpts() as {
      styleDefaults?: () => Record<string, unknown>;
    };

    expect(m.currentLabelShow).toBe(true);
    expect(opts.styleDefaults!().labelShow).toBe(true);
  });

  it("borderWeight defaults to BORDER_WEIGHT.DEFAULT when CONF omits border_weight", () => {
    const m = makeManager({ border_weight: undefined });
    expect(m.borderWeight).toBe(BORDER_WEIGHT.DEFAULT);
  });

  it("borderWeight setter updates state, re-renders and persists", () => {
    const m = makeManager();
    const redrawSpy = vi.spyOn(m, "redrawHeatmap");
    const saveSpy = vi.spyOn(m, "saveConfig");
    const opts = getCanvasOpts();

    opts.styleSetters!.borderWeight!(3);

    expect(m.borderWeight).toBe(3);
    expect(redrawSpy).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalled();
  });

  it("borderWeight setter clamps out-of-range values", () => {
    const m = makeManager();
    const opts = getCanvasOpts();

    opts.styleSetters!.borderWeight!(99);
    expect(m.borderWeight).toBe(BORDER_WEIGHT.MAX);

    opts.styleSetters!.borderWeight!(-5);
    expect(m.borderWeight).toBe(BORDER_WEIGHT.MIN);
  });

  it("borderWeight setter ignores NaN and non-number values", () => {
    const m = makeManager();
    const opts = getCanvasOpts();

    opts.styleSetters!.borderWeight!(Number.NaN);
    expect(m.borderWeight).toBe(1.5);

    opts.styleSetters!.borderWeight!("3" as unknown as number);
    expect(m.borderWeight).toBe(1.5);
  });

  it("borderWeight setter touches the layer and emits LAYER_STYLE_CHANGE", () => {
    const m = makeManager();
    (m.map as unknown as { foliplus: unknown }).foliplus = window.map.foliplus;
    const touchLayer = window.map.foliplus.LayerAPI.touchLayer;
    const emitSpy = vi.spyOn(m.events, "emit");
    const opts = getCanvasOpts();

    opts.styleSetters!.borderWeight!(2.5);

    expect(touchLayer).toHaveBeenCalledWith(m.layerId);
    expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_STYLE_CHANGE, {
      id: m.layerId,
    });
  });

  it("borderColor setter updates state, re-renders and persists", () => {
    const m = makeManager();
    const redrawSpy = vi.spyOn(m, "redrawHeatmap");
    const saveSpy = vi.spyOn(m, "saveConfig");
    const opts = getCanvasOpts();

    opts.styleSetters!.borderColor!("#abcdef");

    expect(m.borderColor).toBe("#abcdef");
    expect(redrawSpy).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalled();
  });

  it("borderColor setter ignores non-string values and normalizes #rgb", () => {
    const m = makeManager();
    const opts = getCanvasOpts();

    opts.styleSetters!.borderColor!(42);
    expect(m.borderColor).toBe("#333333");

    opts.styleSetters!.borderColor!("#abc");
    expect(m.borderColor).toBe("#aabbcc");
  });

  it("borderColor setter touches the layer and emits LAYER_STYLE_CHANGE", () => {
    const m = makeManager();
    (m.map as unknown as { foliplus: unknown }).foliplus = window.map.foliplus;
    const touchLayer = window.map.foliplus.LayerAPI.touchLayer;
    const emitSpy = vi.spyOn(m.events, "emit");
    const opts = getCanvasOpts();

    opts.styleSetters!.borderColor!("#00ff00");

    expect(touchLayer).toHaveBeenCalledWith(m.layerId);
    expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_STYLE_CHANGE, {
      id: m.layerId,
    });
  });
});

describe("HeatmapManager — source meta for the attrs panel", () => {
  const metaOf = (m: HeatmapManager) =>
    window.map.foliplus.LayerAPI.createCanvas.mock.calls.find(
      ([opts]: [{ id?: string }]) => opts.id === m.layerId,
    )![0].meta as Record<string, string | number>;

  it("passes a shared meta object to createCanvas", () => {
    const m = makeManager();
    const meta = metaOf(m);
    expect(meta).toBe(m.sourceMeta);
    expect(meta).toEqual({});
  });

  it("writes source layer name and aggregation field on sync", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "pts", name: "Stores", layer: null, count: 2 }];
    m.selectedLayerId = "pts";
    m.currentAgg = "sum";
    m.currentField = "properties.sales";

    m.syncSourceMeta();

    expect(m.sourceMeta["HeatmapControl.meta_source_layer"]).toBe("Stores");
    expect(m.sourceMeta["HeatmapControl.meta_agg_field"]).toBe("sales");
    expect(window.map.foliplus.LayerAPI.touchLayer).toHaveBeenCalledWith(m.layerId);
  });

  it("omits the field row under count aggregation", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "pts", name: "Stores", layer: null, count: 1 }];
    m.selectedLayerId = "pts";
    m.currentAgg = "count";
    m.currentField = "properties.sales";

    m.syncSourceMeta();

    expect(m.sourceMeta["HeatmapControl.meta_source_layer"]).toBe("Stores");
    expect(m.sourceMeta["HeatmapControl.meta_agg_field"]).toBe("");
  });

  it("uses the auto field when currentField is empty", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "pts", name: "Stores", layer: null, count: 1 }];
    m.selectedLayerId = "pts";
    m.currentAgg = "avg";
    m.currentField = "";
    m.autoFieldKey = "properties.dwell";

    m.syncSourceMeta();

    expect(m.sourceMeta["HeatmapControl.meta_agg_field"]).toBe("dwell");
  });

  it("clears both rows when no layer is selected", () => {
    const m = makeManager();
    m.sourceMeta["HeatmapControl.meta_source_layer"] = "Stores";
    m.sourceMeta["HeatmapControl.meta_agg_field"] = "sales";
    m.selectedLayerId = null;

    m.syncSourceMeta();

    expect(m.sourceMeta["HeatmapControl.meta_source_layer"]).toBe("");
    expect(m.sourceMeta["HeatmapControl.meta_agg_field"]).toBe("");
  });

  it("keeps a plain field name as-is (no properties. prefix)", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "pts", name: "Stores", layer: null, count: 1 }];
    m.selectedLayerId = "pts";
    m.currentAgg = "max";
    m.currentField = "value";

    m.syncSourceMeta();

    expect(m.sourceMeta["HeatmapControl.meta_agg_field"]).toBe("value");
  });

  it("clears the name when the selected id is no longer in pointLayers", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "other", name: "Other", layer: null, count: 1 }];
    m.selectedLayerId = "gone";
    m.sourceMeta["HeatmapControl.meta_source_layer"] = "Stores";

    m.syncSourceMeta();

    expect(m.sourceMeta["HeatmapControl.meta_source_layer"]).toBe("");
  });

  it("does not stamp Updated when the published values are unchanged", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "pts", name: "Stores", layer: null, count: 1 }];
    m.selectedLayerId = "pts";
    m.currentAgg = "count";

    m.syncSourceMeta();
    const touch = window.map.foliplus.LayerAPI.touchLayer;
    expect(touch).toHaveBeenCalledTimes(1);

    m.syncSourceMeta();
    expect(touch).toHaveBeenCalledTimes(1);
  });
});

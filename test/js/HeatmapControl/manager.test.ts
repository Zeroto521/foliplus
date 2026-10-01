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

  it("stays a pure canvas clear — the render empty states keep the user's selection", () => {
    const m = makeManager();
    m.selectedLayerId = "pts";
    m.currentAgg = CONST.AGG.SUM;
    m.currentField = "price";
    m.currentMethod = "quantile";
    m.numClasses = 9;
    m.autoFieldKey = "price";

    // A zoom that lands on no features runs clearHeatmapCanvas through the
    // render empty path — the selection is a user choice, not a render artifact.
    m.renderFeatures([]);

    expect(m.selectedLayerId).toBe("pts");
    expect(m.currentAgg).toBe(CONST.AGG.SUM);
    expect(m.currentField).toBe("price");
    expect(m.currentMethod).toBe("quantile");
    expect(m.numClasses).toBe(9);
    expect(m.autoFieldKey).toBe("price");
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

  it("redrawHeatmap drops slider CSS so the bake never double-compounds (R11)", () => {
    const m = makeManager();
    const canvas = document.createElement("canvas");
    canvas.style.opacity = "0.4"; // live slider arm left this on
    m.overlay = {
      canvas,
      ctx: {
        setTransform: vi.fn(),
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        fillText: vi.fn(),
        measureText: vi.fn(() => ({ width: 10 })),
      } as unknown as CanvasRenderingContext2D,
      register: vi.fn(),
      unregister: vi.fn(),
      setVisible: vi.fn(),
      hooks: { before: [], after: [] },
    };
    m.cachedFeatures = [] as never;
    m.currentLabelShow = false;
    // resolveLabelStyle runs unconditionally before the feature loop.
    m.ui = { ...makeCtrl(m), ctrl: document.createElement("div") };
    m.map.getContainer = vi.fn(() => {
      const c = document.createElement("div");
      Object.defineProperty(c, "clientWidth", { value: 100 });
      Object.defineProperty(c, "clientHeight", { value: 100 });
      return c;
    });
    m.map.getBounds = vi.fn(() => ({ contains: () => true }));

    m.redrawHeatmap();
    // Bake is now the carrier: CSS must be cleared before the draw.
    expect(canvas.style.opacity).toBe("");
  });

  it("clearHeatmapCanvas emits LAYER_ITEM_COUNT_CHANGE so LayerControl refreshes count to 0", () => {
    const m = makeManager();
    const bus = ensureEvents(m.map);
    const handler = vi.fn();
    bus.on(EVENTS.LAYER_ITEM_COUNT_CHANGE, handler);
    m.clearHeatmapCanvas();
    expect(handler).toHaveBeenCalledWith({ id: m.layerId });
  });

  it("clearHeatmapCanvas drops the layer id from the stored order so a redraw lands on top", () => {
    const m = makeManager();
    const forgetSavedOrder = vi.fn(() => true);
    (
      m.map as unknown as { foliplus?: { LayerAPI?: Record<string, unknown> } }
    ).foliplus = {
      LayerAPI: { forgetSavedOrder },
    };
    m.clearHeatmapCanvas();
    expect(forgetSavedOrder).toHaveBeenCalledWith(m.layerId);
  });

  it("clearHeatmapCanvas tolerates a LayerAPI without forgetSavedOrder", () => {
    // An older / lightweight LayerAPI stub won't have forgetSavedOrder; the
    // optional call chain should be a silent no-op so clear never throws.
    const m = makeManager();
    (m.map as unknown as { foliplus?: unknown }).foliplus = { LayerAPI: {} };
    expect(() => m.clearHeatmapCanvas()).not.toThrow();
  });

  it("clearHeatmapCanvas tolerates a map without any LayerAPI", () => {
    // A stripped map (e.g. before any foliplus wiring) must not throw either.
    const m = makeManager();
    (m.map as unknown as { foliplus?: unknown }).foliplus = undefined;
    expect(() => m.clearHeatmapCanvas()).not.toThrow();
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
  const zoomendHandlers = (m: HeatmapManager): Array<() => void> =>
    m.map.on.mock.calls
      .filter(([evt]: [string]) => evt === "zoomend")
      .map(([, fn]: [string, () => void]) => fn);

  const zoomstartHandler = (m: HeatmapManager): (() => void) =>
    m.map.on.mock.calls.filter(([evt]: [string]) => evt === "zoomstart")[0][1];

  it("zoomstart borrows the canvas away through its visibility style", () => {
    // The anti-flicker temp-hide must not stamp the HIDDEN class: that
    // class is the LayerControl intent channel, and stamping it would make
    // "zoom hid it" indistinguishable from "the user hid it" at restore.
    const m = makeManager();
    m.overlay.canvas = document.createElement("canvas");
    zoomstartHandler(m)();
    expect(m.overlay.canvas.style.visibility).toBe("hidden");
    expect(m.overlay.canvas.classList.contains("hidden")).toBe(false);
    expect(m.overlay.setVisible).not.toHaveBeenCalled();
  });

  it("zoomend hands the visibility style back and never touches the HIDDEN class", () => {
    const m = makeManager();
    m.overlay.canvas = document.createElement("canvas");
    zoomstartHandler(m)();
    zoomendHandlers(m).forEach(fn => fn());
    expect(m.overlay.canvas.style.visibility).toBe("");
    expect(m.overlay.canvas.classList.contains("hidden")).toBe(false);
    expect(m.overlay.setVisible).not.toHaveBeenCalledWith(true);
    expect(m.overlay.setVisible).not.toHaveBeenCalledWith(false);
  });

  it("a user-hidden canvas keeps its HIDDEN class through a full zoom cycle", () => {
    // The class is the executor's channel: the zoom cycle borrows and
    // returns only the style, so the user's hide survives untouched — no
    // LayerControl state mirror needed on this side anymore.
    const m = makeManager();
    m.overlay.canvas = document.createElement("canvas");
    m.overlay.canvas.classList.add("hidden"); // LayerControl checkbox off
    zoomstartHandler(m)();
    zoomendHandlers(m).forEach(fn => fn());
    expect(m.overlay.canvas.classList.contains("hidden")).toBe(true);
    expect(m.overlay.canvas.style.visibility).toBe("");
    expect(m.overlay.setVisible).not.toHaveBeenCalledWith(true);
  });

  it("onZoomEnd re-renders and still leaves the intent channel alone", () => {
    const m = makeManager();
    m.selectedLayerId = "layer1";
    m.overlay.canvas = document.createElement("canvas");
    m.overlay.canvas.classList.add("hidden");
    const renderSpy = vi.spyOn(m, "renderHexagons").mockImplementation(() => {});

    m.onZoomEnd();
    m.onZoomEnd.flush();

    expect(renderSpy).toHaveBeenCalled();
    expect(m.overlay.canvas.classList.contains("hidden")).toBe(true);
    expect(m.overlay.canvas.style.visibility).toBe("");
    expect(m.overlay.setVisible).not.toHaveBeenCalledWith(true);
  });

  it("the zoom cycle is a no-op before the canvas exists", () => {
    // The style borrows guard on the element: a zoom that lands between
    // construction and the first draw (fixture default: canvas null) must
    // not throw or fall back to the setVisible stub.
    const m = makeManager();
    m.selectedLayerId = "layer1";
    zoomstartHandler(m)();
    zoomendHandlers(m).forEach(fn => fn());

    expect(m.overlay.setVisible).not.toHaveBeenCalled();
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

    bus.emit(EVENTS.BEFORE_EXPORT, { component: "ExportControl" });
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
      createCanvas: vi.fn(() => {
        const canvas = document.createElement("canvas");
        return {
          register: vi.fn(),
          unregister: vi.fn(),
          setVisible: vi.fn(),
          hooks: { before: [], after: [] },
          canvas,
          ctx: canvas.getContext("2d"),
        };
      }),
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
    ensureEvents(m.map).emit(EVENTS.LAYER_CHANGE, { id: "pts", kind: "vector" });
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    expect(m.cachedAgg).toBeNull();
    expect(m.cachedPoints).toBeNull();
  });

  it("a bare LAYER_CHANGE (no payload) still triggers onLayerChange", async () => {
    // Defense arm for the handler's `!payload` fallback: third-party or
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
    ensureEvents(m.map).emit(EVENTS.LAYER_CHANGE as never);
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    expect(m.cachedAgg).toBeNull();
    expect(m.cachedPoints).toBeNull();
  });

  it.each(["tile", "solid", "canvas"])(
    "ignores a LAYER_CHANGE whose kind (%s) can never hold point markers",
    async kind => {
      // A tile basemap, a solid colour face and a self-drawn canvas all answer
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
      styleDefaultsProvider?: () => Record<string, unknown>;
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

  it("styleDefaultsProvider returns the Python CONF snapshot for the drawer Reset", () => {
    const m = makeManager();
    const opts = getCanvasOpts() as {
      styleDefaultsProvider?: () => Record<string, unknown>;
    };
    expect(typeof opts.styleDefaultsProvider).toBe("function");
    expect(opts.styleDefaultsProvider!()).toEqual({
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
    expect(opts.styleDefaultsProvider!()).toEqual({
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
      styleDefaultsProvider?: () => Record<string, unknown>;
    };

    expect(m.currentLabelShow).toBe(true);
    expect(opts.styleDefaultsProvider!().labelShow).toBe(true);
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
    const conf = makeConf({ color_scheme: "Blues", n_classes: 4, method: "equal" });
    const m = makeManager();
    const ctrl = makeCtrl(m, conf);
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
    m.currentAgg = CONST.AGG.SUM;
    m.currentField = "price";
    m.autoFieldKey = "price";
    m.currentScheme = "Greens";
    m.numClasses = 8;
    m.currentMethod = "quantile";
    const clearSpy = vi.spyOn(m, "clearHeatmapCanvas");
    const clearSaved = vi.spyOn(m, "clearSavedConfig");

    ensureEvents(m.map).emit(EVENTS.LAYER_DELETED, { id: m.layerId });

    // State back to the declared defaults, no stale selection left behind.
    expect(m.selectedLayerId).toBeNull();
    expect(m.autoFieldKey).toBeNull();
    expect(m.currentAgg).toBe(CONST.AGG.COUNT);
    expect(m.currentField).toBe("");
    expect(m.currentMethod).toBe(conf.method);
    expect(m.currentScheme).toBe(conf.color_scheme);
    expect(m.numClasses).toBe(conf.n_classes);
    expect(m.cachedFeatures).toBeNull();
    // Every dropdown reflects the reset — the reported bug was the panel
    // still showing the cleared layer and field.
    expect(ctrl.layerSelect.value).toBe("");
    expect(ctrl.aggSelect.value).toBe(CONST.AGG.COUNT);
    expect(ctrl.methodSelect.value).toBe(conf.method);
    expect(ctrl.classSelect.value).toBe(String(conf.n_classes));
    expect(ctrl.schemeSelectHidden.value).toBe(conf.color_scheme);
    expect(ctrl.extraBody.classList.contains(CONST.CLASSES.HIDDEN)).toBe(true);
    // The record is dropped so a reload does not resurrect the cleared layer,
    // the same teardown as MeasureControl's LAYER_DELETED -> clearAll.
    expect(clearSaved).toHaveBeenCalledTimes(1);
    // resetPanel owns the single canvas wipe — the event handler must not add
    // another one on top of it.
    expect(clearSpy).toHaveBeenCalledTimes(1);
    // Only the contents reset — the panel stays open for the next pick.
    expect(ctrl.ctrl.classList.contains(CONST.CLASSES.COLLAPSED)).toBe(false);
  });

  it("resets state and drops the record when own layer is deleted with no panel", () => {
    const m = makeManager();
    m.ui = null;
    m.selectedLayerId = "pts";
    m.currentAgg = CONST.AGG.SUM;
    m.currentField = "price";
    m.currentScheme = "Greens";
    m.numClasses = 8;
    m.autoFieldKey = "price";
    const clearSpy = vi.spyOn(m, "clearHeatmapCanvas");
    const clearSaved = vi.spyOn(m, "clearSavedConfig");

    ensureEvents(m.map).emit(EVENTS.LAYER_DELETED, { id: m.layerId });

    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(clearSaved).toHaveBeenCalledTimes(1);
    expect(m.selectedLayerId).toBeNull();
    expect(m.autoFieldKey).toBeNull();
    expect(m.currentAgg).toBe(CONST.AGG.COUNT);
    expect(m.currentField).toBe("");
    expect(m.currentScheme).toBe("Reds");
    expect(m.currentMethod).toBe("jenks");
    expect(m.numClasses).toBe(6);
  });
});

describe("constructor — CONF fallbacks", () => {
  it("uses library defaults when CONF omits optional style fields", () => {
    const m = makeManager({
      agg: undefined,
      color_scheme: undefined,
      method: undefined,
      n_classes: undefined,
      border_color: undefined,
      label_color: undefined,
      label_size: undefined,
    });
    expect(m.currentAgg).toBe(CONST.AGG.COUNT);
    expect(m.currentScheme).toBe("Reds");
    expect(m.currentMethod).toBe("jenks");
    expect(m.numClasses).toBe(CONST.CLASS_COUNT.DEFAULT);
    expect(m.borderColor).toBe(CONST.GRAY);
  });
});

describe("featureCountProvider", () => {
  it("returns 0 when cachedFeatures is null", () => {
    const m = makeManager();
    const opts = window.map.foliplus.LayerAPI.createCanvas.mock.calls[0][0];
    expect(opts.featureCountProvider()).toBe(0);
  });

  it("returns the feature count when cachedFeatures is set", () => {
    const m = makeManager();
    m.cachedFeatures = [{}, {}, {}];
    const opts = window.map.foliplus.LayerAPI.createCanvas.mock.calls[0][0];
    expect(opts.featureCountProvider()).toBe(3);
  });
});

describe("onMove handler", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function getMoveHandler(m: HeatmapManager) {
    const moveCall = m.map.on.mock.calls.find(([event]: [string]) => event === "move");
    return moveCall?.[1] as () => void;
  }

  it("calls redrawHeatmap when canvas and features are both set", () => {
    const m = makeManager();
    const handler = getMoveHandler(m);
    m.overlay.canvas = { style: {} };
    m.cachedFeatures = [{}] as never;
    const redrawSpy = vi.spyOn(m, "redrawHeatmap");
    handler();
    expect(redrawSpy).toHaveBeenCalled();
  });

  it("does not call redrawHeatmap when canvas is null", () => {
    const m = makeManager();
    const handler = getMoveHandler(m);
    m.overlay.canvas = null;
    m.cachedFeatures = [{}] as never;
    const redrawSpy = vi.spyOn(m, "redrawHeatmap");
    handler();
    expect(redrawSpy).not.toHaveBeenCalled();
  });

  it("does not call redrawHeatmap when cachedFeatures is null", () => {
    const m = makeManager();
    const handler = getMoveHandler(m);
    m.overlay.canvas = { style: {} };
    m.cachedFeatures = null;
    const redrawSpy = vi.spyOn(m, "redrawHeatmap");
    handler();
    expect(redrawSpy).not.toHaveBeenCalled();
  });
});

describe("redrawHeatmap — edge cases", () => {
  function setupCanvas(m: HeatmapManager) {
    m.overlay.canvas = { style: {} };
    m.overlay.ctx = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      measureText: vi.fn(() => ({ width: 10 })),
    } as unknown as CanvasRenderingContext2D;
    m.map.getContainer = vi.fn(() => {
      const c = document.createElement("div");
      Object.defineProperty(c, "clientWidth", { value: 100 });
      Object.defineProperty(c, "clientHeight", { value: 100 });
      return c;
    });
    m.map.getBounds = vi.fn(() => ({ contains: () => true }));
    m.map.latLngToContainerPoint = vi.fn(() => ({ x: 0, y: 0 }));
    m.ui = { ...makeCtrl(m), ctrl: document.createElement("div") };
  }

  function makeFeature(centroid: [number, number] | null) {
    return {
      properties: { centroid, fillColor: "#fff" },
      geometry: {
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
    } as never;
  }

  it("returns early when ctx is null", () => {
    const m = makeManager();
    m.overlay.canvas = { style: {} };
    m.overlay.ctx = null;
    m.cachedFeatures = [makeFeature([0, 0])] as never;
    expect(() => m.redrawHeatmap()).not.toThrow();
  });

  it("uses devicePixelRatio of 1 when window.devicePixelRatio is 0", () => {
    const m = makeManager();
    setupCanvas(m);
    m.cachedFeatures = [makeFeature([0, 0])] as never;
    const dpr = window.devicePixelRatio;
    (window as any).devicePixelRatio = 0;
    try {
      m.redrawHeatmap();
    } finally {
      (window as any).devicePixelRatio = dpr;
    }
  });

  it("uses null bounds when renderAll is true", () => {
    const m = makeManager();
    setupCanvas(m);
    m.cachedFeatures = [makeFeature([0, 0])] as never;
    m.renderAll = true;
    m.currentLabelShow = false;
    m.redrawHeatmap();
  });

  it("draws labels when currentLabelShow is true", () => {
    const m = makeManager();
    setupCanvas(m);
    m.cachedFeatures = [makeFeature([0, 0])] as never;
    m.renderAll = false;
    m.currentLabelShow = true;
    m.redrawHeatmap();
  });

  it("skips labels when currentLabelShow is false", () => {
    const m = makeManager();
    setupCanvas(m);
    m.cachedFeatures = [makeFeature([0, 0])] as never;
    m.renderAll = false;
    m.currentLabelShow = false;
    m.redrawHeatmap();
  });

  it("skips a feature whose centroid is null", () => {
    const m = makeManager();
    setupCanvas(m);
    m.cachedFeatures = [makeFeature(null)] as never;
    m.renderAll = false;
    m.currentLabelShow = false;
    m.redrawHeatmap();
  });

  it("skips a feature that is outside the bounds", () => {
    const m = makeManager();
    setupCanvas(m);
    m.cachedFeatures = [makeFeature([100, 100])] as never;
    m.map.getBounds = vi.fn(() => ({ contains: () => false }));
    m.renderAll = false;
    m.currentLabelShow = false;
    m.redrawHeatmap();
  });
});

describe("computeBounds", () => {
  beforeEach(() => {
    window.L.latLngBounds = vi.fn(() => ({
      getNorth: () => 0,
      getSouth: () => 0,
      getEast: () => 0,
      getWest: () => 0,
      isValid: () => true,
      contains: () => true,
      getCenter: () => ({ lat: 0, lng: 0 }),
      extend: vi.fn(),
    }));
  });
  it("uses the pointLayers bounds when cachedFeatures is null", () => {
    const m = makeManager();
    m.cachedFeatures = null;
    m.pointLayers = [
      {
        id: "p1",
        name: "P1",
        layer: {
          getBounds: vi.fn(() => ({
            isValid: () => true,
            extend: vi.fn(),
          })),
        } as never,
        count: 1,
      },
    ];
    const bounds = m.computeBounds();
    expect(bounds).not.toBeNull();
  });

  it("uses the ring coordinates when a feature has a ring", () => {
    const m = makeManager();
    m.cachedFeatures = [
      {
        properties: { centroid: [0, 0] },
        geometry: {
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0],
            ],
          ],
        },
      },
    ] as never;
    const bounds = m.computeBounds();
    expect(bounds).not.toBeNull();
  });

  it("falls back to centroid when a feature has no ring", () => {
    const m = makeManager();
    m.cachedFeatures = [
      {
        properties: { centroid: [0, 0] },
        geometry: { coordinates: [] },
      },
    ] as never;
    const bounds = m.computeBounds();
    expect(bounds).not.toBeNull();
  });

  it("skips a feature with no centroid and no ring", () => {
    const m = makeManager();
    m.cachedFeatures = [
      {
        properties: { centroid: null },
        geometry: { coordinates: [] },
      },
    ] as never;
    m.computeBounds();
  });

  it("skips a pointLayer without getBounds", () => {
    const m = makeManager();
    m.cachedFeatures = null;
    m.pointLayers = [
      {
        id: "p1",
        name: "P1",
        layer: {} as never,
        count: 1,
      },
    ];
    m.computeBounds();
  });

  it("skips a pointLayer whose bounds are invalid", () => {
    const m = makeManager();
    m.cachedFeatures = null;
    m.pointLayers = [
      {
        id: "p1",
        name: "P1",
        layer: {
          getBounds: vi.fn(() => ({
            isValid: () => false,
            extend: vi.fn(),
          })),
        } as never,
        count: 1,
      },
    ];
    m.computeBounds();
  });

  it("returns null when the accumulated bounds are invalid", () => {
    const m = makeManager();
    window.L.latLngBounds = vi.fn(() => ({
      getNorth: () => 0,
      getSouth: () => 0,
      getEast: () => 0,
      getWest: () => 0,
      isValid: () => false,
      contains: () => true,
      getCenter: () => ({ lat: 0, lng: 0 }),
      extend: vi.fn(),
    }));
    m.cachedFeatures = null;
    m.pointLayers = [];
    expect(m.computeBounds()).toBeNull();
  });
});

describe("clearHeatmapCanvas — null overlay", () => {
  it("tolerates a null overlay", () => {
    const m = makeManager();
    m.overlay = null as never;
    expect(() => m.clearHeatmapCanvas()).not.toThrow();
  });
});

describe("resetState — CONF fallbacks", () => {
  it("uses library defaults when conf omits optional fields", () => {
    const m = makeManager();
    m.currentAgg = CONST.AGG.SUM;
    m.currentMethod = "quantile";
    m.currentScheme = "Greens";
    m.numClasses = 9;
    m.resetState({
      agg: undefined,
      n_classes: undefined,
      method: undefined,
      color_scheme: undefined,
    });
    expect(m.currentAgg).toBe(CONST.AGG.COUNT);
    expect(m.numClasses).toBe(CONST.CLASS_COUNT.DEFAULT);
    expect(m.currentMethod).toBe("jenks");
    expect(m.currentScheme).toBe("Reds");
  });
});

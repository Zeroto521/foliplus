import { initFixture, trackMembership } from "../LayerControl/ui/fixture.js";
import {
  loadGeometry,
  makeConfig,
  makeCtrl,
  makeManager,
  makeManagerOn,
} from "./fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLASS_COUNT, METHOD } from "#core/value/classify.js";
import { EVENTS, SettledOperation, ensureEvents, publish } from "#core/event/index.js";
import { getLayerAlpha, setLayerAlpha } from "#core/layer/canvasAlpha.js";
import { FILTER_STORE_KEY, type LayerFilter, extractMarkerFields } from "#core/layer/index.js";
import { SCHEME_FALLBACK_COLOR } from "#core/value/palette.js";
import { BORDER_WEIGHT } from "#ui/index.js";
import * as CONST from "#control/HeatmapControl/const.js";
import { HeatmapManager } from "#control/HeatmapControl/manager.js";
import {
  type HeatmapControlUI,
  rebuildLayerDropdown,
} from "#control/HeatmapControl/ui.js";
import type { LayerController } from "#control/LayerControl/controller.js";

afterEach(() => {
  delete globalThis.h3;
  delete globalThis.chroma;
});

describe("getPointValue", () => {
  let m: any;

  beforeEach(() => {
    m = makeManager();
  });

  it("returns 1 when agg is COUNT", () => {
    m.agg = CONST.AGG.COUNT;
    expect(m.getPointValue({})).toBe(1);
  });

  it("returns 1 as fallback for missing field", () => {
    m.agg = CONST.AGG.SUM;
    m.field = "nonexistent";
    expect(m.getPointValue({})).toBe(1);
  });
});

describe("getPointValue — additional gaps", () => {
  it("falls back to 1 when field is empty", () => {
    const m = makeManager();
    m.agg = CONST.AGG.SUM;
    m.field = "";
    expect(m.getPointValue({ value: 42 })).toBe(1);
  });

  it("uses field when it is set", () => {
    const m = makeManager();
    m.agg = CONST.AGG.SUM;
    m.field = "options.value";
    expect(m.getPointValue({ options: { value: 99 } })).toBe(99);
  });

  it("warns on value fallback (once per render)", () => {
    const m = makeManager();
    m.agg = CONST.AGG.SUM;
    m.field = "bad_field";
    m.valueFallbackWarned = false;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(m.getPointValue({})).toBe(1);
    expect(m.valueFallbackWarned).toBe(true);
    expect(m.getPointValue({})).toBe(1); // no additional warn
    warnSpy.mockRestore();
  });
});

describe("HeatmapManager — caching & lifecycle", () => {
  it("clearHeatmapCanvas resets all caches", () => {
    const m = makeManager();
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
    m.agg = CONST.AGG.SUM;
    m.field = "price";
    m.method = "quantile";
    m.numClasses = 9;

    // A zoom that lands on no features runs clearHeatmapCanvas through the
    // render empty path — the selection is a user choice, not a render artifact.
    m.renderFeatures([]);

    expect(m.selectedLayerId).toBe("pts");
    expect(m.agg).toBe(CONST.AGG.SUM);
    expect(m.field).toBe("price");
    expect(m.method).toBe("quantile");
    expect(m.numClasses).toBe(9);
  });

  it("clearHeatmapCanvas runs the UI listener cleanups so detached handlers die with the canvas", () => {
    const m = makeManager();
    const close = vi.fn();
    m.ui = {
      ...makeCtrl(m, makeConfig()),
      schemePicker: { close } as unknown as HeatmapControlUI["schemePicker"],
    };
    m.clearHeatmapCanvas();
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith({ restoreFocus: false });
  });

  it("clearHeatmapCanvas survives a null ui (control removed before teardown)", () => {
    const m = makeManager();
    m.ui = null;
    expect(() => m.clearHeatmapCanvas()).not.toThrow();
  });

  it("redrawHeatmap drops slider CSS so the bake never double-compounds (R11)", () => {
    const m = makeManager();
    const canvas = document.createElement("canvas");
    canvas.style.opacity = "0.4"; // live slider mode left this on
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
    m.labelShow = false;
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

  it("clearLayerState asks LayerControl to drop the stored state for this id", () => {
    // The intent row (visibility / opacity) lives under LayerControl's own
    // storage key, so clearSavedConfig alone never reached it.
    const m = makeManager();
    const dropPersistedLayerState = vi.fn(() => true);
    (
      m.map as unknown as { foliplus?: { LayerAPI?: Record<string, unknown> } }
    ).foliplus = {
      LayerAPI: { dropPersistedLayerState },
    };
    m.clearLayerState();
    expect(dropPersistedLayerState).toHaveBeenCalledWith(m.layerId);
  });

  it("clearLayerState tolerates a LayerAPI without dropPersistedLayerState", () => {
    // A LayerControl that predates this method must not break a panel Clear.
    const m = makeManager();
    (m.map as unknown as { foliplus?: unknown }).foliplus = { LayerAPI: {} };
    expect(() => m.clearLayerState()).not.toThrow();
  });

  it("clearLayerState tolerates a map without any LayerAPI", () => {
    const m = makeManager();
    (m.map as unknown as { foliplus?: unknown }).foliplus = undefined;
    expect(() => m.clearLayerState()).not.toThrow();
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
    m.ui = { ctrl: document.createElement("div") } as any;
    const style1 = m.resolveLabelStyle();
    const style2 = m.resolveLabelStyle();
    expect(style1).toBe(style2);
    expect(m.cachedLabelStyle).toBe(style1);
  });

  it("resolveLabelStyle picks up a runtime size change after cache clear", () => {
    const m = makeManager();
    m.ui = { ctrl: document.createElement("div") } as any;
    m.resolveLabelStyle();
    m.labelSize = 18;
    m.cachedLabelStyle = null;
    expect(m.resolveLabelStyle().font).toContain("18px");
  });

  /** Stub the lazy point traversal the field scan reads. `forEachPoint` is
   *  the extractPoints twin that hands the marker to the callback without
   *  building coordinates, so the tests feed markers directly. */
  const mockMarkers = (...markers: Array<Record<string, unknown>>) => {
    window.map.foliplus.LayerAPI.forEachPoint = vi.fn(
      (_id: string, fn: (marker: unknown) => void) => {
        markers.forEach(marker => fn(marker));
      },
    );
  };

  it("collectFields gathers numeric properties once", () => {
    const m = makeManager();
    mockMarkers(
      { feature: { properties: { price: 1, name: "x" } } },
      { feature: { properties: { price: 2 } } },
    );
    const fields = m.collectFields([{ id: "a" }, { id: "b" }]);
    expect(fields).toContain("price");
    expect(fields).not.toContain("name");
    expect(fields.filter(f => f === "price")).toHaveLength(1);
  });

  it("collectFields enumerates numeric value on extended marker", () => {
    const m = makeManager();
    mockMarkers({ value: 42, feature: { properties: { price: 1 } } });
    const fields = m.collectFields([{ id: "a" }]);
    expect(fields).toContain("value");
    expect(fields).toContain("price");
  });

  it("collectFields enumerates numeric options.value on extended marker", () => {
    const m = makeManager();
    mockMarkers({ options: { value: 99 }, feature: { properties: {} } });
    const fields = m.collectFields([{ id: "a" }]);
    expect(fields).toContain("options.value");
  });

  it("collectFields skips non-numeric value and options.value", () => {
    const m = makeManager();
    mockMarkers({
      value: "not-a-number",
      options: { value: undefined },
      feature: { properties: { price: 1 } },
    });
    const fields = m.collectFields([{ id: "a" }]);
    expect(fields).not.toContain("value");
    expect(fields).not.toContain("options.value");
    expect(fields).toContain("price");
  });

  it("collectFields deduplicates value and options.value across markers", () => {
    const m = makeManager();
    mockMarkers(
      { value: 1, feature: { properties: {} } },
      { value: 2, options: { value: 3 }, feature: { properties: {} } },
    );
    const fields = m.collectFields([{ id: "a" }]);
    expect(fields.filter(f => f === "value")).toHaveLength(1);
    expect(fields.filter(f => f === "options.value")).toHaveLength(1);
  });

  it("collectFields falls back to extractPoints on a LayerAPI without forEachPoint", () => {
    // A component bundle can pair with an older common runtime: the scan must
    // stay correct (just slower) when the lazy traversal is absent.
    const m = makeManager();
    window.map.foliplus.LayerAPI.forEachPoint = undefined;
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 0, lng: 0, marker: { feature: { properties: { price: 3 } } } },
    ]);
    expect(m.collectFields([{ id: "a" }])).toContain("price");
  });

  it("collectFields walks every listed layer through the lazy point traversal", () => {
    const m = makeManager();
    mockMarkers({ feature: { properties: { price: 1 } } });
    m.collectFields([{ id: "a" }, { id: "b" }]);
    expect(window.map.foliplus.LayerAPI.forEachPoint).toHaveBeenCalledTimes(2);
  });

  it("collectFields still enumerates value when feature.properties is absent", () => {
    const m = makeManager();
    mockMarkers({ value: 7 });
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
    m.agg = CONST.AGG.COUNT;
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 2, marker: {} },
      { lat: 3, lng: 4, marker: {} },
    ]);
    const pts = m.getSelectedPoints();
    expect(pts).toHaveLength(2);
    expect(m.cachedPoints).toBeDefined();
    expect(m.cachedPoints!.key).toContain("layer1");
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

  it("count broadcast is settled — a thrower does not starve later consumers", () => {
    const m = makeManager();
    m.overlay.register = vi.fn();
    m.redrawHeatmap = vi.fn();
    const bus = ensureEvents(m.map);
    const seen: string[] = [];
    bus.on(EVENTS.LAYER_ITEM_COUNT_CHANGE, () => {
      throw new Error("count boom");
    });
    bus.on(EVENTS.LAYER_ITEM_COUNT_CHANGE, payload => seen.push(payload.id));

    expect(() => m.renderFeatures([{ type: "Feature" }] as any)).toThrow("count boom");

    expect(seen).toEqual([m.layerId]);
    expect(m.cachedFeatures).toEqual([{ type: "Feature" }]);
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
      key: "layer1|2|count||jenks|Reds|6|",
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
    const { initScan } = await import("#control/HeatmapControl/ui.js");
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
    const { initScan } = await import("#control/HeatmapControl/ui.js");
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
    ensureEvents(m.map).publish(EVENTS.CONTROL_ATTACHED, {
      component: "LayerControl",
    });

    expect(m.hasScanned).toBe(true);
    expect(m.selectedLayerId).toBe("late");
  });

  it("settles the no-layer hint after the synchronous attach sequence", async () => {
    const { initScan } = await import("#control/HeatmapControl/ui.js");
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
    const { initScan } = await import("#control/HeatmapControl/ui.js");
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

    ensureEvents(m.map).publish(EVENTS.CONTROL_ATTACHED, {
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
    const { initScan } = await import("#control/HeatmapControl/ui.js");
    const m = makeManager();
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => [
      { id: "p1", name: "P1", layer: {} },
    ]);
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 2, marker: {} },
    ]);
    m.selectedLayerId = "p1";
    // A non-count agg exercises the full field-selector refresh path.
    m.agg = CONST.AGG.SUM;
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
    const { initScan } = await import("#control/HeatmapControl/ui.js");
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
    const { initScan } = await import("#control/HeatmapControl/ui.js");
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
    const { initScan } = await import("#control/HeatmapControl/ui.js");
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
    expect((opts as any).fieldOptions).toBeUndefined();
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

    m.labelShow = false;
    m.labelColor = "#ff0000";
    m.labelSize = 16;
    m.labelFormat = "comma";
    expect(opts.styleProvider!()).toEqual({
      labelShow: false,
      labelColor: "#ff0000",
      labelSize: 16,
      labelFormat: "comma",
      borderWeight: 1.5,
      borderColor: "#333333",
    });
  });

  it("constructs with empty field when CONFIG.field is absent", () => {
    delete (window.CONFIG as Record<string, unknown>).field;
    const m = makeManager();
    expect(m.field).toBe("");
  });

  it("labelShow setter flips state, re-renders and persists", () => {
    const m = makeManager();
    const renderSpy = vi.spyOn(m, "renderHexagons");
    const saveSpy = vi.spyOn(m, "saveConfig");
    const opts = getCanvasOpts();

    opts.styleSetters!.labelShow!(false);

    expect(m.labelShow).toBe(false);
    expect(renderSpy).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalled();
  });

  it("labelShow setter touches the layer and emits LAYER_STYLE_CHANGE", () => {
    const m = makeManager();
    // makeManager builds a bare map stub; the setter reaches LayerAPI through
    // this.map.foliplus (makeCtrl wires the same object).
    (m.map as unknown as { foliplus: unknown }).foliplus = window.map.foliplus;
    const touchLayer = window.map.foliplus.LayerAPI.touchLayer;
    const emitSpy = vi.spyOn(m.events, "publish");
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
    const emitSpy = vi.spyOn(m.events, "publish");
    const opts = getCanvasOpts();

    opts.styleSetters!.labelFormat!("comma");

    expect(touchLayer).toHaveBeenCalledWith(m.layerId);
    expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_STYLE_CHANGE, {
      id: m.layerId,
    });
  });

  it("styleDefaultsProvider returns the Python CONFIG snapshot for the drawer Reset", () => {
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
    m.labelShow = false;
    m.labelColor = "#00ff00";
    m.labelSize = 20;
    m.labelFormat = "comma";
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
    expect(m.labelColor).toBe("#00ff00");
    expect(m.cachedLabelStyle).toBeNull();

    opts.styleSetters!.labelSize!(18);
    expect(m.labelSize).toBe(18);
    expect(redrawSpy).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalled();
  });

  it("labelSize setter clamps out-of-range values", () => {
    const m = makeManager();
    const opts = getCanvasOpts();

    opts.styleSetters!.labelSize!(99);
    expect(m.labelSize).toBe(CONST.LABEL.SIZE_MAX);

    opts.styleSetters!.labelSize!(1);
    expect(m.labelSize).toBe(CONST.LABEL.SIZE_MIN);
  });

  it("labelColor setter ignores non-string values and normalizes #rgb", () => {
    const m = makeManager();
    const opts = getCanvasOpts();

    opts.styleSetters!.labelColor!(42);
    expect(m.labelColor).toBe("#ffffff");

    opts.styleSetters!.labelColor!("#abc");
    expect(m.labelColor).toBe("#aabbcc");
  });

  it("labelSize setter ignores NaN and non-number values", () => {
    const m = makeManager();
    const opts = getCanvasOpts();

    opts.styleSetters!.labelSize!(Number.NaN);
    expect(m.labelSize).toBe(11);

    opts.styleSetters!.labelSize!("18" as unknown as number);
    expect(m.labelSize).toBe(11);
  });

  it("labelColor and labelSize setters work without a bound panel", () => {
    const m = makeManager();
    // ui is null — the setters own state only; panels refresh via
    // LAYER_STYLE_CHANGE, so no panel sync happens here.
    expect(() => {
      getCanvasOpts().styleSetters!.labelColor!("#00ff00");
      getCanvasOpts().styleSetters!.labelSize!(20);
    }).not.toThrow();
    expect(m.labelColor).toBe("#00ff00");
    expect(m.labelSize).toBe(20);
  });

  it("labelFormat setter updates state, redraws labels and persists", () => {
    const m = makeManager();
    const redrawSpy = vi.spyOn(m, "redrawHeatmap");
    const saveSpy = vi.spyOn(m, "saveConfig");
    const opts = getCanvasOpts();

    opts.styleSetters!.labelFormat!("comma");

    expect(m.labelFormat).toBe("comma");
    expect(redrawSpy).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalled();
  });

  it("labelFormat setter falls back to auto for non-string values", () => {
    const m = makeManager();
    const opts = getCanvasOpts();

    opts.styleSetters!.labelFormat!(42);

    expect(m.labelFormat).toBe("auto");
  });

  it("labelFormat seeds from CONFIG.label_format", () => {
    const m = makeManager({ label_format: "percent" });
    expect(m.labelFormat).toBe("percent");
  });

  it("labelFormat defaults to auto when CONFIG omits label_format", () => {
    const m = makeManager({ label_format: undefined });
    expect(m.labelFormat).toBe("auto");
  });

  it("labelShow defaults to true when CONFIG omits label_show", () => {
    // Python serializes label_show=True by default; a missing key must not
    // silently flip labels off — the same `!== false` rule MeasureControl uses.
    const m = makeManager({ label_show: undefined });
    const opts = getCanvasOpts() as {
      styleDefaultsProvider?: () => Record<string, unknown>;
    };

    expect(m.labelShow).toBe(true);
    expect(opts.styleDefaultsProvider!().labelShow).toBe(true);
  });

  it("borderWeight defaults to BORDER_WEIGHT.DEFAULT when CONFIG omits border_weight", () => {
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
    const emitSpy = vi.spyOn(m.events, "publish");
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
    const emitSpy = vi.spyOn(m.events, "publish");
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
    m.agg = "sum";
    m.field = "properties.sales";

    m.syncSourceMeta();

    expect(m.sourceMeta["HeatmapControl.meta_source_layer"]).toBe("Stores");
    expect(m.sourceMeta["HeatmapControl.meta_agg_field"]).toBe("sales");
    // Only the two user-facing rows are published: the internal source id
    // is not panel content, and a raw meta entry would render as one.
    expect(Object.keys(m.sourceMeta).sort()).toEqual([
      "HeatmapControl.meta_agg_field",
      "HeatmapControl.meta_source_layer",
    ]);
    expect(window.map.foliplus.LayerAPI.touchLayer).toHaveBeenCalledWith(m.layerId);
  });

  it("omits the field row under count aggregation", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "pts", name: "Stores", layer: null, count: 1 }];
    m.selectedLayerId = "pts";
    m.agg = "count";
    m.field = "properties.sales";

    m.syncSourceMeta();

    expect(m.sourceMeta["HeatmapControl.meta_source_layer"]).toBe("Stores");
    expect(m.sourceMeta["HeatmapControl.meta_agg_field"]).toBe("");
  });

  it("omits the aggregation field when the stored field is empty", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "pts", name: "Stores", layer: null, count: 1 }];
    m.selectedLayerId = "pts";
    m.agg = "avg";
    m.field = "";

    m.syncSourceMeta();

    expect(m.sourceMeta["HeatmapControl.meta_agg_field"]).toBe("");
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
    m.agg = "max";
    m.field = "value";

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
    m.agg = "count";

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
    expect(ctrl.extraBody.classList.contains(CONST.CLASSES.HIDDEN)).toBe(true);
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
    expect(ctrl.ctrl.classList.contains(CONST.CLASSES.COLLAPSED)).toBe(false);
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

describe("constructor — CONFIG fallbacks", () => {
  it("uses library defaults when CONFIG omits optional style fields", () => {
    const m = makeManager({
      agg: undefined,
      color_scheme: undefined,
      method: undefined,
      num_classes: undefined,
      border_color: undefined,
      label_color: undefined,
      label_size: undefined,
    });
    expect(m.agg).toBe(CONST.AGG.COUNT);
    expect(m.scheme).toBe("Reds");
    expect(m.method).toBe("jenks");
    expect(m.numClasses).toBe(CLASS_COUNT.DEFAULT);
    expect(m.borderColor).toBe(SCHEME_FALLBACK_COLOR);
  });
});

describe("featureCountProvider", () => {
  it("returns 0 when cachedFeatures is null", () => {
    makeManager();
    const opts = window.map.foliplus.LayerAPI.createCanvas.mock.calls[0][0];
    expect(opts.featureCountProvider()).toBe(0);
  });

  it("returns the filtered feature count when cachedFeatures is set", () => {
    const m = makeManager();
    // cachedFeatures is the drawn (post-filter) set: the Attributes panel and
    // the row therefore report the kept features, while the unfiltered cell
    // total lives only in getFilterModel / the filter panel's Result.
    m.cachedFeatures = [{}, {}, {}] as any;
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
      geometry: loadGeometry("common", "polygon_unit_square_1") as GeoJSON.Polygon,
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
    m.labelShow = false;
    m.redrawHeatmap();
  });

  it("draws labels when labelShow is true", () => {
    const m = makeManager();
    setupCanvas(m);
    m.cachedFeatures = [makeFeature([0, 0])] as never;
    m.renderAll = false;
    m.labelShow = true;
    m.redrawHeatmap();
  });

  it("skips labels when labelShow is false", () => {
    const m = makeManager();
    setupCanvas(m);
    m.cachedFeatures = [makeFeature([0, 0])] as never;
    m.renderAll = false;
    m.labelShow = false;
    m.redrawHeatmap();
  });

  it("skips a feature whose centroid is null", () => {
    const m = makeManager();
    setupCanvas(m);
    m.cachedFeatures = [makeFeature(null)] as never;
    m.renderAll = false;
    m.labelShow = false;
    m.redrawHeatmap();
  });

  it("skips a feature that is outside the bounds", () => {
    const m = makeManager();
    setupCanvas(m);
    m.cachedFeatures = [makeFeature([100, 100])] as never;
    m.map.getBounds = vi.fn(() => ({ contains: () => false }));
    m.renderAll = false;
    m.labelShow = false;
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
        geometry: loadGeometry("common", "polygon_unit_square_1"),
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

describe("resetState — CONFIG fallbacks", () => {
  it("uses library defaults when config omits optional fields", () => {
    const m = makeManager();
    m.agg = CONST.AGG.SUM;
    m.method = "quantile";
    m.scheme = "Greens";
    m.numClasses = 9;
    m.resetState({
      agg: undefined,
      num_classes: undefined,
      method: undefined,
      color_scheme: undefined,
    });
    expect(m.agg).toBe(CONST.AGG.COUNT);
    expect(m.numClasses).toBe(CLASS_COUNT.DEFAULT);
    expect(m.method).toBe("jenks");
    expect(m.scheme).toBe("Reds");
  });
});

describe("getBounds callback", () => {
  it("returns computeBounds result via createCanvas options", () => {
    makeManager();
    const opts = window.map.foliplus.LayerAPI.createCanvas.mock.calls[0][0] as {
      getBounds: () => unknown;
    };
    const result = opts.getBounds();
    expect(result).toBeNull();
  });
});

describe("NO_OP_ENV T fallback", () => {
  it("returns prefixed key when env is not provided", () => {
    const map = {
      getContainer: vi.fn(),
      getBounds: vi.fn(),
      getZoom: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      foliplus: window.map.foliplus,
    };
    const m = new HeatmapManager(map);
    m.init();
    expect(m.T("title")).toBe("HeatmapControl.title");
  });
});

describe("onOpacity callback (R11 redraw branch)", () => {
  it("clears CSS opacity and calls redrawHeatmap", () => {
    const m = makeManager();
    const canvas = document.createElement("canvas");
    canvas.style.opacity = "0.4";
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
        strokeText: vi.fn(),
        measureText: vi.fn(() => ({ width: 10 })),
      } as unknown as CanvasRenderingContext2D,
      register: vi.fn(),
      unregister: vi.fn(),
      setVisible: vi.fn(),
      hooks: { before: [], after: [] },
    };
    m.cachedFeatures = [] as never;
    m.labelShow = false;
    m.ui = { ...makeCtrl(m), ctrl: document.createElement("div") };
    m.map.getContainer = vi.fn(() => {
      const c = document.createElement("div");
      Object.defineProperty(c, "clientWidth", { value: 100 });
      Object.defineProperty(c, "clientHeight", { value: 100 });
      return c;
    });
    m.map.getBounds = vi.fn(() => ({ contains: () => true }));

    const redrawSpy = vi.spyOn(m, "redrawHeatmap");
    // Trigger the onOpacity callback registered in the constructor.
    const opts = window.map.foliplus.LayerAPI.createCanvas.mock.calls[0][0] as {
      onOpacity: () => void;
    };
    opts.onOpacity();

    expect(canvas.style.opacity).toBe("");
    expect(redrawSpy).toHaveBeenCalled();
  });

  it("calls redrawHeatmap even when canvas is null", () => {
    const m = makeManager();
    m.overlay = {
      canvas: null,
      ctx: null,
      register: vi.fn(),
      unregister: vi.fn(),
      setVisible: vi.fn(),
      hooks: { before: [], after: [] },
    };

    const redrawSpy = vi.spyOn(m, "redrawHeatmap");
    const opts = window.map.foliplus.LayerAPI.createCanvas.mock.calls[0][0] as {
      onOpacity: () => void;
    };
    opts.onOpacity();

    expect(redrawSpy).toHaveBeenCalled();
  });
});

describe("redrawHeatmap — preserveCss branch", () => {
  it("keeps CSS and restores layerAlpha when both carriers are set", () => {
    const m = makeManager();
    const canvas = document.createElement("canvas");
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
        strokeText: vi.fn(),
        measureText: vi.fn(() => ({ width: 10 })),
      } as unknown as CanvasRenderingContext2D,
      register: vi.fn(),
      unregister: vi.fn(),
      setVisible: vi.fn(),
      hooks: { before: [], after: [] },
    };
    m.cachedFeatures = [] as never;
    m.labelShow = false;
    m.ui = { ...makeCtrl(m), ctrl: document.createElement("div") };
    m.map.getContainer = vi.fn(() => {
      const c = document.createElement("div");
      Object.defineProperty(c, "clientWidth", { value: 100 });
      Object.defineProperty(c, "clientHeight", { value: 100 });
      return c;
    });
    m.map.getBounds = vi.fn(() => ({ contains: () => true }));

    // Simulate the state after dispatchStateOp: CSS set AND layerAlpha !== 1.
    canvas.style.opacity = "0.5";
    setLayerAlpha(canvas, 0.5);

    m.redrawHeatmap();

    // preserveCss=true: CSS is preserved, not cleared.
    expect(canvas.style.opacity).toBe("0.5");
    // layerAlpha is restored to the original value after the draw pass.
    expect(getLayerAlpha(canvas)).toBeCloseTo(0.5);
  });
});

// ── Source content-signal integration (real LayerAPI chain) ──
//
// The unit tests elsewhere clear the caches by hand before calling
// renderHexagons, which proves the revalidation algorithm but not the runtime
// chain. These tests drive the real chain instead:
//
//   LayerAPI.createLayers() handle addLayer / removeLayer / clearLayers
//     → LayerFactory's patched group → controller.refreshCount
//     → LAYER_ITEM_COUNT_CHANGE on the shared bus
//     → HeatmapManager's source-content listener
//     → cache invalidation + debounced renderHexagons
//
// The map is the real LayerController fixture (test/js/LayerControl/ui), so
// the bus, the registry and the factory are the production instances; only
// the heatmap's own draw is stubbed (jsdom has no 2D canvas).
/** A real-enough layer role: the factory patches and walks its children. */
class FakeGroup {
  options: Record<string, unknown> = {};
  private children = new Set<unknown>();

  addLayer(layer: unknown): this {
    this.children.add(layer);
    return this;
  }
  removeLayer(layer: unknown): this {
    this.children.delete(layer);
    return this;
  }
  clearLayers(): this {
    this.children.clear();
    return this;
  }
  hasLayer(layer: unknown): boolean {
    return this.children.has(layer);
  }
  getLayers(): unknown[] {
    return [...this.children];
  }
  eachLayer(fn: (layer: unknown) => void): void {
    [...this.children].forEach(fn);
  }
}

/** A Marker instance the controller's `extractPoints` accepts: `instanceof
 *  L.Marker`, a `feature` bag and a `getLatLng`, plus the folium `value`
 *  contract the heatmap reads. */
const makeMarker = (value: number) => {
  const marker = new (
    window.L.Marker as unknown as new () => Record<string, unknown>
  )();
  marker.options = {};
  marker.value = value;
  marker.feature = { properties: {} };
  marker.getLatLng = () => ({ lat: 26 + value / 1000, lng: 119 + value / 1000 });
  return marker;
};

const SCAN_DEBOUNCE = 200;

describe("HeatmapControl source content signal (LayerAPI integration)", () => {
  let ctrl: LayerController;
  let map: any;
  let mgr: HeatmapManager;
  let src: ReturnType<LayerController["createLayers"]>;
  let filterSpy: ReturnType<typeof vi.fn<(payload: { id: string }) => void>>;

  /** Flush both debounces the manager uses for layer/content changes. */
  const flushScans = () => vi.advanceTimersByTime(SCAN_DEBOUNCE + 50);

  beforeEach(() => {
    vi.restoreAllMocks();
    const fixture = initFixture();
    ctrl = fixture.manager;
    map = fixture.map;
    trackMembership(map);

    // The factory creates its groups through L.layerGroup — give it a real
    // one so addLayer/removeLayer/clearLayers actually move children.
    window.L.layerGroup = vi.fn(() => new FakeGroup()) as any;

    mgr = makeManagerOn(map);
    // One hex cell per marker: the fixture stub returns a constant cell, but
    // these assertions are about the owner-unit counts (cells kept / total),
    // so distinct cells keep the mapping to the old point totals legible.
    (globalThis.h3 as any).latLngToCell = vi.fn(
      (lat: number, lng: number) => `${lat}:${lng}`,
    );
    // HeatmapManager reads the LayerAPI through the free `map` global
    // (window.map) in getSelectedPoints / publishCount. Point it at the real
    // controller mounted on the fixture map.
    window.map.foliplus = map.foliplus;
    vi.spyOn(mgr, "redrawHeatmap").mockImplementation(() => {});

    vi.useFakeTimers();
    src = ctrl.createLayers({
      id: "src",
      name: "Source",
      panes: [{ name: "srcPane" }],
    });
    filterSpy = vi.fn<(payload: { id: string }) => void>();
    mgr.events.on(EVENTS.LAYER_FILTER_CHANGE, filterSpy);
  });

  afterEach(() => {
    mgr?.onSourceContentChange?.cancel?.();
    mgr?.onLayerChange?.cancel?.();
    ctrl?.debouncedEnforce?.cancel?.();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  /** Register the source with its initial points, flush the registration
   *  scan, then hand the manager the source row the production scan would
   *  have built (the fixture's source is a vector row, so the type filter
   *  drops it from `getLayersByType("point")`). */
  const selectSource = (values: number[]) => {
    const markers = values.map(makeMarker);
    markers.forEach(marker => src.addLayer(marker as unknown as L.Layer));
    flushScans();
    mgr.selectedLayerId = "src";
    mgr.pointLayers = [
      { id: "src", name: "Source", layer: src.mainLayer, count: values.length },
    ];
    return markers;
  };

  it("re-renders from a real addLayer and updates the panel model range", () => {
    const markers = selectSource([10, 30]);
    mgr.renderHexagons();
    expect(mgr.getFilterModel()!.dimensions[0]).toMatchObject({
      kind: "range",
      range: [10, 30],
    });

    // Move the content through the public API: the values now span [1, 5].
    // removeLayer keeps the row registered (only clearLayers retires it), so
    // this is a data update, not a source departure.
    markers.forEach(marker => src.removeLayer(marker as unknown as L.Layer));
    src.addLayer(makeMarker(1) as unknown as L.Layer);
    src.addLayer(makeMarker(5) as unknown as L.Layer);

    // The count signal drops the extraction caches synchronously, before the
    // debounced repaint — a panel read in between must not answer from the
    // retired snapshot.
    expect((mgr as any).cachedPoints).toBeNull();
    expect((mgr as any).cachedSnapshot).toBeNull();

    flushScans();

    expect(mgr.getFilterModel()!.dimensions[0]).toMatchObject({
      kind: "range",
      range: [1, 5],
    });
    expect(mgr.getFilterModel()!.total).toBe(2);
  });

  it("a real content change clamps a committed filter and notifies once", () => {
    const markers = selectSource([10, 30]);
    mgr.renderHexagons();
    mgr.setFilter({
      kind: "atom",
      field: "value",
      op: "between",
      range: [10, 20],
    });
    expect(mgr.getFilterModel()!.filter).toBeDefined();
    filterSpy.mockClear();

    markers.forEach(marker => src.removeLayer(marker as unknown as L.Layer));
    src.addLayer(makeMarker(1) as unknown as L.Layer);
    src.addLayer(makeMarker(5) as unknown as L.Layer);
    flushScans();

    // [10, 20] cannot intersect [1, 5]: the stored band clamps to the only
    // still-valid point, and the one notification lands after the render.
    expect(mgr.getFilterModel()!.filter).toEqual({
      kind: "atom",
      field: "value",
      op: "between",
      range: [5, 5],
    });
    expect(filterSpy).toHaveBeenCalledTimes(1);
    expect(filterSpy).toHaveBeenCalledWith({ id: mgr.layerId });
  });

  it("notifies a content change even when the stored filter survives", () => {
    selectSource([10, 30]);
    mgr.renderHexagons();
    mgr.setFilter({
      kind: "atom",
      field: "value",
      op: "between",
      range: [10, 20],
    });
    expect(mgr.getFilterModel()!.kept).toBe(1);
    filterSpy.mockClear();

    // An added point inside the committed band leaves [10, 20] valid and
    // unchanged, but `kept` moves 1 → 2. An open panel's live readout is
    // derived from that model, so the content signal owes a notification even
    // without a clamp.
    src.addLayer(makeMarker(15) as unknown as L.Layer);
    flushScans();

    const model = mgr.getFilterModel()!;
    expect(model.filter).toEqual({
      kind: "atom",
      field: "value",
      op: "between",
      range: [10, 20],
    });
    expect(model.kept).toBe(2);
    expect(filterSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps the unfiltered cell total when the filter keeps nothing", () => {
    selectSource([10, 20, 30]);
    mgr.renderHexagons();
    expect(mgr.getFilterModel()!.total).toBe(3);

    // [12, 18] is a valid band inside the extent that no point falls in: the
    // render paints nothing, but the row still reports its unfiltered cell
    // count — 0 of 0 would hide what the filter is narrowing.
    mgr.setFilter({
      kind: "atom",
      field: "value",
      op: "between",
      range: [12, 18],
    });
    const model = mgr.getFilterModel()!;
    expect(model.kept).toBe(0);
    expect(model.total).toBe(3);
    expect((mgr as any).cachedFeatures).toBeNull();
    // (The Attributes panel and the row share featureCountProvider, which
    // counts this drawn set — that path is pinned in the featureCountProvider
    // describe; the unfiltered cell total only feeds the filter Result.)

    // The kept geometry survives the empty render: the next paint reuses the
    // same cell set (no h3 walk) and the total stays legible.
    const bins = (mgr as any).cachedBins;
    expect(bins.bins.size).toBe(3);
    mgr.renderHexagons();
    expect((mgr as any).cachedBins).toBe(bins);
    expect(mgr.getFilterModel()!.total).toBe(3);
  });

  it("a real removeLayer shrinks the snapshot and rebuilds the geometry cache", () => {
    const markers = selectSource([10, 20, 30]);
    mgr.renderHexagons();
    const binsBefore = (mgr as any).cachedBins;

    src.removeLayer(markers[1] as unknown as L.Layer);
    flushScans();

    const model = mgr.getFilterModel()!;
    expect(model.dimensions[0]).toMatchObject({ kind: "range", range: [10, 30] });
    expect(model.total).toBe(2);
    expect(model.kept).toBe(2);
    // Point identity moved, so the bin walk is redone for the new set.
    expect((mgr as any).cachedBins).not.toBe(binsBefore);
  });

  it("clearLayers on the selected source drops the selection, canvas and filter", () => {
    selectSource([10, 30]);
    mgr.renderHexagons();
    mgr.setFilter({
      kind: "atom",
      field: "value",
      op: "between",
      range: [10, 20],
    });
    filterSpy.mockClear();

    src.clearLayers();
    flushScans();

    expect(mgr.selectedLayerId).toBeNull();
    expect(fsSize(mgr)).toBe(0);
    expect((mgr as any).cachedFeatures).toBeNull();
    // Exactly one notification, whichever debounced pass revalidates first.
    expect(filterSpy).toHaveBeenCalledTimes(1);
  });

  it("ignores the count signal of its own output row (no self-trigger)", () => {
    selectSource([10, 30]);
    mgr.renderHexagons();
    const cachedPoints = (mgr as any).cachedPoints;
    const renderSpy = vi.spyOn(mgr, "renderHexagons");

    // The manager publishes this event for its own row after every render;
    // consuming it would make each paint schedule another paint.
    mgr.events.publish(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: mgr.layerId });
    flushScans();

    expect(renderSpy).not.toHaveBeenCalled();
    expect((mgr as any).cachedPoints).toBe(cachedPoints);
  });

  it("drops a scheduled content repaint when the selection is gone", () => {
    selectSource([10, 30]);
    mgr.renderHexagons();

    // A content signal schedules the debounced repaint; the selection is
    // cleared before the timer fires, so the callback must bail out instead of
    // rendering an owner that no longer exists.
    mgr.events.publish(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "src" });
    mgr.selectedLayerId = null;
    expect(() => flushScans()).not.toThrow();
    // The count signal already dropped the caches; the cleared selection then
    // keeps the debounced callback from touching the canvas.
    expect((mgr as any).cachedPoints).toBeNull();
  });

  it("keeps the snapshot when only the aggregation key changed", () => {
    selectSource([10, 30]);
    mgr.renderHexagons();
    const snapshot = (mgr as any).cachedSnapshot;

    // A field/aggregation switch invalidates the extracted points (the cache
    // key changes) but not the owner snapshot: the same source keeps the same
    // points/fields/ranges, so the snapshot must not be rebuilt.
    mgr.agg = "sum" as typeof mgr.agg;
    expect(mgr.getSelectedPoints()).toHaveLength(2);
    expect((mgr as any).cachedSnapshot).toBe(snapshot);
    expect((mgr as any).cachedSnapshotLayerId).toBe("src");
  });

  it("syncFilterField is a no-op without a selected source", () => {
    selectSource([10, 30]);
    mgr.renderHexagons();
    mgr.selectedLayerId = null;

    expect(() => (mgr as any).syncFilterField()).not.toThrow();
    expect(fsSize(mgr)).toBe(0);
  });

  it("settles a caller-owned operation when the selection is cleared mid-write", () => {
    selectSource([10, 30]);
    mgr.renderHexagons();
    mgr.selectedLayerId = null;

    // A wider write already owns the operation: renderHexagons must not
    // settle it, the caller raises after its whole fan-out.
    const op = new SettledOperation(mgr.events);
    expect(() => mgr.renderHexagons(op)).not.toThrow();
  });

  it("renders an empty canvas when the selection is cleared without an operation", () => {
    selectSource([10, 30]);
    mgr.renderHexagons();
    mgr.selectedLayerId = null;

    // No caller-owned operation: the local one is settled (and would raise)
    // inside renderHexagons.
    expect(() => mgr.renderHexagons()).not.toThrow();
    expect((mgr as any).cachedFeatures).toBeNull();
  });
});

describe("declared starting layer/field (Python layer=/field=)", () => {
  type WarnSpyable = { log: { warn: (...args: unknown[]) => void } };
  const spyWarn = (m: unknown) =>
    vi.spyOn((m as WarnSpyable).log, "warn").mockImplementation(() => {});

  it("resolves the declared layer name against the scanned point layers", () => {
    const m = makeManager({ layer: "Facility Points" });
    m.pointLayers = [{ id: "p1", name: "Facility Points", layer: null, count: 1 }];
    expect(m.resolveDeclaredLayer()).toBe("p1");
  });

  it("ignores the declaration once a persisted record consumed the guard", () => {
    const m = makeManager({ layer: "Facility Points" });
    m.pointLayers = [{ id: "p1", name: "Facility Points", layer: null, count: 1 }];
    // applySavedConfig sets this for ANY stored record — including one where
    // the user explicitly cleared the selection.
    m.hasScanned = true;
    expect(m.resolveDeclaredLayer()).toBeNull();
  });

  it("warns once when the declared layer is not a point layer", () => {
    const m = makeManager({ layer: "Missing" });
    const warn = spyWarn(m);
    m.pointLayers = [{ id: "p1", name: "Other", layer: null, count: 1 }];
    expect(m.resolveDeclaredLayer()).toBeNull();
    expect(m.resolveDeclaredLayer()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("declared layer not found");
  });

  it("resolves the declared field only when the layer offers it", () => {
    const m = makeManager({ field: "score" });
    expect(m.setAvailableFields(["count", "score"])).toBe("score");
    // Not offered: the declaration is not re-pointed at another column - the
    // first numeric field is only the display fallback, and the declaration
    // never lands in the user's field.
    expect(m.setAvailableFields(["count"])).toBe("count");
    expect(m.field).toBe("");
  });

  it("warns once when the declared field is not offered", () => {
    const m = makeManager({ field: "score" });
    const warn = spyWarn(m);
    expect(m.setAvailableFields(["count"])).toBe("count");
    expect(m.setAvailableFields(["count"])).toBe("count");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("declared field not found");
  });

  it("re-opens the guard on Reset so the declaration applies again", () => {
    const m = makeManager({ layer: "Facility Points" });
    m.pointLayers = [{ id: "p1", name: "Facility Points", layer: null, count: 1 }];
    // A record consumed the guard...
    m.hasScanned = true;
    expect(m.resolveDeclaredLayer()).toBeNull();
    // ...and Reset (the Clear path) deletes that record, so the declaration is
    // the starting state again: the next rebuild may apply it.
    m.resetState({} as never);
    expect(m.hasScanned).toBe(false);
    expect(m.resolveDeclaredLayer()).toBe("p1");
  });

  it("treats a non-string declaration as absent instead of matching it", () => {
    // CONFIG is a JSON bridge, but a hand-written CONFIG (or an older bundle)
    // must not make the scan compare against a non-string name.
    const m = makeManager({ layer: 3, field: {} });
    m.pointLayers = [{ id: "p1", name: "3", layer: null, count: 1 }];
    expect(m.resolveDeclaredLayer()).toBeNull();
    // No declaration to match: the resolver answers with the offered field.
    expect(m.setAvailableFields(["3"])).toBe("3");
  });
});

describe("effective aggregation field - the auto default never becomes a record", () => {
  it("prefers the user's pick, then the declaration, then the first field", () => {
    const declared = makeManager({ field: "score" });
    declared.field = "count";
    expect(declared.setAvailableFields(["count", "score"])).toBe("count");

    declared.field = "";
    expect(declared.setAvailableFields(["count", "score"])).toBe("score");

    const guessed = makeManager();
    expect(guessed.setAvailableFields(["temp", "rain"])).toBe("temp");
  });

  it("keeps a stored pick the data no longer offers, and restores it with the data", () => {
    const m = makeManager();
    m.field = "rain";
    // The pick was written in an earlier session: that record is the intent.
    m.saveConfig();
    m.flush();
    expect(m.loadSavedConfig()?.field).toBe("rain");

    // The new data has no rain column: the display falls back, the pick stays.
    expect(m.setAvailableFields(["temp", "wind"])).toBe("temp");
    expect(m.field).toBe("rain");
    // A later write must not replace the intent with the displayed fallback.
    m.saveConfig();
    m.flush();
    expect(m.loadSavedConfig()?.field).toBe("rain");

    // The column comes back: the user's pick is in force again, untouched.
    expect(m.setAvailableFields(["temp", "rain"])).toBe("rain");
  });

  it("never persists the guess: a scan-only manager saves no field", () => {
    const m = makeManager();
    expect(m.setAvailableFields(["temp", "rain"])).toBe("temp");
    m.saveConfig();
    m.flush();
    expect(m.loadSavedConfig()?.field).toBeUndefined();
  });

  it("resolves once per field list, not once per feature", () => {
    const m = makeManager();
    const resolve = vi.spyOn(m, "resolveEffectiveField");
    m.setAvailableFields(["count", "score"]);
    const afterScan = resolve.mock.calls.length;
    m.agg = CONST.AGG.SUM;

    // 100 per-feature reads (the real path is 20k) must all hit the cache.
    for (let i = 0; i < 100; i++) m.getPointValue({ count: 7 });
    expect(resolve.mock.calls.length).toBe(afterScan);
  });

  it("invalidates on a persistence write so the user's new pick takes effect", () => {
    const m = makeManager();
    m.agg = CONST.AGG.SUM;
    m.setAvailableFields(["count", "options.value"]);
    expect(m.effectiveField()).toBe("count");
    expect(m.getPointValue({ options: { value: 3 } })).toBe(1);

    m.field = "options.value";
    m.saveConfig();
    expect(m.effectiveField()).toBe("options.value");
    expect(m.getPointValue({ options: { value: 3 } })).toBe(3);
  });

  it("Reset returns the field to the declaration (or empty)", () => {
    const m = makeManager({ field: "score" });
    m.field = "count";
    expect(m.setAvailableFields(["count", "score"])).toBe("count");

    m.resetState({} as never);

    // The pick is gone and the scan belongs to the departed selection, so the
    // declaration is the starting state again - no record, no stale guess.
    expect(m.field).toBe("");
    expect(m.effectiveField()).toBe("score");
  });
});

// ── Declared-filter fixtures ──────────────────────────────────────────
// Shared by the guard tests below and the cross-branch matrix at the end.

/** A valid numeric-range atom on the fixture's snapshot field. */
const RANGE = {
  kind: "atom",
  field: "score",
  op: "between",
  range: [10, 50],
} as LayerFilter;

/** A different range the user picks themselves. */
const USER_RANGE = {
  kind: "atom",
  field: "score",
  op: "between",
  range: [20, 30],
} as LayerFilter;

/** A populated snapshot so the timing guard (empty = not painted) does not
 *  swallow the seed. */
const snapshot = (ranges: Record<string, [number, number]> = { score: [0, 100] }) =>
  ({
    points: [{ value: ranges.score?.[0] ?? 0 }],
    numericFields: Object.keys(ranges),
    ranges,
  }) as any;

/** Give a manager the inputs seedDeclaredFilter needs without a LayerAPI
 *  scan. */
const prepare = (manager: any) => {
  manager.selectedLayerId = "pts";
  manager.availableFields = ["score"];
  manager.field = "";
  manager.cachedSnapshot = snapshot();
  manager.getSelectedPoints = vi.fn(() => []) as any;
  return manager;
};

/** A manager whose source is selected and whose snapshot is already built. */
const seedable = (filter: unknown = RANGE) =>
  prepare(makeManager({ filter } as Partial<ComponentConfig>));

/** The reload path: read the saved record and apply it to a fresh manager. */
const reload = (filter: unknown = RANGE) => {
  const manager = makeManager({ filter } as Partial<ComponentConfig>);
  const saved = manager.loadSavedConfig();
  if (saved) manager.applySavedConfig(saved);
  return prepare(manager);
};

/** A user write on a source with no declaration of its own. */
const userWrite = (manager: any, filter: LayerFilter = USER_RANGE) => {
  manager.renderHexagons = vi.fn() as any;
  manager.setFilter(filter);
  return manager;
};

/** The store-backed filter value for one source (declaration or committed). */
const fsGet = (m: any, src: string) => m.filterStore.getFilter(m.layerId, src);
/** Whether the source carries a filter (committed value or declaration). */
const fsHas = (m: any, src: string) => fsGet(m, src) !== undefined;
/** Count of sources carrying a filter value (committed or declared).
 *  Mirrors the old layerFilters.size: a slot the user owns but cleared
 *  holds no value and does not count. */
const fsSize = (m: any) =>
  m.filterStore.sources(m.layerId).filter((s: string) => fsGet(m, s) !== undefined)
    .length;

// ── Declared filter guards (HeatmapManager) ───────────────────────────
//
// The matrix below pins the cross-branch rows; these are the Heatmap-only
// guards the range branch needs: clamping to the snapshot extent, timing versus
// data defects, and the field/aggregation coupling.
describe("HeatmapManager — declared filter guards", () => {
  beforeEach(() => window.localStorage.clear());

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("clamps the declared range to the snapshot extent", () => {
    const manager = seedable({ ...RANGE, range: [10, 500] });

    manager.seedDeclaredFilter();

    expect(fsGet(manager, "pts")).toEqual({
      kind: "atom",
      field: "score",
      op: "between",
      range: [10, 100],
    });
  });

  it("a declared range covering the whole extent is not a filter", () => {
    const manager = seedable({ ...RANGE, range: [0, 100] });
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

    manager.seedDeclaredFilter();

    expect(fsHas(manager, "pts")).toBe(false);
    // Covering the whole extent is the same state as "no filter", so it is a
    // legal no-op — reporting it would call a valid declaration a data problem.
    expect(warn).not.toHaveBeenCalled();
  });

  it("reports a field with no numeric extent and starts unfiltered", () => {
    const manager = seedable(RANGE);
    // The source has points but the field carries no value on any of them, so
    // the panel has no range to render the declaration on.
    manager.cachedSnapshot = {
      points: [{ value: 0 }],
      numericFields: ["score"],
      ranges: {},
    } as any;
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

    manager.seedDeclaredFilter();

    expect(fsHas(manager, "pts")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a snapshot that is not populated yet is not a data problem", () => {
    // The seed runs from the panel build, which can precede the source's first
    // paint. An empty snapshot then is timing, not a declaration defect:
    // reporting it would blame the author's declaration for an empty read —
    // and the report would be remembered in declarationWarned, silencing the
    // real problem once the data arrives.
    const manager = seedable(RANGE);
    manager.cachedSnapshot = {
      points: [],
      numericFields: ["score"],
      ranges: {},
    } as any;
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});
    const debug = vi.spyOn((manager as any).log, "debug").mockImplementation(() => {});

    manager.seedDeclaredFilter();

    expect(fsHas(manager, "pts")).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
    expect(String(debug.mock.calls[0][0])).toContain("not populated");
    expect(manager.declarationWarned.size).toBe(0);
  });

  it("a snapshot that was never built is not a data problem either", () => {
    // The other branch of the same timing check: no snapshot object at all (the
    // cache is cleared on a source or content change and the seed can run
    // before getSelectedPoints rebuilds it). Still not a declaration defect.
    const manager = seedable(RANGE);
    manager.cachedSnapshot = null;
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});
    const debug = vi.spyOn((manager as any).log, "debug").mockImplementation(() => {});

    manager.seedDeclaredFilter();

    expect(fsHas(manager, "pts")).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it("still reports the real missing extent once the frame arrives", () => {
    // Same manager, two phases: quiet while the snapshot is empty, then the
    // genuine report is not swallowed by a flag the empty read would have set.
    const manager = seedable(RANGE);
    manager.cachedSnapshot = {
      points: [],
      numericFields: ["score"],
      ranges: {},
    } as any;
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});
    vi.spyOn((manager as any).log, "debug").mockImplementation(() => {});

    manager.seedDeclaredFilter();
    manager.cachedSnapshot = {
      points: [{ value: 0 }],
      numericFields: ["score"],
      ranges: {},
    } as any;
    manager.seedDeclaredFilter();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][1])).toContain("no usable extent");
  });

  it("an unrelated save persists the seeded declaration", () => {
    // Per the declaration-only contract: a seeded declaration is readable
    // after the load but is NEVER written to persistence. An unrelated save
    // (a color change) writes style fields only; the store's record stays
    // empty because the user never took the slot.
    const manager = seedable(RANGE);
    manager.seedDeclaredFilter();
    expect(fsGet(manager, "pts")).toEqual(RANGE);
    expect(manager.filterStore.isOwned(manager.layerId, "pts")).toBe(false);

    manager.saveConfig();
    // The old component key keeps only style fields — no filters, no flag.
    expect(manager.loadSavedConfig()?.filters).toBeUndefined();
    // The shared store key has no record either: nothing user-set.
    expect(window.localStorage.getItem(FILTER_STORE_KEY)).toBeNull();
    manager.clearSavedConfig();
  });

  it("seeds a hand-edited atom that carries no range to check", () => {
    // F15: CONF can be hand-edited into an equality atom, which has no range
    // for the extent-intersection guard to test. The guard is range-only on
    // purpose; the atom passes through to the runtime's normalizer instead of
    // being rejected as "outside the extent".
    const manager = seedable({ kind: "atom", field: "score", op: "eq", value: 42 });
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

    manager.seedDeclaredFilter();

    expect(fsGet(manager, "pts")).toEqual({
      kind: "atom",
      field: "score",
      op: "eq",
      value: 42,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("reports a declaration outside the extent and starts unfiltered", () => {
    const manager = seedable({ ...RANGE, range: [1000, 2000] });
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

    manager.seedDeclaredFilter();

    // Clamping would collapse it onto one bound and hide the data; the seed
    // reports it and keeps the layer unfiltered instead.
    expect(fsHas(manager, "pts")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("an invalid declaration stays undeclared after Clear and reload, warning once", () => {
    const manager = seedable({ ...RANGE, range: [1000, 2000] });
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

    manager.seedDeclaredFilter();
    manager.seedDeclaredFilter();

    // Warn once per manager, never a half-applied clamp.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(fsHas(manager, "pts")).toBe(false);

    // Clear returns to the declared state; the declaration is still invalid,
    // so the slot stays empty and the warning is not repeated.
    manager.resetState(makeConfig());
    manager.selectedLayerId = "pts";
    manager.availableFields = ["score"];
    manager.cachedSnapshot = snapshot();
    manager.seedDeclaredFilter();
    expect(fsHas(manager, "pts")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);

    // A reload reads the same invalid declaration and starts undeclared too.
    const reloaded = seedable({ ...RANGE, range: [1000, 2000] });
    reloaded.seedDeclaredFilter();
    expect(fsHas(reloaded, "pts")).toBe(false);
  });

  it("keeps the declaration out when a restored per-source filter exists", () => {
    const manager = seedable(RANGE);
    const restored = USER_RANGE;
    manager.filterStore.restore(manager.layerId, "pts", restored);

    manager.seedDeclaredFilter();

    expect(fsGet(manager, "pts")).toEqual(restored);
  });

  it("ignores a declaration bound to a field the panel does not filter", () => {
    const manager = seedable({
      kind: "atom",
      field: "ghost",
      op: "between",
      range: [10, 50],
    });
    // The fixture's env log is a stub; the report goes through it, not console.
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

    manager.seedDeclaredFilter();
    manager.seedDeclaredFilter();

    expect(fsHas(manager, "pts")).toBe(false);
    // The seed runs on every rebuild of the first open; one report is enough.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("seeds before the frame is drawn when the user picks a source", async () => {
    const { initScan } = await import("#control/HeatmapControl/ui.js");
    const declared = {
      kind: "atom",
      field: "val",
      op: "between",
      range: [1, 2],
    } as LayerFilter;
    const manager = makeManager({ filter: declared as Record<string, unknown> });
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => [
      { id: "first", name: "First", layer: {} },
      { id: "second", name: "Second", layer: {} },
    ]);
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 1, marker: { feature: { properties: { val: 1 } } } },
      { lat: 2, lng: 2, marker: { feature: { properties: { val: 3 } } } },
    ]);
    const ctrl = makeCtrl(manager);
    initScan(ctrl);
    // Two point layers: nothing is auto-selected, so the dropdown is the only
    // way in and the declaration has to cover it too.
    expect(manager.selectedLayerId).toBeNull();

    let filterAtRender: LayerFilter | undefined;
    const render = vi.spyOn(manager, "renderHexagons").mockImplementation(() => {
      filterAtRender = fsGet(manager, "second");
    });
    ctrl.layerSelect.value = "second";
    ctrl.layerSelect.onchange?.(new Event("change"));

    // The frame is drawn with the declaration already in the slot; seeding
    // after the draw would paint unfiltered and leave the panel ahead of it.
    expect(filterAtRender).toEqual(declared);
    expect(fsGet(manager, "second")).toEqual(declared);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("the factory Reset drops the ownership so the declaration returns", () => {
    const manager = seedable(RANGE);
    manager.filterStore.restore(manager.layerId, manager.selectedLayerId!, RANGE);

    manager.resetState(makeConfig());

    expect(manager.filterStore.isOwned(manager.layerId, manager.selectedLayerId)).toBe(
      false,
    );
    expect(manager.hasScanned).toBe(false);
  });

  it("a data change that drops the field re-seeds the declaration on rebuild", () => {
    const manager = seedable(RANGE);
    // Seed on first open: the declaration owns the slot.
    manager.seedDeclaredFilter();
    expect(fsGet(manager, "pts")).toEqual(RANGE);
    expect(manager.filterStore.isOwned(manager.layerId, manager.selectedLayerId)).toBe(
      false,
    );

    // Data change drops the field: the source's rebuilt snapshot no longer
    // carries "score". A public render of the selected source revalidates the
    // stored filter against it, normalising to undefined and deleting the
    // slot (it is a statement about data that no longer exists).
    manager.cachedSnapshot = snapshot({});
    manager.renderHexagons();
    expect(fsHas(manager, "pts")).toBe(false);

    // Rebuild: the snapshot is rebuilt with the field back and the manager
    // re-runs the one-shot declaration guard (seedDeclaredFilter, the panel
    // build entry), so the declaration re-seeds.
    manager.cachedSnapshot = snapshot();
    manager.seedDeclaredFilter();
    expect(manager.filterStore.isOwned(manager.layerId, manager.selectedLayerId)).toBe(
      false,
    );
    expect(fsGet(manager, "pts")).toEqual(RANGE);
  });
});

// ── Cross-branch filter contract (range branch) ─────────────────────────────
//
// One half of a mirrored pair. The sibling
// test/js/control/MeasureControl/manager.test.ts pins the same rows against
// the enum branch; the describe/it structure is identical on purpose, so a
// change that moves one branch without the other fails here instead of in a
// user report.
//
// The rows, in order:
//   1. a declared filter is a starting condition and owns nothing;
//   2. a user write owns the slot and wins from then on;
//   3. a stored filter wins over the declaration;
//   4. the filter row's Clear keeps the empty slot, while the factory Reset
//      drops ownership and re-seeds the declaration;
//   5. an unusable declaration warns once and never leaves a half-open state;
//   6. a saved filter round-trips through persistence;
//   7. the dimension carries values only — captions are panel chrome.
describe("HeatmapManager — filter contract (range branch)", () => {
  beforeEach(() => window.localStorage.clear());

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  describe("1. a declared filter is a starting condition", () => {
    it("seeds the declaration without taking ownership", () => {
      const manager = seedable(RANGE);

      manager.seedDeclaredFilter();

      expect(fsGet(manager, "pts")).toEqual(RANGE);
      // A declaration is not a user choice: the factory Reset can still
      // return to it.
      expect(
        manager.filterStore.isOwned(manager.layerId, manager.selectedLayerId),
      ).toBe(false);
    });

    it("does not seed while a stored record owns the slot", () => {
      const manager = seedable(RANGE);
      // The stored record owns the slot with no value — the user cleared the
      // filter (old semantics: filtersTouched flag set, no map entry). A
      // restore with a VALUE would model the opposite (user set a filter),
      // which seeding must also respect but this test pins the cleared case.
      manager.filterStore.restore(manager.layerId, manager.selectedLayerId!, undefined);

      manager.seedDeclaredFilter();

      expect(fsHas(manager, "pts")).toBe(false);
      expect(
        manager.filterStore.isOwned(manager.layerId, manager.selectedLayerId),
      ).toBe(true);
    });
  });

  describe("2. a user write owns the slot", () => {
    it("takes ownership and persists the user's choice", () => {
      const manager = userWrite(seedable(null));

      expect(
        manager.filterStore.isOwned(manager.layerId, manager.selectedLayerId),
      ).toBe(true);
      expect(fsGet(manager, "pts")).toEqual(USER_RANGE);
      // The user's choice persists under the shared store key.
      const saved = manager.loadSavedConfig();
      expect(saved?.filters).toBeUndefined();
      const storeRecord = JSON.parse(window.localStorage.getItem(FILTER_STORE_KEY)!);
      expect(storeRecord.layers[manager.layerId].sources.pts).toEqual({
        touched: true,
        value: USER_RANGE,
      });
    });
  });

  describe("3. a stored filter wins over the declaration", () => {
    it("restores the stored filter instead of the declaration", () => {
      // A record from an earlier session, with its ownership flag: the shared
      // store owns the slot, so the declaration must not re-seed.
      const manager = makeManager({ filter: RANGE } as Partial<ComponentConfig>);
      manager.filterStore.restore(manager.layerId, "pts", USER_RANGE);

      manager.applySavedConfig(manager.loadSavedConfig()!);
      prepare(manager).seedDeclaredFilter();

      expect(fsGet(manager, "pts")).toEqual(USER_RANGE);
      expect(
        manager.filterStore.isOwned(manager.layerId, manager.selectedLayerId!),
      ).toBe(true);
    });
  });

  describe("4. the two clear paths are not the same", () => {
    it("the filter row's Clear keeps the user's empty slot", () => {
      const manager = seedable(RANGE);
      manager.renderHexagons = vi.fn() as any;
      manager.seedDeclaredFilter();
      expect(fsGet(manager, "pts")).toEqual(RANGE);

      manager.setFilter(undefined);
      expect(
        manager.filterStore.isOwned(manager.layerId, manager.selectedLayerId),
      ).toBe(true);
      expect(fsHas(manager, "pts")).toBe(false);

      // The declaration must not come back in this session...
      manager.seedDeclaredFilter();
      expect(fsHas(manager, "pts")).toBe(false);

      // ...or on the next one: the record owns an explicitly empty slot.
      const reloaded = reload(RANGE);
      reloaded.seedDeclaredFilter();
      expect(
        reloaded.filterStore.isOwned(reloaded.layerId, reloaded.selectedLayerId),
      ).toBe(true);
      expect(fsHas(reloaded, "pts")).toBe(false);
    });

    it("the factory Reset drops ownership and re-seeds the declaration", () => {
      const manager = seedable(RANGE);
      manager.filterStore.restore(manager.layerId, "pts", USER_RANGE); // a user wrote earlier
      manager.filterStore.restore(manager.layerId, "pts", USER_RANGE);

      // The panel's Clear is a factory Reset: resetState + clearSavedConfig,
      // exactly what the real button runs.
      manager.resetState(window.CONFIG);
      manager.clearSavedConfig();
      expect(
        manager.filterStore.isOwned(manager.layerId, manager.selectedLayerId),
      ).toBe(false);
      expect(fsSize(manager)).toBe(0);

      prepare(manager).seedDeclaredFilter();
      expect(fsGet(manager, "pts")).toEqual(RANGE);
      expect(
        manager.filterStore.isOwned(manager.layerId, manager.selectedLayerId),
      ).toBe(false);

      // The record is gone, so a reload starts from the declaration again.
      const reloaded = reload(RANGE);
      reloaded.seedDeclaredFilter();
      expect(fsGet(reloaded, "pts")).toEqual(RANGE);
      expect(
        reloaded.filterStore.isOwned(reloaded.layerId, reloaded.selectedLayerId),
      ).toBe(false);
    });
  });

  describe("5. an unusable declaration warns once, never half-applies", () => {
    it("reports the declaration once and starts unfiltered", () => {
      const manager = seedable({ kind: "atom", field: "score", op: "nope" });
      const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

      manager.seedDeclaredFilter();
      manager.seedDeclaredFilter();

      expect(fsHas(manager, "pts")).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("rejects the other branch whole instead of coercing it", () => {
      const manager = seedable({
        kind: "enum",
        field: "score",
        values: ["a", "b"],
      });
      const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

      manager.seedDeclaredFilter();

      // No partial range and no enum leaking into the numeric slot: the wrong
      // branch is undeclared, not coerced.
      expect(fsHas(manager, "pts")).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("stays undeclared after the factory Reset and a reload", () => {
      const manager = seedable({ kind: "atom", field: "score", op: "nope" });
      manager.resetState(window.CONFIG);
      manager.clearSavedConfig();

      prepare(manager).seedDeclaredFilter();
      expect(fsHas(manager, "pts")).toBe(false);

      const reloaded = reload({ kind: "atom", field: "score", op: "nope" });
      reloaded.seedDeclaredFilter();
      expect(fsHas(reloaded, "pts")).toBe(false);
    });
  });

  describe("6. a saved filter round-trips through persistence", () => {
    it("save → load → apply restores the filter and its ownership", () => {
      userWrite(seedable(null));

      const reloaded = reload(RANGE);
      reloaded.seedDeclaredFilter();

      expect(
        reloaded.filterStore.isOwned(reloaded.layerId, reloaded.selectedLayerId),
      ).toBe(true);
      expect(fsGet(reloaded, "pts")).toEqual(USER_RANGE);
    });
  });

  describe("7. the dimension carries values only", () => {
    it("exposes values with captions left to the panel", () => {
      const manager = seedable(RANGE);
      manager.seedDeclaredFilter();

      const dim = manager.getFilterModel()!.dimensions[0];

      expect(dim).toMatchObject({ kind: "range", field: "score" });
      // The panel reads its shared locale keys (filter_field / filter_range);
      // a component-owned caption here is the defect the contract prevents.
      expect(dim).not.toHaveProperty("fieldLabel");
      expect(dim).not.toHaveProperty("label");
    });
  });
});

// ── Filter owner fixtures ─────────────────────────────────────────────
// Shared by the filter-owner suites below; both build a real manager and
// drive the same extract → bins path the UI does.

/** Set up a manager with a point layer, selected, and points extracted. */
function setupWithPoints(
  m: HeatmapManager,
  points: Array<{ lat: number; lng: number; value: number; field?: string }>,
): void {
  const layerId = "layer1";
  m.selectedLayerId = layerId;
  m.agg = "count";
  m.field = "";
  m.numClasses = 6;
  m.method = "jenks";
  m.scheme = "Reds";
  m.labelShow = false;
  vi.spyOn(m, "redrawHeatmap").mockImplementation(() => {});
  m.map = {
    _container: { clientWidth: 800, clientHeight: 600 },
    getZoom: () => 5,
    getBounds: () => ({ isValid: () => true, contains: () => true }),
    getContainer: () => ({ clientWidth: 800, clientHeight: 600 }),
  } as any;
  m.overlay = {
    canvas: { style: {} },
    ctx: {
      setTransform: () => {},
      clearRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      fillText: () => {},
    },
    register: vi.fn(),
    unregister: vi.fn(),
    setVisible: vi.fn(),
    hooks: { before: [], after: [] },
  } as any;
  m.pointLayers = [{ id: layerId, name: "P", layer: {}, count: points.length }];

  const markers = points.map((p, i) => {
    const marker = {
      _latlng: { lat: p.lat, lng: p.lng },
      getLatLng: () => ({ lat: p.lat, lng: p.lng }),
      options: p.field ? { value: p.value } : {},
      value: p.field ? undefined : p.value,
      feature: {
        properties: p.field ? { [p.field]: p.value } : {},
      },
      _foliplus_stamp: `m${i}`,
    } as any;
    return marker;
  });

  vi.spyOn(window.map.foliplus!.LayerAPI!, "extractPoints").mockReturnValue(
    markers.map(m => ({
      lat: m._latlng.lat,
      lng: m._latlng.lng,
      marker: m,
    })),
  );
  // One distinct hex cell per marker: the model counts cells, and these
  // fixtures want the pre-cell semantics (one point ↔ one cell) to stay
  // readable in assertions such as kept === 2.
  (globalThis.h3 as any).latLngToCell = vi.fn(
    (lat: number, lng: number) => `${lat}:${lng}`,
  );
}

/** A spy on the manager's own LAYER_FILTER_CHANGE channel — the payload the
 *  panel and any other observer receives after the owner has settled. The
 *  bus is the one `init()` bound (the fixture map's); setupWithPoints swaps
 *  `m.map` for a zoom stub afterwards, but `this.events` stays put. */
const watchFilterEvents = (
  m: HeatmapManager,
  events: ReturnType<typeof ensureEvents>,
) => {
  const spy = vi.fn();
  events.on(EVENTS.LAYER_FILTER_CHANGE, spy);
  return spy;
};

describe("HeatmapControl filter owner", () => {
  let m: HeatmapManager;
  let events: ReturnType<typeof ensureEvents>;

  beforeEach(() => {
    vi.restoreAllMocks();
    m = makeManager();
    // The bus init() bound to the fixture map — the manager publishes here
    // even after a test replaces m.map with a zoom stub.
    events = ensureEvents(m.map as any);
  });

  it("the manager never subscribes to LAYER_FILTER_CHANGE (no leak by construction)", () => {
    // The write path is the capability call; the owner has nothing to
    // listen for. A listener here would accumulate one consumer per
    // remove/re-add. Publishing at the owner must not move its state.
    publish(events, EVENTS.LAYER_FILTER_CHANGE, { id: m.layerId });
    expect(fsSize(m)).toBe(0);
  });

  it("setFilter applies, re-renders from the bins cache, and publishes the id-only signal", () => {
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 20 },
      { lat: 26.1, lng: 119.32, value: 30 },
    ]);
    m.renderHexagons();
    const h3Spy = vi.spyOn(globalThis.h3, "latLngToCell");
    h3Spy.mockClear();
    const spy = watchFilterEvents(m, events);

    m.setFilter({ kind: "atom", field: "value", op: "between", range: [15, 25] });

    // Zero h3 calls: the bins survived; only aggregateBins reran.
    expect(h3Spy).not.toHaveBeenCalled();
    // The notification is id-only — observers pull the model, never read
    // the filter from the payload.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ id: m.layerId });
  });

  it("setFilter is a no-op when the validated filter equals the stored one", () => {
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 20 },
    ]);
    m.renderHexagons();
    const spy = watchFilterEvents(m, events);
    const f: LayerFilter = {
      kind: "atom",
      field: "value",
      op: "between",
      range: [12, 18],
    };
    m.setFilter(f);
    expect(spy).toHaveBeenCalledTimes(1);
    m.setFilter({ ...f });
    expect(spy).toHaveBeenCalledTimes(1); // unchanged → no second publish
  });

  it("clamps an out-of-range band into the snapshot bounds", () => {
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.1, lng: 119.32, value: 30 },
    ]);
    m.renderHexagons();

    m.setFilter({ kind: "atom", field: "value", op: "between", range: [0, 100] });
    expect(m.getFilterModel()!.filter).toBeUndefined(); // full extent → no filter

    m.setFilter({ kind: "atom", field: "value", op: "between", range: [-5, 20] });
    expect(m.getFilterModel()!.filter).toEqual({
      kind: "atom",
      field: "value",
      op: "between",
      range: [10, 20],
    });
  });

  it("collapses a full-range atom to no filter (missing-field points stay in)", () => {
    // A point without the field: an atom — even over the full extent —
    // would exclude it. Only `undefined` keeps it, which is what dragging
    // both thumbs back to the ends means.
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 30 },
    ]);
    // Third point carries no numeric data at all (the harness's field
    // variant leaks value into options.value, so hand-build this one).
    const extract = window.map.foliplus!.LayerAPI!
      .extractPoints as unknown as ReturnType<typeof vi.fn>;
    extract.mockImplementation(() =>
      [
        { lat: 26.08, lng: 119.3, value: 10 },
        { lat: 26.09, lng: 119.31, value: 30 },
      ]
        .map(p => ({
          lat: p.lat,
          lng: p.lng,
          marker: {
            getLatLng: () => ({ lat: p.lat, lng: p.lng }),
            value: p.value,
            feature: { properties: {} },
          },
        }))
        .concat([
          {
            lat: 26.1,
            lng: 119.32,
            marker: {
              getLatLng: () => ({ lat: 26.1, lng: 119.32 }),
              feature: { properties: {} },
            },
          },
        ] as any),
    );
    (m as any).cachedPoints = null;
    (m as any).cachedSnapshot = null;
    (m as any).cachedSnapshotLayerId = null;
    m.renderHexagons();
    expect(m.getFilterModel()!.total).toBe(3);

    m.setFilter({ kind: "atom", field: "value", op: "between", range: [10, 30] });
    const model = m.getFilterModel()!;
    expect(model.filter).toBeUndefined();
    expect(model.kept).toBe(model.total); // the field-less point is back in
  });

  it("drops an atom whose field is unknown to the snapshot", () => {
    setupWithPoints(m, [{ lat: 26.08, lng: 119.3, value: 10 }]);
    m.renderHexagons();

    m.setFilter({ kind: "atom", field: "nonexistent", op: "between", range: [0, 1] });

    expect(fsSize(m)).toBe(0);
  });

  it("a write that changes nothing does not publish (idempotent)", () => {
    // Clearing a filter that was never set, or writing the band already
    // stored, is a no-op — no render, no notification.
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 30 },
    ]);
    m.renderHexagons();
    const spy = watchFilterEvents(m, events);
    m.setFilter(undefined);
    expect(spy).not.toHaveBeenCalled();
    m.setFilter({ kind: "atom", field: "value", op: "between", range: [10, 20] });
    m.setFilter({ kind: "atom", field: "value", op: "between", range: [10, 20] });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("setFilter on a manager with no selected source is a no-op", () => {
    setupWithPoints(m, [{ lat: 26.08, lng: 119.3, value: 10 }]);
    m.selectedLayerId = null;
    const spy = watchFilterEvents(m, events);

    m.setFilter({ kind: "atom", field: "value", op: "between", range: [0, 10] });

    expect(fsSize(m)).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("getFilterModel reports field, extent, kept/total and a data-derived step", () => {
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 20 },
      { lat: 26.1, lng: 119.32, value: 30 },
    ]);
    m.renderHexagons();

    const model = m.getFilterModel()!;
    expect(model.dimensions[0]).toMatchObject({ kind: "range", field: "value" });
    expect(model.dimensions[0]).toMatchObject({ kind: "range", range: [10, 30] });
    expect(model.filter).toBeUndefined();
    expect(model.kept).toBe(3);
    expect(model.total).toBe(3);
    expect(model.dimensions[0]).toMatchObject({ kind: "range", step: 1 }); // integer data

    m.setFilter({ kind: "atom", field: "value", op: "between", range: [12, 20] });
    expect(m.getFilterModel()!.kept).toBe(1);
  });

  it("binds the filter dimension to the aggregation field without owning captions", () => {
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 20 },
    ]);
    m.renderHexagons();
    const dim = m.getFilterModel()!.dimensions[0];
    // The popup repeats the aggregation field the user picked with field= as
    // a read-only row; its wording is the panel's shared vocabulary, so the
    // dimension carries the field as a value and no caption of its own.
    expect(dim.kind).toBe("range");
    expect(dim.field).toBe("value");
    expect(dim).not.toHaveProperty("fieldLabel");
    expect(dim).not.toHaveProperty("label");
  });

  it("the step honours the data's decimals (no magic 1)", () => {
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 0.5 },
      { lat: 26.09, lng: 119.31, value: 2.75 },
    ]);
    m.renderHexagons();
    const stepDim = m.getFilterModel()!.dimensions[0];
    expect(stepDim.kind).toBe("range");
    expect(stepDim).toMatchObject({ step: 0.01 });
  });

  it("getFilterModel is null without a selection or without numeric fields", () => {
    setupWithPoints(m, [{ lat: 26.08, lng: 119.3, value: 10 }]);
    m.selectedLayerId = null;
    expect(m.getFilterModel()).toBeNull();

    m.selectedLayerId = "layer1";
    // A marker that carries no numeric data at all.
    vi.spyOn(window.map.foliplus!.LayerAPI!, "extractPoints").mockReturnValue([
      {
        lat: 26.08,
        lng: 119.3,
        marker: { getLatLng: () => ({ lat: 26.08, lng: 119.3 }) } as any,
      },
    ]);
    expect(m.getFilterModel()).toBeNull();
  });

  it("filters are attributed per source: A → B → A restores A's filter", () => {
    const ptsA = [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 30 },
    ];
    const ptsB = [
      { lat: 26.08, lng: 119.3, value: 100 },
      { lat: 26.09, lng: 119.31, value: 200 },
      { lat: 26.1, lng: 119.32, value: 300 },
    ];
    setupWithPoints(m, ptsA);
    const extract = window.map.foliplus!.LayerAPI!
      .extractPoints as unknown as ReturnType<typeof vi.fn>;

    // Source A: commit a filter.
    m.renderHexagons();
    m.setFilter({ kind: "atom", field: "value", op: "between", range: [10, 20] });
    expect(m.getFilterModel()!.filter).toBeDefined();

    // Switch to source B (different extent, different count). Both source
    // infos stay registered — a switch changes the selection, not the list.
    m.pointLayers.push({ id: "layer2", name: "Q", layer: {}, count: ptsB.length });
    m.selectedLayerId = "layer2";
    extract.mockImplementation(() =>
      ptsB.map(p => ({
        lat: p.lat,
        lng: p.lng,
        marker: {
          getLatLng: () => ({ lat: p.lat, lng: p.lng }),
          value: p.value,
          feature: { properties: {} },
        },
      })),
    );
    m.renderHexagons();
    const modelB = m.getFilterModel()!;
    expect(modelB.dimensions[0]).toMatchObject({ kind: "range", range: [100, 300] });
    expect(modelB.filter).toBeUndefined(); // B never had a filter
    expect(modelB.total).toBe(3);

    // …and back to A: A's filter is exactly what the user left there.
    extract.mockImplementation(() =>
      ptsA.map(p => ({
        lat: p.lat,
        lng: p.lng,
        marker: {
          getLatLng: () => ({ lat: p.lat, lng: p.lng }),
          value: p.value,
          feature: { properties: {} },
        },
      })),
    );
    m.selectedLayerId = "layer1";
    m.renderHexagons();
    const modelA = m.getFilterModel()!;
    expect(modelA.dimensions[0]).toMatchObject({ kind: "range", range: [10, 30] });
    expect(modelA.filter).toEqual({
      kind: "atom",
      field: "value",
      op: "between",
      range: [10, 20],
    });
  });

  it("revalidates the stored filter when the source content shrinks", () => {
    const original = [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 30 },
    ];
    setupWithPoints(m, original);
    m.renderHexagons();
    m.setFilter({ kind: "atom", field: "value", op: "between", range: [10, 20] });
    expect(m.getFilterModel()!.filter).toBeDefined();

    // Data update: the same source now only carries values 1..5 — the
    // stored band [10, 20] no longer intersects the extent.
    const extract = window.map.foliplus!.LayerAPI!
      .extractPoints as unknown as ReturnType<typeof vi.fn>;
    extract.mockImplementation(() =>
      [
        { lat: 26.08, lng: 119.3, value: 1 },
        { lat: 26.09, lng: 119.31, value: 5 },
      ].map(p => ({
        lat: p.lat,
        lng: p.lng,
        marker: {
          getLatLng: () => ({ lat: p.lat, lng: p.lng }),
          value: p.value,
          feature: { properties: {} },
        },
      })),
    );
    // Invalidate the extraction caches the way onLayerChange does.
    (m as any).cachedPoints = null;
    (m as any).cachedSnapshot = null;
    (m as any).cachedSnapshotLayerId = null;
    const spy = watchFilterEvents(m, events);
    m.renderHexagons();

    // The band clamps into the new extent [1, 5] → [5, 5]; the notification
    // goes out once, after the render that used the corrected filter.
    expect(m.getFilterModel()!.filter).toEqual({
      kind: "atom",
      field: "value",
      op: "between",
      range: [5, 5],
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("drops the filter when its field disappears from the source", () => {
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 30 },
    ]);
    m.renderHexagons();
    m.setFilter({ kind: "atom", field: "value", op: "between", range: [10, 20] });

    // Content update: same layer, but the numeric field is gone.
    const extract = window.map.foliplus!.LayerAPI!
      .extractPoints as unknown as ReturnType<typeof vi.fn>;
    extract.mockImplementation(() =>
      [
        { lat: 26.08, lng: 119.3 },
        { lat: 26.09, lng: 119.31 },
      ].map(p => ({
        lat: p.lat,
        lng: p.lng,
        marker: {
          getLatLng: () => ({ lat: p.lat, lng: p.lng }),
          feature: { properties: { label: "x" } },
        },
      })),
    );
    (m as any).cachedPoints = null;
    (m as any).cachedSnapshot = null;
    (m as any).cachedSnapshotLayerId = null;
    const spy = watchFilterEvents(m, events);
    m.renderHexagons();

    expect(fsSize(m)).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("resetState clears every source's filter and publishes the change", () => {
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 30 },
    ]);
    m.renderHexagons();
    m.setFilter({ kind: "atom", field: "value", op: "between", range: [10, 20] });
    const spy = watchFilterEvents(m, events);

    m.resetState({} as any);

    expect(fsSize(m)).toBe(0);
    expect((m as any).cachedSnapshot).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ id: m.layerId });
  });

  it("resetState without a filter does not publish", () => {
    setupWithPoints(m, [{ lat: 26.08, lng: 119.3, value: 10 }]);
    m.renderHexagons();
    const spy = watchFilterEvents(m, events);
    m.resetState({} as any);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a departing filtered source is cleared and notified exactly once", () => {
    // The review's matrix: selection null, canvas clear, filter deleted, and
    // one LAYER_FILTER_CHANGE after the local state settled. This drives the
    // real onLayerChange pass instead of calling resetState directly.
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 30 },
    ]);
    m.renderHexagons();
    m.setFilter({ kind: "atom", field: "value", op: "between", range: [10, 20] });
    const spy = watchFilterEvents(m, events);

    // The source left the panel's layer list: onLayerChange rescans, finds
    // the selected id missing, and converges the selection/canvas/filter.
    m.pointLayers = [];
    m.onLayerChange();
    m.onLayerChange.flush();

    expect(m.selectedLayerId).toBeNull();
    expect(fsSize(m)).toBe(0);
    expect((m as any).cachedFeatures).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ id: m.layerId });
  });

  it("a departing source without a filter does not publish", () => {
    setupWithPoints(m, [{ lat: 26.08, lng: 119.3, value: 10 }]);
    m.renderHexagons();
    const spy = watchFilterEvents(m, events);

    m.pointLayers = [];
    m.onLayerChange();
    m.onLayerChange.flush();

    expect(m.selectedLayerId).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("a throwing terminal count consumer cannot truncate the filter notification", () => {
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 30 },
    ]);
    m.renderHexagons();
    const boom = vi.fn(() => {
      throw new Error("count boom");
    });
    const after = vi.fn();
    events.on(EVENTS.LAYER_ITEM_COUNT_CHANGE, boom);
    events.on(EVENTS.LAYER_ITEM_COUNT_CHANGE, after);
    const spy = watchFilterEvents(m, events);

    expect(() =>
      m.setFilter({ kind: "atom", field: "value", op: "between", range: [10, 20] }),
    ).toThrow("count boom");

    // The count fan-out ran in full, the notification still reached its
    // observers, and the terminal failure surfaced only at the operation's
    // end — not mid-fan-out.
    expect(boom).toHaveBeenCalled();
    expect(after).toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(m.getFilterModel()!.filter).toBeDefined();
  });

  it("clearHeatmapCanvas keeps per-source filters (a repaint is not a clear)", () => {
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 30 },
    ]);
    m.renderHexagons();
    m.setFilter({ kind: "atom", field: "value", op: "between", range: [10, 20] });

    m.clearHeatmapCanvas();

    expect(fsSize(m)).toBe(1);
  });

  it("filter application reduces the point set via aggregateBins", () => {
    const points = [
      { lat: 26.08, lng: 119.3, value: 5 },
      { lat: 26.09, lng: 119.31, value: 15 },
      { lat: 26.1, lng: 119.32, value: 25 },
      { lat: 26.11, lng: 119.33, value: 35 },
    ];
    setupWithPoints(m, points);

    m.renderHexagons();
    const unfilteredAgg = (m as any).cachedAgg?.data;
    const unfilteredCount = Object.values(unfilteredAgg.hexCells).reduce(
      (sum: number, c: any) => sum + c.count,
      0,
    );
    expect(unfilteredCount).toBe(4);

    m.setFilter({ kind: "atom", field: "value", op: "between", range: [10, 30] });
    const filteredAgg = (m as any).cachedAgg?.data;
    const filteredCount = Object.values(filteredAgg.hexCells).reduce(
      (sum: number, c: any) => sum + c.count,
      0,
    );
    // Values 5 and 35 are excluded → 2 points remain.
    expect(filteredCount).toBe(2);
  });

  it("zoom change invalidates the bin cache (h3 calls again)", () => {
    const points = [
      { lat: 26.08, lng: 119.3, value: 5 },
      { lat: 26.09, lng: 119.31, value: 15 },
    ];
    setupWithPoints(m, points);

    const h3Spy = vi.spyOn(globalThis.h3, "latLngToCell");
    m.renderHexagons();
    expect(h3Spy).toHaveBeenCalled();

    (m as any).map = {
      _container: { clientWidth: 800, clientHeight: 600 },
      getZoom: () => 10,
      getBounds: () => ({ isValid: () => true, contains: () => true }),
      getContainer: () => ({ clientWidth: 800, clientHeight: 600 }),
    } as any;
    h3Spy.mockClear();
    m.renderHexagons();
    expect(h3Spy.mock.calls.length).toBeGreaterThan(0);
  });

  it("drops a cell whose points are all filtered out", () => {
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.08, lng: 119.3, value: 20 },
    ]);
    m.renderHexagons();
    // [15, 15] survives clamping (extent [10, 20]) and excludes both
    // co-located points — the aggregate falls through to the canvas clear
    // instead of emitting an empty cell.
    m.setFilter({ kind: "atom", field: "value", op: "between", range: [15, 15] });
    expect((m as any).cachedFeatures).toBeNull();
  });

  it("extractMarkerFields resolves value, options.value, and properties fields", () => {
    const marker1 = { value: 42, options: {}, feature: { properties: {} } } as any;
    expect(extractMarkerFields(marker1)).toEqual({ value: 42 });

    const marker2 = { options: { value: 99 }, feature: { properties: {} } } as any;
    expect(extractMarkerFields(marker2)).toEqual({ value: 99 });

    const marker3 = {
      options: {},
      feature: { properties: { temperature: 36.5, status: "ok" } },
    } as any;
    expect(extractMarkerFields(marker3)).toEqual({ temperature: 36.5 });
  });

  it("extractMarkerFields skips a properties key the contract already holds", () => {
    const marker = {
      value: 42,
      options: {},
      feature: { properties: { value: 7, other: 3 } },
    } as any;
    expect(extractMarkerFields(marker)).toEqual({ value: 42, other: 3 });
  });
});

// ── Field linkage (first batch of the #724 review) ──
describe("HeatmapControl filter field follows the aggregation field", () => {
  let m: HeatmapManager;

  const points = [
    { lat: 26.08, lng: 119.3, value: 10, field: "b" },
    { lat: 26.09, lng: 119.31, value: 20, field: "a" },
    { lat: 26.1, lng: 119.32, value: 30, field: "a" },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    m = makeManager();
    setupWithPoints(m, points);
  });

  it("reads this.field, not numericFields[0]", () => {
    // numericFields order is ["b", "a"]; the aggregation field is "a".
    m.agg = "sum";
    m.field = "a";
    m.renderHexagons();
    const model = m.getFilterModel();
    expect(model).not.toBeNull();
    expect(model!.dimensions[0]).toMatchObject({ kind: "range", field: "a" });
    expect(model!.dimensions[0]).toMatchObject({ kind: "range", range: [20, 30] });
    expect(model!.total).toBe(3);
  });

  it("falls back to the first numeric field when this.field is empty", () => {
    // Marker values are exposed as the "value" field, which the snapshot
    // orders first — the default field is numericFields[0].
    m.field = "";
    const model = m.getFilterModel()!;
    expect(model.dimensions[0]).toMatchObject({ kind: "range", field: "value" });
    expect(model.dimensions[0]).toMatchObject({ kind: "range", range: [10, 30] });
  });

  it("syncFilterField drops a filter written for the previous field", () => {
    m.agg = "sum";
    m.field = "a";
    m.setFilter({ kind: "atom", field: "a", op: "between", range: [20, 25] });
    expect(fsSize(m)).toBe(1);
    m.field = "b";
    // The panel's field write saves the config, which is what drops the
    // memoised effective field — without it syncFilterField would still read
    // the previous field from the cache.
    m.saveConfig();
    m.syncFilterField();
    expect(fsSize(m)).toBe(0);
  });

  it("syncFilterField keeps a filter bound to the same field", () => {
    m.agg = "sum";
    m.field = "a";
    m.setFilter({ kind: "atom", field: "a", op: "between", range: [20, 25] });
    m.syncFilterField();
    expect(fsSize(m)).toBe(1);
  });
});

describe("HeatmapManager aggregateData onEmpty default", () => {
  it("falls back to clearHeatmapCanvas when no onEmpty is passed", () => {
    const m = makeManager();
    setupWithPoints(m, []);
    const clear = vi.spyOn(m, "clearHeatmapCanvas").mockImplementation(() => {});
    expect(m.aggregateData([], 5)).toBeNull();
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });
});

describe("HeatmapManager — versioned persisted config", () => {
  const KEY = CONST.STORAGE.KEY;

  describe("saveConfig — writes the version stamp", () => {
    it("includes version alongside every other persisted field", () => {
      const m = makeManager();
      m.selectedLayerId = "layer_abc";
      m.agg = CONST.AGG.SUM;
      m.method = METHOD.QUANTILE;
      m.scheme = "Blues";
      m.numClasses = 4;
      m.borderWeight = 2;
      m.borderColor = "#ff0000";
      m.labelShow = true;
      m.labelFormat = "comma";
      m.field = "price";

      m.saveConfig();

      const stored = JSON.parse(window.localStorage.getItem(KEY)!);
      expect(stored.version).toBe(CONST.RECORD_VERSION);
      expect(stored.layerId).toBe("layer_abc");
      expect(stored.agg).toBe("sum");
      expect(stored.numClasses).toBe(4);
    });

    it("saves null layerId when no layer selected", () => {
      const m = makeManager();
      m.selectedLayerId = null;
      m.saveConfig();
      const stored = JSON.parse(window.localStorage.getItem(KEY)!);
      expect(stored.layerId).toBeNull();
    });
  });

  describe("clearSavedConfig", () => {
    it("removes the storage key", () => {
      const m = makeManager();
      window.localStorage.setItem(KEY, JSON.stringify({ agg: "sum" }));
      expect(window.localStorage.getItem(KEY)).not.toBeNull();
      m.clearSavedConfig();
      expect(window.localStorage.getItem(KEY)).toBeNull();
    });

    it("does not throw when key does not exist", () => {
      const m = makeManager();
      expect(() => m.clearSavedConfig()).not.toThrow();
    });

    it("swallows removeItem errors and logs a warning", () => {
      const warn = vi.fn();
      vi.spyOn(console, "warn").mockImplementation(warn);
      const m = makeManager();
      // MockStorage exposes removeItem on its prototype; spy there so the
      // manager's `window.localStorage.removeItem(...)` call is intercepted.
      const proto = Object.getPrototypeOf(window.localStorage);
      const removeItem = vi.spyOn(proto, "removeItem").mockImplementation(() => {
        throw new Error("quota");
      });
      try {
        expect(() => m.clearSavedConfig()).not.toThrow();
        expect(removeItem).toHaveBeenCalledWith(KEY);
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining("failed to remove data"),
          expect.any(Error),
        );
      } finally {
        removeItem.mockRestore();
        vi.restoreAllMocks();
      }
    });
  });

  describe("loadSavedConfig — tolerant of missing/older version", () => {
    it("returns null when nothing is stored", () => {
      expect(makeManager().loadSavedConfig()).toBeNull();
    });

    it("returns the new-format record with its version intact", () => {
      const m = makeManager();
      const cfg = {
        version: CONST.RECORD_VERSION,
        layerId: "x",
        agg: "sum",
        method: "jenks",
      };
      window.localStorage.setItem(KEY, JSON.stringify(cfg));
      expect(m.loadSavedConfig()).toEqual(cfg);
    });

    it("returns a legacy record without a version unchanged (no migration)", () => {
      const m = makeManager();
      const legacy = { layerId: "x", agg: "sum", method: "jenks", scheme: "Reds" };
      window.localStorage.setItem(KEY, JSON.stringify(legacy));
      expect(m.loadSavedConfig()).toEqual(legacy);
      // version is absent on the legacy record — applySavedConfig must still
      // apply every field to the manager's state.
      m.applySavedConfig(legacy as Parameters<typeof m.applySavedConfig>[0]);
      expect(m.selectedLayerId).toBe("x");
      expect(m.agg).toBe("sum");
      expect(m.method).toBe("jenks");
      expect(m.scheme).toBe("Reds");
    });

    it("returns a record with an older/unknown version value unchanged", () => {
      const m = makeManager();
      const cfg = { version: 999, layerId: "x", agg: "sum" };
      window.localStorage.setItem(KEY, JSON.stringify(cfg));
      expect(m.loadSavedConfig()).toEqual(cfg);
    });

    it("returns null for corrupted JSON", () => {
      const m = makeManager();
      window.localStorage.setItem(KEY, "not-json");
      expect(m.loadSavedConfig()).toBeNull();
    });
  });

  describe("saved records are validated at the boundary", () => {
    // loadRecord is a static assertion, not a check: a record from an older
    // build, a hand-edited one, or one from a future version holds whatever
    // it likes. A bad field must keep the default instead of reaching the
    // classifier (which used to re-mean an unknown method as equal) or chroma
    // (whose throw used to abort the panel on load).
    const store = (record: unknown) =>
      window.localStorage.setItem(KEY, JSON.stringify(record));

    it("drops a method the classifier does not implement", () => {
      const m = makeManager();
      const before = m.method;
      store({ method: "bogus", agg: "sum", scheme: "Reds" });
      const loaded = m.loadSavedConfig()!;
      expect(loaded.method).toBeUndefined();
      // The neighbouring fields are unaffected by one bad one.
      expect(loaded.agg).toBe("sum");
      expect(loaded.scheme).toBe("Reds");
      m.applySavedConfig(loaded);
      expect(m.method).toBe(before);
    });

    it("rejects a padded or differently-cased method", () => {
      // A method is a protocol token, so padding and case are meaningful.
      const m = makeManager();
      store({ method: " equal " });
      expect(m.loadSavedConfig()!.method).toBeUndefined();
      store({ method: "EQUAL" });
      expect(m.loadSavedConfig()!.method).toBeUndefined();
      store({ method: "equal" });
      expect(m.loadSavedConfig()!.method).toBe("equal");
    });

    it("drops an unknown aggregation and a non-integer class count", () => {
      const m = makeManager();
      store({ agg: "median", numClasses: 3.5, scheme: "Reds" });
      const loaded = m.loadSavedConfig()!;
      expect(loaded.agg).toBeUndefined();
      expect(loaded.numClasses).toBeUndefined();
      expect(loaded.scheme).toBe("Reds");
    });

    it("clamps an out-of-range class count and keeps a null layerId", () => {
      const m = makeManager();
      store({ numClasses: 99, layerId: null });
      const loaded = m.loadSavedConfig()!;
      expect(loaded.numClasses).toBe(CLASS_COUNT.MAX);
      // null means "the user cleared the selection", so it is preserved
      // rather than treated as an absent field.
      expect(loaded.layerId).toBeNull();
    });

    it("drops a version stamp that is not a positive integer", () => {
      // Absent means "legacy record - the fields are the source of truth";
      // present-but-invalid is not a version at all.
      const m = makeManager();
      store({ version: 0, agg: "sum" });
      expect(m.loadSavedConfig()!.version).toBeUndefined();
      expect(m.loadSavedConfig()!.agg).toBe("sum");
      store({ version: 1.5 });
      expect(m.loadSavedConfig()!.version).toBeUndefined();
      store({ version: "3" });
      expect(m.loadSavedConfig()!.version).toBeUndefined();
    });

    it("clamps a border weight the way the live setter does", () => {
      // The panel offers BORDER_WEIGHT, so a record must not enter the
      // manager through a wider gate than the UI itself provides.
      const m = makeManager();
      store({ borderWeight: -4 });
      expect(m.loadSavedConfig()!.borderWeight).toBe(BORDER_WEIGHT.MIN);
      store({ borderWeight: 99 });
      expect(m.loadSavedConfig()!.borderWeight).toBe(BORDER_WEIGHT.MAX);
    });

    it("drops a label format outside the NumberStyle union", () => {
      const m = makeManager();
      store({ labelFormat: "currency" });
      expect(m.loadSavedConfig()!.labelFormat).toBeUndefined();
    });

    it("ignores a non-object record and leaves the one-shot guard alone", () => {
      const m = makeManager();
      store([1, 2, 3]);
      expect(m.loadSavedConfig()).toBeNull();
      m.applySavedConfig([1, 2, 3] as never);
      expect(m.hasScanned).toBe(false);
    });
  });

  describe("applySavedConfig on a legacy record", () => {
    it("applies every field when version is missing, and keeps manager defaults otherwise", () => {
      const m = makeManager();
      m.applySavedConfig({
        layerId: "layer_xyz",
        agg: "max",
        method: "equal",
        scheme: "Greens",
        numClasses: 5,
        borderWeight: 3,
        borderColor: "#00ff00",
        labelShow: true,
        labelFormat: "percent",
        field: "properties.qty",
      } as Parameters<typeof m.applySavedConfig>[0]);
      expect(m.selectedLayerId).toBe("layer_xyz");
      expect(m.agg).toBe("max");
      expect(m.method).toBe("equal");
      expect(m.scheme).toBe("Greens");
      expect(m.numClasses).toBe(5);
      expect(m.borderWeight).toBe(3);
      expect(m.borderColor).toBe("#00ff00");
      expect(m.labelShow).toBe(true);
      expect(m.labelFormat).toBe("percent");
      expect(m.field).toBe("qty");
    });

    it("clamps numClasses to valid range", () => {
      const m = makeManager();
      m.applySavedConfig({ numClasses: 99 });
      expect(m.numClasses).toBe(CLASS_COUNT.MAX);

      m.applySavedConfig({ numClasses: 0 });
      expect(m.numClasses).toBe(CLASS_COUNT.MIN);
    });

    it("applies only present fields, keeps defaults for missing", () => {
      const m = makeManager();
      m.agg = "custom_agg";
      m.applySavedConfig({ agg: "sum" });
      expect(m.agg).toBe("sum");
      expect(m.method).toBe("jenks");
      expect(m.scheme).toBe("Reds");
    });

    it("sets selectedLayerId to null when layerId is missing", () => {
      const m = makeManager();
      m.selectedLayerId = "old_layer";
      m.applySavedConfig({});
      expect(m.selectedLayerId).toBeNull();
    });

    it("leaves a record without a field unresolved until the first scan resolves it", () => {
      // An old record may carry `field: ""` (the retired auto sentinel). The
      // parser drops empty strings, so applying it leaves the manager's
      // default in place; the first updateFieldSelector resolves and persists
      // the first numeric field (covered in ui.test.ts).
      const m = makeManager();
      m.selectedLayerId = "layer_abc";
      m.field = "";
      m.saveConfig();
      const stored = JSON.parse(window.localStorage.getItem(KEY)!);
      expect(stored.field).toBe("");
      const m2 = makeManager();
      m2.applySavedConfig(m.loadSavedConfig()!);
      expect(m2.field).toBe("");
    });

    it("stores an explicit field pick as the real name", () => {
      const m = makeManager();
      m.field = "price";
      m.saveConfig();
      const stored = JSON.parse(window.localStorage.getItem(KEY)!);
      expect(stored.field).toBe("price");
      const m2 = makeManager();
      m2.applySavedConfig(m.loadSavedConfig()!);
      expect(m2.field).toBe("price");
    });

    it("ignores undefined borderWeight, keeps current value", () => {
      const m = makeManager();
      m.borderWeight = 2.5;
      m.applySavedConfig({});
      expect(m.borderWeight).toBe(2.5);
    });
  });

  describe("flush — teardown safety", () => {
    it("writes the pending config on flush, and is idempotent", () => {
      const m = makeManager();
      m.selectedLayerId = "layer_x";
      m.agg = CONST.AGG.AVG;
      m.scheme = "Greens";
      m.numClasses = 5;
      m.saveConfig(); // schedule a write — flush below lands it

      m.flush();

      const stored = JSON.parse(window.localStorage.getItem(KEY)!);
      expect(stored.layerId).toBe("layer_x");
      expect(stored.agg).toBe("avg");
      expect(stored.scheme).toBe("Greens");
      expect(stored.numClasses).toBe(5);
      expect(stored.version).toBe(CONST.RECORD_VERSION);

      // A second flush must not double-write or drop fields — the timer is
      // already cleared by the first flush, so the second call is a no-op.
      const before = window.localStorage.getItem(KEY);
      m.flush();
      expect(window.localStorage.getItem(KEY)).toBe(before);
    });

    it("flush is a no-op when nothing has been scheduled", () => {
      // Conditional-flush semantic: a teardown that has nothing pending must
      // not rewrite the record. Storage stays untouched.
      const m = makeManager();
      m.selectedLayerId = "layer_x";
      m.flush();
      expect(window.localStorage.getItem(KEY)).toBeNull();
    });
  });

  describe("round-trip", () => {
    it("save → load → apply preserves every field (version travels with the record)", () => {
      const m1 = makeManager();
      m1.selectedLayerId = "r1";
      m1.agg = "avg";
      m1.method = "heads";
      m1.scheme = "Viridis";
      m1.numClasses = 3;
      m1.borderWeight = 0.5;
      m1.borderColor = "#111111";
      m1.labelShow = true;
      m1.field = "value";
      m1.filterStore.restore(m1.layerId, "r1", {
        kind: "atom",
        field: "value",
        op: "between",
        range: [1, 2],
      });
      m1.saveConfig();

      const stored = JSON.parse(window.localStorage.getItem(KEY)!);
      expect(stored.version).toBe(CONST.RECORD_VERSION);
      // The filter half lives under the shared store key, not the old key:
      // the old component key keeps only style fields now.
      expect(stored.filters).toBeUndefined();
      const storeRecord = JSON.parse(window.localStorage.getItem(FILTER_STORE_KEY)!);
      expect(storeRecord.layers[m1.layerId].sources.r1).toEqual({
        touched: true,
        value: { kind: "atom", field: "value", op: "between", range: [1, 2] },
      });

      const m2 = makeManager();
      const loaded = m2.loadSavedConfig();
      expect(loaded).toEqual(stored);
      m2.applySavedConfig(loaded!);
      expect(m2.selectedLayerId).toBe("r1");
      expect(m2.agg).toBe("avg");
      expect(m2.method).toBe("heads");
      expect(m2.scheme).toBe("Viridis");
      expect(m2.numClasses).toBe(3);
      expect(m2.borderWeight).toBe(0.5);
      expect(m2.borderColor).toBe("#111111");
      expect(m2.labelShow).toBe(true);
      expect(m2.field).toBe("value");
      // The ownership flag and the per-source filter travel together: the
      // reloaded manager must not let the declaration overwrite either.
      expect(m2.filterStore.isOwned(m2.layerId, m2.selectedLayerId!)).toBe(true);
      expect(fsGet(m2, "r1")).toEqual({
        kind: "atom",
        field: "value",
        op: "between",
        range: [1, 2],
      });
    });

    it("preserves falsy values (false / 0) through save → load → apply", () => {
      const m1 = makeManager();
      m1.labelShow = false;
      m1.borderWeight = 0;
      m1.saveConfig();

      const m2 = makeManager();
      const loaded = m2.loadSavedConfig();
      expect(loaded).not.toBeNull();
      m2.applySavedConfig(loaded!);

      expect(m2.labelShow).toBe(false);
      expect(m2.borderWeight).toBe(0);
    });
  });
});

describe("HeatmapManager — persisted per-source filters", () => {
  const KEY = CONST.STORAGE.KEY;
  const atom = {
    kind: "atom" as const,
    field: "magnitude",
    op: "between" as const,
    range: [2, 4] as [number, number],
  };

  it("saves each source filter and restores the map on load/apply", () => {
    const m1 = makeManager();
    m1.selectedLayerId = "layer_a";
    m1.filterStore.restore(m1.layerId, "layer_a", atom);
    m1.filterStore.restore(m1.layerId, "layer_b", { ...atom, field: "weight" });
    m1.saveConfig();

    const stored = JSON.parse(window.localStorage.getItem(KEY)!);
    // The filter half lives under the shared store key.
    expect(stored.filters).toBeUndefined();
    const storeRecord = JSON.parse(window.localStorage.getItem(FILTER_STORE_KEY)!);
    expect(Object.keys(storeRecord.layers[m1.layerId].sources)).toEqual([
      "layer_a",
      "layer_b",
    ]);

    const m2 = makeManager();
    m2.applySavedConfig(m2.loadSavedConfig()!);
    expect(fsGet(m2, "layer_a")).toEqual(atom);
    expect(fsGet(m2, "layer_b")).toEqual({
      ...atom,
      field: "weight",
    });
  });

  it("omits the filters field when no source is filtered", () => {
    const m = makeManager();
    m.saveConfig();
    const stored = JSON.parse(window.localStorage.getItem(KEY)!);
    expect(stored.filters).toBeUndefined();
  });
});

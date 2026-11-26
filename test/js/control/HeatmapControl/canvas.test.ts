// Unit tests for HeatmapControl/canvas — the canvas mixin methods.
import {
  loadGeometry,
  makeConfig,
  makeCtrl,
  makeManager,
  setupWithPoints,
} from "./fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents } from "#core/event/index.js";
import { getLayerAlpha, setLayerAlpha } from "#core/layer/index.js";
import type { HeatmapManager } from "#control/HeatmapControl/manager.js";
import type { HeatmapControlUI } from "#control/HeatmapControl/ui.js";
import * as CONST from "#control/HeatmapControl/const.js";

afterEach(() => {
  delete globalThis.h3;
  delete globalThis.chroma;
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
    expect(handler).toHaveBeenCalledWith(
      { id: m.layerId },
      { origin: { kind: "programmatic", via: "refresh" } },
    );
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

  it("collectFields excludes folium/geopandas __-prefixed keys even when numeric", () => {
    // geopandas' explore output carries a numeric __id (and folium a __folium_color
    // render channel) in feature.properties. Without the internal-key guard the
    // numeric one is indistinguishable from a business column and would appear in
    // the aggregation field list; the guard drops it before the number check.
    const m = makeManager();
    mockMarkers({
      feature: { properties: { price: 1, __id: 42, __folium_color: "#22a06b" } },
    });
    const fields = m.collectFields([{ id: "a" }]);
    expect(fields).toContain("price");
    expect(fields).not.toContain("__id");
    expect(fields).not.toContain("__folium_color");
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
    expect(handler).toHaveBeenCalledWith(
      { id: m.layerId },
      { origin: { kind: "programmatic", via: "refresh" } },
    );
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

describe("clearHeatmapCanvas — null overlay", () => {
  it("tolerates a null overlay", () => {
    const m = makeManager();
    m.overlay = null as never;
    expect(() => m.clearHeatmapCanvas()).not.toThrow();
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

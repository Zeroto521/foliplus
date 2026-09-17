import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents } from "#core/event/index.js";
import * as CONST from "#foliplus/HeatmapControl/const.js";
import { HeatmapManager } from "#foliplus/HeatmapControl/manager.js";
import { rebuildLayerDropdown } from "#foliplus/HeatmapControl/ui.js";
import { makeConf, makeCtrl, makeManager } from "./fixture.js";

afterEach(() => {
  delete globalThis.h3;
  delete globalThis.chroma;
});

describe("getH3Res", () => {
  it("returns matching resolution from RES_MAP", () => {
    const m = makeManager();
    expect(m.getH3Res(2)).toBe(0); // RES_MAP[0] = [2, 0]
    expect(m.getH3Res(5)).toBe(2); // RES_MAP[3] = [5, 2]
    expect(m.getH3Res(7)).toBe(4); // RES_MAP[5] = [7, 4]
    expect(m.getH3Res(10)).toBe(6); // RES_MAP[8] = [10, 6]
  });

  it("returns fallback for zoom beyond RES_MAP", () => {
    const m = makeManager();
    expect(m.getH3Res(99)).toBe(CONST.H3.RES_FALLBACK);
  });
});

describe("computeBreaks", () => {
  let m;

  beforeEach(() => {
    m = makeManager();
  });

  it("returns empty array for empty data", () => {
    expect(m.computeBreaks([], 5, "jenks")).toEqual([]);
  });

  it("returns [lo, hi] for data with 2 elements", () => {
    const breaks = m.computeBreaks([1, 10], 5, "jenks");
    expect(breaks).toEqual([1, 10]);
  });

  it("uses equal intervals for 'equal' method", () => {
    const breaks = m.computeBreaks([0, 10, 20, 30, 40], 4, "equal");
    expect(breaks[0]).toBe(0);
    expect(breaks[breaks.length - 1]).toBe(40);
    expect(breaks.length).toBe(5); // nClasses + 1
  });

  it("returns sorted breaks for 'quantile' method", () => {
    const breaks = m.computeBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, "quantile");
    expect(breaks[0]).toBe(1);
    expect(breaks[breaks.length - 1]).toBe(10);
    expect(breaks.length).toBeGreaterThanOrEqual(2);
  });

  it("returns sorted breaks for 'heads' method", () => {
    const breaks = m.computeBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, "heads");
    expect(breaks[0]).toBe(1);
    expect(breaks[breaks.length - 1]).toBe(10);
  });
});

describe("readMarkerField", () => {
  let m;

  beforeEach(() => {
    m = makeManager();
  });

  it("returns undefined for null field", () => {
    expect(m.readMarkerField({}, null)).toBeUndefined();
  });

  it("reads direct marker.value", () => {
    expect(m.readMarkerField({ value: 42 }, "value")).toBe(42);
  });

  it("reads options.value", () => {
    expect(m.readMarkerField({ options: { value: 77 } }, "options.value")).toBe(77);
  });

  it("reads feature.properties", () => {
    const marker = { feature: { properties: { price: 100 } } };
    expect(m.readMarkerField(marker, "properties.price")).toBe(100);
  });
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
    m.fieldAuto = false;
    expect(m.getPointValue({})).toBe(1);
  });
});

describe("pickAutoField", () => {
  let m;

  beforeEach(() => {
    m = makeManager();
  });

  it("returns first field", () => {
    expect(m.pickAutoField(["a", "b", "c"])).toBe("a");
  });

  it("returns null for empty fields", () => {
    expect(m.pickAutoField([])).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(m.pickAutoField(null)).toBeNull();
  });
});

describe("getColorScale", () => {
  let m;

  beforeEach(() => {
    m = makeManager();
  });

  it("returns n colors via chroma.scale", () => {
    const colors = m.getColorScale("Reds", 3);
    expect(colors).toHaveLength(3);
    expect(globalThis.chroma.scale).toHaveBeenCalledWith("Reds");
  });

  it("falls back to gray when chroma is absent", () => {
    delete globalThis.chroma;
    const colors = m.getColorScale("Reds", 3);
    expect(colors).toEqual(["#999", "#999", "#999"]);
  });
});

describe("buildFeatures", () => {
  let m;

  beforeEach(() => {
    m = makeManager();
  });

  it("builds GeoJSON features from aggregated hex data", () => {
    const aggregated = {
      hexCells: {
        abc: { sum: 10, count: 5, min: 1, max: 5 },
        def: { sum: 20, count: 8, min: 2, max: 6 },
      },
      getAggValue: cell => cell.count,
      valueToClassIdx: val => Math.min(val - 1, 0),
      classColors: ["#ff0000", "#00ff00"],
    };
    const features = m.buildFeatures(aggregated);
    expect(features).toHaveLength(2);
    expect(features[0].properties.value).toBe(5);
    expect(features[0].properties.h3).toBe("abc");
    expect(features[0].geometry.type).toBe("Polygon");
  });

  it("returns empty array for empty hexCells", () => {
    const aggregated = {
      hexCells: {},
      getAggValue: () => 0,
      valueToClassIdx: () => 0,
      classColors: [],
    };
    const features = m.buildFeatures(aggregated);
    expect(features).toHaveLength(0);
  });
});

describe("aggregateData", () => {
  let m;

  beforeEach(() => {
    m = makeManager();
  });

  it("aggregates points with COUNT", () => {
    m.currentAgg = CONST.AGG.COUNT;
    globalThis.h3.latLngToCell = vi.fn(lat => `cell_${lat}`);
    const pts = [
      { lat: 26.08, lng: 119.3, value: 1 },
      { lat: 26.09, lng: 119.31, value: 1 },
    ];
    const result = m.aggregateData(pts, 4);
    expect(result).toBeDefined();
    expect(Object.keys(result.hexCells)).toHaveLength(2);
  });

  it("aggregates points with SUM", () => {
    m.currentAgg = CONST.AGG.SUM;
    globalThis.h3.latLngToCell = vi.fn(() => "same_cell");
    const pts = [
      { lat: 26.08, lng: 119.3, value: 5 },
      { lat: 26.08, lng: 119.3, value: 10 },
    ];
    const result = m.aggregateData(pts, 4);
    expect(result.getAggValue(result.hexCells["same_cell"])).toBe(15);
  });

  it("AVG returns 0 for a zero-count cell", () => {
    m.currentAgg = CONST.AGG.AVG;
    globalThis.h3.latLngToCell = vi.fn(() => "same_cell");
    const pts = [{ lat: 26.08, lng: 119.3, value: 5 }];
    const result = m.aggregateData(pts, 4);
    // Normal cell: avg of 5 is 5.
    expect(result.getAggValue(result.hexCells["same_cell"])).toBe(5);
    // Defensive: a cell with count 0 returns 0, not NaN.
    expect(result.getAggValue({ sum: 0, count: 0, min: 0, max: 0 })).toBe(0);
  });

  it("returns null for empty points", () => {
    m.overlay.canvas = {};
    const result = m.aggregateData([], 4);
    expect(result).toBeNull();
  });
});

describe("computeBreaks — additional gaps", () => {
  it("returns [lo, hi] for single-element data across methods", () => {
    const m = makeManager();
    expect(m.computeBreaks([42], 3, "equal")).toEqual([42, 42]);
    expect(m.computeBreaks([42], 3, "quantile")).toEqual([42, 42]);
    expect(m.computeBreaks([42], 3, "heads")).toEqual([42, 42]);
  });

  it("limits nClasses to min(nClasses, data length)", () => {
    const m = makeManager();
    expect(m.computeBreaks([1, 2], 2, "equal")).toEqual([1, 2]);
  });
});

describe("readMarkerField — additional gaps", () => {
  it("returns undefined for unknown field path", () => {
    const m = makeManager();
    expect(m.readMarkerField({}, "some.random.path")).toBeUndefined();
  });

  it("returns undefined when properties key does not exist", () => {
    const m = makeManager();
    const marker = { feature: { properties: { foo: 1 } } };
    expect(m.readMarkerField(marker, "properties.bar")).toBeUndefined();
  });
});

describe("getPointValue — additional gaps", () => {
  it("uses autoFieldKey when fieldAuto is true", () => {
    const m = makeManager();
    m.currentAgg = CONST.AGG.SUM;
    m.fieldAuto = true;
    m.autoFieldKey = "value";
    expect(m.getPointValue({ value: 42 })).toBe(42);
  });

  it("uses currentField when fieldAuto is false", () => {
    const m = makeManager();
    m.currentAgg = CONST.AGG.SUM;
    m.fieldAuto = false;
    m.currentField = "options.value";
    expect(m.getPointValue({ options: { value: 99 } })).toBe(99);
  });

  it("warns on value fallback (once per render)", () => {
    const m = makeManager();
    m.currentAgg = CONST.AGG.SUM;
    m.fieldAuto = false;
    m.currentField = "bad_field";
    m.valueFallbackWarned = false;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(m.getPointValue({})).toBe(1);
    expect(m.valueFallbackWarned).toBe(true);
    expect(m.getPointValue({})).toBe(1); // no additional warn
    warnSpy.mockRestore();
  });
});

describe("buildFeatures — centroid fallback", () => {
  it("computes centroid from boundary polygon when h3.cellToLatLng fails", () => {
    const m = makeManager();
    // Override AFTER construction — makeManager reassigns h3 mocks
    globalThis.h3.cellToLatLng = vi.fn(() => {
      throw new Error("unavailable");
    });
    globalThis.h3.cellToBoundary = vi.fn(() => [
      [0, 0],
      [0, 2],
      [2, 2],
      [2, 0],
      [0, 0],
    ]);

    const aggregated: any = {
      hexCells: { abc: { sum: 1, count: 1 } },
      getAggValue: c => c.count,
      valueToClassIdx: () => 0,
      classColors: ["#ff0000"],
    };
    const feats = m.buildFeatures(aggregated);
    expect(feats).toHaveLength(1);
    expect(feats[0].properties.centroid).toBeDefined();
    // centroid = [cy/(n-1), cx/(n-1)] over coords = [[0,0],[2,0],[2,2],[0,2],[0,0]]
    // cy = 0+0+2+2+0 = 4, cx = 0+2+2+0+0 = 4, n-1 = 5
    expect(feats[0].properties.centroid).toEqual([4 / 5, 4 / 5]);
  });

  it("returns empty array for empty hexCells", () => {
    const m = makeManager();
    const aggregated: any = {
      hexCells: {},
      getAggValue: c => 0,
      valueToClassIdx: () => 0,
      classColors: [],
    };
    expect(m.buildFeatures(aggregated)).toEqual([]);
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
    m.cachedPoints = { key: "layer1|count|true|", pts: [{ lat: 1 }] } as any;
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
      key: "layer1|count|true||2|jenks|Reds|6",
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

describe("HeatmapManager — persistence", () => {
  const KEY = CONST.STORAGE.KEY;

  beforeEach(() => {
    window.localStorage.clear();
  });

  describe("saveConfig", () => {
    it("serialises all current state to localStorage", () => {
      const m = makeManager();
      m.selectedLayerId = "layer_abc";
      m.currentAgg = CONST.AGG.SUM;
      m.currentMethod = CONST.METHOD.QUANTILE;
      m.currentScheme = "Blues";
      m.numClasses = 4;
      m.borderWeight = 2;
      m.borderColor = "#ff0000";
      m.currentLabelShow = true;
      m.currentField = "price";
      m.fieldAuto = false;

      m.saveConfig();

      const stored = JSON.parse(window.localStorage.getItem(KEY)!);
      expect(stored.layerId).toBe("layer_abc");
      expect(stored.agg).toBe("sum");
      expect(stored.method).toBe("quantile");
      expect(stored.scheme).toBe("Blues");
      expect(stored.numClasses).toBe(4);
      expect(stored.borderWeight).toBe(2);
      expect(stored.borderColor).toBe("#ff0000");
      expect(stored.labelShow).toBe(true);
      expect(stored.field).toBe("price");
      expect(stored.fieldAuto).toBe(false);
    });

    it("saves null layerId when no layer selected", () => {
      const m = makeManager();
      m.selectedLayerId = null;
      m.saveConfig();
      const stored = JSON.parse(window.localStorage.getItem(KEY)!);
      expect(stored.layerId).toBeNull();
    });
  });

  describe("loadSavedConfig", () => {
    it("returns null when nothing is stored", () => {
      const m = makeManager();
      expect(m.loadSavedConfig()).toBeNull();
    });

    it("returns parsed config from localStorage", () => {
      const m = makeManager();
      const cfg = { layerId: "x", agg: "sum", method: "jenks", scheme: "Reds" };
      window.localStorage.setItem(KEY, JSON.stringify(cfg));
      expect(m.loadSavedConfig()).toEqual(cfg);
    });

    it("returns null for corrupted JSON", () => {
      const m = makeManager();
      window.localStorage.setItem(KEY, "not-json");
      expect(m.loadSavedConfig()).toBeNull();
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
          expect.stringContaining("failed to clear saved data"),
          expect.any(Error),
        );
      } finally {
        removeItem.mockRestore();
        vi.restoreAllMocks();
      }
    });
  });

  describe("applySavedConfig", () => {
    it("applies all fields to manager state", () => {
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
        field: "properties.qty",
        fieldAuto: false,
      });
      expect(m.selectedLayerId).toBe("layer_xyz");
      expect(m.currentAgg).toBe("max");
      expect(m.currentMethod).toBe("equal");
      expect(m.currentScheme).toBe("Greens");
      expect(m.numClasses).toBe(5);
      expect(m.borderWeight).toBe(3);
      expect(m.borderColor).toBe("#00ff00");
      expect(m.currentLabelShow).toBe(true);
      // Legacy "properties." prefix is stripped on load.
      expect(m.currentField).toBe("qty");
      expect(m.fieldAuto).toBe(false);
    });

    it("clamps numClasses to valid range", () => {
      const m = makeManager();
      m.applySavedConfig({ numClasses: 99 });
      expect(m.numClasses).toBe(CONST.CLASS_COUNT.MAX);

      m.applySavedConfig({ numClasses: 0 });
      expect(m.numClasses).toBe(CONST.CLASS_COUNT.MIN);
    });

    it("applies only present fields, keeps defaults for missing", () => {
      const m = makeManager();
      m.currentAgg = "custom_agg";
      m.applySavedConfig({ agg: "sum" });
      expect(m.currentAgg).toBe("sum");
      expect(m.currentMethod).toBe("jenks");
      expect(m.currentScheme).toBe("Reds");
    });

    it("sets selectedLayerId to null when layerId is missing", () => {
      const m = makeManager();
      m.selectedLayerId = "old_layer";
      m.applySavedConfig({});
      expect(m.selectedLayerId).toBeNull();
    });

    it("ignores undefined borderWeight, keeps current value", () => {
      const m = makeManager();
      m.borderWeight = 2.5;
      m.applySavedConfig({});
      expect(m.borderWeight).toBe(2.5);
    });
  });

  describe("round-trip (save → load → apply)", () => {
    it("restores full configuration after clear", () => {
      const m1 = makeManager();
      m1.selectedLayerId = "r1";
      m1.currentAgg = "avg";
      m1.currentMethod = "heads";
      m1.currentScheme = "Viridis";
      m1.numClasses = 3;
      m1.borderWeight = 0.5;
      m1.borderColor = "#111111";
      m1.currentLabelShow = true;
      m1.currentField = "value";
      m1.fieldAuto = false;
      m1.saveConfig();

      const m2 = makeManager();
      const loaded = m2.loadSavedConfig();
      expect(loaded).not.toBeNull();
      m2.applySavedConfig(loaded!);

      expect(m2.selectedLayerId).toBe("r1");
      expect(m2.currentAgg).toBe("avg");
      expect(m2.currentMethod).toBe("heads");
      expect(m2.currentScheme).toBe("Viridis");
      expect(m2.numClasses).toBe(3);
      expect(m2.borderWeight).toBe(0.5);
      expect(m2.borderColor).toBe("#111111");
      expect(m2.currentLabelShow).toBe(true);
      expect(m2.currentField).toBe("value");
      expect(m2.fieldAuto).toBe(false);
    });

    it("returns defaults when localStorage is empty", () => {
      const m = makeManager();
      const loaded = m.loadSavedConfig();
      expect(loaded).toBeNull();
    });

    it("preserves falsy values (false / 0) through save → load → apply", () => {
      const m1 = makeManager();
      m1.currentLabelShow = false;
      m1.fieldAuto = false;
      m1.borderWeight = 0;
      m1.saveConfig();

      const m2 = makeManager();
      const loaded = m2.loadSavedConfig();
      expect(loaded).not.toBeNull();
      m2.applySavedConfig(loaded!);

      expect(m2.currentLabelShow).toBe(false);
      expect(m2.fieldAuto).toBe(false);
      expect(m2.borderWeight).toBe(0);
    });
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
});

describe("hex label rendering (shared canvas recipe)", () => {
  const makeCtx = () => ({
    font: "",
    textAlign: "",
    textBaseline: "",
    lineJoin: "",
    strokeStyle: "",
    lineWidth: 0,
    fillStyle: "",
    strokeText: vi.fn(),
    fillText: vi.fn(),
  });
  const feat = (centroid: [number, number] | null, value: number) =>
    ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [] },
      properties: { centroid, value },
    }) as never;

  let m: ReturnType<typeof makeManager>;

  beforeEach(() => {
    m = makeManager();
    m.ui = makeCtrl(m);
    (m.map as unknown as { latLngToContainerPoint: unknown }).latLngToContainerPoint =
      vi.fn(() => ({ x: 10, y: 20 }));
  });

  it("resolveLabelStyle reads the shared --label-* tokens and caches them", () => {
    const style = m.resolveLabelStyle();
    expect(style.font).toContain("12px");
    expect(m.resolveLabelStyle()).toBe(style);
  });

  it("drawHexLabel strokes the halo then fills the value at the centroid", () => {
    const ctx = makeCtx();
    const style = m.resolveLabelStyle();

    m.drawHexLabel(
      ctx as unknown as CanvasRenderingContext2D,
      feat([26.08, 119.3], 42),
      style,
    );

    expect(ctx.strokeText).toHaveBeenCalledWith("42", 10, 20);
    expect(ctx.fillText).toHaveBeenCalledWith("42", 10, 20);
  });

  it("drawHexLabel skips a feature without a centroid", () => {
    const ctx = makeCtx();

    m.drawHexLabel(
      ctx as unknown as CanvasRenderingContext2D,
      feat(null, 7),
      m.resolveLabelStyle(),
    );

    expect(ctx.fillText).not.toHaveBeenCalled();
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
      fieldOptions?: () => string[];
    };
  }

  it("createCanvas receives styleProvider, styleSetters and fieldOptions", () => {
    makeManager();
    const opts = getCanvasOpts();
    expect(typeof opts.styleProvider).toBe("function");
    expect(typeof opts.styleSetters?.labelShow).toBe("function");
    expect(typeof opts.styleSetters?.field).toBe("function");
    expect(typeof opts.fieldOptions).toBe("function");
  });

  it("styleProvider returns the live labelShow and field values", () => {
    const m = makeManager();
    const opts = getCanvasOpts();
    // fieldAuto starts true → empty string is the AUTO sentinel.
    expect(opts.styleProvider!()).toEqual({ labelShow: true, field: "" });

    m.currentLabelShow = false;
    m.fieldAuto = false;
    m.currentField = "count";
    expect(opts.styleProvider!()).toEqual({ labelShow: false, field: "count" });
  });

  it("styleProvider reports empty field while fieldAuto is on", () => {
    // Construction / Reset leave fieldAuto on; the drawer must show Auto even
    // when currentField still carries the Python-configured name.
    const m = makeManager();
    m.fieldAuto = true;
    m.currentField = "count";
    const opts = getCanvasOpts();

    expect(opts.styleProvider!().field).toBe("");
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

  it("field setter stores the bare field name", () => {
    const m = makeManager();
    const opts = getCanvasOpts();

    opts.styleSetters!.field!("count");

    expect(m.currentField).toBe("count");
    expect(m.fieldAuto).toBe(false);
  });

  it("field setter strips a legacy properties. prefix", () => {
    const m = makeManager();
    const opts = getCanvasOpts();

    opts.styleSetters!.field!("properties.count");

    expect(m.currentField).toBe("count");
  });

  it("field setter flips state, clears fieldAuto, re-renders and persists", () => {
    const m = makeManager();
    m.fieldAuto = true;
    const renderSpy = vi.spyOn(m, "renderHexagons");
    const saveSpy = vi.spyOn(m, "saveConfig");
    const opts = getCanvasOpts();

    opts.styleSetters!.field!("count");

    expect(m.currentField).toBe("count");
    expect(m.fieldAuto).toBe(false);
    expect(renderSpy).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalled();
  });

  it("field setter with empty string restores auto (Python CONF field)", () => {
    // Empty is the AUTO sentinel — Reset writes it. The setter must restore
    // the construction-time CONF.field snapshot and re-enable auto resolution,
    // not treat it as "clear the field and leave auto off".
    const m = makeManager({ field: "value" });
    m.fieldAuto = false;
    m.currentField = "count";
    const opts = getCanvasOpts();

    opts.styleSetters!.field!("");

    expect(m.currentField).toBe("value");
    expect(m.fieldAuto).toBe(true);
    expect(m.ui?.fieldSelect.value ?? "").toBe("");
  });

  it("styleDefaults returns the Python CONF snapshot for the drawer Reset", () => {
    const m = makeManager();
    const opts = getCanvasOpts() as {
      styleDefaults?: () => Record<string, unknown>;
    };
    expect(typeof opts.styleDefaults).toBe("function");
    // label_show=true in the fixture CONF; empty field is the AUTO sentinel.
    expect(opts.styleDefaults!()).toEqual({ labelShow: true, field: "" });

    // Runtime toggles must not leak into the Reset snapshot.
    m.currentLabelShow = false;
    m.currentField = "sum";
    m.fieldAuto = false;
    expect(opts.styleDefaults!()).toEqual({ labelShow: true, field: "" });
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

  it("labelShow setter syncs ui.labelChk when the panel is attached", () => {
    const m = makeManager();
    const labelChk = document.createElement("input");
    labelChk.type = "checkbox";
    labelChk.checked = true;
    (m as unknown as { ui: { labelChk: HTMLInputElement } }).ui = { labelChk };
    const opts = getCanvasOpts();

    opts.styleSetters!.labelShow!(false);

    expect(labelChk.checked).toBe(false);
  });

  it("field setter syncs ui.fieldSelect when the panel is attached", () => {
    const m = makeManager();
    const fieldSelect = document.createElement("select");
    const opt = document.createElement("option");
    opt.value = "sales";
    fieldSelect.appendChild(opt);
    (m as unknown as { ui: { fieldSelect: HTMLSelectElement } }).ui = {
      fieldSelect,
    };
    const opts = getCanvasOpts();

    opts.styleSetters!.field!("sales");

    expect(fieldSelect.value).toBe("sales");
  });

  it("field setter treats null/undefined as an empty auto-field sentinel", () => {
    const m = makeManager();
    const opts = getCanvasOpts();

    opts.styleSetters!.field!(null);

    // Empty restores the construction-time field and turns auto back on —
    // the path Reset uses.
    expect(m.currentField).toBe("");
    expect(m.fieldAuto).toBe(true);
  });

  it("fieldOptions returns the numeric fields of the selected source layer", () => {
    const m = makeManager();
    m.selectedLayerId = "src1";
    const extractPoints = (
      window.map.foliplus!.LayerAPI as unknown as {
        extractPoints: ReturnType<typeof vi.fn>;
      }
    ).extractPoints;
    extractPoints.mockReturnValue([
      {
        marker: {
          feature: { properties: { count: 5, name: "abc" } },
        },
      },
    ]);
    const opts = getCanvasOpts();
    // Bare field names — the "properties." prefix is stripped for display.
    expect(opts.fieldOptions!()).toEqual(["count"]);
  });

  it("fieldOptions returns empty when no source layer is selected", () => {
    makeManager();
    const opts = getCanvasOpts();
    expect(opts.fieldOptions!()).toEqual([]);
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
    m.fieldAuto = false;
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

  it("uses the auto field when fieldAuto is on", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "pts", name: "Stores", layer: null, count: 1 }];
    m.selectedLayerId = "pts";
    m.currentAgg = "avg";
    m.fieldAuto = true;
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
    m.fieldAuto = false;
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents } from "#core/event/index.js";
import * as CONST from "#foliplus/HeatmapControl/const.js";
import { HeatmapManager } from "#foliplus/HeatmapControl/manager.js";
import { rebuildLayerDropdown } from "#foliplus/HeatmapControl/ui.js";

/** Build a minimal HeatmapManager with all external deps stubbed out. */
function makeManager() {
  window.CONF = {
    ...window.CONF,
    name: "HeatmapControl",
    color_scheme: "Reds",
    method: "jenks",
    n_classes: 6,
    agg: "count",
    field: null,
    fill_opacity: 0.7,
    border_color: "#333333",
    border_weight: 1.5,
    border_opacity: 0.9,
    label_show: true,
    label_format: "auto",
  };

  // Mock h3 and chroma globals
  globalThis.h3 = {
    latLngToCell: vi.fn(() => "abc123"),
    cellToLatLng: vi.fn(() => [26.08, 119.3]),
    cellToBoundary: vi.fn(() => [
      [26.08, 119.3],
      [26.09, 119.3],
      [26.09, 119.31],
      [26.08, 119.31],
      [26.08, 119.3],
    ]),
  };
  globalThis.chroma = {
    scale: vi.fn(() => ({
      mode: vi.fn(() => ({
        colors: vi.fn(() => ["#ff0000", "#00ff00", "#0000ff"]),
      })),
    })),
  };
  globalThis.ss = {
    ckmeans: vi.fn(data => data.map(v => [v])),
    quantileSorted: vi.fn((sorted, q) => sorted[Math.floor(q * (sorted.length - 1))]),
  };

  // Mock LayerAPI (per-map: map.foliplus.LayerAPI)
  window.map.foliplus = {
    LayerAPI: {
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
    },
  };

  const map = {
    getContainer: vi.fn(),
    getBounds: vi.fn(),
    getZoom: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
  const manager = new HeatmapManager(map);
  // Re-stub overlay after constructor (constructor replaces it with createCanvas result)
  manager.overlay = {
    canvas: null,
    ctx: null,
    register: vi.fn(),
    unregister: vi.fn(),
    setVisible: vi.fn(),
    hooks: { before: [], after: [] },
  };
  return manager;
}

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
    expect(fields).toContain("properties.price");
    expect(fields).not.toContain("properties.name");
    expect(fields.filter(f => f === "properties.price")).toHaveLength(1);
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
  it("BEFORE_EXPORT sets renderAll and redraws", () => {
    const m = makeManager();
    m.renderAll = false;
    const redrawSpy = vi.spyOn(m, "redrawHeatmap");
    ensureEvents(m.map).emit(EVENTS.BEFORE_EXPORT, { component: "ExportControl" });
    expect(m.renderAll).toBe(true);
    expect(redrawSpy).toHaveBeenCalled();
  });

  it("AFTER_EXPORT clears renderAll and redraws", () => {
    const m = makeManager();
    m.renderAll = true;
    const redrawSpy = vi.spyOn(m, "redrawHeatmap");
    ensureEvents(m.map).emit(EVENTS.AFTER_EXPORT, { component: "ExportControl" });
    expect(m.renderAll).toBe(false);
    expect(redrawSpy).toHaveBeenCalled();
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
      m.currentField = "properties.price";
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
      expect(stored.field).toBe("properties.price");
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
          expect.stringContaining("Failed to clear saved data"),
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
      expect(m.currentField).toBe("properties.qty");
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
      m1.currentField = "properties.value";
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
      expect(m2.currentField).toBe("properties.value");
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
    vi.spyOn(HeatmapManager.prototype, "scanMapLayers").mockImplementation(function (
      this: HeatmapManager,
    ) {
      // no-op: keep the manually seeded pointLayers
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Build a HeatmapControlUI-shaped stub with all required fields present.
   * These tests exercise buildLayerListItems/initScan, which only touch
   * m/layerSelect/extraBody; the remaining fields exist so the stub satisfies
   * the exported interface and stays resilient to future type-checking. */
  const makeCtrl = (m: HeatmapManager) => {
    const sel = document.createElement("select");
    const emptyInput = document.createElement("input");
    return {
      m,
      ctrl: document.createElement("div"),
      schemeDropdown: null,
      expandHookDone: false,
      observer: null,
      layerSelect: sel,
      extraBody: document.createElement("div"),
      fieldSelect: document.createElement("select"),
      fieldWrap: document.createElement("div"),
      aggSelect: document.createElement("select"),
      methodSelect: document.createElement("select"),
      classSelect: document.createElement("select"),
      schemeControlWrap: document.createElement("div"),
      schemeBar: document.createElement("div"),
      schemeBarInner: document.createElement("div"),
      schemeSelectHidden: document.createElement("select"),
      borderColorInput: emptyInput,
      borderWeightInput: emptyInput,
      labelChk: emptyInput,
      closeSchemeDropdown: () => undefined,
      toggleSchemeDropdown: () => undefined,
    };
  };

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

  const makeCtrl = (m: HeatmapManager) => {
    const sel = document.createElement("select");
    const emptyInput = document.createElement("input");
    return {
      m,
      ctrl: document.createElement("div"),
      schemeDropdown: null,
      expandHookDone: false,
      observer: null,
      layerSelect: sel,
      extraBody: document.createElement("div"),
      fieldSelect: document.createElement("select"),
      fieldWrap: document.createElement("div"),
      aggSelect: document.createElement("select"),
      methodSelect: document.createElement("select"),
      classSelect: document.createElement("select"),
      schemeControlWrap: document.createElement("div"),
      schemeBar: document.createElement("div"),
      schemeBarInner: document.createElement("div"),
      schemeSelectHidden: document.createElement("select"),
      borderColorInput: emptyInput,
      borderWeightInput: emptyInput,
      labelChk: emptyInput,
      closeSchemeDropdown: () => undefined,
      toggleSchemeDropdown: () => undefined,
    };
  };

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

    initScan(ctrl, 3);

    expect(m.hasScanned).toBe(true);
    expect(m.selectedLayerId).toBe("lonely");
    expect(renderSpy).toHaveBeenCalled();
  });

  it("auto-selects a single layer that appears on the init retry", async () => {
    const { initScan } = await import("#foliplus/HeatmapControl/ui.js");
    const m = makeManager();
    // First scan finds nothing; a single layer appears on the retry.  This is
    // still the initial scan phase (hasScanned not yet set), so it auto-selects.
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

    vi.useFakeTimers();
    initScan(ctrl, 2);
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(CONST.TIMING.INIT_SCAN_INTERVAL);
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    expect(m.hasScanned).toBe(true);
    expect(m.selectedLayerId).toBe("late");
  });

  it("sets hasScanned in the terminal no-layer path", async () => {
    const { initScan } = await import("#foliplus/HeatmapControl/ui.js");
    const m = makeManager();
    window.map.foliplus.showHint = vi.fn();
    window.map.foliplus.LayerAPI.isLayerControl = false;
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => []);
    const ctrl = makeCtrl(m);

    vi.useFakeTimers();
    initScan(ctrl, 0); // attempt 0 = no retries, goes straight to the terminal hint
    vi.useRealTimers();

    expect(m.hasScanned).toBe(true);
    expect(m.selectedLayerId).toBeNull();
  });
});

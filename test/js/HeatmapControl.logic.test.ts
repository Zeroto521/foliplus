import * as CONST from "#foliplus/HeatmapControl/HeatmapControl.const.js";
import { HeatmapManager } from "#foliplus/HeatmapControl/HeatmapControl.logic.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Build a minimal HeatmapManager with all external deps stubbed out. */
function makeManager() {
  window.CONF = {
    ...window.CONF,
    name: "HeatmapControl",
    color_scheme: "Reds",
    method: "jenks",
    n_classes: 6,
    agg: "count",
    field: "auto",
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

  // Mock LayerAPI
  window.foliplus.LayerAPI = {
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

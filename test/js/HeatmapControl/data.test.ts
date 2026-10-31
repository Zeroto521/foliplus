// Unit tests for HeatmapControl/data — the pure aggregation helpers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCHEME_FALLBACK_COLOR, getColorScale } from "#core/palette.js";
import * as CONST from "#foliplus/HeatmapControl/const.js";
import {
  aggregateBins,
  aggregateData,
  binPoints,
  buildFeatures,
  getH3Res,
  readMarkerField,
} from "#foliplus/HeatmapControl/data.js";
import type { SelectedPoint } from "#foliplus/HeatmapControl/type.js";
import { createLogger } from "#common/log.js";

const LOG = createLogger("HeatmapControl");

const makePt = (overrides: Partial<SelectedPoint> = {}): SelectedPoint => ({
  lat: 26.08,
  lng: 119.3,
  value: 5,
  marker: {} as L.Marker,
  ...overrides,
});

afterEach(() => {
  delete globalThis.h3;
  delete globalThis.chroma;
  delete globalThis.ss;
});

// The heatmap used to keep a private chroma wrapper; it now shares
// core/palette with the value-based fill. These pin the promise that the
// migration cannot move a color: the chroma call chain is the one the
// retired function used, and the no-chroma fallback is the single grey the
// heatmap border already degraded to.
describe("shared color scale — migration parity", () => {
  it("the no-chroma fallback is the grey the heatmap already used", () => {
    expect(getColorScale("Reds", 4)).toEqual([
      SCHEME_FALLBACK_COLOR,
      SCHEME_FALLBACK_COLOR,
      SCHEME_FALLBACK_COLOR,
      SCHEME_FALLBACK_COLOR,
    ]);
  });

  it("asks chroma the same questions the private wrapper did", () => {
    const colorsSpy = vi.fn(() => ["#a", "#b", "#c"]);
    const modeSpy = vi.fn(() => ({ colors: colorsSpy }));
    const scaleSpy = vi.fn(() => ({ mode: modeSpy }));
    globalThis.chroma = { scale: scaleSpy } as never;

    expect(getColorScale("Viridis", 3)).toEqual(["#a", "#b", "#c"]);
    expect(scaleSpy).toHaveBeenCalledWith("Viridis");
    expect(modeSpy).toHaveBeenCalledWith("lab");
    expect(colorsSpy).toHaveBeenCalledWith(3);
  });
});

describe("getH3Res", () => {
  it("resolves the bin resolution from RES_MAP", () => {
    expect(getH3Res(2)).toBe(0); // RES_MAP[0] = [2, 0]
    expect(getH3Res(5)).toBe(2); // RES_MAP[3] = [5, 2]
    expect(getH3Res(7)).toBe(4); // RES_MAP[5] = [7, 4]
    expect(getH3Res(10)).toBe(6); // RES_MAP[8] = [10, 6]
  });

  it("falls back to RES_FALLBACK beyond the map", () => {
    expect(getH3Res(99)).toBe(CONST.H3.RES_FALLBACK);
  });
});

describe("readMarkerField", () => {
  it("reads the value / options.value contract and bare property keys", () => {
    expect(readMarkerField({ value: 1 } as never, "value")).toBe(1);
    expect(readMarkerField({ options: { value: 2 } } as never, "options.value")).toBe(
      2,
    );
    expect(
      readMarkerField({ feature: { properties: { price: 3 } } } as never, "price"),
    ).toBe(3);
  });

  it("strips the legacy properties. prefix from a dotted field id", () => {
    expect(
      readMarkerField(
        { feature: { properties: { price: 100 } } } as never,
        "properties.price",
      ),
    ).toBe(100);
  });

  it("returns undefined for null or unknown fields", () => {
    expect(readMarkerField({} as never, null)).toBeUndefined();
    expect(readMarkerField({} as never, "missing")).toBeUndefined();
  });

  it("returns undefined for an unknown deep path or a missing property key", () => {
    expect(readMarkerField({} as never, "some.random.path")).toBeUndefined();
    expect(
      readMarkerField(
        { feature: { properties: { foo: 1 } } } as never,
        "properties.bar",
      ),
    ).toBeUndefined();
  });
});

describe("aggregateData", () => {
  beforeEach(() => {
    globalThis.h3 = {
      latLngToCell: vi.fn(() => "cell_a"),
    } as never;
    globalThis.chroma = {
      scale: vi.fn(() => ({
        mode: vi.fn(() => ({
          colors: vi.fn(() => ["#a", "#b"]),
        })),
      })),
    } as never;
    globalThis.ss = {
      ckmeans: vi.fn((data: any) => data.map((v: any) => [v])),
      quantileSorted: vi.fn(),
    } as never;
  });

  it("aggregates with SUM / MIN / MAX / default agg", () => {
    const pts = [makePt({ value: 5 }), makePt({ value: 3 }), makePt({ value: 8 })];
    const sum = aggregateData(pts, 4, "sum", 3, "equal", "Reds", vi.fn(), LOG);
    expect(sum!.getAggValue(sum!.hexCells["cell_a"])).toBe(16);
    const min = aggregateData(pts, 4, "min", 3, "equal", "Reds", vi.fn(), LOG);
    expect(min!.getAggValue(min!.hexCells["cell_a"])).toBe(3);
    const max = aggregateData(pts, 4, "max", 3, "equal", "Reds", vi.fn(), LOG);
    expect(max!.getAggValue(max!.hexCells["cell_a"])).toBe(8);
    const unknown = aggregateData(pts, 4, "bogus", 3, "equal", "Reds", vi.fn(), LOG);
    expect(unknown!.getAggValue(unknown!.hexCells["cell_a"])).toBe(3);
  });

  it("creates one cell per distinct H3 index under COUNT", () => {
    globalThis.h3.latLngToCell = vi.fn(lat => `cell_${lat}`);
    const pts = [makePt({ lat: 26.08 }), makePt({ lat: 26.09 })];
    const result = aggregateData(pts, 4, "count", 6, "equal", "Reds", vi.fn(), LOG);
    expect(result).not.toBeNull();
    expect(Object.keys(result!.hexCells)).toHaveLength(2);
  });

  it("defends a zero-count cell against NaN under AVG", () => {
    const result = aggregateData(
      [makePt({ value: 5 })],
      4,
      "avg",
      6,
      "equal",
      "Reds",
      vi.fn(),
      LOG,
    );
    expect(result!.getAggValue(result!.hexCells["cell_a"])).toBe(5);
    // Defensive: a cell with count 0 returns 0, not NaN.
    expect(result!.getAggValue({ sum: 0, count: 0, min: 0, max: 0 })).toBe(0);
  });

  it("warns and skips a point whose H3 cell conversion throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    globalThis.h3 = {
      latLngToCell: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error("h3 fail");
        })
        .mockImplementation(() => "cell_b"),
    } as never;
    const pts = [makePt({ value: 1 }), makePt({ value: 2 })];
    const result = aggregateData(pts, 4, "count", 3, "equal", "Reds", vi.fn(), LOG);
    expect(result).not.toBeNull();
    expect(Object.keys(result!.hexCells)).toEqual(["cell_b"]);
    warn.mockRestore();
  });

  it("calls onEmpty and returns null for no hex cells", () => {
    const onEmpty = vi.fn();
    const result = aggregateData([], 4, "count", 3, "equal", "Reds", onEmpty, LOG);
    expect(result).toBeNull();
    expect(onEmpty).toHaveBeenCalled();
  });

  it("classifies a value beyond the last break into the final class", () => {
    globalThis.h3.latLngToCell = vi.fn((lat, lng) => {
      if (lat === 26.08 && lng === 119.3) return "cell_a";
      if (lat === 26.09 && lng === 119.4) return "cell_b";
      return "cell_c";
    });
    const pts = [
      makePt({ lat: 26.08, lng: 119.3, value: 1 }),
      makePt({ lat: 26.09, lng: 119.4, value: 1 }),
      makePt({ lat: 26.1, lng: 119.5, value: 1 }),
    ];
    const result = aggregateData(pts, 4, "count", 3, "equal", "Reds", vi.fn(), LOG);
    // Three equal count cells — equal breaks [1,1,1,1]; a value in range maps
    // to class 0, a value beyond all breaks lands in the last class.
    expect(result!.valueToClassIdx(1)).toBe(0);
    expect(result!.valueToClassIdx(99)).toBe(2);
  });

  it("degrades to the equal method when the chosen one needs a missing script", () => {
    // quantile needs the simple-statistics CDN global. On a page that never
    // loaded it the classifier throws the dependency error, and the layer
    // must still render as an equal split instead of throwing out of the
    // method selector's handler.
    delete globalThis.ss;
    globalThis.h3.latLngToCell = vi.fn(lat => `cell_${lat}`);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pts = [makePt({ lat: 26.08 }), makePt({ lat: 26.09 })];
    const result = aggregateData(pts, 4, "count", 3, "quantile", "Reds", vi.fn(), LOG);
    expect(result).not.toBeNull();
    // Two count-1 cells split equally into [1,1,1] - three breaks, so two
    // colors, and a value inside the split stays in class 0 rather than
    // being bisected against an undefined break.
    expect(result!.classColors).toHaveLength(2);
    expect(result!.valueToClassIdx(1)).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      "[HeatmapControl] simple-statistics unavailable, classified with the equal method",
      expect.any(String),
    );
    warn.mockRestore();
  });

  it("rethrows a classifier failure that is not a missing dependency", () => {
    // The script loaded but is broken: a runtime failure, not a page-wide
    // absence, so it must surface instead of silently degrading.
    globalThis.ss = {
      quantileSorted: () => {
        throw new Error("boom");
      },
    } as never;
    globalThis.h3.latLngToCell = vi.fn(lat => `cell_${lat}`);
    const pts = [makePt({ lat: 26.08 }), makePt({ lat: 26.09 })];
    expect(() =>
      aggregateData(pts, 4, "count", 3, "quantile", "Reds", vi.fn(), LOG),
    ).toThrow("boom");
  });
});

describe("buildFeatures", () => {
  beforeEach(() => {
    globalThis.h3 = {
      cellToLatLng: vi.fn(() => [26.08, 119.3]),
      cellToBoundary: vi.fn(() => [
        [26.08, 119.3],
        [26.09, 119.31],
        [26.08, 119.3],
      ]),
    } as never;
  });

  it("builds GeoJSON features from aggregated hex data", () => {
    const aggregated = {
      hexCells: {
        abc: { sum: 10, count: 5, min: 1, max: 5 },
        def: { sum: 20, count: 8, min: 2, max: 6 },
      },
      getAggValue: (cell: any) => cell.count,
      valueToClassIdx: (val: any) => Math.min(val - 1, 0),
      classColors: ["#ff0000", "#00ff00"],
    };
    const features = buildFeatures(aggregated, LOG);
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
    expect(buildFeatures(aggregated, LOG)).toEqual([]);
  });

  it("computes the centroid from the boundary ring when h3.cellToLatLng fails", () => {
    globalThis.h3.cellToLatLng = vi.fn(() => {
      throw new Error("no centroid");
    });
    globalThis.h3.cellToBoundary = vi.fn(() => [
      [0, 0],
      [0, 2],
      [2, 2],
      [2, 0],
      [0, 0],
    ]);
    const feats = buildFeatures(
      {
        hexCells: { abc: { sum: 1, count: 1, min: 1, max: 1 } },
        getAggValue: c => c.count,
        valueToClassIdx: () => 0,
        classColors: ["#ff0000"],
      },
      LOG,
    );
    expect(feats).toHaveLength(1);
    // Centroid falls back to the ring centroid [cy/(n-1), cx/(n-1)] over
    // coords = [[0,0],[2,0],[2,2],[0,2],[0,0]]: cy = 0+0+2+2+0 = 4,
    // cx = 0+2+2+0+0 = 4, n-1 = 5.
    expect(feats[0].properties.centroid).toEqual([4 / 5, 4 / 5]);
  });

  it("warns and skips a cell whose boundary conversion throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    globalThis.h3.cellToBoundary = vi.fn(() => {
      throw new Error("boundary fail");
    });
    const feats = buildFeatures(
      {
        hexCells: { x: { sum: 1, count: 1, min: 1, max: 1 } },
        getAggValue: () => 1,
        valueToClassIdx: () => 0,
        classColors: ["#a"],
      },
      LOG,
    );
    expect(feats).toHaveLength(0);
    warn.mockRestore();
  });
});

describe("binPoints", () => {
  beforeEach(() => {
    globalThis.h3 = { latLngToCell: vi.fn(() => "cell_a") } as never;
  });

  it("groups points by h3 index, preserving encounter order within a cell", () => {
    globalThis.h3.latLngToCell = vi.fn(lat => `cell_${lat}`);
    const pts = [
      makePt({ lat: 1 }),
      makePt({ lat: 2 }),
      makePt({ lat: 1 }),
      makePt({ lat: 2 }),
    ];
    const bins = binPoints(pts, 4, LOG);
    expect(bins).toEqual(
      new Map([
        ["cell_1", [0, 2]],
        ["cell_2", [1, 3]],
      ]),
    );
  });

  it("skips a point whose h3 conversion throws and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    globalThis.h3 = {
      latLngToCell: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error("h3 fail");
        })
        .mockImplementation(() => "cell_ok"),
    } as never;
    const bins = binPoints([makePt({ value: 1 }), makePt({ value: 2 })], 4, LOG);
    expect(bins).toEqual(new Map([["cell_ok", [1]]]));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("returns an empty map for an empty input", () => {
    expect(binPoints([], 4, LOG)).toEqual(new Map());
  });
});

describe("aggregateBins", () => {
  it("computes sum / count / min / max per cell", () => {
    const pts = [makePt({ value: 5 }), makePt({ value: 3 }), makePt({ value: 8 })];
    const bins = new Map([["cell_a", [0, 1, 2]]]);
    const cells = aggregateBins(bins, pts);
    expect(cells.get("cell_a")).toEqual({ sum: 16, count: 3, min: 3, max: 8 });
  });

  it("supports multiple cells", () => {
    const pts = [makePt({ value: 1 }), makePt({ value: 2 }), makePt({ value: 4 })];
    const bins = new Map([
      ["cell_a", [0, 1]],
      ["cell_b", [2]],
    ]);
    const cells = aggregateBins(bins, pts);
    expect(cells).toEqual(
      new Map([
        ["cell_a", { sum: 3, count: 2, min: 1, max: 2 }],
        ["cell_b", { sum: 4, count: 1, min: 4, max: 4 }],
      ]),
    );
  });

  it("skips a bin whose index list is empty (a filter can empty a cell)", () => {
    const pts = [makePt({ value: 1 })];
    const bins = new Map([
      ["cell_a", []],
      ["cell_b", [0]],
    ]);
    const cells = aggregateBins(bins, pts);
    expect(cells.has("cell_a")).toBe(false);
    expect(cells.get("cell_b")).toEqual({ sum: 1, count: 1, min: 1, max: 1 });
  });

  it("never calls h3 — the geometry is upstream, this is pure arithmetic", () => {
    // The whole point of the split: a filter change that keeps the bins
    // but changes the points runs aggregateBins alone, so spying on h3
    // confirms the call path stays away from the geometry.
    const h3Calls = vi.fn();
    globalThis.h3 = { latLngToCell: h3Calls } as never;
    const pts = [makePt({ value: 1 }), makePt({ value: 2 })];
    aggregateBins(new Map([["cell_a", [0, 1]]]), pts);
    expect(h3Calls).not.toHaveBeenCalled();
  });
});

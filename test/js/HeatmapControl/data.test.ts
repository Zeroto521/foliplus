// Unit tests for HeatmapControl/data — the pure aggregation helpers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/HeatmapControl/const.js";
import {
  aggregateData,
  buildFeatures,
  computeBreaks,
  getColorScale,
  getH3Res,
  pickAutoField,
  readMarkerField,
} from "#foliplus/HeatmapControl/data.js";
import type { SelectedPoint } from "#foliplus/HeatmapControl/type.js";

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

describe("pickAutoField", () => {
  it("picks the first field", () => {
    expect(pickAutoField(["a", "b"])).toBe("a");
  });

  it("returns null for empty or null fields", () => {
    expect(pickAutoField([])).toBeNull();
    expect(pickAutoField(null)).toBeNull();
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

describe("getColorScale", () => {
  it("builds a chroma scale with n colors when available", () => {
    globalThis.chroma = {
      scale: vi.fn(() => ({
        mode: vi.fn(() => ({
          colors: vi.fn(() => ["#a", "#b"]),
        })),
      })),
    } as never;
    expect(getColorScale("Reds", 2)).toEqual(["#a", "#b"]);
    expect(globalThis.chroma.scale).toHaveBeenCalledWith("Reds");
  });

  it("falls back to GRAY when chroma is absent", () => {
    expect(getColorScale("Reds", 3)).toEqual([CONST.GRAY, CONST.GRAY, CONST.GRAY]);
  });
});

describe("computeBreaks", () => {
  beforeEach(() => {
    globalThis.ss = {
      ckmeans: vi.fn(),
      quantileSorted: vi.fn((sorted, q) => sorted[Math.floor(q * (sorted.length - 1))]),
    } as never;
  });

  it("returns [lo, hi] when ckmeans throws", () => {
    (globalThis.ss.ckmeans as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("jenks failed");
    });
    expect(computeBreaks([1, 2, 3, 4, 5], 3, "jenks")).toEqual([1, 5]);
  });

  it("builds breaks from ckmeans clusters on success", () => {
    (globalThis.ss.ckmeans as ReturnType<typeof vi.fn>).mockImplementation(() => [
      [1, 2],
      [3, 4],
      [5],
    ]);
    expect(computeBreaks([1, 2, 3, 4, 5], 3, "jenks")).toEqual([1, 2, 4, 5]);
  });

  it("returns [lo, hi] for data with 2 elements", () => {
    expect(computeBreaks([1, 10], 5, "jenks")).toEqual([1, 10]);
  });

  it("returns [lo, hi] for single-element data across methods", () => {
    expect(computeBreaks([42], 3, "equal")).toEqual([42, 42]);
    expect(computeBreaks([42], 3, "quantile")).toEqual([42, 42]);
    expect(computeBreaks([42], 3, "heads")).toEqual([42, 42]);
  });

  it("uses equal intervals for 'equal' method", () => {
    const breaks = computeBreaks([0, 10, 20, 30, 40], 4, "equal");
    expect(breaks[0]).toBe(0);
    expect(breaks[breaks.length - 1]).toBe(40);
    expect(breaks.length).toBe(5); // nClasses + 1
  });

  it("limits nClasses to min(nClasses, data length)", () => {
    expect(computeBreaks([1, 2], 2, "equal")).toEqual([1, 2]);
  });

  it("returns sorted breaks for quantile and heads methods", () => {
    const quantile = computeBreaks([1, 2, 3, 4, 5, 6], 3, "quantile");
    expect(quantile[0]).toBe(1);
    expect(quantile[quantile.length - 1]).toBe(6);
    const heads = computeBreaks([1, 2, 3, 4, 5, 6], 3, "heads");
    expect(heads[0]).toBe(1);
    expect(heads[heads.length - 1]).toBe(6);
  });

  it("returns empty for empty data", () => {
    expect(computeBreaks([], 3, "equal")).toEqual([]);
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
      ckmeans: vi.fn(data => data.map(v => [v])),
      quantileSorted: vi.fn(),
    } as never;
  });

  it("aggregates with SUM / MIN / MAX / default agg", () => {
    const pts = [makePt({ value: 5 }), makePt({ value: 3 }), makePt({ value: 8 })];
    const sum = aggregateData(pts, 4, "sum", 3, "equal", "Reds", vi.fn());
    expect(sum!.getAggValue(sum!.hexCells["cell_a"])).toBe(16);
    const min = aggregateData(pts, 4, "min", 3, "equal", "Reds", vi.fn());
    expect(min!.getAggValue(min!.hexCells["cell_a"])).toBe(3);
    const max = aggregateData(pts, 4, "max", 3, "equal", "Reds", vi.fn());
    expect(max!.getAggValue(max!.hexCells["cell_a"])).toBe(8);
    const unknown = aggregateData(pts, 4, "bogus", 3, "equal", "Reds", vi.fn());
    expect(unknown!.getAggValue(unknown!.hexCells["cell_a"])).toBe(3);
  });

  it("creates one cell per distinct H3 index under COUNT", () => {
    globalThis.h3.latLngToCell = vi.fn(lat => `cell_${lat}`);
    const pts = [makePt({ lat: 26.08 }), makePt({ lat: 26.09 })];
    const result = aggregateData(pts, 4, "count", 6, "equal", "Reds", vi.fn());
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
    const result = aggregateData(pts, 4, "count", 3, "equal", "Reds", vi.fn());
    expect(result).not.toBeNull();
    expect(Object.keys(result!.hexCells)).toEqual(["cell_b"]);
    warn.mockRestore();
  });

  it("calls onEmpty and returns null for no hex cells", () => {
    const onEmpty = vi.fn();
    const result = aggregateData([], 4, "count", 3, "equal", "Reds", onEmpty);
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
    const result = aggregateData(pts, 4, "count", 3, "equal", "Reds", vi.fn());
    // Three equal count cells → equal breaks [1,1,1,1]; a value in range maps
    // to class 0, a value beyond all breaks lands in the last class.
    expect(result!.valueToClassIdx(1)).toBe(0);
    expect(result!.valueToClassIdx(99)).toBe(2);
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
      getAggValue: cell => cell.count,
      valueToClassIdx: val => Math.min(val - 1, 0),
      classColors: ["#ff0000", "#00ff00"],
    };
    const features = buildFeatures(aggregated);
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
    expect(buildFeatures(aggregated)).toEqual([]);
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
    const feats = buildFeatures({
      hexCells: { abc: { sum: 1, count: 1 } },
      getAggValue: c => c.count,
      valueToClassIdx: () => 0,
      classColors: ["#ff0000"],
    });
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
    const feats = buildFeatures({
      hexCells: { x: { sum: 1, count: 1, min: 1, max: 1 } },
      getAggValue: () => 1,
      valueToClassIdx: () => 0,
      classColors: ["#a"],
    });
    expect(feats).toHaveLength(0);
    warn.mockRestore();
  });
});

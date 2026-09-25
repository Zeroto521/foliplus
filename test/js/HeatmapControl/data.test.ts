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
  it("resolves the bin resolution for a zoom level", () => {
    expect(getH3Res(2)).toBe(0);
    expect(getH3Res(7)).toBe(4);
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

  it("returns undefined for null or unknown fields", () => {
    expect(readMarkerField({} as never, null)).toBeUndefined();
    expect(readMarkerField({} as never, "missing")).toBeUndefined();
  });
});

describe("getColorScale", () => {
  it("builds a chroma scale when available", () => {
    globalThis.chroma = {
      scale: vi.fn(() => ({
        mode: vi.fn(() => ({
          colors: vi.fn(() => ["#a", "#b"]),
        })),
      })),
    } as never;
    expect(getColorScale("Reds", 2)).toEqual(["#a", "#b"]);
  });

  it("falls back to GRAY when chroma is absent", () => {
    expect(getColorScale("Reds", 2)).toEqual([CONST.GRAY, CONST.GRAY]);
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

  it("builds a feature with a computed centroid fallback", () => {
    globalThis.h3.cellToLatLng = vi.fn(() => {
      throw new Error("no centroid");
    });
    const feats = buildFeatures({
      hexCells: { x: { sum: 1, count: 1, min: 1, max: 1 } },
      getAggValue: () => 1,
      valueToClassIdx: () => 0,
      classColors: ["#a"],
    });
    expect(feats).toHaveLength(1);
    // Centroid falls back to the ring centroid (not null) when cellToLatLng throws.
    expect(feats[0].properties.centroid).not.toBeNull();
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

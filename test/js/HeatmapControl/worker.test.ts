// The aggregation that runs offscreen — exercised here directly, since the
// worker boundary itself (blob URL + Worker) is covered in manager.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aggregate, computeBreaks } from "#foliplus/HeatmapControl/worker/aggregate.js";
import type { AggregateMessage, H3Api } from "#foliplus/HeatmapControl/worker/types.js";

/** h3 stub with independently-addressable cells.  ``latLngToCell`` derives the
 *  cell index from the lat so a caller can place two points in the same cell
 *  without touching ``lng``. */
const makeH3 = (overrides: Partial<H3Api> = {}): H3Api => ({
  latLngToCell: (lat, lng, res) => `c${Math.round(lat * 100)}`,
  cellToLatLng: () => [26.08, 119.3],
  cellToBoundary: () => [
    [26.08, 119.3],
    [26.09, 119.3],
    [26.09, 119.31],
    [26.08, 119.31],
    [26.08, 119.3],
  ],
  ...overrides,
});

const msg = (over: Partial<AggregateMessage> = {}): AggregateMessage => ({
  pts: [{ lat: 26.08, lng: 119.3, value: 1 }],
  res: 2,
  agg: "count",
  method: "equal",
  numClasses: 4,
  classColors: ["#ff0000", "#00ff00"],
  seq: 1,
  ...over,
});

afterEach(() => {
  delete globalThis.ss;
});

describe("computeBreaks", () => {
  it("returns [] for empty data", () => {
    expect(computeBreaks([], 5, "equal")).toEqual([]);
  });

  it("collapses to [lo, hi] for two or fewer values", () => {
    expect(computeBreaks([42], 3, "equal")).toEqual([42, 42]);
    expect(computeBreaks([1, 10], 5, "equal")).toEqual([1, 10]);
  });

  it("clamps nClasses to the data length and to a floor of 3", () => {
    expect(computeBreaks([1, 2], 2, "equal")).toEqual([1, 2]);
    expect(computeBreaks([0, 10, 20, 30, 40], 4, "equal")).toEqual([0, 10, 20, 30, 40]);
  });

  it("quantile uses ss.quantileSorted and falls back to index math", () => {
    globalThis.ss = {
      quantileSorted: (sorted: number[], q: number) =>
        sorted[Math.floor(q * (sorted.length - 1))],
      ckmeans: vi.fn(),
    };
    const d = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(computeBreaks(d, 3, "quantile")).toEqual([1, 4, 7, 10]);
    delete globalThis.ss;
    expect(computeBreaks(d, 3, "quantile")).toEqual([1, 4, 7, 10]);
  });

  it("heads uses head-based intervals", () => {
    expect(computeBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, "heads")).toEqual([
      1, 3, 6, 8, 10,
    ]);
  });

  it("jenks uses ss.ckmeans and degrades to [lo, hi] when ss is gone", () => {
    globalThis.ss = {
      ckmeans: vi.fn(() => [[1], [5], [10]]),
      quantileSorted: vi.fn(),
    };
    // clusters[0][0] plus each cluster's max — the first cluster's min and
    // max coincide, so its edge appears twice.
    expect(computeBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, "jenks")).toEqual([
      1, 1, 5, 10,
    ]);
    delete globalThis.ss;
    expect(computeBreaks([1, 2, 3, 4, 5], 3, "jenks")).toEqual([1, 5]);
  });

  it("jenks falls through when ckmeans throws", () => {
    globalThis.ss = {
      ckmeans: vi.fn(() => {
        throw new Error("cluster failure");
      }),
      quantileSorted: vi.fn(),
    };
    expect(computeBreaks([1, 2, 3, 4, 5], 3, "jenks")).toEqual([1, 5]);
  });
});

describe("aggregate", () => {
  it("returns [] when there are no points", () => {
    expect(aggregate(msg({ pts: [] }), makeH3())).toEqual([]);
  });

  it("returns [] when every point is unconvertible", () => {
    const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      aggregate(msg(), {
        ...makeH3(),
        latLngToCell: () => {
          throw new Error("bad cell");
        },
      }),
    ).toEqual([]);
    warnSpy.mockRestore();
  });

  it("groups points by cell and applies the requested aggregation", () => {
    const pts = [
      { lat: 26.08, lng: 119.3, value: 5 },
      { lat: 26.08, lng: 119.4, value: 10 },
      { lat: 26.09, lng: 119.3, value: 2 },
    ];
    const cells = { 5: 0, 10: 0, 2: 0 } as Record<string, number>;
    const h3: H3Api = {
      latLngToCell: lat => {
        const idx = `c${Math.round(lat * 100)}`;
        return idx;
      },
      cellToLatLng: () => [26.08, 119.3],
      cellToBoundary: () => [
        [26.08, 119.3],
        [26.09, 119.3],
        [26.09, 119.31],
        [26.08, 119.31],
      ],
    };
    const feats = aggregate(msg({ pts, agg: "count" }), h3);
    expect(feats).toHaveLength(2);
    const byCell = Object.fromEntries(feats.map(f => [f.properties.h3, f]));
    expect(byCell["c2608"].properties.value).toBe(2);
    expect(byCell["c2609"].properties.value).toBe(1);
    // Aggregation is recomputed per kind.
    expect(
      aggregate(msg({ pts, agg: "sum" }), h3).find(f => f.properties.h3 === "c2608")
        .properties.value,
    ).toBe(15);
    expect(
      aggregate(msg({ pts, agg: "avg" }), h3).find(f => f.properties.h3 === "c2608")
        .properties.value,
    ).toBe(7.5);
    expect(
      aggregate(msg({ pts, agg: "min" }), h3).find(f => f.properties.h3 === "c2608")
        .properties.value,
    ).toBe(5);
    expect(
      aggregate(msg({ pts, agg: "max" }), h3).find(f => f.properties.h3 === "c2608")
        .properties.value,
    ).toBe(10);
  });

  it("emits a closed Polygon ring in GeoJSON [lng, lat] order", () => {
    const feats = aggregate(msg(), makeH3());
    const ring = feats[0].geometry.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    // The boundary stub is [lat, lng]; the ring must be [lng, lat].
    expect(ring[0]).toEqual([119.3, 26.08]);
    expect(ring[1]).toEqual([119.3, 26.09]);
  });

  it("derives the centroid from the boundary when cellToLatLng fails", () => {
    const feats = aggregate(msg({ pts: [{ lat: 27.03, lng: 119.3, value: 1 }] }), {
      ...makeH3(),
      cellToLatLng: () => {
        throw new Error("no centroid");
      },
      cellToBoundary: () => [
        [0, 0],
        [0, 2],
        [2, 2],
        [2, 0],
      ],
    });
    expect(feats).toHaveLength(1);
    // Over the non-closing points: cy = 0+0+2+2 = 4, cx = 0+2+2+0 = 4, n = 4.
    expect(feats[0].properties.centroid).toEqual([1, 1]);
  });

  it("skips a cell whose boundary cannot be read", () => {
    let seen = 0;
    const feats = aggregate(msg({ pts: [{ lat: 27.04, lng: 119.3, value: 1 }] }), {
      ...makeH3(),
      cellToBoundary: () => {
        seen++;
        throw new Error("no boundary");
      },
    });
    expect(feats).toEqual([]);
    expect(seen).toBeGreaterThan(0);
  });

  it("assigns classIdx and fillColor from the requested classes", () => {
    // Values 1, 7, 12, 20 land in successive equal-width bins [1,5.75,10.5,15.25,20];
    // the top value sits exactly on the last break and clamps to the final class.
    const feats = aggregate(
      msg({
        pts: [
          { lat: 27.11, lng: 119.3, value: 1 },
          { lat: 27.12, lng: 119.3, value: 7 },
          { lat: 27.13, lng: 119.3, value: 12 },
          { lat: 27.14, lng: 119.3, value: 20 },
        ],
        agg: "sum",
        numClasses: 4,
        classColors: ["#ff0000", "#00ff00", "#0000ff", "#ffff00"],
      }),
      makeH3(),
    );
    expect(feats).toHaveLength(4);
    expect(feats.map(f => f.properties.classIdx)).toEqual([0, 1, 2, 3]);
    feats.forEach(f =>
      expect(f.properties.fillColor).toBe(
        ["#ff0000", "#00ff00", "#0000ff", "#ffff00"][f.properties.classIdx],
      ),
    );
  });

  it("falls back to #999 when the color scale is shorter than the classes", () => {
    const feats = aggregate(
      msg({
        pts: [
          { lat: 27.21, lng: 119.3, value: 1 },
          { lat: 27.22, lng: 119.3, value: 7 },
          { lat: 27.23, lng: 119.3, value: 12 },
          { lat: 27.24, lng: 119.3, value: 20 },
        ],
        agg: "sum",
        numClasses: 4,
        classColors: ["#ff0000", "#00ff00", "#0000ff"],
      }),
      makeH3(),
    );
    expect(feats.map(f => f.properties.classIdx)).toEqual([0, 1, 2, 3]);
    expect(feats[3].properties.fillColor).toBe("#999");
    expect(feats.slice(0, 3).map(f => f.properties.fillColor)).toEqual([
      "#ff0000",
      "#00ff00",
      "#0000ff",
    ]);
  });

  it("caches geometry per cell — cellToBoundary is called once per cell", () => {
    const seen: number[] = [];
    const h3: H3Api = {
      latLngToCell: lat => {
        seen.push(Math.round(lat * 100));
        return `c${Math.round(lat * 100)}`;
      },
      cellToLatLng: () => [26.08, 119.3],
      cellToBoundary: () => [
        [26.08, 119.3],
        [26.09, 119.3],
        [26.09, 119.31],
        [26.08, 119.31],
      ],
    };
    const pts = [
      { lat: 26.08, lng: 119.3, value: 1 },
      { lat: 26.08, lng: 119.4, value: 1 },
      { lat: 26.08, lng: 119.5, value: 1 },
    ];
    const feats = aggregate(msg({ pts }), h3);
    expect(feats).toHaveLength(1);
  });
});

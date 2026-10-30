// Unit tests for core/classify — the shared value-classification breaks.
// The `ss` global is injected by the build; tests stub it here the same way
// the old HeatmapControl/data.test.ts did.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLASS_COUNT,
  CLASS_COUNT_VALUES,
  ClassifyMethodError,
  METHOD,
  METHOD_ORDER,
  computeBreaks,
  isClassifyMethod,
} from "#core/classify.js";

afterEach(() => {
  delete globalThis.ss;
});

describe("METHOD", () => {
  it("defines standard classification methods", () => {
    expect(METHOD.JENKS).toBe("jenks");
    expect(METHOD.QUANTILE).toBe("quantile");
    expect(METHOD.EQUAL).toBe("equal");
    expect(METHOD.HEADS).toBe("heads");
  });
});

describe("isClassifyMethod", () => {
  it("accepts exactly the four implemented methods", () => {
    expect(isClassifyMethod("jenks")).toBe(true);
    expect(isClassifyMethod("quantile")).toBe(true);
    expect(isClassifyMethod("equal")).toBe(true);
    expect(isClassifyMethod("heads")).toBe(true);
  });

  it("rejects an unknown name, padding and the wrong case", () => {
    // A method is a protocol token, not a property key: the classifier used to
    // send every unmatched string down the equal arm, so a record could claim
    // one algorithm while the map ran another.
    expect(isClassifyMethod("bogus")).toBe(false);
    expect(isClassifyMethod(" equal ")).toBe(false);
    expect(isClassifyMethod("EQUAL")).toBe(false);
    expect(isClassifyMethod("heads ")).toBe(false);
    expect(isClassifyMethod("")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isClassifyMethod(undefined)).toBe(false);
    expect(isClassifyMethod(null)).toBe(false);
    expect(isClassifyMethod(1)).toBe(false);
    expect(isClassifyMethod({})).toBe(false);
    expect(isClassifyMethod(["equal"])).toBe(false);
  });
});

describe("computeBreaks — the closed method protocol", () => {
  beforeEach(() => {
    globalThis.ss = {
      ckmeans: vi.fn(() => [[1, 2], [3]]),
      quantileSorted: vi.fn(
        (sorted: number[], q: number) => sorted[Math.floor(q * (sorted.length - 1))],
      ),
    } as never;
  });

  it("throws a ClassifyMethodError instead of running the equal split", () => {
    // The old trailing arm made every unmatched string an equal split, which
    // silently changed what a stale record meant.
    expect(() => computeBreaks([1, 2, 3], 2, "bogus" as never)).toThrow(
      ClassifyMethodError,
    );
    expect(() => computeBreaks([1, 2, 3], 2, " equal " as never)).toThrow(
      ClassifyMethodError,
    );
  });

  it("validates the method even when there is nothing to classify", () => {
    // The contract is about the config, not the sample: a caller must not
    // learn the method is unrecognised only once the layer has values.
    expect(() => computeBreaks([], 2, "bogus" as never)).toThrow(ClassifyMethodError);
  });

  it("still computes all four implemented methods", () => {
    for (const method of [METHOD.EQUAL, METHOD.HEADS, METHOD.QUANTILE, METHOD.JENKS]) {
      expect(computeBreaks([1, 2, 3], 2, method)).toHaveLength(3);
    }
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
    expect(breaks.length).toBe(5); // numClasses + 1
  });

  it("limits numClasses to min(numClasses, data length)", () => {
    expect(computeBreaks([1, 2], 2, "equal")).toEqual([1, 1.5, 2]);
  });

  it("builds two classes for two values: only a single value collapses", () => {
    // `n === 1` is the only degenerate sample. Two values still split into two
    // classes, and a request for more classes than values is capped at n - the
    // old `n <= 2` shortcut forced one class and left a color scale that was
    // told to expect two with no second color to draw.
    expect(computeBreaks([1, 2], 3, "equal")).toEqual([1, 1.5, 2]);
    expect(computeBreaks([1, 2], 9, "equal")).toEqual([1, 1.5, 2]);
  });

  it("builds exactly two classes when two are requested", () => {
    // The picker's own contract is 2-9, so a two-class request must build two
    // classes. Forcing three made the caller's color scale — asked for the
    // two classes it was told — run out of colors for the third.
    expect(computeBreaks([1, 2, 3, 4, 5, 6], 2, "equal")).toEqual([1, 3.5, 6]);
    expect(computeBreaks([1, 2, 3, 4, 5, 6], 2, "quantile")).toEqual([1, 3, 6]);
    expect(computeBreaks([1, 2, 3, 4, 5, 6], 2, "heads")).toEqual([1, 4, 6]);
  });

  it("jenks builds two clusters when two classes are requested", () => {
    (globalThis.ss.ckmeans as ReturnType<typeof vi.fn>).mockImplementation(() => [
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(computeBreaks([1, 2, 3, 4, 5, 6], 2, "jenks")).toEqual([1, 3, 6]);
  });

  it("never returns more classes than the caller asked for", () => {
    // The caller caps its own count at the value count before calling, and the
    // classifier must not then round it back up: one side rounding changes the
    // color count the other side was handed.
    for (const n of [3, 4, 5, 9]) {
      const values = Array.from({ length: n }, (_, i) => i);
      expect(computeBreaks(values, 2, "equal").length, "n=" + n).toBe(3);
    }
  });

  it("keeps three classes when three are requested", () => {
    // The floor moved from three to two, not away from three.
    expect(computeBreaks([1, 2, 3, 4, 5, 6], 3, "equal").length).toBe(4);
    // Nine asked for six values: capped by the sample, not by the floor.
    expect(computeBreaks([1, 2, 3, 4, 5, 6], 9, "equal").length).toBe(7); // capped by n
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
describe("shared picker vocabulary", () => {
  it("METHOD_ORDER lists every method once, in display order", () => {
    expect(METHOD_ORDER).toEqual(["jenks", "quantile", "equal", "heads"]);
    expect(new Set(METHOD_ORDER).size).toBe(METHOD_ORDER.length);
  });

  it("CLASS_COUNT bounds and values agree", () => {
    expect(CLASS_COUNT).toEqual({ MIN: 2, MAX: 9, DEFAULT: 6 });
    expect(CLASS_COUNT_VALUES).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(CLASS_COUNT_VALUES[0]).toBe(CLASS_COUNT.MIN);
    expect(CLASS_COUNT_VALUES[CLASS_COUNT_VALUES.length - 1]).toBe(CLASS_COUNT.MAX);
    expect(CLASS_COUNT_VALUES).toContain(CLASS_COUNT.DEFAULT);
  });
});

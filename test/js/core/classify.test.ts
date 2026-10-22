// Unit tests for core/classify — the shared value-classification breaks.
// The `ss` global is injected by the build; tests stub it here the same way
// the old HeatmapControl/data.test.ts did.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { METHOD, computeBreaks } from "#core/classify.js";

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
    expect(computeBreaks([1, 2], 2, "equal")).toEqual([1, 2]);
  });

  it("builds exactly two classes when two are requested", () => {
    // The picker's own contract is 2-9, so a two-class request must build two
    // classes. Forcing three made the caller's colour scale — asked for the
    // two classes it was told — run out of colours for the third.
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
    // colour count the other side was handed.
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

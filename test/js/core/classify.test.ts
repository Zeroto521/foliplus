// Unit tests for core/classify — the shared value-classification breaks.
// The `ss` global is injected by the build; tests stub it here the same way
// the old HeatmapControl/data.test.ts did.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeBreaks } from "#core/classify.js";

afterEach(() => {
  delete globalThis.ss;
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

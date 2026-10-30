// Unit tests for core/ramp — the shared value → color ramp
// (breaks + scheme colors + the value → class bisection).
import { afterEach, describe, expect, it, vi } from "vitest";
import { METHOD, computeBreaks } from "#core/classify.js";
import { SCHEME_FALLBACK_COLOR } from "#core/palette.js";
import { buildCategoryRamp, buildRamp, colorFor } from "#core/ramp.js";

// `computeBreaks` is spied rather than called through so one test can feed
// buildRamp the single-boundary answer the real classifier never gives: a
// non-empty input yields two breaks or more, and the empty case short-
// circuits before `classOf` is reachable. The default is the real
// implementation, so the other tests are untouched.
vi.mock("#core/classify.js", async importOriginal => {
  const actual = await importOriginal<typeof import("#core/classify.js")>();
  return { ...actual, computeBreaks: vi.fn(actual.computeBreaks) };
});

afterEach(() => {
  vi.clearAllMocks();
  delete globalThis.chroma;
});

/** Install a chroma stub that hands back at most the requested number of the
 *  fixed color list — counting the request is what `buildRamp` must get
 *  right, so the stub honours it rather than ignoring it. Passing one color
 *  for a multi-class ramp forces the out-of-bounds fallback. */
const installChroma = (colors: string[]): void => {
  globalThis.chroma = {
    scale: () => ({
      mode: () => ({
        colors: (count: number) => colors.slice(0, Math.max(0, count)),
      }),
    }),
  } as never;
};

const EQUAL: { method: typeof METHOD.EQUAL; classes: number; scheme: string } = {
  method: METHOD.EQUAL,
  classes: 3,
  scheme: "Reds",
};

describe("buildRamp", () => {
  it("requests colors for the break span, not the raw class count", () => {
    const colorsSpy = vi.fn(() => ["#1", "#2", "#3"]);
    const scaleSpy = vi.fn(() => ({ mode: () => ({ colors: colorsSpy }) }));
    globalThis.chroma = { scale: scaleSpy } as never;

    const ramp = buildRamp([1, 5, 9], EQUAL);

    // 3 classes is 4 breaks, so the scale is asked for 3 colors.
    expect(ramp.colors).toEqual(["#1", "#2", "#3"]);
    expect(scaleSpy).toHaveBeenCalledWith("Reds");
    expect(colorsSpy).toHaveBeenCalledWith(3);
  });

  it("returns monotone non-decreasing breaks covering the input range", () => {
    const ramp = buildRamp([9, 1, 5], EQUAL);

    expect(ramp.breaks[0]).toBe(1);
    expect(ramp.breaks[ramp.breaks.length - 1]).toBe(9);
    for (let i = 1; i < ramp.breaks.length; i++) {
      expect(ramp.breaks[i]).toBeGreaterThanOrEqual(ramp.breaks[i - 1]);
    }
  });

  it("caps the class count at the number of values", () => {
    installChroma(["#1", "#2"]);

    // 9 requested classes over 2 values degrades to 2 classes: breaks is
    // `classes + 1`, so 3 breaks and 2 colors. Only a single value would
    // collapse the ramp to one class.
    const ramp = buildRamp([1, 9], { ...EQUAL, classes: 9 });

    expect(ramp.breaks).toHaveLength(3);
    expect(ramp.colors).toHaveLength(2);
    expect(ramp.classOf(1)).toBe(0);
    expect(ramp.classOf(9)).toBe(1);
  });

  it("classOf bisects: a value on a break takes the lower class", () => {
    // Bisection rather than a linear scan, so a value exactly on a break
    // lands in the class below it and one past the final break keeps the
    // last class instead of running off the color table.
    installChroma(["#1", "#2"]);
    const ramp = buildRamp([0, 10], { ...EQUAL, classes: 2 });
    expect(ramp.breaks).toEqual([0, 5, 10]);
    expect(ramp.classOf(-99)).toBe(0);
    expect(ramp.classOf(0)).toBe(0);
    expect(ramp.classOf(4.999)).toBe(0);
    expect(ramp.classOf(5)).toBe(0);
    expect(ramp.classOf(5.001)).toBe(1);
    expect(ramp.classOf(10)).toBe(1);
    expect(ramp.classOf(1e9)).toBe(1);
  });

  it("yields an empty ramp for empty input rather than throwing", () => {
    const ramp = buildRamp([], EQUAL);

    expect(ramp.breaks).toEqual([]);
    expect(ramp.colors).toEqual([]);
    expect(ramp.classOf(1)).toBe(0);
  });

  it("does not ask the palette when there is nothing to classify", () => {
    // Real chroma answers a zero-color request with the scheme's two
    // endpoints, so an empty ramp must not pass through the palette at all —
    // otherwise the caller would paint an endpoint color instead of the
    // fallback grey, and the empty contract would be unobservable.
    const scaleSpy = vi.fn(() => ({
      mode: () => ({ colors: () => ["#1", "#9"] }),
    }));
    globalThis.chroma = { scale: scaleSpy } as never;

    const ramp = buildRamp([], EQUAL);

    expect(ramp.breaks).toEqual([]);
    expect(ramp.colors).toEqual([]);
    expect(colorFor(ramp, 1)).toBe(SCHEME_FALLBACK_COLOR);
    expect(scaleSpy).not.toHaveBeenCalled();
  });

  it("bisects on the first break at or above the value", () => {
    installChroma(["#1", "#2", "#3"]);
    const ramp = buildRamp([1, 5, 9], EQUAL);

    expect(ramp.classOf(1)).toBe(0);
    expect(ramp.classOf(4)).toBe(1);
    expect(ramp.classOf(9)).toBe(2);
  });

  it("clamps values beyond the final break to the last class", () => {
    installChroma(["#1", "#2", "#3"]);
    const ramp = buildRamp([1, 5, 9], EQUAL);

    expect(ramp.classOf(100)).toBe(2);
    expect(ramp.classOf(-5)).toBe(0);
  });

  it("keeps a single value in one class", () => {
    installChroma(["#1"]);
    const ramp = buildRamp([42], { ...EQUAL, classes: 6 });

    expect(ramp.breaks).toEqual([42, 42]);
    expect(ramp.colors).toHaveLength(1);
    expect(ramp.classOf(42)).toBe(0);
  });

  it("clamps a single-boundary answer to class zero", () => {
    // A defensive floor rather than a reachable state: the classifier never
    // answers a non-empty input with fewer than two breaks. classOf still
    // owns the "non-negative index" contract, and a -1 would make colorFor
    // read `colors[-1]` and degrade a whole ramp to the shared grey.
    vi.mocked(computeBreaks).mockReturnValueOnce([5]);
    installChroma(["#only"]);

    const ramp = buildRamp([1, 9], EQUAL);

    expect(ramp.colors).toEqual([]);
    expect(ramp.classOf(5)).toBe(0);
    expect(ramp.classOf(99)).toBe(0);
    expect(colorFor(ramp, 5)).toBe(SCHEME_FALLBACK_COLOR);
  });
});

describe("colorFor", () => {
  it("returns the color for the value's class", () => {
    installChroma(["#1", "#2", "#3"]);
    const ramp = buildRamp([1, 5, 9], EQUAL);

    expect(colorFor(ramp, 1)).toBe("#1");
    expect(colorFor(ramp, 4)).toBe("#2");
    expect(colorFor(ramp, 9)).toBe("#3");
  });

  it("falls back to the last available color when chroma returns fewer", () => {
    // One color requested for three classes: classes 1 and 2 are
    // out of bounds and take the last available color.
    installChroma(["#only"]);
    const ramp = buildRamp([1, 5, 9], EQUAL);

    expect(colorFor(ramp, 1)).toBe("#only");
    expect(colorFor(ramp, 4)).toBe("#only");
    expect(colorFor(ramp, 9)).toBe("#only");
  });

  it("falls back to the shared grey for an empty ramp", () => {
    expect(colorFor(buildRamp([], EQUAL), 1)).toBe(SCHEME_FALLBACK_COLOR);
  });
});

describe("buildCategoryRamp", () => {
  it("assigns one discrete color per category in first-seen order", () => {
    installChroma(["#1", "#2", "#3"]);
    globalThis.chroma = {
      scale: () => ({
        colors: (n: number) => ["#1", "#2", "#3"].slice(0, Math.max(0, n)),
      }),
    } as never;
    const ramp = buildCategoryRamp(["forest", "lake", "urban"], "Set3");
    expect(ramp.colors.size).toBe(3);
    expect(ramp.colors.get("forest")).toBeTruthy();
    expect(ramp.colors.get("lake")).toBeTruthy();
    expect(ramp.colors.get("urban")).toBeTruthy();
    expect(ramp.colors.get("forest")).not.toBe(ramp.colors.get("lake"));
    expect(ramp.other).toBe(SCHEME_FALLBACK_COLOR);
  });
  it("yields an empty map for empty input", () => {
    const ramp = buildCategoryRamp([], "Set3");
    expect(ramp.colors.size).toBe(0);
    expect(ramp.other).toBe(SCHEME_FALLBACK_COLOR);
  });
  it("paints the fallback grey when the palette is empty", () => {
    // chroma returned no colors at all: every category must degrade to the
    // shared fallback, not read palette[palette.length - 1] (undefined).
    globalThis.chroma = { scale: () => ({ colors: () => [] }) } as never;
    const ramp = buildCategoryRamp(["forest", "lake"], "Set3");
    expect(ramp.colors.get("forest")).toBe(SCHEME_FALLBACK_COLOR);
    expect(ramp.colors.get("lake")).toBe(SCHEME_FALLBACK_COLOR);
    expect(ramp.other).toBe(SCHEME_FALLBACK_COLOR);
  });
  it("falls back to grey for unknown or missing values", () => {
    const ramp = buildCategoryRamp(["forest"], "Set3");
    expect(ramp.colors.get("unknown")).toBeUndefined();
    expect(ramp.other).toBe(SCHEME_FALLBACK_COLOR);
  });
  it("falls back to the last color when the palette is shorter than the categories", () => {
    // Set2 has 8 discrete colors; with 10 categories the 9th and 10th take
    // the last palette color (the same out-of-bounds fallback colorFor uses),
    // not the first — a repeated first color would be a second rule.
    const colors = ["#0", "#1", "#2", "#3", "#4", "#5", "#6", "#7"];
    globalThis.chroma = {
      scale: () => ({ colors: (n: number) => colors.slice(0, Math.max(0, n)) }),
    } as never;
    const values = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const ramp = buildCategoryRamp(values, "Set2");
    expect(ramp.colors.size).toBe(10);
    expect(ramp.colors.get("h")).toBe("#7");
    expect(ramp.colors.get("i")).toBe("#7");
    expect(ramp.colors.get("j")).toBe("#7");
  });
});

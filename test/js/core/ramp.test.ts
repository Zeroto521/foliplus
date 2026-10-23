// Unit tests for core/ramp — the shared value → colour ramp
// (breaks + scheme colours + the value → class bisection).
import { afterEach, describe, expect, it, vi } from "vitest";
import { METHOD, computeBreaks } from "#core/classify.js";
import { SCHEME_FALLBACK_COLOR } from "#core/palette.js";
import { buildRamp, colorFor } from "#core/ramp.js";

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
 *  fixed colour list — counting the request is what `buildRamp` must get
 *  right, so the stub honours it rather than ignoring it. Passing one colour
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
  it("requests colours for the break span, not the raw class count", () => {
    const colorsSpy = vi.fn(() => ["#1", "#2", "#3"]);
    const scaleSpy = vi.fn(() => ({ mode: () => ({ colors: colorsSpy }) }));
    globalThis.chroma = { scale: scaleSpy } as never;

    const ramp = buildRamp([1, 5, 9], EQUAL);

    // 3 classes is 4 breaks, so the scale is asked for 3 colours.
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
    // `classes + 1`, so 3 breaks and 2 colours. Only a single value would
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
    // last class instead of running off the colour table.
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
    // Real chroma answers a zero-colour request with the scheme's two
    // endpoints, so an empty ramp must not pass through the palette at all —
    // otherwise the caller would paint an endpoint colour instead of the
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
  it("returns the colour for the value's class", () => {
    installChroma(["#1", "#2", "#3"]);
    const ramp = buildRamp([1, 5, 9], EQUAL);

    expect(colorFor(ramp, 1)).toBe("#1");
    expect(colorFor(ramp, 4)).toBe("#2");
    expect(colorFor(ramp, 9)).toBe("#3");
  });

  it("falls back to the last available colour when chroma returns fewer", () => {
    // One colour requested for three classes: classes 1 and 2 are
    // out of bounds and take the last available colour.
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

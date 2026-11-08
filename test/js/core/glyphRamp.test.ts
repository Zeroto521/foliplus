// Unit tests for core/glyphRamp — the shared value → glyph ramp
// (breaks + per-class glyphs + the value → class bisection). The glyph
// analogue of core/ramp.test.ts: the SAME computeBreaks and the SAME
// bisection must be used (lead ruling #2), so this file does not re-spy
// computeBreaks for a different result — it pins that buildGlyphRamp hands
// values to the shared classifier and yields the shared class semantics.
import { afterEach, describe, expect, it, vi } from "vitest";
import { METHOD } from "#core/classify.js";
import { buildCategoryGlyphRamp, buildGlyphRamp, glyphFor } from "#core/glyphRamp.js";

afterEach(() => {
  vi.clearAllMocks();
});

const EQUAL: {
  method: typeof METHOD.EQUAL;
  classes: number;
  glyphs: string[];
} = {
  method: METHOD.EQUAL,
  classes: 3,
  glyphs: ["circle", "square", "diamond"],
};

describe("buildGlyphRamp", () => {
  it("caps the glyph list at the break span, not the raw class count", () => {
    // 3 classes over 3 values -> 4 breaks -> 3 glyphs.
    const ramp = buildGlyphRamp([1, 5, 9], EQUAL);
    expect(ramp.breaks).toHaveLength(4);
    expect(ramp.glyphs).toEqual(["circle", "square", "diamond"]);
  });

  it("caps the class count at the number of values", () => {
    // 9 requested classes over 2 values degrades to 2 classes: 3 breaks,
    // 2 glyphs (the glyph list is truncated to the span, not the request).
    const ramp = buildGlyphRamp([1, 9], { ...EQUAL, classes: 9 });
    expect(ramp.breaks).toHaveLength(3);
    expect(ramp.glyphs).toHaveLength(2);
    expect(ramp.classOf(1)).toBe(0);
    expect(ramp.classOf(9)).toBe(1);
  });

  it("classOf bisects identically to the color ramp", () => {
    const ramp = buildGlyphRamp([0, 10], { ...EQUAL, classes: 2 });
    expect(ramp.breaks).toEqual([0, 5, 10]);
    // A value exactly on a break takes the LOWER class (same as ramp.ts).
    expect(ramp.classOf(-99)).toBe(0);
    expect(ramp.classOf(0)).toBe(0);
    expect(ramp.classOf(4.999)).toBe(0);
    expect(ramp.classOf(5)).toBe(0);
    expect(ramp.classOf(5.001)).toBe(1);
    expect(ramp.classOf(10)).toBe(1);
    expect(ramp.classOf(1e9)).toBe(1);
  });

  it("yields an empty ramp for empty input rather than throwing", () => {
    const ramp = buildGlyphRamp([], EQUAL);
    expect(ramp.breaks).toEqual([]);
    expect(ramp.glyphs).toEqual([]);
    expect(ramp.classOf(1)).toBe(0);
  });

  it("keeps a single value in one class", () => {
    const ramp = buildGlyphRamp([42], { ...EQUAL, classes: 6 });
    expect(ramp.breaks).toEqual([42, 42]);
    expect(ramp.glyphs).toHaveLength(1);
    expect(ramp.classOf(42)).toBe(0);
  });

  it("falls back to the last glyph when the glyph list is shorter than the span", () => {
    // 3 classes over 3 values but only 2 glyphs: the third class takes the
    // last glyph, never a cycle back to the first.
    const ramp = buildGlyphRamp([1, 5, 9], {
      method: METHOD.EQUAL,
      classes: 3,
      glyphs: ["circle", "square"],
    });
    // Equal-interval breaks for [1,5,9] are [1, 3.667, 6.333, 9].
    expect(ramp.classOf(1)).toBe(0);
    expect(ramp.classOf(5)).toBe(1); // class 1 -> square
    expect(ramp.classOf(9)).toBe(2); // class 2 -> out of glyph range
    expect(glyphFor(ramp, 9)).toBe("square"); // last glyph, not a cycle
  });
});

describe("glyphFor", () => {
  it("returns the glyph for the value's class", () => {
    const ramp = buildGlyphRamp([1, 5, 9], EQUAL);
    expect(glyphFor(ramp, 1)).toBe("circle");
    expect(glyphFor(ramp, 4)).toBe("square");
    expect(glyphFor(ramp, 9)).toBe("diamond");
  });

  it("degrades to undefined for an empty ramp", () => {
    expect(glyphFor(buildGlyphRamp([], EQUAL), 1)).toBeUndefined();
  });
});

describe("buildCategoryGlyphRamp", () => {
  it("assigns one glyph per category in first-seen order", () => {
    const ramp = buildCategoryGlyphRamp(
      ["forest", "lake", "urban"],
      ["tree", "circle", "square"],
    );
    expect(ramp.glyphs.size).toBe(3);
    expect(ramp.glyphs.get("forest")).toBe("tree");
    expect(ramp.glyphs.get("lake")).toBe("circle");
    expect(ramp.glyphs.get("urban")).toBe("square");
  });

  it("yields an empty map for empty input", () => {
    const ramp = buildCategoryGlyphRamp([], ["circle"]);
    expect(ramp.glyphs.size).toBe(0);
    expect(ramp.other).toBeUndefined();
  });

  it("falls back to the last glyph when the glyph list is shorter than the categories", () => {
    const ramp = buildCategoryGlyphRamp(["a", "b", "c", "d"], ["circle", "square"]);
    expect(ramp.glyphs.get("a")).toBe("circle");
    expect(ramp.glyphs.get("b")).toBe("square");
    expect(ramp.glyphs.get("c")).toBe("square");
    expect(ramp.glyphs.get("d")).toBe("square");
    expect(ramp.other).toBe("square");
  });
});

// Unit tests for core/value/glyphRamp — the shared value → glyph ramp.
// The glyph analogue of ramp.test.ts: the by-value icon dimension classifies
// a feature field and maps each class (or distinct category) to a glyph.
// The classifier/bisection are NOT re-implemented here — the test asserts the
// ramp shares computeBreaks semantics and keeps the same out-of-bounds
// fallback (last glyph, never a cycle back to the first).
import { describe, expect, it } from "vitest";
import { METHOD } from "#core/value/classify.js";
import {
  buildCategoryGlyphRamp,
  buildGlyphRamp,
  glyphFor,
} from "#core/value/glyphRamp.js";

const GLYPHS = ["circle", "square", "diamond", "star", "triangle-exclamation"];

describe("buildGlyphRamp (numeric)", () => {
  it("yields an empty ramp for empty input, not a throw", () => {
    const ramp = buildGlyphRamp([], {
      method: METHOD.EQUAL,
      classes: 5,
      glyphs: GLYPHS,
    });
    expect(ramp.breaks).toEqual([]);
    expect(ramp.glyphs).toEqual([]);
    expect(ramp.classOf(0)).toBe(0);
    expect(glyphFor(ramp, 0)).toBeUndefined();
  });

  it("caps classes at the value count, like buildRamp", () => {
    const ramp = buildGlyphRamp([1, 2], {
      method: METHOD.EQUAL,
      classes: 9,
      glyphs: GLYPHS,
    });
    // Two values can never yield more than two classes.
    expect(ramp.breaks.length - 1).toBeLessThanOrEqual(2);
    expect(ramp.glyphs.length).toBe(Math.max(0, ramp.breaks.length - 1));
  });

  it("maps each value to a glyph via the class bisection", () => {
    const values = [10, 20, 30, 40, 50, 60];
    const ramp = buildGlyphRamp(values, {
      method: METHOD.EQUAL,
      classes: 3,
      glyphs: GLYPHS.slice(0, 3),
    });
    expect(ramp.glyphs).toHaveLength(3);
    const first = glyphFor(ramp, 10);
    const last = glyphFor(ramp, 60);
    expect(first).toBe(ramp.glyphs[0]);
    expect(last).toBe(ramp.glyphs[ramp.glyphs.length - 1]);
  });

  it("falls back to the LAST glyph for a value past the final break, never the first", () => {
    const ramp = buildGlyphRamp([0, 1, 2, 3, 4, 5], {
      method: METHOD.EQUAL,
      classes: 2,
      glyphs: ["a", "b"],
    });
    const big = glyphFor(ramp, 9999);
    expect(big).toBe("b");
    expect(big).not.toBe("a");
  });
});

describe("buildCategoryGlyphRamp (categorical)", () => {
  it("maps distinct categories in first-seen order", () => {
    const ramp = buildCategoryGlyphRamp(["res", "com", "ind", "res"], GLYPHS);
    expect(ramp.glyphs.get("res")).toBe(GLYPHS[0]);
    expect(ramp.glyphs.get("com")).toBe(GLYPHS[1]);
    expect(ramp.glyphs.get("ind")).toBe(GLYPHS[2]);
    expect(ramp.other).toBe(GLYPHS[GLYPHS.length - 1]);
  });

  it("falls back to the LAST glyph when categories exceed the glyph list", () => {
    const ramp = buildCategoryGlyphRamp(["a", "b", "c", "d"], ["x", "y"]);
    expect(ramp.glyphs.get("a")).toBe("x");
    expect(ramp.glyphs.get("b")).toBe("y");
    expect(ramp.glyphs.get("c")).toBe("y");
    expect(ramp.glyphs.get("d")).toBe("y");
  });

  it("yields an empty map and undefined other for empty input", () => {
    const ramp = buildCategoryGlyphRamp([], GLYPHS);
    expect(ramp.glyphs.size).toBe(0);
    expect(ramp.other).toBeUndefined();
  });
});

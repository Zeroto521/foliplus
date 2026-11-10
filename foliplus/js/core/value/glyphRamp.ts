// core/value/glyphRamp — the shared value → glyph ramp: ordered class
// breaks, the glyph list per class, and the value → class bisection. The
// glyph analogue of core/ramp.ts (value → color): the by-value icon dimension
// classifies a feature field and maps each class (or distinct category) to a
// glyph.
//
// The classifier and the bisection are NOT re-implemented here — they are the
// SAME computeBreaks / classOf the color ramp uses (no second classify
// kernel). buildGlyphRamp calls computeBreaks and reuses the identical value →
// class bisection; buildCategoryGlyphRamp maps distinct labels in first-seen
// order. A glyph that is not syntactically valid is dropped by the caller
// before it reaches this module (isGlyphSyntax gate in the intent validator);
// this module trusts its inputs the way ramp.ts trusts a scheme name.
import { type ClassifyMethod, computeBreaks } from "../classify.js";

/** A built glyph ramp: ordered breaks, per-class glyphs, and the value →
 *  class index bisection (identical semantics to core/ramp.ts classOf).
 *  classOf always returns a non-negative index. */
type ValueGlyphRamp = {
  breaks: number[];
  glyphs: string[];
  classOf: (value: number) => number;
};

/** The glyph a value falls into under a built ramp, carrying the same
 *  out-of-bounds fallback the color ramp uses: a class index past the glyph
 *  list's end takes the last glyph (never a cycle back to the first). An
 *  empty ramp degrades to undefined — the caller keeps the author icon. */
const glyphFor = (ramp: ValueGlyphRamp, value: number): string | undefined =>
  ramp.glyphs[ramp.classOf(value)] ?? ramp.glyphs[ramp.glyphs.length - 1];

/** Build the glyph ramp for a set of values under a method/classes/glyphs
 *  config.
 *
 *  Empty input yields an empty ramp (breaks and glyphs both empty, classOf →
 *  0) rather than throwing — the caller checks glyphs.length before painting.
 *  classes is capped at the value count, the same cap buildRamp applies, so
 *  a 9-glyph request over 2 features is the same honest answer.
 *
 *  The bisection is byte-for-byte the one core/ramp.ts uses: the first break
 *  at or above the value opens the class, values past the final break take
 *  the last class. Keeping them identical (not merely similar) is what makes
 *  the R3 guard meaningful. */
const buildGlyphRamp = (
  values: number[],
  config: { method: ClassifyMethod; classes: number; glyphs: string[] },
): ValueGlyphRamp => {
  if (values.length === 0) {
    return { breaks: [], glyphs: [], classOf: () => 0 };
  }
  const nClasses = Math.min(config.classes, values.length);
  const breaks = computeBreaks(values, nClasses, config.method);
  const glyphs = config.glyphs.slice(0, Math.max(0, breaks.length - 1));
  const classOf = (value: number): number => {
    /* v8 ignore next -- defensive: values.length===0 returns above, so computeBreaks always yields >=2 breaks here */
    if (breaks.length < 2) return 0;
    let lo = 1;
    let hi = breaks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (value <= breaks[mid]) hi = mid;
      else lo = mid + 1;
    }
    return value <= breaks[lo] ? lo - 1 : breaks.length - 2;
  };
  return { breaks, glyphs, classOf };
};

/** A built categorical glyph ramp: an exact category → glyph map plus the
 *  one "other" glyph every category not in the domain falls back to. */
type CategoryGlyphRamp = {
  glyphs: Map<string, string>;
  other: string | undefined;
};

/** Build the category → glyph ramp for a set of distinct category values.
 *
 *  Each category takes the next glyph in first-seen order. When the category
 *  count exceeds the glyph count, the extra categories take the *last* glyph
 *  rather than cycling back to the first — the same out-of-bounds fallback
 *  glyphFor uses. Empty input yields an empty map and an undefined "other". */
const buildCategoryGlyphRamp = (
  categories: string[],
  glyphs: string[],
): CategoryGlyphRamp => {
  const map = new Map<string, string>();
  if (categories.length === 0) return { glyphs: map, other: undefined };
  categories.forEach((value, index) => {
    map.set(value, glyphs[index] ?? glyphs[glyphs.length - 1]);
  });
  return { glyphs: map, other: glyphs[glyphs.length - 1] };
};

export { buildCategoryGlyphRamp, buildGlyphRamp, glyphFor };
export type { CategoryGlyphRamp, ValueGlyphRamp };

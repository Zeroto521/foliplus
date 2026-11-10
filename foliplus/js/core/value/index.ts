// core/value — the value cluster barrel. External consumers import glyph
// ramp pieces from here (never a deep path into this directory), so a new
// value module is added here rather than creating a second deep import.
export { buildCategoryGlyphRamp, buildGlyphRamp, glyphFor } from "./glyphRamp.js";
export type { CategoryGlyphRamp, ValueGlyphRamp } from "./glyphRamp.js";

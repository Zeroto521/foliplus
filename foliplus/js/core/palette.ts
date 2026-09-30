// Shared discrete color-scheme vocabulary — the palette names and the
// chroma-based scale builder consumed by both HeatmapControl's hex classes
// and LayerControl's value-based fill. Lives next to `classify.ts` (same
// domain: classification + color mapping) so the two consumers stay in
// lockstep on the palette vocabulary.
//
// `DEFAULT_SCHEMES` is the canonical JS-side list. The Python-side
// declaration (HeatmapControl.py's `schemes or [...]`) is the author-facing
// default and must mirror this list — the Python docstring names the same
// seven palettes, so a drift on either side is a bug that surfaces the
// moment a user's saved state asks for a scheme neither side lists.

/** Scheme names available by default. Chroma.js supports any ColorBrewer
 *  palette name, but this list is the shared vocabulary — every picker
 *  built from it offers the same seven options across the product. */
const DEFAULT_SCHEMES = [
  "Blues",
  "Greens",
  "Reds",
  "Oranges",
  "Purples",
  "YlOrRd",
  "Viridis",
] as const;

/** A scheme name in the shared vocabulary. */
type SchemeName = (typeof DEFAULT_SCHEMES)[number];

/** Placeholder color when chroma is unavailable — the same value the
 *  HeatmapControl border fallback uses, so an unreadable color degrades
 *  to one color across the product. */
const SCHEME_FALLBACK_COLOR = "#999";

/** Build a discrete `n`-color scale from a ColorBrewer / chroma scheme
 *  name. Falls back to a flat GRAY array when chroma is unavailable
 *  (jsdom unit tests, headless contexts). */
const getColorScale = (name: string, n: number): string[] => {
  if (typeof chroma !== "undefined") {
    return chroma.scale(name).mode("lab").colors(n) as string[];
  }
  return Array(n).fill(SCHEME_FALLBACK_COLOR);
};

export { DEFAULT_SCHEMES, SCHEME_FALLBACK_COLOR, getColorScale };
export type { SchemeName };

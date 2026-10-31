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
import { createLogger } from "#common/log.js";

const log = createLogger("foliplus");

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

/** The one unreadable-color fallback the product degrades to: a color
 *  chroma cannot read, or a feature that declared no fill. Heatmap's hex
 *  fill and border, and the value-based fill's scale, all degrade to this
 *  one value instead of each component keeping its own. */
const SCHEME_FALLBACK_COLOR = "#999";

/** A throw's text, whatever was thrown. `instanceof Error` rather than a
 *  type assertion: a dependency or a test double can `throw null`, and
 *  reading `.message` off that turns this wrapper into a TypeError of its own
 *  - which would then escape the very `safeColorScale` that exists to stop
 *  it. */
const thrownText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** Thrown when chroma cannot build a scale from the requested name. A
 *  project-owned type rather than chroma's own: callers switch on it to
 *  degrade, and chroma's error shape is not ours to depend on. */
class PaletteConfigError extends Error {}

/** Build a discrete `n`-color scale from a ColorBrewer / chroma scheme
 *  name.
 *
 *  Two failure classes, deliberately handled differently rather than both
 *  collapsing into the fallback:
 *    - chroma is absent (jsdom unit tests, headless contexts). That is the
 *      environment, not the config, so it returns the fallback colors.
 *    - chroma is present and rejects the name. That is a config error, and
 *      it throws `PaletteConfigError` so each consumer can degrade the way
 *      its own axis allows: LayerControl restores the author's fill face,
 *      Heatmap paints the fallback through `safeColorScale`.
 *  The one thing the product does not do is let chroma's own exception
 *  escape and abort whichever control happened to be mounting. */
const getColorScale = (name: string, n: number): string[] => {
  if (typeof chroma === "undefined") {
    return Array(n).fill(SCHEME_FALLBACK_COLOR);
  }
  try {
    return chroma.scale(name).mode("lab").colors(n) as string[];
  } catch (err) {
    throw new PaletteConfigError(
      log.msg(`chroma cannot build a scale from "${name}" (${thrownText(err)})`),
    );
  }
};

/** `getColorScale` for a caller that must not fail: an unreadable name
 *  paints the fallback color instead of aborting the control that asked.
 *  Both of Heatmap's call sites use this - a stale record must not stop the
 *  panel from mounting. LayerControl's ramp deliberately keeps the throwing
 *  form, because it can restore the author's fill face instead of painting
 *  a color the user never chose. */
const safeColorScale = (name: string, n: number): string[] => {
  try {
    return getColorScale(name, n);
  } catch {
    // Total by contract: `getColorScale` has exactly one throw (the palette
    // error above), and re-raising it here would just move the decision back
    // to a caller that has already said it cannot fail.
    return Array(n).fill(SCHEME_FALLBACK_COLOR);
  }
};

/** Qualitative (category) schemes the category fill arm offers, with the
 *  discrete color count each ColorBrewer family defines. These are the
 *  canonical category palettes — a category fill is a flat set of names, so
 *  interpolating between endpoints would produce colors the brewer never
 *  defined. The count is the family's max; `getCategoryColors` caps at it.
 *
 *  The keys mirror `DEFAULT_SCHEMES`'s shape but are a separate vocabulary:
 *  a sequential scheme (Blues) is a *gradient*, which a categorical field
 *  must not use — the category arm paints distinct labels, and a gradient
 *  would make two adjacent categories nearly indistinguishable. */
const CATEGORY_SCHEMES: Record<string, number> = {
  Set3: 12,
  Paired: 12,
  Set1: 9,
  Set2: 8,
  Dark2: 8,
};

/** Build a discrete `n`-color qualitative scale from a category scheme
 *  name.
 *
 *  Unlike `getColorScale`, this never interpolates: a category palette's
 *  colors are the brewer's named colors, and `.mode("lab")` would blend two
 *  endpoints into a shade the brewer never intended. Chroma's `colors(n)`
 *  on a qualitative scheme returns the scheme's own discrete colors when
 *  `n` is within the family's count, and cycles otherwise — so the count is
 *  capped at the family's max.
 *
 *  Total by the same contract as `safeColorScale`: chroma absent OR the
 *  name unreadable paints the fallback grey instead of aborting the control
 *  that asked — a stale or hand-edited record must not stop a panel from
 *  mounting. */
const getCategoryColors = (name: string, n: number): string[] => {
  const max = CATEGORY_SCHEMES[name] ?? 0;
  if (typeof chroma === "undefined") {
    return Array(n).fill(SCHEME_FALLBACK_COLOR);
  }
  try {
    // Cap at the family's discrete count: asking chroma for more colors than
    // the brewer defined would cycle and repeat a color, which a category
    // fill must never do (two categories sharing one color is the exact
    // confusion the palette exists to prevent).
    const count = max > 0 ? Math.min(n, max) : n;
    return chroma.scale(name).colors(count) as string[];
  } catch {
    // Total by the same contract as `safeColorScale`: an unreadable name
    // paints the fallback grey instead of aborting the control that asked.
    return Array(n).fill(SCHEME_FALLBACK_COLOR);
  }
};

export {
  CATEGORY_SCHEMES,
  DEFAULT_SCHEMES,
  PaletteConfigError,
  SCHEME_FALLBACK_COLOR,
  getCategoryColors,
  getColorScale,
  safeColorScale,
};

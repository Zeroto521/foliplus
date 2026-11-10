// core/leaflet — the picker's glyph vocabulary (relocated from
// control/LayerControl/ui/style/glyph.ts so core/leaflet/markerIcon can
// render a marker's inner glyph HTML without importing control).
//
// FontAwesome names are accepted on SYNTAX alone — a persisted/declared name
// is any syntactically valid FA6 name, NOT one of the 40 below. The grid is
// only a shortcut collection; the icon font itself is not ours to ship:
// folium's page already loads fontawesome-free 6.2 `all.min.css` (see
// `folium/folium.py`), so a glyph is a bare `<i class="fa-solid fa-<name>">`.
//
// These are FA6 names, not the FA4 ones folium's `Icon(prefix='fa')` docs use
// (`map-marker`, `info-sign`, …). The panel writes exactly what it renders.

/** A syntactically valid FontAwesome name: lowercase alphanumerics joined by
 *  single hyphens (no leading/trailing/double hyphen), max 64 chars. This is
 *  the grammar FA6 class names follow; it deliberately does NOT enumerate a
 *  catalog — any name the author declares or a store persists passes syntax,
 *  and runtime availability is probed separately (see glyphAvailable). */
const GLYPH_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GLYPH_NAME_MAX = 64;

/** The picker's 40-slot grid (8 columns x 5 rows) — a SHORTCUT collection,
 *  NOT a validity whitelist. Any syntactically valid FA6 name works through a
 *  Python declaration or persisted value; these are just the ones the panel
 *  offers for quick picking. Add a glyph here only when it joins the grid. */
const PICKER_GLYPHS = [
  "circle",
  "square",
  "diamond",
  "star",
  "heart",
  "flag",
  "cross",
  "map-pin",
  "location-dot",
  "location-arrow",
  "compass",
  "map",
  "globe",
  "plane",
  "paper-plane",
  "camera",
  "tag",
  "bookmark",
  "bell",
  "book",
  "envelope",
  "fire",
  "leaf",
  "music",
  "phone",
  "tree",
  "gear",
  "triangle-exclamation",
  "circle-info",
  "circle-check",
  "circle-xmark",
  "xmark",
  "plus",
  "minus",
  "arrow-up",
  "arrow-down",
  "arrow-left",
  "arrow-right",
  "house",
  "magnifying-glass",
] as const;

/** True when `value` is a syntactically valid FA6 name (see GLYPH_NAME_RE).
 *  This is the ONLY acceptance gate for a persisted/declared name — the grid
 *  is not a whitelist. */
const isGlyphSyntax = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= GLYPH_NAME_MAX &&
  GLYPH_NAME_RE.test(value);

/** The computed ::before content a FontAwesome glyph paints. A real FA icon
 *  class renders a non-empty content (its glyph codepoint); the "none"/"normal"
 *  /"" values mean the class is not in the loaded stylesheet (a wrong or
 *  unloaded name paints nothing). */
const isGlyphPainted = (content: string): boolean =>
  content !== "none" && content !== "normal" && content !== "";

/** Normalize a glyph name to a single FA class token: ensure exactly one
 *  leading `fa-`. A user who writes `fa-martini-glass` (as awesome-markers
 *  stores it) and one who writes `martini-glass` both land on the same token
 *  `fa-martini-glass` — so the probe and the render never disagree on the
 *  class the stylesheet actually matches. */
const faToken = (name: string): string =>
  name.startsWith("fa-") ? name : `fa-${name}`;

/** FontAwesome family class prefixes the panel may paint under.
 *
 *  A prefix is the family part of an FA class pair - "fa-solid" in
 *  "fa-solid fa-star". Folium's own Icon(prefix=...) accepts any string
 *  ("fa", "fas", "fa-solid", ...), so this table is NOT a whitelist of what
 *  an author may write; it is the set of *panel-controlled* families the
 *  picker grid and the availability probe render under, plus the default the
 *  panel falls back to when neither the layer nor the control names one.
 *  Anything else a layer author writes is kept for the author-declared glyph
 *  (awesome-markers paints prefix + " " + icon verbatim) but is not a
 *  valid panel family: the panel renders such a layer's glyph under its
 *  declared prefix only when that prefix is one of these families.
 */
const GLYPH_PREFIXES = {
  /** The classic solid family - the panel default. */
  solid: "fa-solid",
  /** The outlined family. */
  regular: "fa-regular",
} as const;

/** A panel-controlled FontAwesome family class prefix (see GLYPH_PREFIXES). */
type GlyphPrefix = (typeof GLYPH_PREFIXES)[keyof typeof GLYPH_PREFIXES];

/** The default FontAwesome family the panel paints under when neither the
 *  layer author nor the control declares a prefix. */
const DEFAULT_GLYPH_PREFIX: GlyphPrefix = GLYPH_PREFIXES.solid;

/** Narrow an author-declared prefix to a panel family. An author may write
 *  any string folium's Icon(prefix=...) accepts ("fa", "fas", ...), but
 *  only a known family is a panel family - anything else falls back to the
 *  default so the panel never paints a class the stylesheet cannot match.
 *  (The author-declared glyph keeps the author's own prefix verbatim; this
 *  coercion only applies when the PANEL chooses the family.) */
const coerceGlyphPrefix = (prefix: unknown): GlyphPrefix =>
  typeof prefix === "string" &&
  (Object.values(GLYPH_PREFIXES) as string[]).includes(prefix)
    ? (prefix as GlyphPrefix)
    : DEFAULT_GLYPH_PREFIX;

/** The full FontAwesome class string a glyph renders under a given family
 *  prefix. Single source of truth for BOTH the render path (glyphHtml) and
 *  the availability probe (glyphAvailable): the probe builds exactly the class
 *  the stylesheet must paint, so a name the renderer draws is never reported
 *  unavailable and vice versa. */
const glyphClassName = (name: string, prefix: string = DEFAULT_GLYPH_PREFIX): string =>
  `${prefix} ${faToken(name)}`;

/** Runtime availability probe: does the loaded FontAwesome stylesheet actually
 *  paint `fa-<name>`? Builds a hidden `<i class="fa-solid fa-<name>">`, attaches
 *  it (a detached element reads ::before content as "" even when the rule
 *  exists — see the note in the body), reads
 *  `getComputedStyle(el, "::before").content`, then removes it. A real FA
 *  class gives a glyph codepoint, a missing one gives "none"/"normal"/"".
 *  Results are cached in a Map — the CSS is static, so one probe per name ever.
 *
 *  jsdom (vitest) has no external stylesheet, so every name probes "none" —
 *  single tests must stub `getComputedStyle` (or `glyphAvailable`) to model
 *  availability; the real probe lives in the browser suite. */
const availabilityCache = new Map<string, boolean>();
const glyphAvailable = (name: string, prefix: string = DEFAULT_GLYPH_PREFIX): boolean => {
  const cacheKey = `${prefix}|${name}`;
  const cached = availabilityCache.get(cacheKey);
  if (cached !== undefined) return cached;
  if (typeof document === "undefined") {
    availabilityCache.set(cacheKey, false);
    return false;
  }
  // A *detached* <i> reads ::before content as "" in Chromium even when the
  // loaded FontAwesome stylesheet declares the rule — the ::before
  // pseudo-element only computes against an attached element (verified by a
  // live browser probe, 2026-11-07: detached "" vs attached "\uf276"). The
  // old probe never attached, so in the real browser suite every name probed
  // unavailable and the icon dimension silently degraded to the author icon.
  // Attach (hidden, so no layout flash) then remove immediately; the probe is
  // read-only and cached, so this runs once per name ever.
  const probe = document.createElement("i");
  probe.className = glyphClassName(name, prefix);
  probe.style.display = "none";
  const host = document.body ?? document.documentElement;
  if (!host) {
    availabilityCache.set(name, false);
    return false;
  }
  host.appendChild(probe);
  let content: string;
  try {
    content = getComputedStyle(probe, "::before").content;
  } finally {
    probe.remove();
  }
  const available = isGlyphPainted(content);
  availabilityCache.set(cacheKey, available);
  return available;
};

/** Resolve a name to a renderable glyph string. Now that the grid is not a
 *  whitelist, this never drops a syntactically valid name — it returns the
 *  name itself (the caller still checks availability via glyphAvailable and
 *  degrades honestly if the stylesheet does not paint it). An invalid
 *  (non-syntax) name still resolves to null so the caller shows the author's
 *  original instead of rendering garbage. */
const resolveGlyph = (name: string): string | null =>
  isGlyphSyntax(name) ? name : null;

/** A glyph's HTML: the shell class plus the FA classes. `extraClass` lets the
 *  marker scene carry the author's own paint class (`icon-white`, …) and
 *  `style` its inline colour, so the symbol inherits the chassis paint. */
const glyphHtml = (
  name: string,
  extraClass = "",
  style = "",
  prefix: string = DEFAULT_GLYPH_PREFIX,
): string => {
  const classes = ["foliplus-marker-glyph", extraClass, glyphClassName(name, prefix)]
    .filter(Boolean)
    .join(" ");
  return `<i class="${classes}"${style ? ` style="${style}"` : ""} aria-hidden="true"></i>`;
};

export {
  PICKER_GLYPHS,
  GLYPH_PREFIXES,
  DEFAULT_GLYPH_PREFIX,
  coerceGlyphPrefix,
  glyphAvailable,
  glyphHtml,
  isGlyphSyntax,
  resolveGlyph,
};

export type { GlyphPrefix };

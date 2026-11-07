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

/** Runtime availability probe: does the loaded FontAwesome stylesheet actually
 *  paint `fa-<name>`? Builds a detached `<i class="fa-solid fa-<name>">` and
 *  reads `getComputedStyle(el, "::before").content`; a real FA class gives a
 *  glyph codepoint, a missing one gives "none"/"normal"/"". Results are cached
 *  in a Map — the CSS is static, so one probe per name ever.
 *
 *  jsdom (vitest) has no external stylesheet, so every name probes "none" —
 *  single tests must stub `getComputedStyle` (or `glyphAvailable`) to model
 *  availability; the real probe lives in the browser suite. */
const availabilityCache = new Map<string, boolean>();
const glyphAvailable = (name: string): boolean => {
  const cached = availabilityCache.get(name);
  if (cached !== undefined) return cached;
  if (typeof document === "undefined") {
    availabilityCache.set(name, false);
    return false;
  }
  const probe = document.createElement("i");
  probe.className = `fa-solid fa-${name}`;
  probe.style.display = "none";
  const content = getComputedStyle(probe, "::before").content;
  const available = isGlyphPainted(content);
  availabilityCache.set(name, available);
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
const glyphHtml = (name: string, extraClass = "", style = ""): string => {
  const classes = ["foliplus-marker-glyph", extraClass, "fa-solid", `fa-${name}`]
    .filter(Boolean)
    .join(" ");
  return `<i class="${classes}"${style ? ` style="${style}"` : ""} aria-hidden="true"></i>`;
};

export { PICKER_GLYPHS, glyphAvailable, glyphHtml, isGlyphSyntax, resolveGlyph };

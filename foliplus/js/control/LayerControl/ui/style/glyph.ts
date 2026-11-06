// LayerControl UI — the picker's glyph vocabulary.
//
// One ordered source: array order is the picker grid order (8 columns), and
// each entry is BOTH the persisted glyph name and the FontAwesome class
// suffix. The icon font is not ours to ship: folium's page already loads
// fontawesome-free 6.2 `all.min.css` (see `folium/folium.py`), so a glyph is a
// bare `<i class="fa-solid fa-<name>">` — no per-icon markup, no alias table,
// no bundle weight.
//
// These are FA6 names, not the FA4 ones folium's `Icon(prefix='fa')` docs use
// (`map-marker`, `info-sign`, …). The panel writes exactly what it renders.
const GLYPH_NAMES = [
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

type GlyphName = (typeof GLYPH_NAMES)[number];

const isGlyphName = (value: unknown): value is GlyphName =>
  typeof value === "string" && (GLYPH_NAMES as readonly string[]).includes(value);

/** A glyph's HTML: the shell class plus the FA classes. `extraClass` lets the
 *  marker scene carry the author's own paint class (`icon-white`, …) and
 *  `style` its inline colour, so the symbol inherits the chassis paint. */
const glyphHtml = (name: GlyphName, extraClass = "", style = ""): string => {
  const classes = ["foliplus-marker-glyph", extraClass, "fa-solid", `fa-${name}`]
    .filter(Boolean)
    .join(" ");
  return `<i class="${classes}"${style ? ` style="${style}"` : ""} aria-hidden="true"></i>`;
};

/** Resolve a persisted/author name to a glyph we can render, or null when the
 *  set does not contain it. An unknown name is never swapped for a different
 *  icon — the caller shows the author's original instead. */
const resolveGlyph = (name: string): GlyphName | null =>
  isGlyphName(name) ? name : null;

export { GLYPH_NAMES, glyphHtml, isGlyphName, resolveGlyph };

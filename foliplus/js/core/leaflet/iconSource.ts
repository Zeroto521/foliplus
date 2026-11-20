// core/leaflet — the two NON-glyph marker-icon sources the panel may write:
// a user URL (rendered as a native L.Icon <img>) and an authorized divIcon
// className (rendered as a plain-text-glyph L.divIcon).
//
// Both are MINIMAL-AUTHORIZATION shapes. A URL is accepted on a strict
// scheme/mediatype whitelist (never as HTML), and a divIcon is authorized
// down to a whitelisted className plus a plain-text glyph — never innerHTML.
// The whitelist is the ONLY acceptance gate; anything else degrades honestly
// to the FontAwesome glyph.
//
// This module is scanner-blind vocabulary + predicates (no Leaflet import),
// so markerIcon.ts can build the actual icons from it and a static guard can
// scan it. Vocabulary the CSS owns (a shape class name) lives here, not in a
// second copy — the class-owner guard sees one source.
import { isGlyphSyntax } from "./glyphSource.js";
import { MARKER_CLASS } from "./markerClassName.js";

/** The URL schemes/mediatypes the panel may write as a marker icon. A URL
 *  becomes a native <img> (L.Icon iconUrl), so the only injection face is the
 *  URL itself — and the whitelist keeps every scriptable mediatype out:
 *
 *  - https?:// — an ordinary remote image.
 *  - data:image/(png|jpeg|gif|webp);base64, — an inline raster. SVG is
 *    excluded on purpose (data:image/svg+xml can carry <script> / onload),
 *    as are data:text/html and javascript:.
 *
 *  A non-matching value is NOT an error — it is ignored (the panel degrades
 *  to the FontAwesome glyph), so a hostile URL is never rendered at all. */
const ICON_URL_PATTERNS = [
  /^https?:\/\//i,
  /^data:image\/(?:png|jpeg|gif|webp);base64,/i,
] as const;

/** A user/declared URL the panel may render as a marker icon. The ONLY
 *  acceptance gate for a URL — the panel never renders HTML, so the URL is
 *  validated as a URL, not sanitized as markup. */
const isAllowedIconUrl = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 2048 &&
  ICON_URL_PATTERNS.some(re => re.test(value));

/** The divIcon classNames the panel may write — the minimal-authorization
 *  whitelist. A divIcon renders an authorized className plus a plain-text
 *  glyph (never innerHTML), so this table is the single gate for a CSS class
 *  the panel did not register. Add a shape here only when its CSS is
 *  registered in foliplus/css. */
const DIVICON_CLASS_NAMES = {
  /** The round pin shape (the panel's default divIcon chassis). */
  pin: MARKER_CLASS.SHAPE_PIN,
  /** The square chip shape. */
  square: MARKER_CLASS.SHAPE_SQUARE,
} as const;

/** A panel-authorized divIcon shape key. */
type DivIconShape = keyof typeof DIVICON_CLASS_NAMES;

/** The whitelisted divIcon className for a shape key, or null when the key is
 *  not one the panel registered (a non-whitelisted className degrades to the
 *  FontAwesome glyph, never an arbitrary CSS class). */
const divIconClassNameOf = (shape: unknown): string | null => {
  if (typeof shape !== "string") return null;
  return (DIVICON_CLASS_NAMES as Record<string, string | undefined>)[shape] ?? null;
};

/** The divIcon shape keys the panel offers (the picker's shortcut set). */
const DIVICON_SHAPES = Object.keys(DIVICON_CLASS_NAMES) as DivIconShape[];

/** True when value is a plain-text glyph the divIcon arm may render. The
 *  divIcon carries the glyph as TEXT content (never markup), so the same FA
 *  syntax gate the glyph picker uses applies — a syntactically valid FA6
 *  name. A redundant guard over glyphHtml (which is text-safe by
 *  construction); it documents that the divIcon arm renders no HTML of its
 *  own beyond the glyph the shared renderer emits. */
const isDivIconGlyph = (value: unknown): value is string => isGlyphSyntax(value);

export {
  DIVICON_CLASS_NAMES,
  DIVICON_SHAPES,
  divIconClassNameOf,
  isAllowedIconUrl,
  isDivIconGlyph,
};

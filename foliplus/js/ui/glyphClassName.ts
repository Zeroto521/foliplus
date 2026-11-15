// ui/glyphClassName — single source for the marker-glyph shell class name.
//
// The glyph shell is the class every marker-glyph <i> carries (glyphHtml in
// core/leaflet/glyphSource) and the selector hook markerIcon matches against.
// A class name is a contract, and this one was spelled bare in glyphSource
// until its owner module existed; one spelling here, every consumer reads
// through it.
//
// This module is pure data — no runtime import, no map, no DOM — so any
// layer may import it.
const GLYPH_CLASS = {
  SHELL: "foliplus-marker-glyph",
} as const;

export { GLYPH_CLASS };

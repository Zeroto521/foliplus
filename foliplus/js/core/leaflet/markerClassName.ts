// core/leaflet — marker icon class vocabulary.
//
// The default marker icon and its chassis are both built and read inside
// markerIcon.ts (a scanner-blind module), so the tokens live in a
// *ClassName.ts owner file that class-owner --include-core can see.
const MARKER_CLASS = {
  /** The default (non-author) div-icon shell. */
  DEFAULT: "foliplus-marker-default",
  /** The chassis span inside a sprite/author icon. */
  CHASSIS: "foliplus-marker-chassis",
  /** The inner wrapper created by applyDeclaredIconScale when a whole-icon
   *  pixel size is declared. The scale lives here (Leaflet overwrites any
   *  transform on the outer box); a dedicated class lets CSS and tests find
   *  the scale wrapper by vocabulary, not by structural lookup. */
  SCALE_WRAPPER: "foliplus-marker-scale-wrapper",
  /** The authorized divIcon shape shells (the panel's className whitelist).
   *  A divIcon source renders one of these plus a plain-text glyph, never
   *  innerHTML — see iconSource.ts DIVICON_SHAPE. */
  SHAPE_PIN: "foliplus-shape-pin",
  SHAPE_SQUARE: "foliplus-shape-square",
} as const;

export { MARKER_CLASS };

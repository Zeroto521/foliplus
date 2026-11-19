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
  /** The authorized divIcon shape shells (the panel's className whitelist).
   *  A divIcon source renders one of these plus a plain-text glyph, never
   *  innerHTML — see iconSource.ts DIVICON_SHAPE. */
  SHAPE_PIN: "foliplus-shape-pin",
  SHAPE_SQUARE: "foliplus-shape-square",
} as const;

export { MARKER_CLASS };

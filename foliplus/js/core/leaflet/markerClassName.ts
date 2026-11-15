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
} as const;

export { MARKER_CLASS };

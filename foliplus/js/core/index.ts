// core — shared core domain modules (pure logic, no CONF/DOM).
// Each subdomain (layer, geo, geocode, events, …) lives in its own
// subdirectory; this index is the single export surface for consumers.
export { COORD_BOUNDS, fromWgs84, getMapCrsType, toWgs84 } from "./geo/index.js";
export { area, bearing, centroid, distance, midpoint } from "./geo/index.js";
export type { LatLngPoint } from "./geo/index.js";
export {
  BUILTIN_FACTORIES,
  BUILTIN_PROVIDERS,
  NOMINATIM,
  cacheSuggestion,
  createNominatim,
  createPelias,
  createPhoton,
  createThrottleQueue,
  formatAddress,
  geocode,
  interpolate,
  joinUrl,
  nominatimUrl,
  providerFromConfig,
  resolveProvider,
  reverseGeocode,
  safeEval,
  toItems,
  withParams,
} from "./geocode/index.js";
export type {
  GeocodeProvider,
  GeocodeResult,
  ProviderConfig,
  ProviderOpConfig,
  SuggestItem,
} from "./geocode/index.js";
export * from "./layer/index.js";
export {
  AUTO_FIELD,
  autoLabelField,
  collectLabelFields,
  isNumericField,
  resolveSelectedField,
} from "./labelField.js";
export type { LabelField } from "./labelField.js";
export {
  HIDE_OVERLAP,
  hOverlap,
  hides,
  planVisible,
  vOverlap,
} from "./labelCollision.js";
export type { Box, PlacedLabel } from "./labelCollision.js";
export { createControlEnv } from "./controlEnv.js";
export { registerHintIcon } from "./hint.js";
export * from "./event/index.js";
export * from "./mode.js";
export { ListCursor } from "./listCursor.js";
export type {
  ListCursorMode,
  ListCursorOptions,
  ListCursorRoles,
} from "./listCursor.js";

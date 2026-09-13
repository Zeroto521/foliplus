// core — shared core domain modules (pure logic, no CONF/DOM).
// Each subdomain (layer, geo, geocode, events, …) lives in its own
// subdirectory; this index is the single export surface for consumers.
export { COORD_BOUNDS, fromWgs84, getMapCrsType, toWgs84 } from "./geo/index.js";
export { area, bearing, centroid, distance, midpoint } from "./geo/index.js";
export type { LatLngPoint } from "./geo/index.js";
export {
  NOMINATIM,
  NominatimProvider,
  cacheSuggestion,
  createThrottleQueue,
  formatAddress,
  geocode,
  nominatimUrl,
  reverseGeocode,
} from "./geocode/index.js";
export type { GeocodeItem, GeocodeProvider, GeocodeResult } from "./geocode/index.js";
export * from "./layer/index.js";
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

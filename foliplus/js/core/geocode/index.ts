// core/geocode — pluggable geocode provider layer (pure) + the stateful
// geocoder singleton (cache + per-provider throttle queues).
export * from "./type.js";
export * from "./util.js";
export {
  BUILTIN_FACTORIES,
  BUILTIN_PROVIDERS,
  providerFromConfig,
  resolveProvider,
} from "./registry.js";
export {
  DEFAULT_BASE_URL,
  NOMINATIM,
  createNominatim,
  formatAddress,
  nominatimUrl,
} from "./nominatim.js";
export { DEFAULT_BASE_URL as DEFAULT_PHOTON_BASE_URL, createPhoton } from "./photon.js";
export { DEFAULT_BASE_URL as DEFAULT_PELIAS_BASE_URL, createPelias } from "./pelias.js";
export { createThrottleQueue } from "./rateLimit.js";
export { cacheSuggestion, geocode, reverseGeocode } from "./geocoder.js";
export type { GeocodeResult } from "./geocoder.js";

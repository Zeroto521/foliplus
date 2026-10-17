// core/geocode — pluggable geocode provider layer (pure) + the stateful
// geocoder singleton (cache + per-provider throttle queues).
export * from "./type.js";
export * from "./util.js";
export { BUILTIN_PROVIDERS, providerFromConfig, resolveProvider } from "./registry.js";
export { createNominatim, formatAddress, nominatimUrl } from "./nominatim.js";
export { createPhoton } from "./photon.js";
export { createPelias } from "./pelias.js";
export { createThrottleQueue, lastRequestAt, markRequest } from "./rateLimit.js";
export { cacheSuggestion, geocode, reverseGeocode } from "./geocoder.js";

// core/geocode — pure geocode provider layer (no mutable state).
// The stateful singleton (cache + throttle queues) lives in runtime/geocoder.ts.
export * from "./type.js";
export * from "./util.js";
export {
  BUILTIN_FACTORIES,
  BUILTIN_PROVIDERS,
  providerFromConfig,
  resolveProvider,
} from "./registry.js";
export { createNominatim } from "./nominatim.js";
export { createPhoton } from "./photon.js";
export { createPelias } from "./pelias.js";

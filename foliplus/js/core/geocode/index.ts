// core/geocode — geocoding subdomain (Nominatim provider + shared rate limit).
export {
  NOMINATIM,
  NominatimProvider,
  formatAddress,
  nominatimUrl,
} from "./nominatim.js";
export type { GeocodeItem, GeocodeProvider } from "./provider.js";
export { createThrottleQueue } from "./rateLimit.js";
export { cacheSuggestion, geocode, reverseGeocode } from "./geocoder.js";
export type { GeocodeResult } from "./geocoder.js";

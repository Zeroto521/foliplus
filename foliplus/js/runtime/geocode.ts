// Geocoding is now part of runtime/index.ts (single-file runtime).
// This re-export preserves the legacy import path for tests and consumers.
export { geocode, reverseGeocode, type GeocodeResult } from "./index.js";

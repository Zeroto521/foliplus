// Shared helpers for core unit tests.
//
// The GeoJSON readers live in the suite-wide `test/js/fixture.ts`; re-export
// them here so core tests import from a subdirectory fixture instead of
// climbing back to test/js.
export { loadFeature, loadGeoJSON, loadGeometry } from "../fixture.js";

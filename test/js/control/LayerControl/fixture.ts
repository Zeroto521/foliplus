// Shared helpers for LayerControl unit tests.
//
// The GeoJSON readers live in the suite-wide `test/js/fixture.ts`; re-export
// them here so deeper LayerControl tests (label/*, domain/*, …) import
// from a subdirectory fixture instead of climbing back to test/js.
export { loadFeature, loadGeoJSON, loadGeometry } from "../fixture.js";

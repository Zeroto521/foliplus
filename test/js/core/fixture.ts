// Shared helpers for core unit tests.
//
// The GeoJSON readers live in the suite-wide `test/js/fixture.ts`; re-export
// them here so core tests import from a subdirectory fixture instead of
// climbing back to test/js. The map stand-in below is the shape the overlay
// registry and the panel controller both need: an `on` hook that records the
// map's unload handler, plus a way to fire it.
import type * as L from "leaflet";
import { vi } from "vitest";

export { loadFeature, loadGeoJSON, loadGeometry } from "../fixture.js";

/** A map stand-in: both the overlay registry and the panel controller only
 *  need the map's unload hook, so this hands back the handler's trigger. */
const makeUnloadMap = () => {
  let unload: () => void = () => undefined;
  const on = vi.fn((event: string, handler: () => void) => {
    if (event === "unload") unload = handler;
  });
  return {
    map: { on } as unknown as L.Map,
    fireUnload: () => unload(),
  };
};

export { makeUnloadMap };

// Shared fixtures for MeasureControl unit tests.
//
// makeManager mirrors the measure runtime globals (L, the map, and LayerAPI)
// and returns a manager whose store and filter record can be exercised without
// a browser; mockLayerAPI is the CreateLayersAPI stub both factories share.
// The module mocks stay in each test file: they must be hoisted above the
// manager import, and a fixture cannot register them on the caller's behalf.
import { makeControlEnv } from "../fixture.js";
import { vi } from "vitest";
import { MeasureManager } from "#control/MeasureControl/manager.js";

// Re-export the shared helpers so deeper MeasureControl tests (mode/*) can
// import from this subdirectory fixture instead of climbing to test/js.
export { makeControlEnv };
export { loadFeature, loadGeoJSON, loadGeometry } from "../fixture.js";

/** Shared mock LayerAPI factory — builds a CreateLayersAPI with spy methods. */
function mockLayerAPI() {
  // The real mainLayer is a Leaflet LayerGroup; the filter's visibility path
  // asks it which leaves are attached, so the mock tracks membership too.
  const attached = new Set<unknown>();
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    clearLayers: vi.fn(),
    addLayer: vi.fn(l => l),
    removeLayer: vi.fn(),
    mainLayer: {
      addLayer: vi.fn((leaf: unknown) => {
        attached.add(leaf);
        return leaf;
      }),
      removeLayer: vi.fn((leaf: unknown) => {
        attached.delete(leaf);
        return leaf;
      }),
      hasLayer: vi.fn((leaf: unknown) => attached.has(leaf)),
    },
  };
}

function makeManager(opts?: { id?: string }) {
  window.CONFIG = {
    ...window.CONFIG,
    name: "MeasureControl",
    locale_code: "en",
  };

  const env = makeControlEnv();

  const layers = mockLayerAPI();

  // Mock L marker / circleMarker / divIcon for mode.ts side effects
  const mkMarker = () => {
    const m: any = {
      bindPopup: vi.fn(() => m),
      openPopup: vi.fn(),
      addTo: vi.fn(() => m),
      getPopup: () => null,
      setPopupContent: vi.fn(),
      closePopup: vi.fn(),
      getLatLng: vi.fn(() => ({ lat: 0, lng: 0 })),
      setLatLng: vi.fn(),
      getElement: vi.fn(() => null),
    };
    m.on = vi.fn(() => m);
    m.off = vi.fn(() => m);
    return m;
  };
  window.L.marker = vi.fn(mkMarker);
  window.L.circleMarker = vi.fn(() => ({}));
  window.L.divIcon = vi.fn(() => ({}));
  window.L.polyline = vi.fn(() => ({ addTo: vi.fn(), on: vi.fn() }));
  window.L.polygon = vi.fn(() => ({ addTo: vi.fn(), on: vi.fn() }));
  window.L.latLng = vi.fn((lat, lng) => ({ lat, lng }));

  const container = document.createElement("div");
  const map = {
    getContainer: () => container,
    on: vi.fn(),
    off: vi.fn(),
    eachLayer: vi.fn(),
    getSize: (..._args: unknown[]) => ({ x: 1000, y: 800 }),
    latLngToContainerPoint: (..._args: unknown[]) => ({ x: 0, y: 0 }),
    foliplus: {
      showHint: vi.fn(),
      hideHint: vi.fn(),
      interaction: { shortcuts: [] as Array<Record<string, unknown>> },
      events: { emit: vi.fn(), publish: vi.fn() },
      LayerAPI: {
        createLayers: vi.fn(() => layers),
      },
    },
  };

  const manager = new MeasureManager(map, env, opts);
  manager.init();
  return { manager, map, container, layers };
}

/** Reset the shared globals a Measure test must not leak into the next one. */
function resetMeasureControlState() {
  document.body.innerHTML = "";
  window.localStorage.clear();
  // CONFIG is shared process-wide; a declared-filter test must not leak its
  // declaration into the next manager.
  window.CONFIG = { ...window.CONFIG, filter: null };
}

export { makeManager, mockLayerAPI, resetMeasureControlState };

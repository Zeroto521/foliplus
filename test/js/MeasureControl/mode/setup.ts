// Shared Leaflet + turf mock setup for MeasureControl mode tests.
// Each test file imports initMocks and calls it inside beforeEach.
import { vi } from "vitest";

export function initMocks() {
  vi.clearAllMocks();

  window.L.circleMarker = vi.fn(() => ({
    bringToFront: vi.fn(),
    on: vi.fn(),
    getLatLng: vi.fn(() => ({ lat: 31, lng: 121 })),
    getElement: vi.fn(() => null),
  }));

  window.L.polyline = vi.fn(() => ({
    addLatLng: vi.fn(),
    setLatLngs: vi.fn(),
    getElement: vi.fn(() => null),
    on: vi.fn(),
  }));

  window.L.polygon = vi.fn(() => ({
    setLatLngs: vi.fn(),
    getElement: vi.fn(() => null),
    on: vi.fn(),
  }));

  window.L.circle = vi.fn(() => ({
    setRadius: vi.fn(),
    getElement: vi.fn(() => null),
    on: vi.fn(),
  }));

  window.L.marker = vi.fn(() => ({
    setLatLng: vi.fn(),
    setIcon: vi.fn(),
    on: vi.fn(),
    bringToFront: vi.fn(),
    getElement: vi.fn(() => null),
    setZIndexOffset: vi.fn(),
    bindPopup: vi.fn(() => ({})),
    openPopup: vi.fn(),
    getPopup: vi.fn(() => null),
    setPopupContent: vi.fn(),
    addTo: vi.fn(),
    getLatLng: vi.fn(() => ({ lat: 0, lng: 0 })),
  }));

  window.L.divIcon = vi.fn(opts => ({ _mockDivIconHtml: opts?.html }));

  window.L.latLng = vi.fn((lat, lng) => ({ lat, lng }));

  window.L.DomEvent = {
    ...window.L.DomEvent,
    stopPropagation: vi.fn(event => {
      if (event?.originalEvent) event.originalEvent._stopped = true;
    }),
  };

  globalThis.turf = {
    point: coords => ({ coords }),
    distance: vi.fn(() => 100),
    bearing: vi.fn(() => 45),
    midpoint: vi.fn(() => ({ geometry: { coordinates: [0, 0] } })),
    area: vi.fn(() => 1000),
    destination: vi.fn((coord, _, bearing) => ({
      geometry: { coordinates: [coord[0] + bearing, coord[1] + bearing] },
    })),
    polygon: vi.fn(rings => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: rings },
    })),
    circle: vi.fn(() => ({
      geometry: {
        coordinates: [
          [
            [121.0, 31.0],
            [121.001, 31.0],
            [121.002, 31.0],
            [121.001, 31.001],
            [121.0, 31.002],
            [120.999, 31.001],
            [120.998, 31.0],
            [120.999, 31.0],
            [121.0, 31.0],
          ],
        ],
      },
    })),
  };
}

export function makeManagerMock() {
  return {
    map: {
      on: vi.fn(),
      off: vi.fn(),
      removeLayer: vi.fn(),
      getContainer: () => document.createElement("div"),
    },
    layers: {
      addLayer: vi.fn(l => l),
      removeLayer: vi.fn(),
      mainLayer: { addLayer: vi.fn(l => l) },
    },
    nextMeasurementId: vi.fn(() => "test-id"),
    saveMeasurements: vi.fn(),
    clearActiveMode: vi.fn(),
    cleanMapEvents: vi.fn(),
    currentMode: null,
    measurements: [],
    finalizedClickHandlers: [],
  };
}

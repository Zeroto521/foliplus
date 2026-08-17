// Shared Leaflet + turf mock setup for MeasureControl mode tests.
// Each test file imports initMocks and calls it inside beforeEach.
import { vi } from "vitest";

export function initMocks() {
  vi.clearAllMocks();

  window.L.circleMarker = vi.fn(() => ({
    bringToFront: vi.fn(),
    on: vi.fn(),
    getLatLng: vi.fn(() => ({ lat: 31, lng: 121 })),
  }));

  window.L.polyline = vi.fn(() => ({
    addLatLng: vi.fn(),
    setLatLngs: vi.fn(),
    getElement: vi.fn(() => null),
    on: vi.fn(),
  }));

  window.L.polygon = vi.fn(() => ({
    setLatLngs: vi.fn(),
  }));

  window.L.circle = vi.fn(() => ({
    setRadius: vi.fn(),
  }));

  window.L.marker = vi.fn(() => ({
    setLatLng: vi.fn(),
    setIcon: vi.fn(),
    on: vi.fn(),
    bringToFront: vi.fn(),
    getElement: vi.fn(() => null),
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
    wkt: {
      toWKT: feature => {
        const geom = feature.geometry;
        if (!geom) return "";
        if (geom.type === "Point") {
          const [lng, lat] = geom.coordinates;
          return "POINT(" + lng + " " + lat + ")";
        }
        if (geom.type === "LineString") {
          const pts = geom.coordinates.map(([lng, lat]) => lng + " " + lat).join(", ");
          return "LINESTRING(" + pts + ")";
        }
        if (geom.type === "Polygon") {
          const ring = geom.coordinates[0].map(([lng, lat]) => lng + " " + lat).join(", ");
          return "POLYGON((" + ring + "))";
        }
        return "";
      },
    },
  };
}

export function makeManagerMock() {
  return {
    map: {
      on: vi.fn(),
      off: vi.fn(),
      getContainer: () => document.createElement("div"),
    },
    layers: { addLayer: vi.fn(l => l), removeLayer: vi.fn() },
    nextMeasurementId: vi.fn(() => "test-id"),
    saveMeasurements: vi.fn(),
    clearActiveMode: vi.fn(),
    cleanMapEvents: vi.fn(),
    currentMode: null,
    measurements: [],
  };
}

// Shared Leaflet + turf mock setup for MeasureControl mode tests.
// Each test file imports initMocks and calls it inside beforeEach.
import { vi } from "vitest";
import { isDragSyntheticClick } from "#foliplus/MeasureControl/edit.js";

export function initMocks() {
  vi.clearAllMocks();
  // Consume any pending drag-synthetic-click flag so a prior test's drag end
  // doesn't leak into the next test's click handler.
  isDragSyntheticClick();

  window.L.circleMarker = vi.fn(() => ({
    bringToFront: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    setLatLng: vi.fn(),
    getLatLng: vi.fn(() => ({ lat: 31, lng: 121 })),
    getElement: vi.fn(() => null),
  }));

  window.L.polyline = vi.fn(() => ({
    addLatLng: vi.fn(),
    setLatLngs: vi.fn(),
    getElement: vi.fn(() => null),
    on: vi.fn(),
    off: vi.fn(),
  }));

  window.L.polygon = vi.fn(() => ({
    setLatLngs: vi.fn(),
    getElement: vi.fn(() => null),
    on: vi.fn(),
    off: vi.fn(),
  }));

  window.L.circle = vi.fn(() => ({
    setRadius: vi.fn(),
    getRadius: vi.fn(() => 1000),
    setLatLng: vi.fn(),
    getLatLng: vi.fn(() => ({ lat: 31, lng: 121 })),
    getElement: vi.fn(() => null),
    on: vi.fn(),
    off: vi.fn(),
  }));

  const markerFactory = vi.fn(() => {
    const m: any = {
      setLatLng: vi.fn(),
      setIcon: vi.fn(),
      bringToFront: vi.fn(),
      getElement: vi.fn(() => null),
      setZIndexOffset: vi.fn(),
      bindPopup: vi.fn(() => ({})),
      openPopup: vi.fn(),
      closePopup: vi.fn(),
      getPopup: vi.fn(() => null),
      setPopupContent: vi.fn(),
      addTo: vi.fn(() => m),
      getLatLng: vi.fn(() => ({ lat: 0, lng: 0 })),
    };
    m.on = vi.fn(() => m);
    m.off = vi.fn(() => m);
    return m;
  });
  window.L.marker = markerFactory;

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
  const finalizedClickHandlers: Array<() => void> = [];
  // Backing array so add/remove/update mutate the same live list the tests
  // assert against via manager.measurements (compatibility getter path).
  const measurements: any[] = [];
  return {
    map: {
      on: vi.fn(),
      off: vi.fn(),
      removeLayer: vi.fn(),
      getContainer: () => document.createElement("div"),
      mouseEventToContainerPoint: vi.fn(
        (raw: { clientX: number; clientY: number }) => ({
          x: raw.clientX,
          y: raw.clientY,
        }),
      ),
      dragging: { disable: vi.fn(), enable: vi.fn() },
    },
    layers: {
      addLayer: vi.fn(l => l),
      removeLayer: vi.fn(),
      unregister: vi.fn(),
      mainLayer: { addLayer: vi.fn(l => l) },
    },
    nextMeasurementId: vi.fn(() => "test-id"),
    saveMeasurements: vi.fn(),
    clearActiveMode: vi.fn(),
    cleanMapEvents: vi.fn(),
    registerEditOverlayCloser: vi.fn(() => () => {}),
    registerEditDragToggle: vi.fn(() => () => {}),
    registerFinalized: vi.fn((cleanup: () => void) => {
      finalizedClickHandlers.push(cleanup);
      return () => {
        const i = finalizedClickHandlers.indexOf(cleanup);
        if (i !== -1) finalizedClickHandlers.splice(i, 1);
      };
    }),
    store: {
      all: () => measurements,
      count: () => measurements.length,
      add: vi.fn((data: any) => {
        measurements.push(data);
      }),
      remove: vi.fn((id: string) => {
        // Remove all matches — mirrors the real store's behavior.
        const matches = measurements.map((m: any) => m.id === id);
        measurements.splice(
          0,
          measurements.length,
          ...measurements.filter((m: any) => m.id !== id),
        );
      }),
      update: vi.fn((id: string, patch: any) => {
        const m = measurements.find((x: any) => x.id === id);
        if (m) Object.assign(m, patch);
      }),
      load: vi.fn(() => measurements),
      hydrate: vi.fn((data: any[]) => {
        measurements.length = 0;
        measurements.push(...data);
      }),
      persist: vi.fn(),
      emitCount: vi.fn(),
      nextId: vi.fn(() => "test-id"),
      clear: vi.fn(() => {
        measurements.length = 0;
      }),
    },
    currentMode: null,
    isEditMode: false,
    get measurements() {
      return measurements;
    },
    set measurements(v: any[]) {
      measurements.length = 0;
      measurements.push(...v);
    },
    finalizedClickHandlers,
  };
}

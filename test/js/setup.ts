// Vitest setup — runs before all test file imports.
// Sets up global mocks needed by module-level code (e.g. `const foliplus = window.foliplus`).
// Use vi.fn() so tests can spy on calls even when module captures at import time.
import { vi } from "vitest";

// Spec-compliant in-memory Web Storage fallback.
// Node.js (24.19+, and newer 24.x used by CI) exposes an experimental global
// `localStorage` getter. Without `--localstorage-file` it yields undefined (or
// throws), and vitest's populateGlobal then skips jsdom's real localStorage
// because the key already exists on the global. Provide a fallback whenever the
// environment lacks a working localStorage so storage tests run identically
// locally and in CI.
class MockStorage {
  private _store: Record<string, string>;

  constructor() {
    this._store = {};
  }
  get length() {
    return Object.keys(this._store).length;
  }
  clear() {
    this._store = {};
  }
  getItem(key) {
    return key in this._store ? this._store[key] : null;
  }
  setItem(key, value) {
    this._store[key] = String(value);
  }
  removeItem(key) {
    delete this._store[key];
  }
  key(index) {
    return Object.keys(this._store)[index] ?? null;
  }
}

let hasLocalStorage = true;
try {
  hasLocalStorage = Boolean(window.localStorage);
} catch {
  hasLocalStorage = false;
}
if (!hasLocalStorage) {
  Object.defineProperty(window, "localStorage", {
    value: new MockStorage(),
    configurable: true,
    writable: true,
  });
}

// Mock window.foliplus runtime (must be set before module imports that capture it)
window.foliplus = {
  showHint: vi.fn(),
  hideHint: vi.fn(),
  registerHintIcon: vi.fn(),
  geocode: vi.fn(),
  reverseGeocode: vi.fn(() => Promise.resolve("")),
  cacheSuggestion: vi.fn(),
  HINT_DURATION: { SHORT: 1200, MEDIUM: 2500, LONG: 4000, PERSIST: 0 },
};

// Mock L (Leaflet)
window.L = {
  DomEvent: {
    disableClickPropagation: vi.fn(),
    disableScrollPropagation: vi.fn(),
  },
  Control: class {},
  latLng: (lat, lng) => ({ lat, lng }),
  point: (x, y) => ({ x, y }),
  marker: vi.fn(() => ({
    bindPopup: vi.fn(),
    openPopup: vi.fn(),
    addTo: vi.fn(),
    getPopup: () => null,
    on: vi.fn(),
  })),
  divIcon: vi.fn(() => ({})),
  Path: class {},
  Polygon: class {},
  Polyline: class {},
  CircleMarker: class {},
};

// L.Path.prototype.bringToFront is captured at module import time by
// LayerControl.manager.js — set it up before test imports.
window.L.Path.prototype.bringToFront = vi.fn();

// Mock Jinja IIFE free variables
window.CONF = {
  name: "SearchControl",
  zoom: 16,
  locale_code: "en",
  position: "topleft",
  mode: "coord",
};
window.map = {
  foliplus: {
    showHint: vi.fn(),
    hideHint: vi.fn(),
  },
  flyTo: vi.fn(),
  addLayer: vi.fn(),
  getCenter: () => ({ lng: 119.3, lat: 26.08 }),
  getContainer: () => {
    const el = document.createElement("div");
    el.id = "test-map";
    document.body.appendChild(el);
    return el;
  },
  eachLayer: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  removeLayer: vi.fn(),
};

// Mock turf (needed by MeasureControl: turf.circle, turf.distance, etc.
// export.ts implements WKT inline (no turf.wkt dependency).
globalThis.turf = {
  point: coords => ({
    type: "Feature",
    properties: {},
    geometry: { type: "Point", coordinates: coords },
  }),
  distance: () => 100,
  bearing: () => 45,
  midpoint: () => ({ geometry: { coordinates: [0, 0] } }),
  area: () => 1000,
  polygon: () => ({ type: "Feature", geometry: { type: "Polygon" } }),
  circle: () => ({
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [2, 0],
          [2, 1],
          [1, 2],
          [0, 2],
          [-1, 1],
          [-1, 0],
          [0, 0],
        ],
      ],
    },
  }),
};

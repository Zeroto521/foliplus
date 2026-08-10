// Vitest setup — runs before all test file imports.
// Sets up global mocks needed by module-level code (e.g. `const foliplus = window.foliplus`).
// Use vi.fn() so tests can spy on calls even when module captures at import time.
import { vi } from "vitest";

// Mock window.foliplus runtime (must be set before module imports that capture it)
window.foliplus = {
  showHint: vi.fn(),
  hideHint: vi.fn(),
  registerHintIcon: vi.fn(),
  HINT_DURATION: { SHORT: 1200, MEDIUM: 2500, LONG: 4000, PERSIST: 0 },
};

// Mock localStorage for Node 24 compat (native localStorage requires --localstorage-file).
// jsdom provides localStorage via window, but Node 24's globalThis.localStorage is
// undefined when the flag is absent, which can shadow jsdom's version.
const store = {};
globalThis.localStorage = {
  getItem: vi.fn(key => store[key] ?? null),
  setItem: vi.fn((key, val) => {
    store[key] = String(val);
  }),
  removeItem: vi.fn(key => {
    delete store[key];
  }),
  clear: vi.fn(() => {
    for (const k in store) delete store[k];
  }),
  get length() {
    return Object.keys(store).length;
  },
  key: vi.fn(i => Object.keys(store)[i] ?? null),
};

// Mock L (Leaflet)
window.L = {
  DomEvent: {
    disableClickPropagation: vi.fn(),
    disableScrollPropagation: vi.fn(),
  },
  Control: class {},
  latLng: (lat, lng) => ({ lat, lng }),
  marker: vi.fn(() => ({
    bindPopup: vi.fn(),
    openPopup: vi.fn(),
    addTo: vi.fn(),
    getPopup: () => null,
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
  flyTo: vi.fn(),
  addLayer: vi.fn(),
  getCenter: () => ({ lng: 119.3, lat: 26.08 }),
  getContainer: () => ({ id: "test" }),
  eachLayer: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  removeLayer: vi.fn(),
};

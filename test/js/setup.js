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

// Redirect globalThis.localStorage to jsdom's real Storage implementation.
// Node 24 defines globalThis.localStorage as a read-only getter that returns
// `undefined` (without the flag --experimental-webstorage --localstorage-file),
// which shadows jsdom's window.localStorage in vitest.  A plain assignment is
// silently ignored, so we must redefine the property with defineProperty.
// This ensures the real jsdom Storage is always used regardless of Node
// version or CLI flags.
Object.defineProperty(globalThis, "localStorage", {
  value: window.localStorage,
  configurable: true,
  writable: true,
});

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

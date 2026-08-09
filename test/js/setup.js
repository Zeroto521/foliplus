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
};

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
  eachLayer: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  removeLayer: vi.fn(),
};

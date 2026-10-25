// Shared setup for ui/*.test.ts — pure utility helpers.
// Each test file owns its own vi.hoisted/vi.mock/beforeEach; those are
// compile-time directives that cannot be factored out.
import { vi } from "vitest";
import { createScopedTranslator } from "#common/locale.js";

/** A CONFIG for the measure UI with the delete-icon locale the UI renders
 *  (ComponentName-prefixed keys, like the Python bridge emits). */
const makeConfig = (overrides: Partial<ComponentConfig> = {}): ComponentConfig => ({
  name: "MeasureControl",
  locale_code: "en",
  locale_tables: {
    en: {
      "MeasureControl.del_all": "Delete measurement",
      "MeasureControl.del_node": "Delete point",
    },
  },
  ...overrides,
});

/** MeasureManager-shaped fake carrying its own `config` and a translator bound
 *  to it — mirroring the real manager (which binds `this.T = T` in its
 *  constructor) so the UI reads delete-icon titles through the per-instance
 *  translator, never an ambient module-level one. */
const makeMgr = (config: ComponentConfig = makeConfig()) => {
  const translator = createScopedTranslator(config);
  const T = vi.fn((key: string) => translator(key));
  return {
    map: {
      on: vi.fn(),
      off: vi.fn(),
      mouseEventToContainerPoint: vi.fn(() => ({ x: 0, y: 0 })),
      dragging: { enable: vi.fn(), disable: vi.fn() },
    },
    isEditMode: true,
    config,
    T,
    registerEditOverlayCloser: vi.fn(() => () => {}),
    registerEditDragToggle: vi.fn(() => () => {}),
    registerFinalized: vi.fn(() => () => {}),
    registerLabel: vi.fn(() => () => {}),
    closeOtherEditOverlays: vi.fn(),
  };
};

/** Install the window.L and globalThis.turf stubs every ui test needs.
 *  Call from beforeEach (after vi.clearAllMocks) — the mocks are fresh
 *  per test so each test can inspect `window.L.<factory>.mock.calls`. */
const installStubs = () => {
  window.L = {
    marker: vi.fn(() => ({
      getElement: vi.fn(() => null),
      on: vi.fn(),
      off: vi.fn(),
      setLatLng: vi.fn(),
    })),
    // buildNode builds L.CircleMarker nodes (shared with the edit-mode node
    // markers and the center dot); stub it so polygon-mode UI tests reach
    // rebuildCentroid.
    circleMarker: vi.fn(() => ({
      getElement: vi.fn(() => null),
      on: vi.fn(),
      off: vi.fn(),
      setLatLng: vi.fn(),
      getLatLng: vi.fn(() => ({ lat: 0, lng: 0 })),
    })),
    latLng: vi.fn((lat: number, lng: number) => ({ lat, lng })),
    divIcon: vi.fn(() => ({})),
    DomEvent: { stopPropagation: vi.fn() },
  };
  globalThis.turf = {
    point: (coords: unknown) => ({ coords }),
    distance: vi.fn(() => 100),
    bearing: vi.fn(() => 45),
    midpoint: vi.fn(() => ({
      geometry: { coordinates: [0, 0] },
    })),
    area: vi.fn(() => 1000),
    polygon: vi.fn(rings => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: rings },
    })),
  };
};

export { installStubs, makeConfig, makeMgr };

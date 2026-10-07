// Shared fixtures for HeatmapControl unit tests.
// makeManager mirrors the heatmap runtime globals (h3/chroma/ss/LayerAPI);
// makeCtrl builds the HeatmapControlUI state object carrying its own CONFIG so
// the UI functions can be exercised with per-instance configuration.
import { vi } from "vitest";
import { HeatmapManager } from "#foliplus/HeatmapControl/manager.js";
import type { HeatmapControlUI } from "#foliplus/HeatmapControl/ui.js";
import { createScopedTranslator } from "#common/locale.js";

/** A CONFIG with the heatmap fields the UI functions read, in English. */
const makeConfig = (overrides: Partial<ComponentConfig> = {}): ComponentConfig => ({
  name: "HeatmapControl",
  locale_code: "en",
  schemes: ["Reds", "Blues", "Greens"],
  num_classes: 6,
  method: "jenks",
  color_scheme: "Reds",
  label_show: true,
  border_weight: 1.5,
  border_color: "#333333",
  field: null,
  // Locale tables normally arrive inside CONFIG from the Python bridge; provide
  // the keys the hint assertions rely on so the scoped translator resolves.
  locale_tables: {
    en: {
      "HeatmapControl.no_layer": "No point layers found",
      "HeatmapControl.no_layercontrol": "HeatmapControl requires LayerControl",
    },
  },
  ...overrides,
});

/** Build a real HeatmapManager with all external deps stubbed out. */
function makeManager(confOverrides: Partial<ComponentConfig> = {}) {
  // Mutate in place — module-level `T = createScopedTranslator(CONFIG)` captured
  // the setup-time object; replacing window.CONFIG would strand that reference
  // on SearchControl and meta keys would resolve to the wrong prefix.
  // `confOverrides` wins last so a test can omit/replace a key (including
  // setting it to undefined to simulate a CONFIG that never sent it).
  Object.assign(
    window.CONFIG,
    {
      name: "HeatmapControl",
      color_scheme: "Reds",
      method: "jenks",
      num_classes: 6,
      agg: "count",
      field: null,
      fill_opacity: 0.7,
      border_color: "#333333",
      border_weight: 1.5,
      border_opacity: 0.9,
      label_show: true,
      label_color: "#fff",
      label_size: 11,
      label_format: "auto",
    },
    confOverrides,
  );

  globalThis.h3 = {
    latLngToCell: vi.fn(() => "abc123"),
    cellToLatLng: vi.fn(() => [26.08, 119.3]),
    cellToBoundary: vi.fn(() => [
      [26.08, 119.3],
      [26.09, 119.3],
      [26.09, 119.31],
      [26.08, 119.31],
      [26.08, 119.3],
    ]),
  };
  globalThis.chroma = {
    scale: vi.fn(() => ({
      mode: vi.fn(() => ({
        colors: vi.fn(() => ["#ff0000", "#00ff00", "#0000ff"]),
      })),
    })),
  };
  globalThis.ss = {
    ckmeans: vi.fn(data => data.map(v => [v])),
    quantileSorted: vi.fn((sorted, q) => sorted[Math.floor(q * (sorted.length - 1))]),
  };

  window.map.foliplus = {
    LayerAPI: {
      getLayersByType: vi.fn(() => []),
      extractPoints: vi.fn(() => []),
      touchLayer: vi.fn(() => true),
      createCanvas: vi.fn(() => {
        const canvas = document.createElement("canvas");
        return {
          register: vi.fn(),
          unregister: vi.fn(),
          setVisible: vi.fn(),
          hooks: { before: [], after: [] },
          canvas,
          ctx: canvas.getContext("2d"),
        };
      }),
    },
  };

  const map = {
    getContainer: vi.fn(),
    getBounds: vi.fn(),
    getZoom: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
  const manager = new HeatmapManager(map, {
    T: createScopedTranslator(window.CONFIG),
    log: { warn: () => {}, error: () => {}, msg: (m: string) => m },
  });
  manager.overlay = {
    canvas: null,
    ctx: null,
    register: vi.fn(),
    unregister: vi.fn(),
    setVisible: vi.fn(),
    hooks: { before: [], after: [] },
  };
  return manager;
}

/** HeatmapControlUI-shaped fixture carrying its own CONFIG + translator. */
function makeCtrl(
  mgr: HeatmapManager,
  config: ComponentConfig = makeConfig(),
): HeatmapControlUI {
  // initScan reaches the map via ctrl.mgr.map — mirror the window.map foliplus
  // stub (LayerAPI + showHint) onto the manager's map so the API and hint
  // paths resolve to the same mocks the tests stub.
  (mgr.map as unknown as { foliplus?: unknown }).foliplus = window.map.foliplus;
  return {
    mgr,
    // The real control routes document-level listeners through its mounting
    // signal (BaseControl.on). The fixture has no signal, so it binds for
    // real and hands back the matching unbind — the outside-click tests
    // dispatch a genuine document click.
    on: (target, type, fn) => {
      target.addEventListener(type, fn);
      return () => target.removeEventListener(type, fn);
    },
    config,
    T: createScopedTranslator(config),
    ctrl: document.createElement("div"),
    schemeDropdown: null,
    expandHookDone: false,
    schemeBarCleanup: null,
    dropdownCleanup: null,
    toggleDropdown: null,
    selectScheme: null,
    observer: null,
    layerSelect: document.createElement("select"),
    extraBody: document.createElement("div"),
    fieldWrap: document.createElement("div"),
    fieldSelect: document.createElement("select"),
    aggSelect: document.createElement("select"),
    methodSelect: document.createElement("select"),
    classSelect: document.createElement("select"),
    schemeControlWrap: document.createElement("div"),
    schemeBar: document.createElement("div"),
    schemeBarInner: document.createElement("div"),
    schemeSelectHidden: document.createElement("select"),
    closeSchemeDropdown: () => undefined,
    toggleSchemeDropdown: () => undefined,
  };
}

export { makeConfig, makeCtrl, makeManager };

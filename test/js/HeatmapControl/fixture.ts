// Shared fixtures for HeatmapControl unit tests.
// makeManager mirrors the heatmap runtime globals (h3/chroma/ss/LayerAPI);
// makeCtrl builds the HeatmapControlUI state object carrying its own CONF so
// the UI functions can be exercised with per-instance configuration.
import { vi } from "vitest";
import { HeatmapManager } from "#foliplus/HeatmapControl/manager.js";
import type { HeatmapControlUI } from "#foliplus/HeatmapControl/ui.js";
import { createScopedTranslator } from "#common/locale.js";

/** A CONF with the heatmap fields the UI functions read, in English. */
const makeConf = (overrides: Partial<ComponentConfig> = {}): ComponentConfig => ({
  name: "HeatmapControl",
  locale_code: "en",
  schemes: ["Reds", "Blues", "Greens"],
  n_classes: 6,
  method: "jenks",
  color_scheme: "Reds",
  label_show: true,
  border_weight: 1.5,
  border_color: "#333333",
  field: null,
  // Locale tables normally arrive inside CONF from the Python bridge; provide
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
  // Mutate in place — module-level `T = createScopedTranslator(CONF)` captured
  // the setup-time object; replacing window.CONF would strand that reference
  // on SearchControl and meta keys would resolve to the wrong prefix.
  // `confOverrides` wins last so a test can omit/replace a key (including
  // setting it to undefined to simulate a CONF that never sent it).
  Object.assign(
    window.CONF,
    {
      name: "HeatmapControl",
      color_scheme: "Reds",
      method: "jenks",
      n_classes: 6,
      agg: "count",
      field: null,
      fill_opacity: 0.7,
      border_color: "#333333",
      border_weight: 1.5,
      border_opacity: 0.9,
      label_show: true,
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
      createCanvas: vi.fn(() => ({
        register: vi.fn(),
        unregister: vi.fn(),
        setVisible: vi.fn(),
        hooks: { before: [], after: [] },
        canvas: null,
        ctx: null,
      })),
    },
  };

  const map = {
    getContainer: vi.fn(),
    getBounds: vi.fn(),
    getZoom: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
  const manager = new HeatmapManager(map);
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

/** HeatmapControlUI-shaped fixture carrying its own CONF + translator. */
function makeCtrl(
  m: HeatmapManager,
  conf: ComponentConfig = makeConf(),
): HeatmapControlUI {
  // initScan reaches the map via ctrl.m.map — mirror the window.map foliplus
  // stub (LayerAPI + showHint) onto the manager's map so the API and hint
  // paths resolve to the same mocks the tests stub.
  (m.map as unknown as { foliplus?: unknown }).foliplus = window.map.foliplus;
  return {
    m,
    conf,
    T: createScopedTranslator(conf),
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
    borderColorInput: document.createElement("input"),
    borderWeightInput: document.createElement("input"),
    labelChk: document.createElement("input"),
    closeSchemeDropdown: () => undefined,
    toggleSchemeDropdown: () => undefined,
  };
}

export { makeConf, makeCtrl, makeManager };

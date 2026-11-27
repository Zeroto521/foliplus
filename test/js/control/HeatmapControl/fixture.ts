// Shared fixtures for HeatmapControl unit tests.
// makeManager mirrors the heatmap runtime globals (h3/chroma/ss/LayerAPI);
// makeCtrl builds the HeatmapControlUI state object carrying its own CONFIG so
// the UI functions can be exercised with per-instance configuration.
import { vi } from "vitest";
import { EVENTS, type ensureEvents } from "#core/event/index.js";
import type { LayerFilter } from "#core/layer/index.js";
import { createScopedTranslator, createTranslator } from "#platform/locale.js";
import { createTimers } from "#platform/timer.js";
import { HeatmapManager } from "#control/HeatmapControl/manager.js";
import type { HeatmapControlUI } from "#control/HeatmapControl/ui.js";

// Re-export the shared GeoJSON readers so sibling tests import from the
// control's own fixture module instead of climbing to test/js.
export { loadFeature, loadGeoJSON, loadGeometry } from "../fixture.js";

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
  folder: null,
  // Locale tables normally arrive inside CONFIG from the Python bridge; provide
  // the keys the hint assertions rely on so the scoped translator resolves.
  locale_tables: {
    en: {
      "HeatmapControl.no_layer": "No point layers found",
      "HeatmapControl.no_layercontrol": "HeatmapControl requires LayerControl",
      "HeatmapControl.needs_numeric_field":
        "Needs a numeric field to aggregate by value",
    },
  },
  ...overrides,
});

/** Install the process-wide HeatmapControl dependencies (CONFIG, h3, chroma,
 *  ss). Split from the manager builder so a test that supplies its own map
 *  (the LayerAPI integration suite) gets the same globals without the stub
 *  map's LayerAPI overwriting the real one for longer than construction.
 *
 *  NOTE: this writes a stub `window.map.foliplus.LayerAPI`. A caller that
 *  needs the global `map` to resolve a real LayerAPI must restore it after
 *  construction — the manager's own reads go through `this.map`. */
function installHeatmapGlobals(confOverrides: Partial<ComponentConfig> = {}) {
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
      folder: null,
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
    ckmeans: vi.fn((data: any) => data.map((v: any) => [v])),
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
}

/** Build a real HeatmapManager with all external deps stubbed out. */
function makeManager(confOverrides: Partial<ComponentConfig> = {}) {
  installHeatmapGlobals(confOverrides);
  const map = {
    getContainer: vi.fn(() => {
      const c = document.createElement("div");
      c.id = "heatmap-test-map";
      return c;
    }),
    getBounds: vi.fn(),
    getZoom: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
  const manager = new HeatmapManager(map, {
    T: createScopedTranslator(window.CONFIG),
    log: { warn: () => {}, error: () => {}, debug: () => {}, msg: (m: string) => m },
  });
  manager.init();
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

/** Build a HeatmapManager on a caller-supplied map (a real LayerController
 *  fixture, for the createLayers content-signal integration tests). The map's
 *  `foliplus.LayerAPI` and `foliplus.events` are used as-is; the overlay comes
 *  from that map's real `createCanvas`. */
function makeManagerOn(
  map: any,
  confOverrides: Partial<ComponentConfig> = {},
): HeatmapManager {
  installHeatmapGlobals(confOverrides);
  const manager = new HeatmapManager(map, {
    T: createScopedTranslator(window.CONFIG),
    log: { warn: () => {}, error: () => {}, debug: () => {}, msg: (m: string) => m },
  });
  manager.init();
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
    timers: createTimers(),
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
    _: createTranslator(config),
    ctrl: document.createElement("div"),
    schemePicker: null,
    expandHookDone: false,
    schemePickerOverlayUnregister: null,
    schemePickerCleanup: null,
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
  };
}

// ── Shared filter fixtures ──────────────────────────────────────────────
// Moved here from manager.test.ts during the mixin split: the module-level
// filter/scan helpers the aspect suites all share.

/** A valid numeric-range atom on the fixture's snapshot field. */
export const RANGE = {
  kind: "atom",
  field: "score",
  op: "between",
  range: [10, 50],
} as LayerFilter;
/** A different range the user picks themselves. */
export const USER_RANGE = {
  kind: "atom",
  field: "score",
  op: "between",
  range: [20, 30],
} as LayerFilter;
/** A populated snapshot so the timing guard (empty = not painted) does not swallow the seed. */
export const snapshot = (
  ranges: Record<string, [number, number]> = { score: [0, 100] },
) =>
  ({
    points: [{ value: ranges.score?.[0] ?? 0 }],
    numericFields: Object.keys(ranges),
    ranges,
  }) as any;
/** Give a manager the inputs seedDeclaredFilter needs without a LayerAPI scan. */
export const prepare = (manager: any) => {
  manager.selectedLayerId = "pts";
  manager.availableFields = ["score"];
  manager.field = "";
  manager.cachedSnapshot = snapshot();
  manager.getSelectedPoints = vi.fn(() => []) as any;
  return manager;
};
/** A manager whose source is selected and whose snapshot is already built. */
export const seedable = (filter: unknown = RANGE) =>
  prepare(makeManager({ filter } as Partial<ComponentConfig>));
/** The reload path: read the saved record and apply it to a fresh manager. */
export const reload = (filter: unknown = RANGE) => {
  const manager = makeManager({ filter } as Partial<ComponentConfig>);
  const saved = manager.loadSavedConfig();
  if (saved) manager.applySavedConfig(saved);
  return prepare(manager);
};
/** A user write on a source with no declaration of its own. */
export const userWrite = (manager: any, filter: LayerFilter = USER_RANGE) => {
  manager.renderHexagons = vi.fn() as any;
  manager.setFilter(filter);
  return manager;
};
/** The store-backed filter value for one source (declaration or committed). */
export const fsGet = (m: any, src: string) => m.filterStore.getFilter(m.layerId, src);
/** Whether the source carries a filter (committed value or declaration). */
export const fsHas = (m: any, src: string) => fsGet(m, src) !== undefined;
/** Count of sources carrying a filter value (committed or declared). */
export const fsSize = (m: any) =>
  m.filterStore.sources(m.layerId).filter((s: string) => fsGet(m, s) !== undefined)
    .length;
/** A Marker instance the controller's extractPoints accepts. */
export const makeMarker = (value: number) => {
  const marker = new (
    window.L.Marker as unknown as new () => Record<string, unknown>
  )();
  marker.options = {};
  marker.value = value;
  marker.feature = { properties: {} };
  marker.getLatLng = () => ({ lat: 26 + value / 1000, lng: 119 + value / 1000 });
  return marker;
};
export const SCAN_DEBOUNCE = 200;

/** A real-enough layer role: the factory patches and walks its children. */
export class FakeGroup {
  options: Record<string, unknown> = {};
  private children = new Set<unknown>();
  addLayer(layer: unknown): this {
    this.children.add(layer);
    return this;
  }
  removeLayer(layer: unknown): this {
    this.children.delete(layer);
    return this;
  }
  clearLayers(): this {
    this.children.clear();
    return this;
  }
  hasLayer(layer: unknown): boolean {
    return this.children.has(layer);
  }
  getLayers(): unknown[] {
    return [...this.children];
  }
  eachLayer(fn: (layer: unknown) => void): void {
    [...this.children].forEach(fn);
  }
}
/** Set up a manager with a point layer, selected, and points extracted. */
export function setupWithPoints(
  m: HeatmapManager,
  points: Array<{ lat: number; lng: number; value: number; field?: string }>,
): void {
  const layerId = "layer1";
  m.selectedLayerId = layerId;
  m.agg = "count";
  m.field = "";
  m.numClasses = 6;
  m.method = "jenks";
  m.scheme = "Reds";
  m.labelShow = false;
  vi.spyOn(m, "redrawHeatmap").mockImplementation(() => {});
  m.map = {
    _container: { clientWidth: 800, clientHeight: 600 },
    getZoom: () => 5,
    getBounds: () => ({ isValid: () => true, contains: () => true }),
    getContainer: () => ({ clientWidth: 800, clientHeight: 600 }),
  } as any;
  m.overlay = {
    canvas: { style: {} },
    ctx: {
      setTransform: () => {},
      clearRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      fillText: () => {},
    },
    register: vi.fn(),
    unregister: vi.fn(),
    setVisible: vi.fn(),
    hooks: { before: [], after: [] },
  } as any;
  m.pointLayers = [{ id: layerId, name: "P", layer: {}, count: points.length }];
  const markers = points.map(
    (p, i) =>
      ({
        _latlng: { lat: p.lat, lng: p.lng },
        getLatLng: () => ({ lat: p.lat, lng: p.lng }),
        options: p.field ? { value: p.value } : {},
        value: p.field ? undefined : p.value,
        feature: { properties: p.field ? { [p.field]: p.value } : {} },
        _foliplus_stamp: `m${i}`,
      }) as any,
  );
  vi.spyOn(window.map.foliplus!.LayerAPI!, "extractPoints").mockReturnValue(
    markers.map(m => ({ lat: m._latlng.lat, lng: m._latlng.lng, marker: m })),
  );
  (globalThis.h3 as any).latLngToCell = vi.fn(
    (lat: number, lng: number) => `${lat}:${lng}`,
  );
}
/** A spy on the manager's own LAYER_FILTER_CHANGE channel. */
export const watchFilterEvents = (
  m: HeatmapManager,
  events: ReturnType<typeof ensureEvents>,
) => {
  const spy = vi.fn();
  events.on(EVENTS.LAYER_FILTER_CHANGE, spy);
  return spy;
};

export { makeConfig, makeCtrl, makeManager, makeManagerOn, installHeatmapGlobals };

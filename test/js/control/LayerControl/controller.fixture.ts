// test/js/control/LayerControl/controller.fixture — shared map stub and controller setup for the controller aspect suites.
import { makeDerivedUI } from "./ui/fixture.js";
import { vi } from "vitest";
import { type LayerFilterFeatures, folderLayoutKey } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { LayerController } from "#control/LayerControl/controller.js";
import { LayerIntentStore } from "#control/LayerControl/domain/index.js";

/** Build a v2 folder-layout document from a v1 order shape, for tests
 *  that seed a persisted block order. Each key also gets a folder entry with a
 *  display name equal to its key (the seeded order is all that matters here). */
export const layoutFromRoles = (
  v1Order: Record<string, string[]>,
): Record<string, unknown> => {
  const keys = new Set<string>();
  for (const list of Object.values(v1Order)) for (const k of list) keys.add(k);
  return {
    version: 2,
    folders: [...keys].map(key => ({ key, name: key })),
    order: v1Order,
    members: {},
  };
};

/** Read the persisted folder-layout document for a map (null when never written). */
export const readLayoutStorage = (map: any): Record<string, unknown> | null => {
  const stored = JSON.parse(
    window.localStorage.getItem(folderLayoutKey(map)) ?? "null",
  ) as { data?: Record<string, unknown> } | null;
  return stored?.data ?? null;
};

export const ENFORCE_ORDER_DEBOUNCE_MS = 50;

/** Build a LayerIntentStore from the old two-map fixture shape. */
export const makeStore = (
  intents: Record<string, Record<string, unknown>> = {},
  provenance: Record<string, string[]> = {},
): LayerIntentStore => {
  const store = new LayerIntentStore();
  store.replaceIntents(intents as never);
  store.replaceProvenance(provenance as never);
  return store;
};

/** Seed the persisted record so a constructor or a replay reads it. */
export const seedStorage = (record: Record<string, unknown>) => {
  window.localStorage.setItem(CONST.STORAGE.KEY, JSON.stringify(record));
};

// Leaflet models a TileLayer as a GridLayer subclass, and the manager relies on
// that: a GridLayer carries its z natively (`setZIndex` / `options.zIndex`) and
// therefore gets no pane of its own, a decision LayerSurface makes with the same
// `instanceof L.GridLayer` check.
export class GridLayer {
  options: Record<string, unknown> = {};
}

export class TileLayer extends GridLayer {
  options: Record<string, unknown> = { attribution: "© OpenStreetMap" };
  setZIndex = vi.fn();
}

/** A container with Leaflet's `eachLayer`/`hasLayer` surface. The fixture's
 *  `L.layerGroup` is a stub, so carrier recovery tests build the tree
 *  explicitly and call `manager.onLayerAdd` / `onLayerRemove` directly. */
export class TestGroup {
  options: Record<string, unknown> = {};
  children: unknown[];
  constructor(children: unknown[] = []) {
    this.children = children;
  }
  eachLayer(fn: (child: unknown) => void): void {
    this.children.forEach(fn);
  }
  addLayer(layer: unknown): this {
    this.children.push(layer);
    return this;
  }
  removeLayer(layer: unknown): this {
    this.children = this.children.filter(child => child !== layer);
    return this;
  }
  hasLayer(layer: unknown): boolean {
    return this.children.includes(layer);
  }
  getLayers(): unknown[] {
    return this.children.slice();
  }
}

// Identity-stable stamp: the shared mock in beforeEach is a counter, which
// would shift a layer's stamp between the sweep and the assertion.
export const stableStamp = vi.fn(obj => obj.__id ?? (obj.__id = ++stableStampId));

export let stableStampId = 1000;

// ── generic data-layer filter (moved from filterApply.test.ts) ────────────
// All subjects (registerLayer/setLayerFilter/genericFilterModel/hiddenSets/
// events bus) live on LayerController (controller.ts), so this suite rides
// the controller test file.

/** A geometry leaf stub with a real element the class toggle writes, exposed
 *  through the public getElement() the apply pass enumerates. */
export const leafWithElement = (): L.Layer => {
  const el = document.createElement("path");
  return { getElement: () => el } as unknown as L.Layer;
};

/** A hand-built snapshot: 3 geometry leaves with a numeric `value` field.
 *  Filtering `value` to [2, 5] hides the first leaf (1) and keeps the last
 *  two (2, 5). */
export const makeFeatures = (): LayerFilterFeatures => ({
  features: [
    { leaf: leafWithElement(), fields: { value: 1 } },
    { leaf: leafWithElement(), fields: { value: 2 } },
    { leaf: leafWithElement(), fields: { value: 5 } },
  ],
  total: 3,
  numericFields: ["value"],
  ranges: { value: [1, 5] },
  enumFields: [],
  enumValues: {},
});

export const between = (field: string, range: readonly [number, number]) => ({
  kind: "atom" as const,
  field,
  op: "between" as const,
  range,
});

export const createLayerControllerFixture = (): {
  manager: LayerController;
  map: any;
} => {
  // A test that flushes persistence leaves a real record behind, and the next
  // constructor reads it: without this clear, an order written by one test
  // decides where the next test's layers land.
  window.localStorage.clear();
  window.CONFIG = { ...window.CONFIG, name: "LayerControl", locale_code: "en" };

  class Renderer {}

  class Path {
    options = {};
  }

  class Polygon {
    options = {};
  }

  class Polyline {
    options = {};
  }

  class Marker {
    getElement() {
      return null;
    }
  }

  class CircleMarker {}
  const stamp = (() => {
    let id = 0;
    return vi.fn(() => ++id);
  })();

  window.L.TileLayer = TileLayer;
  window.L.GridLayer = GridLayer;
  window.L.Renderer = Renderer;
  window.L.layerGroup = vi.fn(() => ({
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    hasLayer: vi.fn(() => false),
    getLayers: vi.fn(() => []),
    clearLayers: vi.fn(),
    options: {},
  }));
  window.L.Path = Path;
  window.L.Polygon = Polygon;
  window.L.Polyline = Polyline;
  window.L.Marker = Marker;
  window.L.CircleMarker = CircleMarker;
  window.L.stamp = stamp;
  window.L.svg = vi.fn(() => ({
    addTo: vi.fn(),
    // Real renderers carry a root element: `pinLateContent` needs it to move
    // path nodes, and its absence would silently take the "mark handled"
    // branch instead.
    _container: document.createElement("div"),
  }));

  const makePane = () => {
    const el = document.createElement("div");
    el.style.zIndex = "0";
    return el;
  };

  const map: any = {
    on: vi.fn(),
    off: vi.fn(),
    invalidateSize: vi.fn(),
    eachLayer: vi.fn(),
    hasLayer: vi.fn(() => false),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    closePopup: vi.fn(),
    getZoom: vi.fn(() => 5),
    getMaxZoom: vi.fn(() => 18),
    getMinZoom: vi.fn(() => 0),
    getContainer: vi.fn(() => map._container),
    getPane: vi.fn(() => {
      const p = makePane();
      p.style.zIndex = "0";
      return p;
    }),
    createPane: vi.fn(() => {
      const p = makePane();
      p.classList.add("foliplus-layer-pane");
      return p;
    }),
    _container: document.createElement("div"),
    _layers: {},
    _paneRenderers: {},
    options: { maxZoom: 18 },
    attributionControl: { _attributions: {}, _update: vi.fn() },
  };

  const manager: LayerController = new LayerController(map, [
    { id: "overlay1", name: "Points", role: "overlay" },
    {
      id: "base1",
      name: "OSM",
      role: "base",
      layer: new TileLayer(),
      paneName: "tilePane",
    },
  ]);
  return { manager, map };
};

export const teardownLayerControllerFixture = (manager: LayerController): void => {
  // The derived-state barrier (invalidateDerived) and the order enforcement
  // both run on debounced timers that can resolve AFTER a test completes —
  // during teardown, while the test's own narrow manager.ui stub (often
  // scoped to one method, or missing data members like listPanel.activeIdx)
  // is still installed. Cancel the pending timers at the source so teardown
  // never runs against that partial UI, rather than trying to make a stub
  // absorb every side effect (a stub cannot know which data members are read
  // as DOM vs null-vs-object). makeDerivedUI stays as belt-and-suspenders for
  // any timer a future change adds without a matching cancel.
  manager.debouncedEnforce?.cancel?.();
  manager.ui = makeDerivedUI();
};

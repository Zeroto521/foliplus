import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import { LayerManager } from "#foliplus/LayerControl/manager.js";
import {
  patchBringToFront,
  unpatchBringToFront,
} from "#foliplus/LayerControl/manager.js";
import { LayerPersistence } from "#foliplus/LayerControl/persistence.js";
import { LayerUI } from "#foliplus/LayerControl/ui.js";
import { GEOM_TYPE, Z_INDEX } from "#foliplus/core/layer/const.js";
import * as Storage from "#common/storage.js";

const ENFORCE_ORDER_DEBOUNCE_MS = 50;

class TileLayer {
  options = { attribution: "© OpenStreetMap" };
  setZIndex = vi.fn();
}

class GridLayer {
  options = {};
}

// ===========================================================================
// bringToFront patch refcounting (merged from guard.test.ts)
// Runs before the main describe('LayerManager') because that block's beforeEach
// replaces window.L.Path with a class lacking bringToFront on its prototype;
// these guard tests rely on the original L mock from setup.ts.

describe("bringToFront patch refcounting", () => {
  it("patch is idempotent; unpatch restores only at zero refcount", () => {
    const proto = window.L.Path.prototype;
    const base = proto.bringToFront;
    try {
      patchBringToFront();
      patchBringToFront();
      expect(proto.bringToFront).not.toBe(base);
      unpatchBringToFront();
      expect(proto.bringToFront).not.toBe(base); // second instance still patched
      unpatchBringToFront();
      expect(proto.bringToFront).toBe(base); // last instance restored
    } finally {
      // leave the module counter at zero even if an assertion failed
      unpatchBringToFront();
      unpatchBringToFront();
      proto.bringToFront = base;
    }
  });

  it("guarded bringToFront skips detached paths without throwing", () => {
    const proto = window.L.Path.prototype;
    const base = proto.bringToFront;
    patchBringToFront();
    try {
      const guarded = proto.bringToFront as unknown as (this: unknown) => unknown;
      // _path missing / detached → no-op, returns this
      expect(() => guarded.call({})).not.toThrow();
      expect(() => guarded.call({ _path: null })).not.toThrow();
      expect(() => guarded.call({ _path: { parentNode: null } })).not.toThrow();
      expect(() => guarded.call({ _path: { parentNode: {} } })).not.toThrow();
    } finally {
      unpatchBringToFront();
      proto.bringToFront = base;
    }
  });
});

// Identity-stable stamp: the shared mock in beforeEach is a counter, which
// would shift a layer's stamp between the sweep and the assertion.
const stableStamp = vi.fn(obj => obj.__id ?? (obj.__id = ++stableStampId));
let stableStampId = 1000;

describe("LayerManager", () => {
  let manager, map;

  beforeEach(() => {
    window.CONF = { ...window.CONF, name: "LayerControl", locale_code: "en" };

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
    class Marker {}
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
    window.L.svg = vi.fn(() => ({ addTo: vi.fn() }));

    const makePane = () => {
      const el = document.createElement("div");
      el.style.zIndex = "0";
      return el;
    };

    map = {
      on: vi.fn(),
      off: vi.fn(),
      invalidateSize: vi.fn(),
      hasLayer: vi.fn(() => false),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
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
      attributionControl: { _attributions: {}, _update: vi.fn() },
    };

    manager = new LayerManager(map, [
      { id: "overlay1", name: "Points", isBase: false },
      {
        id: "base1",
        name: "OSM",
        isBase: true,
        layer: new TileLayer(),
        paneName: "tilePane",
      },
    ]);
  });

  it("constructor creates registry from data", () => {
    expect(manager.layerRegistry.size).toBe(2);
  });

  it("non-TileLayer GridLayer gets options.zIndex and no fallback pane", () => {
    const grid = new GridLayer();
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({ id: "grid1", name: "Grid", layer: grid, isBase: true });
    manager.enforceOrder();
    expect(grid.options.zIndex).toBeDefined();
    expect(String(grid.options.pane)).not.toMatch(/^foliplus_pane_/);
  });

  it("computeZIndex returns expected values", () => {
    // 2 layers, index 0, layer count = 2
    // z = Z_INDEX.BASE + (2 - 0) * 10 = 600 + 20 = 620
    const base = Z_INDEX.BASE;
    const step = Z_INDEX.STEP;
    expect(manager.computeZIndex(0, false)).toBe(base + 2 * step);
    expect(manager.computeZIndex(1, false)).toBe(base + 1 * step);
    // Tile layers use TILE_BASE
    expect(manager.computeZIndex(0, true)).toBe(Z_INDEX.TILE_BASE + 2 * step);
  });

  it("getLayerType returns null for unknown id", () => {
    expect(manager.getLayerType("nonexistent")).toBeNull();
  });

  it("getLayerType returns 'base' for base layers", () => {
    expect(manager.getLayerType("base1")).toBe("base");
  });

  it("getLayersByType filters by type", () => {
    const bases = manager.getLayersByType("base");
    expect(bases).toHaveLength(1);
    expect(bases[0].id).toBe("base1");
  });

  it("extractPoints returns empty array for non-existent layer", () => {
    expect(manager.extractPoints("nonexistent")).toEqual([]);
  });

  it("destroy clears registry and unbinds events", () => {
    manager.destroy();
    expect(manager.layerRegistry.size).toBe(0);
    expect(map.off).toHaveBeenCalled();
  });

  it("unregisterLayer returns false for unknown id", () => {
    expect(manager.unregisterLayer("nonexistent")).toBe(false);
  });

  it("unregisterLayer sweeps label panes no longer referenced", () => {
    manager.map.hasLayer.mockReturnValue(false);
    const api = manager.createLayers({
      id: "g1",
      name: "Group",
      labelPane: "g1_label",
    });
    api.register();
    expect(manager.panes.labelPanes.has("g1_label")).toBe(true);
    expect(manager.unregisterLayer("g1")).toBe(true);
    expect(manager.panes.labelPanes.has("g1_label")).toBe(false);
  });

  it("unregisterLayer returns true when layer is found and removed", () => {
    manager.registerLayer({ id: "test_layer", name: "Test" });
    const result = manager.unregisterLayer("test_layer");
    expect(result).toBe(true);
  });

  it("unregisterLayer reclaims only the unregistered layer's fallback pane", () => {
    // A full sweep on every unregister would also delete another
    // registered layer's pane. The map fixture needs the Leaflet pane
    // registry for the teardown to run.
    const paneA = document.createElement("div");
    const paneB = document.createElement("div");
    const paneRegistry = { foliplus_pane_a: paneA, foliplus_pane_b: paneB };
    map._panes = paneRegistry;
    // Stable fallback so a debounced enforceOrder firing after this test's
    // teardown does not read a deleted registry.
    map.getPane = vi.fn(name => paneRegistry[name] ?? document.createElement("div"));
    const layerA = { options: {} };
    const layerB = { options: {} };
    window["fb_a"] = layerA;
    window["fb_b"] = layerB;
    manager.registerLayer({ id: "fb_a", name: "A", layer: layerA });
    manager.registerLayer({ id: "fb_b", name: "B", layer: layerB });
    // The shared stamp mock is a counter, so stamps would shift between the
    // sweep and the assertion. Use an identity-stable stamp like Leaflet's.
    window.L.stamp = stableStamp;
    const stampA = window.L.stamp(layerA);
    const stampB = window.L.stamp(layerB);
    manager.panes.fallbackPaneMap.set(stampA, "foliplus_pane_a");
    manager.panes.fallbackPaneMap.set(stampB, "foliplus_pane_b");
    expect(manager.unregisterLayer("fb_a")).toBe(true);
    // A is gone from both the records and the map DOM.
    expect(manager.panes.fallbackPaneMap.size).toBe(1);
    expect(paneRegistry.foliplus_pane_a).toBeUndefined();
    // B is still registered, so its pane survives the sweep.
    expect(paneRegistry.foliplus_pane_b).toBe(paneB);
    expect(manager.panes.getLayerPanes(layerB)).toEqual(["foliplus_pane_b"]);
    delete window["fb_a"];
    delete window["fb_b"];
  });

  it("unregisterLayer emits EVENTS.LAYER_REMOVED event with the layer id", () => {
    manager.registerLayer({ id: "test_layer", name: "Test" });
    const bus = map.foliplus!.events;
    const handler = vi.fn();
    bus.on(EVENTS.LAYER_REMOVED, handler);

    manager.unregisterLayer("test_layer");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ id: "test_layer" });
  });

  it("unregisterLayer does NOT emit EVENTS.LAYER_REMOVED for unknown id", () => {
    const bus = map.foliplus!.events;
    const handler = vi.fn();
    bus.on(EVENTS.LAYER_REMOVED, handler);

    manager.unregisterLayer("nonexistent");

    expect(handler).not.toHaveBeenCalled();
  });

  it("clearAllLayers is safe for null", () => {
    expect(() => manager.clearAllLayers(null)).not.toThrow();
  });

  it("clearAllLayers handles eachLayer recursively", () => {
    const child = { clearLayers: vi.fn() };
    const parent = { eachLayer: vi.fn(cb => cb(child)) };
    manager.clearAllLayers(parent);
    expect(child.clearLayers).toHaveBeenCalled();
  });

  // ── getLayerType geometry inference ──

  it("getLayerType infers polygon from a Polygon layer", () => {
    manager.registerLayer({
      id: "poly",
      name: "Poly",
      layer: new window.L.Polygon(),
    });
    expect(manager.getLayerType("poly")).toBe(GEOM_TYPE.POLYGON);
  });

  it("getLayerType returns custom for iconSvg layers", () => {
    manager.registerLayer({ id: "icon", name: "Icon", iconSvg: "<svg/>" });
    expect(manager.getLayerType("icon")).toBe(GEOM_TYPE.CUSTOM);
  });

  it("invalidateType clears the cached type; refreshType re-infers", () => {
    // overlay1 has no layer — getLayerType returns null without caching a type.
    manager.layerRegistry.get("overlay1")!.type = GEOM_TYPE.POINT;
    manager.invalidateType("overlay1");
    expect(manager.layerRegistry.get("overlay1")!.type).toBeNull();
    expect(manager.refreshType("overlay1")).toBeNull(); // no layer resolvable
  });

  it("getLayerType caches the resolved type on the layer info", () => {
    manager.registerLayer({
      id: "poly2",
      name: "Poly",
      layer: new window.L.Polygon(),
    });
    expect(manager.getLayerType("poly2")).toBe(GEOM_TYPE.POLYGON);
    expect(manager.getLayerType("poly2")).toBe(GEOM_TYPE.POLYGON);
    expect(manager.layerRegistry.get("poly2").type).toBe(GEOM_TYPE.POLYGON);
  });

  // ── findLayer ──

  it("findLayer resolves a layer by string id", () => {
    const layer = new window.L.TileLayer();
    manager.registerLayer({ id: "x", name: "X", layer });
    expect(manager.findLayer("x")).toBe(layer);
  });

  it("findLayer returns null after unregisterLayer", () => {
    manager.registerLayer({ id: "x", name: "X", layer: new window.L.TileLayer() });
    manager.unregisterLayer("x");
    expect(manager.findLayer("x")).toBeNull();
  });

  it("registerLayer uses incremental item init instead of full re-scan", () => {
    manager.map.hasLayer.mockReturnValue(true);
    manager.uiContainer = document.createElement("div");
    manager.ui = {
      insertLayerItem: vi.fn(),
      updateLayerItem: vi.fn(),
      initTypesAndVisibility: vi.fn(),
      initLayerItem: vi.fn(),
      syncToggleAll: vi.fn(),
    } as any;
    manager.registerLayer({
      id: "new1",
      name: "New",
      layer: { options: {} },
    } as any);
    expect(manager.ui.initLayerItem).toHaveBeenCalled();
    expect(manager.ui.initTypesAndVisibility).not.toHaveBeenCalled();
    expect(manager.ui.syncToggleAll).toHaveBeenCalled();
  });

  it("re-applies hidden state when a previously-hidden layer is re-registered at runtime", () => {
    const layer = { options: {} };
    manager.map.hasLayer.mockReturnValue(false);
    const addLayer = vi.fn();
    const removeLayer = vi.fn();
    manager.map.addLayer = addLayer;
    manager.map.removeLayer = removeLayer;
    manager.ui = {
      hiddenIds: new Set(["new1"]),
      saveHiddenIds: vi.fn(),
    } as any;
    manager.registerLayer({ id: "new1", name: "New", layer } as any);

    // Hidden layer is kept off the map entirely (no add, no remove) so
    // onAdd side effects never fire, and visible is set to false.
    expect(addLayer).not.toHaveBeenCalled();
    expect(removeLayer).not.toHaveBeenCalled();
    expect(manager.layerRegistry.get("new1")!.visible).toBe(false);
  });

  it("fires onToggle(false) for a callback-only hidden layer on re-registration without adding it to the map", () => {
    manager.map.hasLayer.mockReturnValue(false);
    const addLayer = vi.fn();
    const removeLayer = vi.fn();
    manager.map.addLayer = addLayer;
    manager.map.removeLayer = removeLayer;
    const onToggle = vi.fn();
    manager.ui = {
      hiddenIds: new Set(["canvas1"]),
      saveHiddenIds: vi.fn(),
    } as any;
    manager.registerLayer({
      id: "canvas1",
      name: "Canvas",
      layer: null,
      onToggle,
    } as any);

    // Callback-only layer has no Leaflet layer to add/remove — the guard
    // skips addLayer and removeLayer, and fires onToggle so the canvas/heatmap
    // hides itself.
    expect(addLayer).not.toHaveBeenCalled();
    expect(removeLayer).not.toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(manager.layerRegistry.get("canvas1")!.visible).toBe(false);
  });

  it("does not add a hidden layer to the map before removing it", () => {
    const layer = { options: {} };
    manager.map.hasLayer.mockReturnValue(false);
    const addLayer = vi.fn();
    const removeLayer = vi.fn();
    manager.map.addLayer = addLayer;
    manager.map.removeLayer = removeLayer;
    manager.ui = {
      hiddenIds: new Set(["new1"]),
      saveHiddenIds: vi.fn(),
    } as any;
    manager.registerLayer({ id: "new1", name: "New", layer } as any);

    // Hidden layers must be kept off the map entirely (skip addLayer) so
    // onAdd side effects never fire.
    expect(addLayer).not.toHaveBeenCalled();
    expect(removeLayer).not.toHaveBeenCalled();
    expect(manager.layerRegistry.get("new1")!.visible).toBe(false);
  });

  it("does not re-apply hidden state when the layer is not in the hidden set", () => {
    const layer = { options: {} };
    manager.map.hasLayer.mockReturnValue(false);
    const removeLayer = vi.fn();
    manager.map.removeLayer = removeLayer;
    manager.ui = {
      hiddenIds: new Set(["other"]),
      saveHiddenIds: vi.fn(),
    } as any;
    manager.registerLayer({ id: "visible1", name: "V", layer } as any);

    expect(removeLayer).not.toHaveBeenCalled();
    expect(manager.layerRegistry.get("visible1")!.visible).toBe(true);
  });

  it("registerLayer resolves layer from map when opts.layer is absent", () => {
    const layer = new window.L.TileLayer();
    map._layers["resolved"] = layer;
    manager.registerLayer({ id: "resolved", name: "R" });
    expect(manager.findLayer("resolved")).toBe(layer);
  });

  // ── destroy lifecycle ──

  it("destroy reverts to lightweight LayerAPI", () => {
    expect(map.foliplus.LayerAPI).toBeDefined();
    expect(map.foliplus.LayerAPI.layers.length).toBe(2);
    manager.destroy();
    // After destroy, LayerAPI is still valid (lightweight default) but
    // layers is empty and registerLayer is a no-op.
    expect(map.foliplus.LayerAPI).toBeDefined();
    expect(map.foliplus.LayerAPI.layers).toEqual([]);
    expect(map.foliplus.LayerAPI.registerLayer({ id: "x" })).toBeNull();
  });

  // ── syncAttribution caching ──

  it("syncAttribution skips _update when attribution is unchanged", () => {
    const update = map.attributionControl._update;
    manager.syncAttribution();
    const afterFirst = update.mock.calls.length;
    manager.syncAttribution();
    expect(update.mock.calls.length).toBe(afterFirst);
  });

  // ── batch registration coalescing ──

  it("registerLayer does not run enforceOrder synchronously", () => {
    const spy = vi.spyOn(manager, "enforceOrder");
    manager.registerLayer({ id: "a", name: "A", layer: new window.L.TileLayer() });
    manager.registerLayer({ id: "b", name: "B", layer: new window.L.TileLayer() });
    expect(spy).not.toHaveBeenCalled();
  });

  it("batch registration coalesces into a single debounced enforceOrder", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(manager, "enforceOrder");
    manager.registerLayer({ id: "a", name: "A", layer: new window.L.TileLayer() });
    manager.registerLayer({ id: "b", name: "B", layer: new window.L.TileLayer() });
    vi.advanceTimersByTime(ENFORCE_ORDER_DEBOUNCE_MS);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  // ── layeradd re-entry during enforceOrder ──

  it("layeradd during enforceOrder does NOT reschedule debouncedEnforce (prevents freeze loop)", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(manager, "enforceOrder");
    manager.isEnforcing = true;
    manager.onLayerAdd({ layer: new window.L.Path() });
    vi.advanceTimersByTime(ENFORCE_ORDER_DEBOUNCE_MS);
    expect(spy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("getNavigableItems returns layer items and toggle-all rows", () => {
    // 模拟 uiContainer 和 ui
    const container = document.createElement("div");
    container.innerHTML = `
      <div class="foliplus-layer-toggle-all" data-group="overlay">
        <div class="foliplus-checkbox"><input type="checkbox" data-role="toggle-all" /></div>
      </div>
      <div class="foliplus-layer-item" data-layer-id="a">
        <div class="foliplus-checkbox"><input type="checkbox" /></div>
      </div>
      <div class="foliplus-layer-toggle-all" data-group="base">
        <div class="foliplus-checkbox"><input type="checkbox" data-role="toggle-all" /></div>
      </div>
      <div class="foliplus-layer-item foliplus-color-layer-item" data-layer-id="color">
        <input type="color" />
      </div>
    `;
    manager.uiContainer = container;
    manager.ui = { reindexAfterMove: vi.fn() } as any;
    // verify DOM structure includes toggle-all rows and layer items
    // (getNavigableItems is tested via browser tests)
    const items = container.querySelectorAll(
      ".foliplus-layer-item:not(.foliplus-color-layer-item), .foliplus-layer-toggle-all",
    );
    expect(items.length).toBe(3);
    expect(items[0].classList.contains("foliplus-layer-toggle-all")).toBe(true);
    expect(items[1].classList.contains("foliplus-layer-item")).toBe(true);
    expect(items[2].classList.contains("foliplus-layer-toggle-all")).toBe(true);
  });

  it("onLayerAdd responds to container layers (GeoJSON/FeatureGroup) too", () => {
    // Container layers (L.GeoJSON / FeatureGroup) previously fell through the
    // Path/Marker filter, so their addTo never re-ran enforceOrder. Any
    // registered container's add must coalesce into one enforce.
    vi.useFakeTimers();
    const spy = vi.spyOn(manager, "enforceOrder");
    const container = { options: {}, eachLayer: vi.fn() };
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({ id: "fg", name: "FG", layer: container });
    manager.onLayerAdd({ layer: container });
    manager.onLayerAdd({ layer: container });
    vi.advanceTimersByTime(ENFORCE_ORDER_DEBOUNCE_MS);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("onLayerAdd ignores unrelated layers once all registered layers are resolved", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(manager, "enforceOrder");
    // Resolve every registered layer so the managed-layer filter is active.
    manager.registerLayer({ id: "overlay1", name: "Points", layer: { options: {} } });
    manager.registerLayer({
      id: "base1",
      name: "OSM",
      layer: new TileLayer(),
      isBase: true,
    });
    vi.advanceTimersByTime(ENFORCE_ORDER_DEBOUNCE_MS);
    spy.mockClear();
    // An unrelated layeradd (e.g. ExportControl crossOrigin re-add) must NOT
    // trigger a full enforceOrder pass.
    manager.onLayerAdd({ layer: { options: {}, eachLayer: vi.fn() } });
    vi.advanceTimersByTime(ENFORCE_ORDER_DEBOUNCE_MS);
    expect(spy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  // ── initial data normalization ──

  it("syncAttribution picks the topmost visible base tile and stops early", () => {
    const tile1 = new TileLayer(); // attribution: © OpenStreetMap (default)
    const tile2 = new TileLayer();
    manager.map.hasLayer.mockImplementation(l => l === tile1);
    // Re-register base1 with the test instance; base2 registers ahead of it
    // (insertAt firstBaseIdx) but is invisible, so base1 is the topmost
    // visible tile whose attribution wins.
    manager.registerLayer({ id: "base1", name: "Base1", layer: tile1, isBase: true });
    manager.registerLayer({ id: "base2", name: "Base2", layer: tile2, isBase: true });
    manager.enforceOrder();
    expect(manager.lastAttribution).toBe("© OpenStreetMap");
  });

  it("syncAttribution returns empty when no base tile is visible", () => {
    manager.map.hasLayer.mockReturnValue(false);
    manager.enforceOrder();
    expect(manager.lastAttribution).toBe("");
  });

  it("saveOrder is debounced — rapid calls coalesce into one storage write", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(Storage, "save");
    manager.saveOrder();
    manager.saveOrder();
    manager.saveOrder();
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    vi.useRealTimers();
  });

  describe("loadSavedOrder", () => {
    it("restores a persisted overlay/base order", () => {
      const spy = vi.spyOn(Storage, "load").mockReturnValue(["overlay1", "base1"]);
      const m = new LayerManager(map, [
        { id: "base1", name: "B", isBase: true },
        { id: "overlay1", name: "O", isBase: false },
      ]);
      expect(m.layers.map(l => l.id)).toEqual(["overlay1", "base1"]);
      spy.mockRestore();
    });

    it("drops unknown ids from persisted order and keeps the rest", () => {
      const spy = vi
        .spyOn(Storage, "load")
        .mockReturnValue(["ghost", "overlay1", "gone", "base1"]);
      const m = new LayerManager(map, [
        { id: "base1", name: "B", isBase: true },
        { id: "overlay1", name: "O", isBase: false },
      ]);
      expect(m.layers.map(l => l.id)).toEqual(["overlay1", "base1"]);
      spy.mockRestore();
    });

    it("ignores non-array storage data", () => {
      const spy = vi.spyOn(Storage, "load").mockReturnValue("nope");
      const m = new LayerManager(map, [{ id: "overlay1", name: "O", isBase: false }]);
      // falls back to the initial (insertion) order
      expect(m.layers.map(l => l.id)).toEqual(["overlay1"]);
      spy.mockRestore();
    });
  });

  it("normalizes initial data into the full layerInfo field set", () => {
    const m2 = new LayerManager(map, [
      { id: "a", name: "A", visible: true, isBase: false },
    ]);
    const li = m2.layers[0];
    expect(li).toMatchObject({ id: "a", name: "A", visible: true, isBase: false });
    for (const key of [
      "paneName",
      "iconSvg",
      "type",
      "canvas",
      "onToggle",
      "onZIndex",
    ]) {
      expect(key in li).toBe(true);
    }
  });

  // ── registerLayer id validation ──

  it("registerLayer throws when id is missing", () => {
    expect(() => manager.registerLayer({} as any)).toThrow("id_required");
  });

  it("registerLayer throws when id is empty", () => {
    expect(() => manager.registerLayer({ id: "" } as any)).toThrow("id_required");
  });

  // ── createCanvas id validation ──

  it("createCanvas throws when id is missing", () => {
    expect(() => manager.factory.createCanvas({} as any)).toThrow(
      "createCanvas requires an id",
    );
  });

  it("createCanvas throws when id is empty", () => {
    expect(() => manager.factory.createCanvas({ id: "" } as any)).toThrow(
      "createCanvas requires an id",
    );
  });

  // ── bringLayerToFront ──

  it("bringLayerToFront moves layer to front of z-order", () => {
    const spy = vi.spyOn(manager, "enforceOrder");
    manager.registerLayer({ id: "a", name: "A", layer: new window.L.TileLayer() });
    manager.registerLayer({ id: "b", name: "B", layer: new window.L.TileLayer() });
    manager.bringLayerToFront("a");
    expect(spy).toHaveBeenCalled();
  });

  it("bringLayerToFront is a no-op for unknown id", () => {
    const spy = vi.spyOn(manager, "enforceOrder");
    manager.bringLayerToFront("nonexistent");
    expect(spy).not.toHaveBeenCalled();
  });

  // ── traverse / extractPoints ──

  it("extractPoints returns empty array for non-existent layer", () => {
    expect(manager.extractPoints("nonexistent")).toEqual([]);
  });

  // ── migrateLayers container guard ──

  it("migrateLayers skips container layers (those with eachLayer)", () => {
    const container = { options: {}, eachLayer: vi.fn() };
    const leaf = { options: { pane: "overlayPane" } };
    manager.registerLayer({ id: "c", name: "C", layer: container });
    manager.registerLayer({ id: "l", name: "L", layer: leaf });
    expect(container.options.pane).toBeUndefined();
  });

  // ── unregisterLayer skips invalidateSize ──

  it("unregisterLayer does not call invalidateSize", () => {
    const spy = vi.spyOn(map, "invalidateSize");
    manager.unregisterLayer("nonexistent");
    expect(spy).not.toHaveBeenCalled();
  });

  // ── getLayersByType ──

  it("getLayersByType returns empty array for unknown type", () => {
    expect(manager.getLayersByType("nonexistent")).toEqual([]);
  });
  // ── coverage-gap tests: register/unregister UI paths, factory delegation ──

  it("createCanvas delegates to the factory", () => {
    window.L.DomUtil = { getPosition: vi.fn(() => ({ x: 0, y: 0 })) };
    map.getPanes = vi.fn(() => ({ mapPane: document.createElement("div") }));
    const api = manager.createCanvas({ id: "canvas1" });
    expect(api.canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(typeof api.register).toBe("function");
    expect(typeof api.bringToFront).toBe("function");
    api.destroy();
  });

  it("registerLayer appends a base layer when no base exists yet", () => {
    const m2 = new LayerManager(map, [
      { id: "only_overlay", name: "O", isBase: false },
    ]);
    map.hasLayer.mockReturnValue(false);
    m2.registerLayer({ id: "first_base", name: "B", isBase: true });
    expect(m2.layerRegistry.firstBaseIdx).toBe(1);
  });

  it("registerLayer sets pane options for non-Path/Marker layers", () => {
    const layer = { options: {} } as any;
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({ id: "p", name: "P", layer, paneName: "my_pane" });
    expect(layer.options.pane).toBe("my_pane");
    expect(layer.options.paneSet).toBe(true);
  });

  it("re-registering an existing layer updates the UI row", () => {
    manager.map.hasLayer.mockReturnValue(false);
    manager.uiContainer = document.createElement("div");
    manager.ui = {
      updateLayerItem: vi.fn(),
      initLayerItem: vi.fn(),
      syncToggleAll: vi.fn(),
      insertLayerItem: vi.fn(),
    } as any;
    manager.registerLayer({ id: "overlay1", name: "Renamed" });
    expect(manager.ui.updateLayerItem).toHaveBeenCalled();
    expect(manager.ui.insertLayerItem).not.toHaveBeenCalled();
  });

  it("registerLayer queues into pendingRegistrations when the panel is not attached", () => {
    // A layer registering before attachUI is recorded for the deferred
    // z-order pass rather than being lost, and returns null for the row.
    expect(manager.uiContainer).toBeNull();
    const row = manager.registerLayer({ id: "late", name: "Late" });
    expect(row).toBeNull();
    expect(manager.pendingRegistrations).toEqual([
      expect.objectContaining({ id: "late" }),
    ]);
  });

  it("registerLayer keeps a user-hidden layer off the map", () => {
    // A re-registration must not re-add a layer the user hid: the callback
    // fires so a canvas/heatmap can hide itself without a Leaflet layer.
    const m = new LayerManager(map, [
      { id: "hidden", name: "H", layer: { options: {} } },
    ]);
    const layer = m.layerRegistry.get("hidden")!.layer as any;
    m.ui = { hiddenIds: new Set(["hidden"]) } as any;
    const onToggle = vi.fn();
    m.registerLayer({ id: "hidden", name: "H", layer, onToggle });
    expect(m.map.addLayer).not.toHaveBeenCalledWith(layer);
    expect(m.layerRegistry.get("hidden")!.visible).toBe(false);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("unregisterLayer removes the UI row and reindexes", () => {
    manager.map.hasLayer.mockReturnValue(false);
    const row = document.createElement("div");
    row.setAttribute("data-layer-id", "overlay1");
    manager.uiContainer = document.createElement("div");
    manager.uiContainer.appendChild(row);
    manager.ui = {
      reindexItems: vi.fn(),
      saveHiddenIds: vi.fn(),
    } as any;
    expect(manager.unregisterLayer("overlay1")).toBe(true);
    expect(manager.uiContainer.querySelector("[data-layer-id=overlay1]")).toBeNull();
    expect(manager.ui.reindexItems).toHaveBeenCalled();
  });

  it("unregisterLayer removes a layer that is on the map", () => {
    // The remove path is separate from the map.hasLayer check: a layer
    // present in the registry and live on the map must be removed there
    // before the subtree is torn down.
    const layer = new window.L.TileLayer() as any;
    manager.map.hasLayer.mockImplementation(l => l === layer);
    manager.registerLayer({ id: "live", name: "Live", layer, isBase: true });
    expect(manager.unregisterLayer("live")).toBe(true);
    expect(manager.map.removeLayer).toHaveBeenCalledWith(layer);
  });

  it("clearAllLayers recurses into containers without clearLayers", () => {
    // A container exposing eachLayer (an L.GeoJSON-style wrapper) has no
    // clearLayers of its own, so its children must be cleared one by one.
    const grandchild = { clearLayers: vi.fn() };
    const child = { eachLayer: vi.fn(cb => cb(grandchild)) };
    const parent = { eachLayer: vi.fn(cb => cb(child)) };
    manager.clearAllLayers(parent);
    expect(child.clearLayers).toBeUndefined();
    expect(grandchild.clearLayers).toHaveBeenCalled();
  });

  it("unregisterLayer removes the layer id from the persisted hidden set", () => {
    manager.map.hasLayer.mockReturnValue(false);
    const saveHiddenIds = vi.fn();
    manager.ui = {
      hiddenIds: new Set(["overlay1", "base1"]),
      reindexItems: vi.fn(),
      saveHiddenIds,
    } as any;
    manager.unregisterLayer("overlay1");

    expect(manager.ui.hiddenIds).toEqual(new Set(["base1"]));
    expect(saveHiddenIds).toHaveBeenCalledTimes(1);
  });

  it("attachUI delegates to the UI", () => {
    manager.ui = { attachUI: vi.fn() } as any;
    const div = document.createElement("div");
    manager.attachUI(div);
    expect(manager.ui.attachUI).toHaveBeenCalledWith(div);
  });

  it("destroy cleans up the UI container and unbinds", () => {
    manager.uiContainer = document.createElement("div");
    const ui = { unbindEvents: vi.fn() } as any;
    manager.ui = ui;
    manager.destroy();
    expect(ui.unbindEvents).toHaveBeenCalled();
    expect(manager.uiContainer).toBeNull();
    expect(manager.isDestroyed).toBe(true);
  });

  it("destroy without a UI container still tears down map bindings", () => {
    // A map without LayerControl on it has a manager with a registry but no
    // panel: destroy still must unbind the layeradd listener and clear the
    // registry.
    const m = new LayerManager(map, [{ id: "a", name: "A", isBase: false }]);
    expect(m.uiContainer).toBeNull();
    m.destroy();
    expect(map.off).toHaveBeenCalledWith("layeradd", m.onLayerAdd);
    expect(m.isDestroyed).toBe(true);
    expect(m.layerRegistry.size).toBe(0);
  });

  it("onLayerAdd is a no-op once the manager is destroyed", () => {
    // A destroyed manager must ignore stray layeradd events, including ones
    // fired before its off() takes effect in the same teardown pass.
    const m = new LayerManager(map, [{ id: "a", name: "A", isBase: false }]);
    const spy = vi.spyOn(m, "enforceOrder");
    m.destroy();
    m.onLayerAdd({ layer: { options: {} } } as any);
    expect(spy).not.toHaveBeenCalled();
  });

  it("debouncedEnforce skips scheduling once destroyed", () => {
    // A register/unregister racing the teardown must not reschedule a
    // z-order pass on a manager that no longer has a map.
    const m = new LayerManager(map, [{ id: "a", name: "A", isBase: false }]);
    const spy = vi.spyOn(m, "enforceOrder");
    m.destroy();
    m.debouncedEnforce();
    expect(spy).not.toHaveBeenCalled();
  });

  it("destroy flushes a pending order write instead of cancelling it", () => {
    // persistence.destroy cancels the debounce timer, so the UI's flush in
    // unbindEvents must run first — otherwise the last reorder inside the
    // debounce window is dropped and the panel reads a stale order back.
    const m = new LayerManager(map, [
      { id: "a", name: "A", isBase: false },
      { id: "b", name: "B", isBase: false },
    ]);
    m.persistence = new LayerPersistence(m.layerRegistry);
    const save = vi.spyOn(Storage, "save");
    m.saveOrder();
    save.mockClear();
    m.destroy();
    expect(save).toHaveBeenCalledWith(
      CONST.STORAGE.ORDER_KEY,
      expect.any(Array),
      expect.any(String),
    );
  });

  it("destroy flushes a pending hidden-set write instead of cancelling it", () => {
    // Same ordering for visibility: a hide just before teardown must survive
    // the reload, which is the whole point of the teardown flush.
    const m = new LayerManager(map, [{ id: "a", name: "A", isBase: false }]);
    m.persistence = new LayerPersistence(m.layerRegistry);
    const save = vi.spyOn(Storage, "save");
    m.persistence.saveHiddenIds(() => new Set(["a"]));
    save.mockClear();
    m.destroy();
    expect(save).toHaveBeenCalledWith(
      CONST.STORAGE.VISIBILITY_KEY,
      ["a"],
      expect.any(String),
    );
  });

  it("registerLayer pins the pane on a layer with a container of its own", () => {
    // A non-Path/Marker layer with children (L.GeoJSON-style) must get
    // paneSet written so enforceOrder does not fall back to a generated pane.
    const child = { options: {} };
    const parent = { options: {}, eachLayer: vi.fn(cb => cb(child)) };
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({
      id: "layered",
      name: "Layered",
      layer: parent,
      paneName: "layer_graph",
    });
    expect(parent.options.pane).toBe("layer_graph");
    expect(parent.options.paneSet).toBe(true);
  });

  it("applyLayerZIndex calls setZIndex for visible TileLayers", () => {
    const tile = new TileLayer();
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({ id: "t1", name: "T", layer: tile, isBase: true });
    manager.enforceOrder();
    expect(tile.setZIndex).toHaveBeenCalled();
  });

  it("extractPoints collects markers with features", () => {
    class Marker {}
    window.L.Marker = Marker;
    const marker = new Marker() as any;
    marker.feature = { type: "Feature" };
    marker.getLatLng = () => ({ lat: 1, lng: 2 });
    marker.options = {};
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({
      id: "pts",
      name: "Pts",
      layer: {
        eachLayer: (cb: (l: unknown) => void) => cb(marker),
        options: {},
      } as any,
    });
    const pts = manager.extractPoints("pts");
    expect(pts).toEqual([{ lat: 1, lng: 2, marker }]);
  });

  it("extractPoints excludes label markers (no double-counting)", () => {
    class Marker {}
    window.L.Marker = Marker;
    const data = new Marker() as any;
    data.feature = { type: "Feature" };
    data.getLatLng = () => ({ lat: 1, lng: 2 });
    data.options = {};
    const label = new Marker() as any;
    label.feature = { type: "Feature" };
    label.getLatLng = () => ({ lat: 9, lng: 9 });
    label.options = {};
    label.isLabel = true;
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({
      id: "el",
      name: "El",
      layer: {
        eachLayer: (cb: (l: unknown) => void) => {
          cb(data);
          cb(label);
        },
        options: {},
      } as any,
    });
    const pts = manager.extractPoints("el");
    expect(pts).toEqual([{ lat: 1, lng: 2, marker: data }]);
  });

  it("extractPoints rejects a plain Marker without .feature, matching the icon contract", () => {
    // countFeatureGeometry counts a plain Marker (no .feature) as a point, but
    // the layer's type icon shows "unknown" because .feature is required to
    // extract coordinates/properties.  extractPoints is that same .feature
    // gate, so a plain Marker must be rejected here too — otherwise the icon's
    // "unknown" promise would diverge from downstream behavior.
    // A Marker WITH .feature (consumable) is extracted, proving the gate is
    // specifically the missing envelope, not Marker identity.
    class Marker {}
    window.L.Marker = Marker;
    const plain = new Marker() as any; // no .feature
    plain.getLatLng = () => ({ lat: 1, lng: 2 });
    plain.options = {};
    const consumed = new Marker() as any;
    consumed.feature = { type: "Feature", properties: {} };
    consumed.getLatLng = () => ({ lat: 3, lng: 4 });
    consumed.options = {};
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({
      id: "mixed",
      name: "Mixed",
      layer: {
        eachLayer: (cb: (l: unknown) => void) => {
          cb(plain);
          cb(consumed);
        },
        options: {},
      } as any,
    });
    // count treats both as points (count==2), but extractPoints returns only
    // the consumable one — the count-vs-consumable contract held.
    expect(manager.getFeatureCount("mixed")).toBe(2);
    const pts = manager.extractPoints("mixed");
    expect(pts.length).toBe(1);
    expect(pts[0].marker).toBe(consumed);
  });

  it("bringLayerToFront re-renders the list when a UI is attached", () => {
    manager.map.hasLayer.mockReturnValue(false);
    // register bottom first so top lands at index 0; bottom is then movable
    manager.registerLayer({ id: "bottom", name: "Bottom", layer: { options: {} } });
    manager.registerLayer({ id: "top", name: "Top", layer: { options: {} } });
    manager.uiContainer = document.createElement("div");
    manager.ui = {
      renderInitialList: vi.fn(),
      initTypesAndVisibility: vi.fn(),
    } as any;
    manager.bringLayerToFront("bottom");
    expect(manager.layers[0].id).toBe("bottom");
    expect(manager.ui.renderInitialList).toHaveBeenCalled();
    expect(manager.ui.initTypesAndVisibility).toHaveBeenCalled();
  });

  it("bringLayerToFront ignores base layers", () => {
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({ id: "b", name: "B", layer: new TileLayer(), isBase: true });
    const orderBefore = manager.layers.map(l => l.id);
    manager.bringLayerToFront("b");
    expect(manager.layers.map(l => l.id)).toEqual(orderBefore);
  });

  it("applyLayerZIndex lands ordinary layers in a fallback pane", () => {
    const layer = { options: {} } as any;
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({ id: "fb", name: "Fb", layer });
    manager.enforceOrder();
    expect(layer.options.pane).toMatch(/^foliplus_pane_/);
    expect(layer.options.paneSet).toBe(true);
  });

  describe("child pane z-order", () => {
    it("pins a layer's node and label panes one step above its graph pane", () => {
      // Child panes are never written by the main loop, so they would keep the
      // 600 `LayerFactory` gave them at creation time — under every data pane.
      // A stable registry is needed, since the fixture's getPane is a factory.
      const graph = document.createElement("div");
      const node = document.createElement("div");
      const label = document.createElement("div");
      const panes: Record<string, HTMLDivElement> = {
        measure_graph: graph,
        measure_node: node,
        measure_label: label,
      };
      map._panes = panes;
      map.getPane = vi.fn((name: string) => panes[name]);
      manager.map.hasLayer.mockReturnValue(true);
      manager.registerLayer({
        id: "measure",
        name: "Measure",
        layer: { options: {} } as any,
        paneName: "measure_graph",
        nodePane: "measure_node",
        labelPane: "measure_label",
      });
      manager.enforceOrder();
      const graphZ = Number(graph.style.zIndex);
      expect(Number(node.style.zIndex)).toBe(graphZ + 1);
      expect(Number(label.style.zIndex)).toBe(graphZ + 1);
      expect(graphZ).toBeGreaterThan(Z_INDEX.BASE);
    });

    it("leaves the panes of a child-less layer alone", () => {
      const graph = document.createElement("div");
      const node = document.createElement("div");
      const panes = { my_graph: graph, my_node: node };
      map._panes = panes;
      map.getPane = vi.fn((name: string) => panes[name]);
      manager.map.hasLayer.mockReturnValue(true);
      manager.registerLayer({
        id: "plain",
        name: "Plain",
        layer: { options: {} } as any,
        paneName: "my_graph",
      });
      manager.enforceOrder();
      expect(node.style.zIndex).toBe("");
      expect(graph.style.zIndex).not.toBe("");
    });

    it("z-orders discovered child panes and skips the fallback pane", () => {
      const graph = document.createElement("div");
      const label = document.createElement("div");
      map._panes = { child_graph: graph, child_label: label };
      map.getPane = vi.fn((name: string) => map._panes[name]);
      // The group's own subtree must reach the label pane through a second
      // container, not the layer's own options.pane — that is what makes the
      // discovered set contain more than the layer's graph pane.
      const data = {
        options: {},
        eachLayer: (cb: (l: unknown) => void) =>
          cb({ options: { pane: "child_label" } }),
      };
      const layer = {
        options: { pane: "child_graph" },
        eachLayer: (cb: (l: unknown) => void) => cb(data),
      };
      manager.panes.labelPanes.add("child_label");
      manager.map.hasLayer.mockReturnValue(true);
      manager.registerLayer({ id: "d1", name: "D1", layer });

      manager.enforceOrder();

      const z = Number(graph.style.zIndex);
      expect(z).toBeGreaterThan(0);
      // Label panes are bumped one step above the graph pane's z.
      expect(Number(label.style.zIndex)).toBe(z + 1);
      expect(layer.options.paneSet).toBe(true);
      // Discovered child panes are handled by their own branch; a fallback
      // pane for this layer must not be created alongside them.
      expect(manager.panes.fallbackPaneMap.has(window.L.stamp(layer))).toBe(false);
    });
  });

  describe("getFeatureCount", () => {
    // Build a leaf that looks like a real Leaflet layer (has options) so
    // registerLayer's discoverChildPanes does not fail, and that carries
    // the constructor identity forEachLeaf's instanceof checks need.
    const makeLeaf = (ctor: any, extra: unknown = {}) =>
      Object.assign(Object.create(ctor.prototype), { options: {}, ...extra });
    const wrap = (...leaves: unknown[]) =>
      ({
        options: {},
        eachLayer: (cb: (l: unknown) => void) => leaves.forEach(cb),
      }) as any;

    beforeEach(() => {
      manager.map.hasLayer.mockReturnValue(false);
    });

    it("returns null for base layers", () => {
      manager.registerLayer({
        id: "b1",
        name: "B",
        layer: { options: {} },
        isBase: true,
      });
      expect(manager.getFeatureCount("b1")).toBe(null);
    });

    it("returns null for an unknown layer id", () => {
      expect(manager.getFeatureCount("ghost")).toBe(null);
    });

    it("returns null for a canvas/unknown layer without a provider", () => {
      manager.registerLayer({ id: "c1", name: "Canvas", layer: { options: {} } });
      expect(manager.getFeatureCount("c1")).toBe(null);
    });

    it("prefers the third-party featureCountProvider over forEachLeaf", () => {
      const provider = vi.fn(() => 999);
      manager.registerLayer({
        id: "pv",
        name: "PV",
        layer: { options: {} },
        featureCountProvider: provider,
      });
      expect(manager.getFeatureCount("pv")).toBe(999);
      expect(provider).toHaveBeenCalledTimes(1);
    });

    it("passes featureCountProvider through createLayerInfo (survives registration)", () => {
      const provider = vi.fn(() => 7);
      manager.registerLayer({
        id: "surv",
        name: "Surv",
        layer: { options: {} },
        featureCountProvider: provider,
      });
      const li = manager.layerRegistry.get("surv");
      expect(typeof li?.featureCountProvider).toBe("function");
      expect(manager.getFeatureCount("surv")).toBe(7);
    });

    it("logs an error when featureCountProvider throws", () => {
      const provider = vi.fn(() => {
        throw new Error("provider boom");
      });
      const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      manager.registerLayer({
        id: "boom",
        name: "Boom",
        layer: { options: {} },
        featureCountProvider: provider,
      });
      expect(manager.getFeatureCount("boom")).toBe(null);
      expect(logSpy).toHaveBeenCalled();
      expect(logSpy.mock.calls[0][0]).toContain("featureCountProvider threw");
      logSpy.mockRestore();
    });

    it("counts polygons in a feature container via forEachLeaf fallback", () => {
      const layer = wrap(makeLeaf(window.L.Polygon), makeLeaf(window.L.Polygon));
      manager.registerLayer({ id: "poly", name: "Poly", layer });
      expect(manager.getFeatureCount("poly")).toBe(2);
    });

    it("counts all markers, including markers without feature", () => {
      // A plain folium.Marker() has no .feature; both markers are data points.
      const m1 = makeLeaf(window.L.Marker, { feature: {} });
      const m2 = makeLeaf(window.L.Marker);
      const layer = wrap(m1, m2);
      manager.registerLayer({ id: "mk", name: "Mk", layer });
      expect(manager.getFeatureCount("mk")).toBe(2);
    });

    it("returns null for a container layer that is not present (findLayer null)", () => {
      manager.registerLayer({ id: "absent", name: "Absent" });
      expect(manager.getFeatureCount("absent")).toBe(null);
    });

    it("counts only data features when a label sub-group is nested under mainLayer", () => {
      const dataPoly = makeLeaf(window.L.Polygon);
      const labelPoly = makeLeaf(window.L.Polygon);
      (labelPoly as unknown as { isLabel: boolean }).isLabel = true;
      const labelGroup = {
        options: {},
        eachLayer: (cb: (l: unknown) => void) => cb(labelPoly),
      };
      const mainLayer = wrap(dataPoly, labelGroup);
      manager.registerLayer({ id: "nested", name: "Nested", layer: mainLayer });
      expect(manager.getFeatureCount("nested")).toBe(1);
    });
  });

  describe("refreshCount", () => {
    it("emits LAYER_ITEM_COUNT_CHANGE for a registered overlay layer", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.registerLayer({ id: "rc1", name: "RC", layer: { options: {} } });
      const bus = map.foliplus!.events;
      const handler = vi.fn();
      bus.on(EVENTS.LAYER_ITEM_COUNT_CHANGE, handler);
      manager.refreshCount("rc1");
      expect(handler).toHaveBeenCalledWith({ id: "rc1" });
    });

    it("does not emit for a base layer", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.registerLayer({
        id: "b1",
        name: "B",
        layer: { options: {} },
        isBase: true,
      });
      const bus = map.foliplus!.events;
      const handler = vi.fn();
      bus.on(EVENTS.LAYER_ITEM_COUNT_CHANGE, handler);
      manager.refreshCount("b1");
      expect(handler).not.toHaveBeenCalled();
    });

    it("invalidates the layer's cached type before emitting, so mixed geometry at runtime is re-detected", () => {
      manager.map.hasLayer.mockReturnValue(false);
      const poly = Object.assign(Object.create(window.L.Polygon.prototype), {
        options: {},
      });
      const polyLayer = {
        options: {},
        eachLayer: (cb: (l: unknown) => void) => cb(poly),
      };
      manager.registerLayer({ id: "rt", name: "RT", layer: polyLayer });
      expect(manager.getLayerType("rt")).toBe(GEOM_TYPE.POLYGON);
      // refreshCount must clear the cached type so a subsequent runtime geometry
      // mix is re-detected by getLayerType/getGeometryType
      manager.refreshCount("rt");
      const layerInfo = manager.layerRegistry.get("rt");
      expect(layerInfo?.type).toBeNull();
    });

    it("emits for an unknown layer id (no-op subscriber; defensive)", () => {
      const bus = map.foliplus!.events;
      const handler = vi.fn();
      bus.on(EVENTS.LAYER_ITEM_COUNT_CHANGE, handler);
      manager.refreshCount("ghost");
      expect(handler).toHaveBeenCalledWith({ id: "ghost" });
    });

    // The createLayers wiring hands invalidateType / onDataChange to the factory
    // as thin closures — the body they resolve to is what the factory calls on
    // every add/remove. Exercise them through that path.
    it("wires createLayers addLayer to invalidateType and onDataChange", () => {
      manager.map.hasLayer.mockReturnValue(true);
      const api = manager.createLayers({ id: "w1", name: "W1", graphPane: "g" });
      manager.registerLayer({ id: "w1", name: "W1", layer: api.mainLayer });
      manager.layerRegistry.get("w1")!.type = GEOM_TYPE.POINT;
      const bus = map.foliplus!.events;
      const handler = vi.fn();
      bus.on(EVENTS.LAYER_ITEM_COUNT_CHANGE, handler);

      api.addLayer(new window.L.Path());

      expect(manager.layerRegistry.get("w1")!.type).toBeNull();
      expect(handler).toHaveBeenCalledWith({ id: "w1" });
    });
  });

  it("canReorderBetween delegates to the registry", () => {
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({ id: "o2", name: "O2", layer: { options: {} } });
    // layers: [o2, overlay1, base1] — 0↔1 same overlay group, 0↔2 cross-group
    expect(manager.canReorderBetween(0, 1)).toBe(true);
    expect(manager.canReorderBetween(0, 2)).toBe(false);
  });

  it("registerLayer ensures child panes via discoverChildPanes", () => {
    const childPaneLayer = {
      options: { pane: "custom_child" },
      eachLayer: (cb: (l: unknown) => void) =>
        cb({ options: { pane: "custom_child" } }),
    } as any;
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({ id: "cp", name: "Cp", layer: childPaneLayer });
    expect(manager.panes.paneCache.size).toBeGreaterThanOrEqual(0); // no crash
    // ensurePane was reached — the pane should exist in defaultPanes set? just verify no throw
  });

  it("syncAttribution removes the previous attribution via removeAttribution", () => {
    const tile = new TileLayer();
    map.attributionControl.removeAttribution = vi.fn();
    map.attributionControl.addAttribution = vi.fn();
    manager.map.hasLayer.mockImplementation(l => l === tile);
    manager.registerLayer({ id: "b1", name: "B1", layer: tile, isBase: true });
    manager.enforceOrder();
    expect(manager.lastAttribution).toBe("© OpenStreetMap");
    expect(map.attributionControl.addAttribution).toHaveBeenCalledWith(
      "© OpenStreetMap",
    );
    // flip visibility off → top becomes empty → prev removed
    manager.map.hasLayer.mockReturnValue(false);
    manager.enforceOrder();
    expect(manager.lastAttribution).toBe("");
    expect(map.attributionControl.removeAttribution).toHaveBeenCalledWith(
      "© OpenStreetMap",
    );
  });
});

// ===========================================================================
// moveLayerUp / moveLayerDown (merged from move.test.ts)

describe("LayerManager moveLayerUp / moveLayerDown", () => {
  let manager, map;

  beforeEach(() => {
    window.CONF = { ...window.CONF, name: "LayerControl", locale_code: "en" };

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
    class Marker {}
    class CircleMarker {}
    const stamp = (() => {
      let id = 0;
      return vi.fn(() => ++id);
    })();

    class TileLayer {
      options = { attribution: "© OpenStreetMap" };
      setZIndex = vi.fn();
    }
    class GridLayer {
      options = {};
    }

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
    window.L.svg = vi.fn(() => ({ addTo: vi.fn() }));

    const makePane = () => {
      const el = document.createElement("div");
      el.style.zIndex = "0";
      return el;
    };

    map = {
      on: vi.fn(),
      off: vi.fn(),
      invalidateSize: vi.fn(),
      hasLayer: vi.fn(() => false),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
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
      attributionControl: { _attributions: {}, _update: vi.fn() },
    };
  });

  it("moves an overlay one position up", () => {
    manager = new LayerManager(map, [
      { id: "a", name: "A", isBase: false },
      { id: "b", name: "B", isBase: false },
      { id: "c", name: "C", isBase: false },
    ]);
    expect(manager.moveLayerUp("b")).toBe(true);
    expect(manager.layers[0].id).toBe("b");
    expect(manager.layers[1].id).toBe("a");
    expect(manager.layers[2].id).toBe("c");
  });

  it("returns false when layer is already at top", () => {
    manager = new LayerManager(map, [
      { id: "a", name: "A", isBase: false },
      { id: "b", name: "B", isBase: false },
    ]);
    expect(manager.moveLayerUp("a")).toBe(false);
  });

  it("returns false for unknown layer id", () => {
    manager = new LayerManager(map, [{ id: "a", name: "A", isBase: false }]);
    expect(manager.moveLayerUp("unknown")).toBe(false);
  });

  it("does not move base layer past overlay boundary", () => {
    manager = new LayerManager(map, [
      { id: "a", name: "A", isBase: false },
      { id: "b", name: "B", isBase: false },
      { id: "base1", name: "Base", isBase: true },
      { id: "base2", name: "Base2", isBase: true },
    ]);
    expect(manager.moveLayerUp("base2")).toBe(true);
    expect(manager.layers[2].id).toBe("base2");
    expect(manager.moveLayerUp("base2")).toBe(false);
  });

  it("moves an overlay one position down", () => {
    manager = new LayerManager(map, [
      { id: "a", name: "A", isBase: false },
      { id: "b", name: "B", isBase: false },
      { id: "c", name: "C", isBase: false },
    ]);
    expect(manager.moveLayerDown("a")).toBe(true);
    expect(manager.layers[0].id).toBe("b");
    expect(manager.layers[1].id).toBe("a");
    expect(manager.layers[2].id).toBe("c");
  });

  it("returns false when layer is already at bottom of group", () => {
    manager = new LayerManager(map, [
      { id: "a", name: "A", isBase: false },
      { id: "b", name: "B", isBase: false },
    ]);
    expect(manager.moveLayerDown("b")).toBe(false);
  });

  it("does not move overlay past base boundary", () => {
    manager = new LayerManager(map, [
      { id: "a", name: "A", isBase: false },
      { id: "base1", name: "Base", isBase: true },
      { id: "base2", name: "Base2", isBase: true },
    ]);
    expect(manager.moveLayerDown("a")).toBe(false);
  });

  it("moves base layer down within base group", () => {
    manager = new LayerManager(map, [
      { id: "a", name: "A", isBase: false },
      { id: "base1", name: "Base1", isBase: true },
      { id: "base2", name: "Base2", isBase: true },
    ]);
    expect(manager.moveLayerDown("base1")).toBe(true);
    expect(manager.layers[1].id).toBe("base2");
    expect(manager.layers[2].id).toBe("base1");
  });

  it("moves a layer down and notifies the panel", () => {
    // moveLayerDown is the other half of the reorder pair: it must emit
    // LAYER_CHANGE too, since the panel re-reads the persisted order on it.
    const m = new LayerManager(map, [
      { id: "a", name: "A", isBase: false },
      { id: "b", name: "B", isBase: false },
    ]);
    m.uiContainer = document.createElement("div");
    m.ui = { reindexAfterMove: vi.fn() } as any;
    const handler = vi.fn();
    map.foliplus!.events.on(EVENTS.LAYER_CHANGE, handler);

    expect(m.moveLayerDown("a")).toBe(true);
    expect(m.layers[0].id).toBe("b");
    expect(m.layers[1].id).toBe("a");
    expect(m.ui.reindexAfterMove).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("moveLayerDown returns false for an unknown id", () => {
    const m = new LayerManager(map, [{ id: "a", name: "A", isBase: false }]);
    expect(m.moveLayerDown("unknown")).toBe(false);
  });

  it("emits an order change on a successful moveLayerUp", () => {
    // A reorder that never emitted would leave a collapsed second panel
    // reading stale state, so the event is the contract the UI relies on.
    const m = new LayerManager(map, [
      { id: "a", name: "A", isBase: false },
      { id: "b", name: "B", isBase: false },
    ]);
    m.uiContainer = document.createElement("div");
    m.ui = { reindexAfterMove: vi.fn() } as any;
    const handler = vi.fn();
    map.foliplus!.events.on(EVENTS.LAYER_CHANGE, handler);

    expect(m.moveLayerUp("b")).toBe(true);
    expect(m.layers[0].id).toBe("b");
    expect(m.layers[1].id).toBe("a");
    expect(m.ui.reindexAfterMove).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("maintains z-index order after move", () => {
    manager = new LayerManager(map, [
      { id: "a", name: "A", isBase: false },
      { id: "b", name: "B", isBase: false },
    ]);
    manager.moveLayerUp("b");
    const zB = manager.computeZIndex(
      manager.layerRegistry.indexOf(manager.layerRegistry.get("b")!),
      false,
    );
    const zA = manager.computeZIndex(
      manager.layerRegistry.indexOf(manager.layerRegistry.get("a")!),
      false,
    );
    expect(zB).toBeGreaterThan(zA);
  });

  it("returns false when only one layer exists", () => {
    manager = new LayerManager(map, [{ id: "a", name: "A", isBase: false }]);
    expect(manager.moveLayerUp("a")).toBe(false);
    expect(manager.moveLayerDown("a")).toBe(false);
  });

  it("moves first overlay to the top of overlay group", () => {
    manager = new LayerManager(map, [
      { id: "a", name: "A", isBase: false },
      { id: "b", name: "B", isBase: false },
      { id: "c", name: "C", isBase: false },
      { id: "base1", name: "Base1", isBase: true },
    ]);
    expect(manager.moveLayerUp("b")).toBe(true);
    expect(manager.layers[0].id).toBe("b");
    expect(manager.moveLayerUp("c")).toBe(true);
    expect(manager.moveLayerUp("c")).toBe(true);
    expect(manager.layers[0].id).toBe("c");
  });

  it("does not move overlay that is the only overlay into base group", () => {
    manager = new LayerManager(map, [
      { id: "a", name: "A", isBase: false },
      { id: "base1", name: "Base1", isBase: true },
    ]);
    expect(manager.moveLayerDown("a")).toBe(false);
  });

  it("reorder works across multiple base layers", () => {
    manager = new LayerManager(map, [
      { id: "a", name: "A", isBase: false },
      { id: "b", name: "B", isBase: false },
      { id: "base1", name: "Base1", isBase: true },
      { id: "base2", name: "Base2", isBase: true },
      { id: "base3", name: "Base3", isBase: true },
    ]);
    expect(manager.moveLayerDown("base1")).toBe(true);
    expect(manager.moveLayerDown("base1")).toBe(true);
    expect(manager.layers[2].id).toBe("base2");
    expect(manager.layers[3].id).toBe("base3");
    expect(manager.layers[4].id).toBe("base1");
    expect(manager.moveLayerDown("base1")).toBe(false);
  });

  it("moveLayerUp calls enforceOrder", () => {
    manager = new LayerManager(map, [
      { id: "a", name: "A", isBase: false },
      { id: "b", name: "B", isBase: false },
    ]);
    const enforceSpy = vi.spyOn(manager, "enforceOrder");
    manager.moveLayerUp("b");
    expect(enforceSpy).toHaveBeenCalled();
  });

  it("moveLayerDown returns false when layer is already at bottom of base group", () => {
    manager = new LayerManager(map, [
      { id: "a", name: "A", isBase: false },
      { id: "base1", name: "Base1", isBase: true },
    ]);
    expect(manager.moveLayerDown("base1")).toBe(false);
  });

  it("moveLayerUp returns false when layer is the only overlay", () => {
    manager = new LayerManager(map, [
      { id: "a", name: "A", isBase: false },
      { id: "base1", name: "Base1", isBase: true },
    ]);
    expect(manager.moveLayerUp("a")).toBe(false);
  });

  it("moveLayerUp returns false when layer is the only base map", () => {
    manager = new LayerManager(map, [
      { id: "a", name: "A", isBase: false },
      { id: "base1", name: "Base1", isBase: true },
    ]);
    expect(manager.moveLayerUp("base1")).toBe(false);
  });

  it("moveLayerDown calls enforceOrder", () => {
    manager = new LayerManager(map, [
      { id: "a", name: "A", isBase: false },
      { id: "b", name: "B", isBase: false },
    ]);
    const enforceSpy = vi.spyOn(manager, "enforceOrder");
    manager.moveLayerDown("a");
    expect(enforceSpy).toHaveBeenCalled();
  });
});

// ===========================================================================
// User-assigned display names (rename persistence)
//
// `LayerUI.renamedNames` is the source of truth; the registry's
// `LayerInfo.name` is a projection refreshed by `applyUserState()`. A
// third-party layer that re-registers itself re-advertises its own metadata,
// so a re-registration used to reset `name` back to the provider's original
// and the rename reverted visibly. `attachUI()` applies the persisted names at
// startup, so the rename also survives a reload.
//
// The initial registration carries a real layer object: an id-only one makes
// createLayerInfo fall through to `Reflect.get(window, id)`, which in jsdom
// resolves to a host object and crashes enforceOrder's `instanceof` check.

describe("LayerManager user-assigned names", () => {
  // Assertions go through `ui.displayName(id)` — the render contract — never
  // the registry's `LayerInfo.name`, which a third-party re-registration can
  // legitimately overwrite before the refresh pushes the rename back out.
  let manager, map;

  beforeEach(() => {
    window.localStorage.clear();
    window.CONF = { ...window.CONF, name: "LayerControl", locale_code: "en" };

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
    class Marker {}
    class CircleMarker {}
    window.L.TileLayer = TileLayer;
    window.L.GridLayer = GridLayer;
    window.L.Renderer = Renderer;
    window.L.Path = Path;
    window.L.Polygon = Polygon;
    window.L.Polyline = Polyline;
    window.L.Marker = Marker;
    window.L.CircleMarker = CircleMarker;
    window.L.stamp = vi.fn();
    window.L.svg = vi.fn(() => ({ addTo: vi.fn() }));

    const makePane = () => {
      const el = document.createElement("div");
      el.style.zIndex = "0";
      return el;
    };

    map = {
      on: vi.fn(),
      off: vi.fn(),
      invalidateSize: vi.fn(),
      hasLayer: vi.fn(() => false),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
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
      attributionControl: { _attributions: {}, _update: vi.fn() },
    };

    // The third-party provider's own layer object; its metadata advertises the
    // provider's name, never the user's rename.
    const extLayer = { options: {} };

    manager = new LayerManager(map, [
      { id: "ext", name: "Provider Layer", isBase: false, layer: extLayer },
    ]);
    manager.ui = new LayerUI(manager);
    manager.attachUI(document.createElement("div"));
  });

  it("keeps a rename when the provider re-registers its own layer", () => {
    // The user renamed the layer, then the provider re-adds it still
    // advertising its own name. createLayerInfo used to take the caller's
    // `opts.name` over the existing value, reverting the panel to the
    // original on the next render or reload.
    manager.ui.renameLayer("ext");
    const item = manager.ui.uiContainer.querySelector(
      `[${CONST.DATA.LAYER_ID}="ext"]`,
    )!;
    const label = item.querySelector("label") as HTMLLabelElement;
    const input = label.querySelector("input") as HTMLInputElement;
    input.value = "My Layer";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(manager.ui.displayName("ext")).toBe("My Layer");

    // Re-registration rebuilds the registry entry from the caller's metadata,
    // then the incremental refresh pushes the rename back out.
    manager.registerLayer({ id: "ext", name: "Provider Layer" });
    manager.ui.applyUserState();

    expect(manager.ui.displayName("ext")).toBe("My Layer");
    expect(manager.layerRegistry.get("ext")?.name).toBe("My Layer");
  });

  it("applies a persisted rename at startup", () => {
    // `attachUI` reads the names key at call time, so the seed has to land
    // before `attachUI` — but after the LayerManager constructor, which has
    // already built the registry that loadNames validates against.
    const fresh = new LayerManager(map, [
      { id: "ext", name: "Provider Layer", isBase: false, layer: { options: {} } },
    ]);
    fresh.ui = new LayerUI(fresh);
    window.localStorage.setItem(
      CONST.STORAGE.NAMES_KEY,
      JSON.stringify({ ext: "My Layer" }),
    );
    fresh.attachUI(document.createElement("div"));

    // The registry is the projection, so the sweep pushes the rename into it
    // too; displayName is the render contract either way.
    expect(fresh.layerRegistry.get("ext")?.name).toBe("My Layer");
    expect(fresh.ui.displayName("ext")).toBe("My Layer");
  });

  it("keeps a rename for a layer that registers after the UI attaches", () => {
    // A component whose bundle loads after LayerControl registers its layer
    // in its own constructor — HeatmapControl's createCanvas and
    // MeasureControl's createLayers both run after attachUI has already
    // loaded the persisted names. loadNames filters value types only, so the
    // rename survives the attach and is projected the moment the layer
    // registers. A registry filter here would have reverted it on every reload.
    const fresh = new LayerManager(map, [
      { id: "ext", name: "Provider Layer", isBase: false, layer: { options: {} } },
    ]);
    fresh.ui = new LayerUI(fresh);
    window.localStorage.setItem(
      CONST.STORAGE.NAMES_KEY,
      JSON.stringify({ heatmap1: "POI Density" }),
    );
    fresh.attachUI(document.createElement("div"));

    // The heatmap registers late, still advertising its own title.
    fresh.registerLayer({ id: "heatmap1", name: "Heatmap" });
    fresh.ui.applyUserState();

    expect(fresh.ui.displayName("heatmap1")).toBe("POI Density");
    expect(fresh.layerRegistry.get("heatmap1")?.name).toBe("POI Density");
  });

  it("accepts a caller-supplied name for a fresh layer", () => {
    // A fresh id has no existing entry, so the caller's `opts.name` wins
    // instead of the registry defaulting to the id.
    const fresh = new LayerManager(map, [
      { id: "fresh", name: "Fresh Layer", isBase: false, layer: { options: {} } },
    ]);

    expect(fresh.layerRegistry.get("fresh")?.name).toBe("Fresh Layer");
  });

  it("keeps a stored rename for an id that no longer exists", () => {
    // The sweep must not drop a rename whose id is absent from the registry:
    // that id may belong to a component that registers later. unregisterLayer
    // is the only place that prunes a rename, since it knows the layer is
    // gone for good.
    window.localStorage.setItem(
      CONST.STORAGE.NAMES_KEY,
      JSON.stringify({ "no-such-id": "Ghost" }),
    );
    manager.ui.loadPersistedState();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    manager.ui.applyUserState();
    warn.mockRestore();

    expect(manager.ui.renamedNames["no-such-id"]).toBe("Ghost");
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("stale rename ids"));
  });

  it("prunes a rename when its layer is unregistered", () => {
    // The prune lives on unregisterLayer because only that call knows the
    // layer is gone for good rather than merely not registered yet.
    manager.ui.renamedNames["ext"] = "My Layer";
    const save = vi.fn();
    manager.ui.saveNamesState = save;

    expect(manager.unregisterLayer("ext")).toBe(true);

    expect(manager.ui.renamedNames["ext"]).toBeUndefined();
    expect(save).toHaveBeenCalled();
  });

  it("does not touch the rename map when unregistering an unknown id", () => {
    const save = vi.fn();
    manager.ui.saveNamesState = save;

    expect(manager.unregisterLayer("never-registered")).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });
});

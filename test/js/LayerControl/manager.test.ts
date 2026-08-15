import * as Storage from "#common/storage.js";
import { LayerManager } from "#foliplus/LayerControl/manager.js";
import { GEOM_TYPE, Z_INDEX } from "#foliplus/core/layer/const.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ENFORCE_ORDER_DEBOUNCE_MS = 50;

class TileLayer {
  options = { attribution: "© OpenStreetMap" };
  setZIndex = vi.fn();
}

class GridLayer {
  options = {};
}

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
    window.L.Path = Path;
    window.L.Polygon = Polygon;
    window.L.Polyline = Polyline;
    window.L.Marker = Marker;
    window.L.CircleMarker = CircleMarker;
    window.L.stamp = stamp;
    window.L.svg = vi.fn(() => ({ addTo: vi.fn() }));

    function makePane() {
      const el = document.createElement("div");
      el.style.zIndex = "0";
      return el;
    }

    map = {
      on: vi.fn(),
      off: vi.fn(),
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

  it("unregisterLayer returns true when layer is found and removed", () => {
    manager.registerLayer({ id: "test_layer", name: "Test" });
    const result = manager.unregisterLayer("test_layer");
    expect(result).toBe(true);
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

  it("layeradd during enforceOrder reschedules via debouncedEnforce", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(manager, "enforceOrder");
    manager.isEnforcing = true;
    manager.onLayerAdd({ layer: new window.L.Path() });
    vi.advanceTimersByTime(ENFORCE_ORDER_DEBOUNCE_MS);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("onLayerAdd responds to container layers (GeoJSON/FeatureGroup) too", () => {
    // Container layers (L.GeoJSON / FeatureGroup) previously fell through the
    // Path/Marker filter, so their addTo never re-ran enforceOrder. With the
    // filter removed, any layer-level add must coalesce into one enforce.
    vi.useFakeTimers();
    const spy = vi.spyOn(manager, "enforceOrder");
    manager.onLayerAdd({ layer: { options: {}, eachLayer: vi.fn() } });
    manager.onLayerAdd({ layer: { options: {}, eachLayer: vi.fn() } });
    vi.advanceTimersByTime(ENFORCE_ORDER_DEBOUNCE_MS);
    expect(spy).toHaveBeenCalledTimes(1);
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
});

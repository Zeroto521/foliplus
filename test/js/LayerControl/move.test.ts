import { LayerManager } from "#foliplus/LayerControl/manager.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("LayerManager moveLayerUp / moveLayerDown", () => {
  let manager, map;

  beforeEach(() => {
    window.CONF = { ...window.CONF, name: "LayerControl", locale_code: "en" };

    class Renderer {}
    class Path { options = {}; }
    class Polygon { options = {}; }
    class Polyline { options = {}; }
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

    function makePane() {
      const el = document.createElement("div");
      el.style.zIndex = "0";
      return el;
    }

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
    manager = new LayerManager(map, [
      { id: "a", name: "A", isBase: false },
    ]);
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

  it("moveLayerUp and moveLayerDown are inverse operations", () => {
    manager = new LayerManager(map, [
      { id: "a", name: "A", isBase: false },
      { id: "b", name: "B", isBase: false },
      { id: "c", name: "C", isBase: false },
    ]);
    manager.moveLayerUp("c");
    expect(manager.layers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "b" }),
        expect.objectContaining({ id: "c" }),
        expect.objectContaining({ id: "a" }),
      ]),
    );
    manager.moveLayerDown("c");
    expect(manager.layers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "a" }),
        expect.objectContaining({ id: "b" }),
        expect.objectContaining({ id: "c" }),
      ]),
    );
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
    manager = new LayerManager(map, [
      { id: "a", name: "A", isBase: false },
    ]);
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

import { LayerFactory } from "#foliplus/core/layer/LayerFactory.js";
import { PaneManager } from "#foliplus/core/layer/PaneManager.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("LayerFactory", () => {
  let factory, map, panes, registerLayer, unregisterLayer, bringLayerToFront;

  beforeEach(() => {
    class TileLayer {
      options = { attribution: "© OSM" };
    }
    class Path {
      options = {};
    }
    class Marker {
      options = {};
    }
    window.L.TileLayer = TileLayer;
    window.L.Path = Path;
    window.L.Marker = Marker;
    window.L.svg = vi.fn(() => ({ addTo: vi.fn() }));
    const stamp = (() => {
      let id = 0;
      return vi.fn(() => ++id);
    })();
    window.L.stamp = stamp;
    window.L.layerGroup = vi.fn(() => {
      const layers: any[] = [];
      const grp = {
        addLayer: vi.fn((l: any) => { layers.push(l); return grp; }),
        removeLayer: vi.fn((l: any) => { const i = layers.indexOf(l); if (i !== -1) layers.splice(i, 1); return grp; }),
        hasLayer: vi.fn((l: any) => layers.includes(l)),
        getLayers: vi.fn(() => layers),
        clearLayers: vi.fn(() => { layers.length = 0; return grp; }),
        eachLayer: vi.fn((cb: any) => layers.forEach(cb)),
        options: {},
      };
      return grp;
    });
    window.L.DomUtil = { getPosition: vi.fn(() => ({ x: 0, y: 0 })) };

    map = {
      on: vi.fn(),
      off: vi.fn(),
      hasLayer: vi.fn(() => false),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      getContainer: vi.fn(() => ({ clientWidth: 800, clientHeight: 600 })),
      getPane: vi.fn(() => {
        const el = document.createElement("div");
        el.style.zIndex = "0";
        return el;
      }),
      createPane: vi.fn(() => {
        const p = document.createElement("div");
        p.classList.add("foliplus-layer-pane");
        return p;
      }),
      getPanes: vi.fn(() => {
        const el = document.createElement("div");
        return { mapPane: el };
      }),
      _container: document.createElement("div"),
      _layers: {},
      attributionControl: { _attributions: {}, _update: vi.fn() },
    };

    panes = new PaneManager(map);
    registerLayer = vi.fn(() => null);
    unregisterLayer = vi.fn(() => true);
    bringLayerToFront = vi.fn();

    factory = new LayerFactory({ map, panes, registerLayer, unregisterLayer, bringLayerToFront });
  });

  describe("createLayers", () => {
    it("returns CreateLayersAPI with expected methods", () => {
      const api = factory.createLayers({ id: "test", name: "Test" });
      expect(api.mainLayer).toBeDefined();
      expect(typeof api.addLayer).toBe("function");
      expect(typeof api.removeLayer).toBe("function");
      expect(typeof api.clearLayers).toBe("function");
      expect(typeof api.register).toBe("function");
      expect(typeof api.unregister).toBe("function");
      expect(typeof api.registered).toBe("function");
      expect(typeof api.bringToFront).toBe("function");
    });

    it("registers via dependency when addLayer triggers", () => {
      const api = factory.createLayers({ id: "test", name: "Test", graphPane: "graph1" });
      api.addLayer(new window.L.Path());
      expect(registerLayer).toHaveBeenCalled();
    });

    it("bringToFront delegates to the injected callback", () => {
      const api = factory.createLayers({ id: "test", name: "Test" });
      api.bringToFront();
      expect(bringLayerToFront).toHaveBeenCalledWith("test");
    });
  });

  describe("createCanvas", () => {
    it("returns CreateCanvasAPI with expected methods", () => {
      const api = factory.createCanvas({ id: "canvas_test", name: "Canvas" });
      expect(api.canvas).toBeInstanceOf(HTMLCanvasElement);
      expect(typeof api.resize).toBe("function");
      expect(typeof api.getSize).toBe("function");
      expect(typeof api.updatePosition).toBe("function");
      expect(typeof api.register).toBe("function");
      expect(typeof api.unregister).toBe("function");
      expect(typeof api.registered).toBe("function");
      expect(typeof api.destroy).toBe("function");
      expect(typeof api.bringToFront).toBe("function");
      expect(typeof api.setZIndex).toBe("function");
      expect(typeof api.setVisible).toBe("function");
    });

    it("throws when id is missing", () => {
      expect(() => factory.createCanvas({} as any)).toThrow("createCanvas requires an id");
    });

    it("bringToFront delegates to the injected callback", () => {
      const api = factory.createCanvas({ id: "canvas_test" });
      api.bringToFront();
      expect(bringLayerToFront).toHaveBeenCalledWith("canvas_test");
    });
  });
});
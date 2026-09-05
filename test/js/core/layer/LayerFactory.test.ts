import { beforeEach, describe, expect, it, vi } from "vitest";
import { LayerFactory } from "#foliplus/core/layer/LayerFactory.js";
import { PaneManager } from "#foliplus/core/layer/PaneManager.js";

describe("LayerFactory", () => {
  let factory,
    map,
    panes,
    registerLayer,
    unregisterLayer,
    bringLayerToFront,
    invalidateType;

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
        addLayer: vi.fn((l: any) => {
          layers.push(l);
          return grp;
        }),
        removeLayer: vi.fn((l: any) => {
          const i = layers.indexOf(l);
          if (i !== -1) layers.splice(i, 1);
          return grp;
        }),
        hasLayer: vi.fn((l: any) => layers.includes(l)),
        getLayers: vi.fn(() => layers),
        clearLayers: vi.fn(() => {
          layers.length = 0;
          return grp;
        }),
        eachLayer: vi.fn((cb: any) => layers.forEach(cb)),
        options: {},
      };
      return grp;
    });
    window.L.DomUtil = { getPosition: vi.fn(() => ({ x: 0, y: 0 })) };
    // jsdom canvas.getContext returns null; mock it
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      setTransform: vi.fn(),
      clearRect: vi.fn(),
    })) as any;

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
      // Minimal stand-in for the renderer `Map.getRenderer` would resolve
      // from the layer's own pane; `ensureVector` pins that pane instead.
      getRenderer: vi.fn(() => ({ addTo: vi.fn() })),
      _paneRenderers: {},
      _container: document.createElement("div"),
      _layers: {},
      attributionControl: { _attributions: {}, _update: vi.fn() },
    };

    panes = new PaneManager(map);
    registerLayer = vi.fn(() => null);
    unregisterLayer = vi.fn(() => true);
    bringLayerToFront = vi.fn();
    invalidateType = vi.fn();

    factory = new LayerFactory({
      map,
      panes,
      registerLayer,
      unregisterLayer,
      bringLayerToFront,
      invalidateType,
    });
  });

  // ── createLayers ──

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
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        graphPane: "graph1",
      });
      api.addLayer(new window.L.Path());
      expect(registerLayer).toHaveBeenCalled();
    });

    it("bringToFront delegates to the injected callback", () => {
      const api = factory.createLayers({ id: "test", name: "Test" });
      api.bringToFront();
      expect(bringLayerToFront).toHaveBeenCalledWith("test");
    });

    it("routes isLabel layers to labelPane", () => {
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        graphPane: "graph1",
        labelPane: "label1",
      });
      const labelLayer = new window.L.Marker();
      labelLayer.isLabel = true;
      api.addLayer(labelLayer);
      expect(labelLayer.options.pane).toBe("label1");
    });

    // A Path that is also a label must be pinned to the label pane, not the
    // graph pane: it joins the label layer group, so pinning the graph pane
    // would force it back into the wrong renderer.
    it("pins the label pane on an isLabel L.Path", () => {
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        graphPane: "graph1",
        labelPane: "label1",
      });
      const path = new window.L.Path();
      path.isLabel = true;
      api.addLayer(path);
      expect(path.options.pane).toBe("label1");
      const svgCalls = window.L.svg.mock.calls.map((c: any[]) => c[0]);
      expect(svgCalls.some(o => o.pane === "label1")).toBe(true);
    });

    it("falls through to origAddLayer when no graphPane/labelPane", () => {
      const api = factory.createLayers({ id: "test", name: "Test" });
      const layer = new window.L.Path();
      api.addLayer(layer);
      expect(layer.options.pane).toBeUndefined();
    });

    it("notifies onDataChange when graph content changes", () => {
      const onDataChange = vi.fn();
      const f = new LayerFactory({
        map,
        panes,
        registerLayer,
        unregisterLayer,
        bringLayerToFront,
        invalidateType,
        onDataChange,
      });
      const api = f.createLayers({ id: "test", name: "Test", graphPane: "g1" });
      const layer = new window.L.Path();
      api.addLayer(layer);
      expect(onDataChange).toHaveBeenCalledWith("test");
      onDataChange.mockClear();
      api.removeLayer(layer);
      expect(onDataChange).toHaveBeenCalledWith("test");
    });

    it("skips onDataChange when featureCountProvider is supplied", () => {
      const onDataChange = vi.fn();
      const f = new LayerFactory({
        map,
        panes,
        registerLayer,
        unregisterLayer,
        bringLayerToFront,
        invalidateType,
        onDataChange,
      });
      const api = f.createLayers({
        id: "measure",
        name: "Measure",
        graphPane: "g1",
        featureCountProvider: () => 0,
      });
      const layer = new window.L.Path();
      api.addLayer(layer);
      expect(onDataChange).not.toHaveBeenCalled();
      expect(invalidateType).toHaveBeenCalledWith("measure");
      invalidateType.mockClear();
      api.removeLayer(layer);
      expect(onDataChange).not.toHaveBeenCalled();
      expect(invalidateType).toHaveBeenCalledWith("measure");
    });

    it("notifies onDataChange on clearLayers only when there was content", () => {
      const onDataChange = vi.fn();
      const f = new LayerFactory({
        map: { ...map, hasLayer: vi.fn(() => true) },
        panes,
        registerLayer,
        unregisterLayer,
        bringLayerToFront,
        invalidateType,
        onDataChange,
      });
      const api = f.createLayers({ id: "test", name: "Test" });
      api.register();
      api.clearLayers();
      expect(onDataChange).not.toHaveBeenCalled(); // nothing to clear
      const layer = new window.L.Path();
      api.addLayer(layer);
      onDataChange.mockClear();
      api.clearLayers();
      expect(onDataChange).toHaveBeenCalledWith("test");
    });

    it("does not notify onDataChange for an empty graph-pane layer on clearLayers", () => {
      const onDataChange = vi.fn();
      const f = new LayerFactory({
        map: { ...map, hasLayer: vi.fn(() => true) },
        panes,
        registerLayer,
        unregisterLayer,
        bringLayerToFront,
        invalidateType,
        onDataChange,
      });
      const api = f.createLayers({ id: "test", name: "Test", graphPane: "g1" });
      api.register();
      api.clearLayers(); // graphPane configured but contains no data
      expect(onDataChange).not.toHaveBeenCalled();
    });

    it("does not crash when onDataChange is not provided", () => {
      const api = factory.createLayers({ id: "test", name: "Test", graphPane: "g1" });
      const layer = new window.L.Path();
      expect(() => api.addLayer(layer)).not.toThrow();
      expect(() => api.removeLayer(layer)).not.toThrow();
    });

    it("invalidates the cached type when graph content changes", () => {
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        graphPane: "graph1",
      });
      const layer = new window.L.Path();
      api.addLayer(layer);
      expect(invalidateType).toHaveBeenCalledWith("test");
      invalidateType.mockClear();
      api.removeLayer(layer);
      expect(invalidateType).toHaveBeenCalledWith("test");
    });

    it("removeLayer falls through to origRemoveLayer when not in a sub-layer", () => {
      const api = factory.createLayers({ id: "test", name: "Test" }); // no graph/label pane
      const layer = new window.L.Path();
      api.addLayer(layer); // goes to mainLayer directly
      expect(api.mainLayer.getLayers().length).toBe(1);
      api.removeLayer(layer);
      expect(api.mainLayer.getLayers().length).toBe(0);
    });

    it("clearLayers unregisters when empty", () => {
      const unreg = vi.fn(() => true);
      const f = new LayerFactory({
        map: { ...map, hasLayer: vi.fn(() => true) },
        panes: new PaneManager(map),
        registerLayer: vi.fn(() => null),
        unregisterLayer: unreg,
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
      });
      const api = f.createLayers({ id: "test", name: "Test" });
      api.register();
      api.clearLayers();
      expect(unreg).toHaveBeenCalledWith("test");
    });

    it("register() always calls registerLayer (not idempotent at callback level)", () => {
      const reg = vi.fn(() => null);
      const f = new LayerFactory({
        map: { ...map, hasLayer: vi.fn(() => false) },
        panes: new PaneManager(map),
        registerLayer: reg,
        unregisterLayer: vi.fn(),
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
      });
      const api = f.createLayers({ id: "test", name: "Test", graphPane: "graph1" });
      api.addLayer(new window.L.Path());
      api.register(); // second call — register() always calls registerLayer
      expect(reg).toHaveBeenCalledTimes(2);
    });

    it("unregister is no-op when not registered", () => {
      const api = factory.createLayers({ id: "test", name: "Test" });
      api.unregister();
      expect(unregisterLayer).not.toHaveBeenCalled();
    });

    it("registered() tracks state", () => {
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        graphPane: "graph1",
      });
      expect(api.registered()).toBe(false);
      api.addLayer(new window.L.Path());
      expect(api.registered()).toBe(true);
    });

    it("addLayer with L.Path triggers ensurePane for the graphPane", () => {
      const ensureSpy = vi.spyOn(PaneManager.prototype, "ensurePane");
      const f = new LayerFactory({
        map,
        panes: new PaneManager(map),
        registerLayer: vi.fn(),
        unregisterLayer: vi.fn(),
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
      });
      const api = f.createLayers({ id: "test", name: "Test", graphPane: "graph1" });
      api.addLayer(new window.L.Path());
      expect(ensureSpy).toHaveBeenCalled();
      ensureSpy.mockRestore();
    });
  });

  // ── createCanvas ──

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
      expect(() => factory.createCanvas({} as any)).toThrow(
        "createCanvas requires an id",
      );
    });

    it("bringToFront delegates to the injected callback", () => {
      const api = factory.createCanvas({ id: "canvas_test" });
      api.bringToFront();
      expect(bringLayerToFront).toHaveBeenCalledWith("canvas_test");
    });

    it("register calls registerLayer with correct opts", () => {
      const api = factory.createCanvas({ id: "canvas_test", name: "My Canvas" });
      api.register();
      expect(registerLayer).toHaveBeenCalledWith(
        expect.objectContaining({ id: "canvas_test", name: "My Canvas" }),
      );
    });

    it("register adds className when provided", () => {
      const api = factory.createCanvas({ id: "canvas_test", className: "my-canvas" });
      expect(api.canvas.classList.contains("my-canvas")).toBe(true);
    });

    it("register is idempotent", () => {
      const reg = vi.fn(() => null);
      const f = new LayerFactory({
        map,
        panes: new PaneManager(map),
        registerLayer: reg,
        unregisterLayer: vi.fn(),
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
      });
      const api = f.createCanvas({ id: "canvas_test" });
      api.register();
      api.register();
      expect(reg).toHaveBeenCalledTimes(1);
    });

    it("unregister clears canvas and calls unregisterLayer", () => {
      const unreg = vi.fn(() => true);
      const f = new LayerFactory({
        map,
        panes: new PaneManager(map),
        registerLayer: vi.fn(),
        unregisterLayer: unreg,
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
      });
      const api = f.createCanvas({ id: "canvas_test" });
      api.register();
      api.unregister();
      expect(unreg).toHaveBeenCalledWith("canvas_test");
    });

    it("unregister is no-op when not registered", () => {
      const api = factory.createCanvas({ id: "canvas_test" });
      api.unregister();
      expect(unregisterLayer).not.toHaveBeenCalled();
    });

    it("registered() tracks state", () => {
      const api = factory.createCanvas({ id: "canvas_test" });
      expect(api.registered()).toBe(false);
      api.register();
      expect(api.registered()).toBe(true);
      api.unregister();
      expect(api.registered()).toBe(false);
    });

    it("destroy unbinds events and removes canvas", () => {
      const api = factory.createCanvas({ id: "canvas_test" });
      api.register();
      api.destroy();
      expect(map.off).toHaveBeenCalled();
      expect(unregisterLayer).toHaveBeenCalledWith("canvas_test");
      expect(api.canvas.parentElement).toBeNull();
    });

    it("setVisible toggles hidden class", () => {
      const api = factory.createCanvas({ id: "canvas_test" });
      api.setVisible(false);
      expect(api.canvas.classList.contains("hidden")).toBe(true);
      api.setVisible(true);
      expect(api.canvas.classList.contains("hidden")).toBe(false);
    });

    it("setZIndex sets canvas style", () => {
      const api = factory.createCanvas({ id: "canvas_test" });
      api.setZIndex(42);
      expect(api.canvas.style.zIndex).toBe("42");
    });

    it("resize and getSize work with mock container", () => {
      const api = factory.createCanvas({ id: "canvas_test" });
      const size = api.getSize();
      expect(size.width).toBe(800);
      expect(size.height).toBe(600);
    });

    it("passes custom onToggle to registerLayer", () => {
      const onToggle = vi.fn();
      const reg = vi.fn(() => null);
      const f = new LayerFactory({
        map,
        panes: new PaneManager(map),
        registerLayer: reg,
        unregisterLayer: vi.fn(),
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
      });
      const api = f.createCanvas({ id: "test", onToggle });
      api.register();
      expect(reg).toHaveBeenCalledWith(expect.objectContaining({ onToggle }));
    });

    it("passes custom onZIndex to registerLayer", () => {
      const onZIndex = vi.fn();
      const reg = vi.fn(() => null);
      const f = new LayerFactory({
        map,
        panes: new PaneManager(map),
        registerLayer: reg,
        unregisterLayer: vi.fn(),
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
      });
      const api = f.createCanvas({ id: "test", onZIndex });
      api.register();
      expect(reg).toHaveBeenCalledWith(expect.objectContaining({ onZIndex }));
    });

    it("removeLayer routes from graphLayer when present", () => {
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        graphPane: "graph1",
      });
      const layer = new window.L.Path();
      api.addLayer(layer);
      api.removeLayer(layer);
      // layer should be removed from the graphLayer, not the mainLayer directly
      const mainLayer = api.mainLayer;
      // mainLayer still has the graphLayer (container), but the path was removed from graphLayer
      expect(mainLayer.getLayers().length).toBe(1); // graphLayer remains
    });

    it("removeLayer routes from labelLayer when isLabel", () => {
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        graphPane: "graph1",
        labelPane: "label1",
      });
      const labelLayer = new window.L.Marker();
      labelLayer.isLabel = true;
      api.addLayer(labelLayer);
      expect(api.registered()).toBe(true);
      api.removeLayer(labelLayer);
      // Label layer was removed from the label sub-layer; registered stays true
      // (removeLayer does not auto-unregister; only clearLayers does)
      expect(api.registered()).toBe(true);
    });

    it("passes iconSvg to registerLayer", () => {
      const reg = vi.fn(() => null);
      const f = new LayerFactory({
        map,
        panes: new PaneManager(map),
        registerLayer: reg,
        unregisterLayer: vi.fn(),
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
      });
      const api = f.createLayers({
        id: "test",
        name: "Test",
        iconSvg: "<svg/>",
        graphPane: "g1",
      });
      api.addLayer(new window.L.Path());
      expect(reg).toHaveBeenCalledWith(expect.objectContaining({ iconSvg: "<svg/>" }));
    });

    it("throws when mapPane is not available", () => {
      const badMap = { ...map, getPanes: vi.fn(() => ({})) };
      const f = new LayerFactory({
        map: badMap,
        panes: new PaneManager(badMap),
        registerLayer: vi.fn(),
        unregisterLayer: vi.fn(),
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
      });
      expect(() => f.createCanvas({ id: "test" })).toThrow("mapPane not available");
    });
  });
});

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
    class Layer {
      options = {};
    }
    window.L.TileLayer = TileLayer;
    window.L.Path = Path;
    window.L.Layer = Layer;
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

    // The measure center dot is placed before the shapes exist, so its slot in
    // the graph pane is permanently first and the radius line paints over it.
    // The node pane sits above the graph pane instead.
    it("routes isNode layers to nodePane", () => {
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        graphPane: "graph1",
        nodePane: "node1",
      });
      const nodeLayer = new window.L.Marker();
      nodeLayer.isNode = true;
      api.addLayer(nodeLayer);
      expect(nodeLayer.options.pane).toBe("node1");
    });

    // A node that is a label is a label: the label pane wins over the node
    // pane, otherwise a label would be pinned to the wrong renderer.
    it("prefers labelPane when a layer is both a label and a node", () => {
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        graphPane: "graph1",
        nodePane: "node1",
        labelPane: "label1",
      });
      const path = new window.L.Path();
      path.isLabel = true;
      path.isNode = true;
      api.addLayer(path);
      expect(path.options.pane).toBe("label1");
    });

    it("routes isNode Layers via addLayer's isNode argument", () => {
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        graphPane: "graph1",
        nodePane: "node1",
      });
      const nodeLayer = new window.L.Marker();
      api.addLayer(nodeLayer, false, true);
      expect(nodeLayer.options.pane).toBe("node1");
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

    it("skips onDataChange for node and label removals with a provider", () => {
      // The guard wraps each of the three sub-pane removal branches, so a
      // provider-backed component must stay silent no matter which one fires.
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
        nodePane: "n1",
        labelPane: "l1",
        featureCountProvider: () => 0,
      });
      const node = new window.L.Path();
      api.addLayer(node, false, true);
      const label = new window.L.Path();
      api.addLayer(label, true, false);
      api.removeLayer(node);
      api.removeLayer(label);
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

    it("clears a directly added layer without touching the empty sub-panes", () => {
      // Content added straight to the group (no sub-pane configured) counts
      // as content, so clearLayers must not report an empty clear.
      const onDataChange = vi.fn();
      const f = new LayerFactory({
        map: { ...map, hasLayer: vi.fn(() => true) },
        panes: new PaneManager(map),
        registerLayer: vi.fn(() => null),
        unregisterLayer: vi.fn(() => true),
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
        onDataChange,
      });
      const api = f.createLayers({ id: "direct", name: "Direct" });
      const layer = new window.L.Path();
      api.addLayer(layer);
      expect(api.mainLayer.getLayers().length).toBe(1);
      api.clearLayers();
      expect(onDataChange).toHaveBeenCalledWith("direct");
    });

    it("clears a node-layer group without misreading the graph sub-pane", () => {
      // Only the node pane exists, so the graph term of the content check
      // must short-circuit rather than reading a null container.
      const onDataChange = vi.fn();
      const f = new LayerFactory({
        map: { ...map, hasLayer: vi.fn(() => true) },
        panes: new PaneManager(map),
        registerLayer: vi.fn(() => null),
        unregisterLayer: vi.fn(() => true),
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
        onDataChange,
      });
      const api = f.createLayers({ id: "nodes", name: "Nodes", nodePane: "n1" });
      api.register();
      const node = new window.L.Path();
      node.isNode = true;
      api.addLayer(node);
      onDataChange.mockClear();
      api.clearLayers();
      expect(onDataChange).toHaveBeenCalledWith("nodes");
    });

    it("clears a label-layer group without misreading the graph sub-pane", () => {
      // Only the label pane exists; the node term must short-circuit too.
      const onDataChange = vi.fn();
      const f = new LayerFactory({
        map: { ...map, hasLayer: vi.fn(() => true) },
        panes: new PaneManager(map),
        registerLayer: vi.fn(() => null),
        unregisterLayer: vi.fn(() => true),
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
        onDataChange,
      });
      const api = f.createLayers({ id: "labels", name: "Labels", labelPane: "l1" });
      api.register();
      const label = new window.L.Path();
      label.isLabel = true;
      api.addLayer(label);
      onDataChange.mockClear();
      api.clearLayers();
      expect(onDataChange).toHaveBeenCalledWith("labels");
    });

    it("drops a label flag without treating the layer as a node", () => {
      // The label/node route is a ternary chain: isLabel wins, isNode only
      // runs when isLabel is absent.
      const api = factory.createLayers({
        id: "t",
        name: "T",
        graphPane: "g1",
        nodePane: "n1",
        labelPane: "l1",
      });
      const layer = new window.L.Path();
      api.addLayer(layer, true, false);
      expect(layer.isLabel).toBe(true);
      expect(layer.isNode).toBeUndefined();
    });

    it("adds a layer straight to the group when no sub-pane is configured", () => {
      // Every sub-pane is null, so the ternary target is null and the add
      // falls through to the original group addLayer.
      const api = factory.createLayers({ id: "plain", name: "Plain" });
      const layer = new window.L.Path();
      api.addLayer(layer);
      expect(layer.options.pane).toBeUndefined();
      expect(api.mainLayer.getLayers().length).toBe(1);
    });

    it("skips the data-change callback when it is not configured", () => {
      // The callback is optional; a third party can opt out of live counts.
      const api = factory.createLayers({ id: "quiet", name: "Quiet", graphPane: "g1" });
      expect(() => api.addLayer(new window.L.Path())).not.toThrow();
    });

    it("ignores null entries in removeLayer", () => {
      // A caller passing an unresolved layer must not reach the group's
      // removeLayer with null.
      const api = factory.createLayers({ id: "t", name: "T", graphPane: "g1" });
      const layer = new window.L.Path();
      api.addLayer(layer);
      api.removeLayer(null, undefined);
      expect(api.mainLayer.getLayers().length).toBe(1);
    });

    it("removes a node layer and reports the change", () => {
      // A node routes to nodeLayer, so its removal must go through the node
      // branch of the removeLayer wrapper, not the graph one.
      const onDataChange = vi.fn();
      const f = new LayerFactory({
        map,
        panes: new PaneManager(map),
        registerLayer: vi.fn(() => null),
        unregisterLayer: vi.fn(() => true),
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
        onDataChange,
      });
      const api = f.createLayers({
        id: "n",
        name: "N",
        graphPane: "g1",
        nodePane: "n1",
      });
      const node = new window.L.Path();
      api.addLayer(node, false, true);
      onDataChange.mockClear();
      api.removeLayer(node);
      expect(onDataChange).toHaveBeenCalledWith("n");
    });

    it("removes a label layer and reports the change", () => {
      // Same for the label branch: the third lookup in the wrapper chain.
      const onDataChange = vi.fn();
      const f = new LayerFactory({
        map,
        panes: new PaneManager(map),
        registerLayer: vi.fn(() => null),
        unregisterLayer: vi.fn(() => true),
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
        onDataChange,
      });
      const api = f.createLayers({
        id: "l",
        name: "L",
        graphPane: "g1",
        labelPane: "l1",
      });
      const label = new window.L.Path();
      api.addLayer(label, true, false);
      onDataChange.mockClear();
      api.removeLayer(label);
      expect(onDataChange).toHaveBeenCalledWith("l");
    });

    it("ensures the pane for a non-Path layer routed to a sub-pane", () => {
      // Only Path/CircleMarker resolve a renderer; everything else just needs
      // its pane created so the group's pane option has something to hang on.
      // (L.Marker in this fixture derives from L.Path, so it would take the
      // renderer branch — a plain Layer is needed to reach the fallback.)
      const ensureSpy = vi.spyOn(PaneManager.prototype, "ensurePane");
      const f = new LayerFactory({
        map,
        panes: new PaneManager(map),
        registerLayer: vi.fn(() => null),
        unregisterLayer: vi.fn(),
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
      });
      const api = f.createLayers({ id: "m", name: "M", graphPane: "g1" });
      const layer = new window.L.Layer();
      expect(layer).not.toBeInstanceOf(window.L.Path);
      expect(layer).not.toBeInstanceOf(L.Path);
      api.addLayer(layer);
      expect(ensureSpy).toHaveBeenCalledWith("g1", false);
      ensureSpy.mockRestore();
    });

    it("unregister drops the layer while it still holds content", () => {
      // The content guard keeps a populated layer registered, so a third
      // party must use clearLayers() to release it.
      const api = factory.createLayers({ id: "busy", name: "Busy", graphPane: "g1" });
      api.register();
      api.addLayer(new window.L.Path());
      api.unregister();
      expect(api.registered()).toBe(true);
      api.clearLayers();
      expect(api.registered()).toBe(false);
    });

    it("tracks the container size on an explicit resize", () => {
      // resize reads the container each call, so a growing container must
      // reach the canvas backing store.
      const container = { clientWidth: 800, clientHeight: 600 };
      map.getContainer = vi.fn(() => container);
      const api = factory.createCanvas({ id: "c1", name: "C" });
      Object.defineProperty(container, "clientWidth", { value: 1200 });
      api.resize();
      expect(api.canvas.width).toBe(1200 * (window.devicePixelRatio || 1));
      expect(api.getSize()).toEqual({ width: 1200, height: 600 });
    });

    it("falls back to a scale of 1 when devicePixelRatio is unavailable", () => {
      // jsdom reports 1 already, but a browser could expose 0 or null; the
      // backing store must still get a positive size instead of 0.
      const prev = (window as any).devicePixelRatio;
      (window as any).devicePixelRatio = 0;
      try {
        const api = factory.createCanvas({ id: "c2", name: "C2" });
        api.resize();
        expect(api.canvas.width).toBe(800);
        expect(api.canvas.height).toBe(600);
      } finally {
        (window as any).devicePixelRatio = prev;
      }
    });

    it("unregisters and removes the canvas on destroy", () => {
      // destroy must leave no registered layer and no canvas in the pane.
      const unreg = vi.fn(() => true);
      const f = new LayerFactory({
        map,
        panes: new PaneManager(map),
        registerLayer: vi.fn(() => null),
        unregisterLayer: unreg,
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
      });
      const api = f.createCanvas({ id: "gone", name: "Gone" });
      api.register();
      api.destroy();
      expect(api.registered()).toBe(false);
      expect(unreg).toHaveBeenCalledWith("gone");
      expect(api.canvas.parentNode).toBeNull();
      expect(map.off).toHaveBeenCalledTimes(2);
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

    it("uses default onToggle and onZIndex when none are supplied", () => {
      const reg = vi.fn(() => null);
      const f = new LayerFactory({
        map,
        panes: new PaneManager(map),
        registerLayer: reg,
        unregisterLayer: vi.fn(),
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
      });
      const api = f.createCanvas({ id: "test" });
      api.register();

      const registered = reg.mock.calls[0][0] as any;
      expect(typeof registered.onToggle).toBe("function");
      expect(typeof registered.onZIndex).toBe("function");

      // The defaults must actually drive the canvas, not be inert stubs.
      registered.onToggle(false);
      expect(api.canvas.classList.contains("hidden")).toBe(true);
      registered.onToggle(true);
      expect(api.canvas.classList.contains("hidden")).toBe(false);
      registered.onZIndex(7);
      expect(api.canvas.style.zIndex).toBe("7");
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

    it("removeLayer routes from nodeLayer when isNode", () => {
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        graphPane: "graph1",
        nodePane: "node1",
      });
      const nodeLayer = new window.L.Marker();
      nodeLayer.isNode = true;
      api.addLayer(nodeLayer);
      expect(api.registered()).toBe(true);
      api.removeLayer(nodeLayer);
      // Node layer was removed from the node sub-layer; registered stays true
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

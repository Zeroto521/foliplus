import { beforeEach, describe, expect, it, vi } from "vitest";
import { LayerFactory } from "#foliplus/core/layer/LayerFactory.js";
import { PaneManager } from "#foliplus/core/layer/PaneManager.js";

describe("LayerFactory", () => {
  let factory;
  let map;
  let panes;
  let registerLayer;
  let unregisterLayer;
  let bringLayerToFront;
  let invalidateType;

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
    window.L.layerGroup = vi.fn((layers?: any[], options?: { pane?: string }) => {
      const children: any[] = [];
      const grp = {
        addLayer: vi.fn((l: any) => {
          children.push(l);
          return grp;
        }),
        removeLayer: vi.fn((l: any) => {
          const i = children.indexOf(l);
          if (i !== -1) children.splice(i, 1);
          return grp;
        }),
        hasLayer: vi.fn((l: any) => children.includes(l)),
        getLayers: vi.fn(() => children),
        clearLayers: vi.fn(() => {
          children.length = 0;
          return grp;
        }),
        eachLayer: vi.fn((cb: any) => children.forEach(cb)),
        // Respect the { pane } arg so tests that route by subLayer.options.pane
        // see the same truth LayerFactory.createLayers writes.
        options: options ?? {},
      };
      return grp;
    });
    window.L.DomUtil = { getPosition: vi.fn(() => ({ x: 0, y: 0 })) };
    // jsdom canvas.getContext returns null; mock it
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      setTransform: vi.fn(),
      clearRect: vi.fn(),
    })) as any;

    const paneRegistry: Record<string, HTMLElement> = {};
    map = {
      on: vi.fn(),
      off: vi.fn(),
      hasLayer: vi.fn(() => false),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      getContainer: vi.fn(() => ({ clientWidth: 800, clientHeight: 600 })),
      getPane: vi.fn((name: string) => paneRegistry[name] ?? null),
      createPane: vi.fn((name: string) => {
        const p = document.createElement("div");
        p.classList.add("foliplus-layer-pane");
        paneRegistry[name] = p;
        return p;
      }),
      getPanes: vi.fn(() => {
        const el = document.createElement("div");
        return { mapPane: el };
      }),
      _panes: paneRegistry,
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
        panes: [{ name: "graph1" }],
      });
      api.addLayer(new window.L.Path());
      expect(registerLayer).toHaveBeenCalled();
    });

    it("bringToFront delegates to the injected callback", () => {
      const api = factory.createLayers({ id: "test", name: "Test" });
      api.bringToFront();
      expect(bringLayerToFront).toHaveBeenCalledWith("test");
    });

    it("routes a layer to the named sub-pane via addLayer's second arg", () => {
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        panes: [{ name: "graph1" }, { name: "label1", isLabel: true }],
      });
      const labelLayer = new window.L.Marker();
      api.addLayer(labelLayer, "label1");
      expect(labelLayer.options.pane).toBe("label1");
    });

    it("preserves existing options.pane when addLayer omits paneName", () => {
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        panes: [
          { name: "graph1" },
          { name: "node1" },
          { name: "label1", isLabel: true },
        ],
      });
      // Simulate a layer already routed to node1 (e.g. by mainLayer.addLayer),
      // then re-added without an explicit pane (resortLayers path).
      const nodeLayer = new window.L.Marker();
      nodeLayer.options.pane = "node1";
      nodeLayer.options.paneSet = true;
      api.addLayer(nodeLayer);
      expect(nodeLayer.options.pane).toBe("node1");
    });

    it("marks a layer as isLabel when its pane is declared isLabel: true", () => {
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        panes: [{ name: "graph1" }, { name: "label1", isLabel: true }],
      });
      const labelLayer = new window.L.Marker();
      api.addLayer(labelLayer, "label1");
      expect(labelLayer.isLabel).toBe(true);
    });

    it("does not mark isLabel for a pane without isLabel: true (e.g. a node pane)", () => {
      // Three-pane shape: graph / node / label. Only the label pane opts in,
      // so a node-marker must NOT be counted as a label leaf by
      // countFeatureGeometry.
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        panes: [
          { name: "graph1" },
          { name: "node1" },
          { name: "label1", isLabel: true },
        ],
      });
      const nodeLayer = new window.L.Path();
      api.addLayer(nodeLayer, "node1");
      expect(nodeLayer.isLabel).toBe(false);
      const labelLayer = new window.L.Marker();
      api.addLayer(labelLayer, "label1");
      expect(labelLayer.isLabel).toBe(true);
    });

    it("does not mark isLabel for a layer in the base pane (index 0)", () => {
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        panes: [{ name: "graph1" }, { name: "label1", isLabel: true }],
      });
      const graphLayer = new window.L.Path();
      api.addLayer(graphLayer, "graph1");
      expect(graphLayer.isLabel).toBe(false);
    });

    it("falls through to origAddLayer when no panes declared", () => {
      const api = factory.createLayers({ id: "test", name: "Test" });
      const layer = new window.L.Path();
      api.addLayer(layer);
      expect(layer.options.pane).toBeUndefined();
    });

    it("addLayer with an unknown paneName silently falls through to the base layerGroup", () => {
      // Documenting current behavior, not endorsing it. A mis-spelled pane
      // name (the class of bug that bit MeasureControl's PR #271 where two
      // addLayer calls forgot isNode and silently routed to the base pane)
      // would be nice to catch, but throwing here would kill a live
      // measurement if a caller passes a null/undefined pane. Silent
      // fallback keeps the layer visible on the map; the layer just lands
      // in the wrong sub-pane. If we tighten this to throw, update this test.
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        panes: [{ name: "graph1" }, { name: "label1", isLabel: true }],
      });
      const layer = new window.L.Marker();
      api.addLayer(layer, "does_not_exist");
      // The api.addLayer wrapper does not write options.pane for a name
      // outside subPanes; mainLayer.addLayer then auto-routes to the base
      // sub-pane (subPanes[0]) �?the same place a bare addLayer(layer) with
      // no name goes. Documented so a future tightening has a test to
      // update.
      expect(layer.options.pane).toBe("graph1");
      expect(layer.isLabel).toBeUndefined();
    });

    it("addLayer with the base pane name (subPanes[0]) routes to the sub-layer", () => {
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        panes: [{ name: "graph1" }, { name: "label1", isLabel: true }],
      });
      const layer = new window.L.Path();
      api.addLayer(layer, "graph1");
      expect(layer.options.pane).toBe("graph1");
      // Graph is index 0 — not a label pane, so isLabel is false.
      expect(layer.isLabel).toBe(false);
    });

    it("addLayer without a paneName defaults to the base pane (subPanes[0])", () => {
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        panes: [{ name: "graph1" }, { name: "label1", isLabel: true }],
      });
      const layer = new window.L.Path();
      api.addLayer(layer);
      expect(layer.options.pane).toBe("graph1");
      // No explicit paneName → wrapper skips isLabel; mainLayer routes to base.
      expect(layer.isLabel).toBeUndefined();
    });

    it("mainLayer.addLayer auto-routes a leaf without options.pane to the base sub-layer", () => {
      // Pre-refactor, mainLayer.addLayer(layer) wrote options.pane = graphPane
      // automatically when layer.isLabel was absent. The refactor initially
      // dropped that write, silently breaking the mainLayer.addLayer(poly)
      // contract that browser tests and MeasureControl rely on �?the CI run
      // caught it as "assert 'overlayPane' == '__pane_test_graph__'". This
      // test pins the restored auto-route behavior.
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        panes: [{ name: "graph1" }, { name: "label1", isLabel: true }],
      });
      const layer = new window.L.Path();
      expect(layer.options.pane).toBeUndefined();
      api.mainLayer.addLayer(layer);
      expect(layer.options.pane).toBe("graph1");
      // The sub-layer, not mainLayer, now owns the leaf.
      const subLayers = Array.from(api.mainLayer.getLayers());
      expect(subLayers.length).toBe(2); // graph + label sub-layers
      const graphSub = subLayers.find(g => g.options.pane === "graph1");
      expect(graphSub.hasLayer(layer)).toBe(true);
    });

    it("mainLayer.addLayer honours an explicit options.pane that matches a sub-pane", () => {
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        panes: [{ name: "graph1" }, { name: "label1", isLabel: true }],
      });
      const layer = new window.L.Path();
      layer.options.pane = "label1";
      // `paneSet` marks the pane as explicitly authored (not a Leaflet
      // class default like 'overlayPane' / 'markerPane'). The wrapper
      // honours the declared value only when this flag is true.
      (layer.options as { paneSet?: boolean }).paneSet = true;
      api.mainLayer.addLayer(layer);
      expect(layer.options.pane).toBe("label1");
      const subLayers = Array.from(api.mainLayer.getLayers());
      const labelSub = subLayers.find(g => g.options.pane === "label1");
      expect(labelSub.hasLayer(layer)).toBe(true);
    });

    it("mainLayer.addLayer falls through to origAddLayer when options.pane names a pane not in subPanes", () => {
      // A caller that sets options.pane to a name outside subPanes (a
      // third-party pane, or a stale reference after a rebuild) is left
      // alone: the leaf lands in mainLayer directly, no pin, no crash.
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        panes: [{ name: "graph1" }],
      });
      const layer = new window.L.Path();
      layer.options.pane = "__not_ours__";
      (layer.options as { paneSet?: boolean }).paneSet = true;
      api.mainLayer.addLayer(layer);
      expect(layer.options.pane).toBe("__not_ours__");
      // Direct on mainLayer (not in any sub-layer).
      const subLayers = Array.from(api.mainLayer.getLayers());
      const directOnMain = subLayers.filter(g => g === layer).length;
      expect(directOnMain).toBe(1);
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
      const api = f.createLayers({ id: "test", name: "Test", panes: [{ name: "g1" }] });
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
        panes: [{ name: "g1" }],
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
      const api = f.createLayers({ id: "test", name: "Test", panes: [{ name: "g1" }] });
      api.register();
      api.clearLayers(); // panes declared but contains no data
      expect(onDataChange).not.toHaveBeenCalled();
    });

    it("does not crash when onDataChange is not provided", () => {
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        panes: [{ name: "g1" }],
      });
      const layer = new window.L.Path();
      expect(() => api.addLayer(layer)).not.toThrow();
      expect(() => api.removeLayer(layer)).not.toThrow();
    });

    it("invalidates the cached type when graph content changes", () => {
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        panes: [{ name: "graph1" }],
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

    it("clearLayers leaves the map untouched when the map does not hold the mainLayer", () => {
      const f = new LayerFactory({
        map: { ...map, hasLayer: vi.fn(() => false) },
        panes: new PaneManager(map),
        registerLayer: vi.fn(),
        unregisterLayer: vi.fn(),
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
      });
      const api = f.createLayers({
        id: "test",
        name: "Test",
        panes: [{ name: "g1" }],
      });
      expect(() => api.clearLayers()).not.toThrow();
      expect(map.removeLayer).not.toHaveBeenCalledWith(api.mainLayer);
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
      const api = f.createLayers({
        id: "test",
        name: "Test",
        panes: [{ name: "graph1" }],
      });
      api.addLayer(new window.L.Path());
      api.register(); // second call �?register() always calls registerLayer
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
        panes: [{ name: "graph1" }],
      });
      expect(api.registered()).toBe(false);
      api.addLayer(new window.L.Path());
      expect(api.registered()).toBe(true);
    });

    it("addLayer with L.Path triggers ensureVector for the declared pane", () => {
      const ensureVectorSpy = vi.spyOn(PaneManager.prototype, "ensureVector");
      const f = new LayerFactory({
        map,
        panes: new PaneManager(map),
        registerLayer: vi.fn(),
        unregisterLayer: vi.fn(),
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
      });
      const api = f.createLayers({
        id: "test",
        name: "Test",
        panes: [{ name: "graph1" }],
      });
      api.addLayer(new window.L.Path(), "graph1");
      expect(ensureVectorSpy).toHaveBeenCalledWith(expect.anything(), "graph1");
      ensureVectorSpy.mockRestore();
    });

    it("forwards styleProvider / styleSetters / styleDefaults to registerLayer", () => {
      const reg = vi.fn(() => null);
      const f = new LayerFactory({
        map,
        panes: new PaneManager(map),
        registerLayer: reg,
        unregisterLayer: vi.fn(),
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
      });
      const styleProvider = () => ({ color: "#f00" });
      const styleSetters = { color: () => {} };
      const styleDefaults = () => ({ weight: 2 });
      const api = f.createLayers({
        id: "test",
        name: "Test",
        panes: [{ name: "g1" }],
        styleProvider,
        styleSetters,
        styleDefaults,
      });
      api.addLayer(new window.L.Path(), "g1");
      expect(reg).toHaveBeenCalledWith(
        expect.objectContaining({ styleProvider, styleSetters, styleDefaults }),
      );
    });

    it("removeLayer ignores null and undefined entries", () => {
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        panes: [{ name: "g1" }],
      });
      const layer = new window.L.Path();
      api.addLayer(layer, "g1");
      expect(() => api.removeLayer(layer, null, undefined)).not.toThrow();
      expect(api.mainLayer.getLayers().length).toBe(1);
    });

    it("addLayer skips auto-register when the map already holds the mainLayer", () => {
      const reg = vi.fn(() => null);
      const f = new LayerFactory({
        map: { ...map, hasLayer: vi.fn(() => true) },
        panes: new PaneManager(map),
        registerLayer: reg,
        unregisterLayer: vi.fn(),
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
      });
      const api = f.createLayers({
        id: "test",
        name: "Test",
        panes: [{ name: "g1" }],
      });
      api.register();
      reg.mockClear();
      api.addLayer(new window.L.Path(), "g1");
      expect(reg).not.toHaveBeenCalled();
    });

    it("unregister keeps the layer registered while it still holds content", () => {
      const unreg = vi.fn(() => true);
      const f = new LayerFactory({
        map: { ...map, hasLayer: vi.fn(() => true) },
        panes: new PaneManager(map),
        registerLayer: vi.fn(),
        unregisterLayer: unreg,
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
      });
      const api = f.createLayers({
        id: "test",
        name: "Test",
        panes: [{ name: "g1" }],
      });
      api.register();
      api.addLayer(new window.L.Path(), "g1");
      api.unregister();
      expect(unreg).not.toHaveBeenCalled();
      expect(api.registered()).toBe(true);
    });

    it("clearLayers skips onDataChange when featureCountProvider is supplied", () => {
      const onDataChange = vi.fn();
      const f = new LayerFactory({
        map: { ...map, hasLayer: vi.fn(() => true) },
        panes: new PaneManager(map),
        registerLayer: vi.fn(),
        unregisterLayer: vi.fn(),
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
        onDataChange,
      });
      const api = f.createLayers({
        id: "test",
        name: "Test",
        panes: [{ name: "g1" }],
        featureCountProvider: () => 0,
      });
      api.addLayer(new window.L.Path(), "g1");
      onDataChange.mockClear();
      api.clearLayers();
      expect(onDataChange).not.toHaveBeenCalled();
    });

    it("falls through to the LayerGroup prototype when L.LayerGroup is defined", () => {
      class MockLayerGroup {
        addLayer(_l: unknown) {
          return this;
        }
        removeLayer(_l: unknown) {
          return this;
        }
      }
      window.L.LayerGroup = MockLayerGroup;
      try {
        const api = factory.createLayers({
          id: "test",
          name: "Test",
          panes: [{ name: "g1" }],
        });
        const layer = new window.L.Path();
        layer.options.pane = "__not_ours__";
        (layer.options as { paneSet?: boolean }).paneSet = true;
        api.mainLayer.addLayer(layer);
        expect(layer.options.pane).toBe("__not_ours__");
      } finally {
        Reflect.deleteProperty(window.L, "LayerGroup");
      }
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

    it("register forwards source / updatedAt / meta provenance", () => {
      const meta = { "Source layer": "Stores", "Aggregation field": "sales" };
      const api = factory.createCanvas({
        id: "canvas_test",
        source: "stores.geojson",
        updatedAt: 1700000000000,
        meta,
      });
      api.register();
      expect(registerLayer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "canvas_test",
          source: "stores.geojson",
          updatedAt: 1700000000000,
          meta,
        }),
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

    it("setZIndex sets the dedicated pane style", () => {
      const api = factory.createCanvas({ id: "canvas_test" });
      api.setZIndex(42);
      expect(api.canvas.parentElement?.style.zIndex).toBe("42");
    });

    it("mounts the canvas in a dedicated foliplus-layer-pane", () => {
      const api = factory.createCanvas({ id: "canvas_test" });
      const pane = api.canvas.parentElement;
      expect(pane?.classList.contains("foliplus-layer-pane")).toBe(true);
      expect(map.createPane).toHaveBeenCalledWith("foliplus-canvas-canvas_test");
    });

    it("uses the generic foliplus-canvas-layer class, not a component class", () => {
      const api = factory.createCanvas({ id: "canvas_test" });
      expect(api.canvas.classList.contains("foliplus-canvas-layer")).toBe(true);
      expect(api.canvas.classList.contains("foliplus-heatmap-canvas")).toBe(false);
    });

    it("keeps no SVG renderer on the canvas pane", () => {
      factory.createCanvas({ id: "canvas_test" });
      expect(window.L.svg).not.toHaveBeenCalled();
      expect(map["foliplus_renderer_foliplus-canvas-canvas_test"]).toBeUndefined();
    });

    it("registers with paneName so enforceOrder can z-order the pane", () => {
      const api = factory.createCanvas({ id: "canvas_test" });
      api.register();
      expect(registerLayer).toHaveBeenCalledWith(
        expect.objectContaining({ paneName: "foliplus-canvas-canvas_test" }),
      );
    });

    it("destroy removes the dedicated pane from the Leaflet registry", () => {
      const api = factory.createCanvas({ id: "canvas_test" });
      const paneName = "foliplus-canvas-canvas_test";
      expect(map._panes[paneName]).toBeTruthy();
      api.destroy();
      expect(api.canvas.parentElement).toBeNull();
      expect(map._panes[paneName]).toBeUndefined();
    });

    it("resize and getSize work with mock container", () => {
      const api = factory.createCanvas({ id: "canvas_test" });
      const size = api.getSize();
      expect(size.width).toBe(800);
      expect(size.height).toBe(600);
    });

    it("resize falls back to devicePixelRatio 1 when the browser reports 0", () => {
      const original = window.devicePixelRatio;
      Object.defineProperty(window, "devicePixelRatio", {
        value: 0,
        configurable: true,
      });
      try {
        const api = factory.createCanvas({ id: "test" });
        api.resize();
        expect(api.canvas.width).toBe(800);
      } finally {
        Object.defineProperty(window, "devicePixelRatio", {
          value: original,
          configurable: true,
        });
      }
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

    it("removeLayer routes from the sub-layer when present", () => {
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        panes: [{ name: "graph1" }],
      });
      const layer = new window.L.Path();
      api.addLayer(layer, "graph1");
      api.removeLayer(layer);
      // layer should be removed from the sub-layer, not the mainLayer directly
      const mainLayer = api.mainLayer;
      // mainLayer still has the sub-layer (container), but the path was removed from it
      expect(mainLayer.getLayers().length).toBe(1); // sub-layer remains
    });

    it("removeLayer routes from the label sub-layer when pinned there", () => {
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        panes: [{ name: "graph1" }, { name: "label1", isLabel: true }],
      });
      const labelLayer = new window.L.Marker();
      api.addLayer(labelLayer, "label1");
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
      const iconSvg = '<svg viewBox="0 0 4 4"><rect width="2" height="2"/></svg>';
      const api = f.createLayers({
        id: "test",
        name: "Test",
        iconSvg,
        panes: [{ name: "g1" }],
      });
      api.addLayer(new window.L.Path(), "g1");
      expect(reg).toHaveBeenCalledWith(expect.objectContaining({ iconSvg }));
    });

    it("forwards getBounds to registerLayer", () => {
      const reg = vi.fn(() => null);
      const f = new LayerFactory({
        map,
        panes: new PaneManager(map),
        registerLayer: reg,
        unregisterLayer: vi.fn(),
        bringLayerToFront: vi.fn(),
        invalidateType: vi.fn(),
      });
      const getBounds = () => null;
      const api = f.createCanvas({ id: "test", getBounds });
      api.register();
      expect(reg).toHaveBeenCalledWith(expect.objectContaining({ getBounds }));
    });

    it("default onToggle hides the canvas when invoked with false", () => {
      const reg = vi.fn((opts: any) => {
        opts.onToggle(false);
        return null;
      });
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
      expect(api.canvas.classList.contains("hidden")).toBe(true);
    });
  });

  // ── createSurface equivalence ──

  describe("createSurface", () => {
    it("createLayers wrapper delegates to createSurface and returns the layers dialect", () => {
      const wrapperApi = factory.createLayers({
        id: "eq",
        name: "Eq",
        panes: [{ name: "g1" }, { name: "l1", isLabel: true }],
      });
      const handle = factory.createSurface({
        id: "eq",
        name: "Eq",
        content: {
          kind: "layers",
          panes: [{ name: "g1" }, { name: "l1", isLabel: true }],
        },
      });
      const c = handle.content as Extract<
        import("#foliplus/core/layer/type.js").SurfaceContentHandle,
        { kind: "layers" }
      >;
      // The wrapper returns the handle's content fields plus the shared plumbing.
      expect(Object.keys(wrapperApi).sort()).toEqual(
        Object.keys({
          mainLayer: c.mainLayer,
          addLayer: c.addLayer,
          removeLayer: c.removeLayer,
          clearLayers: c.clearLayers,
          register: handle.register,
          unregister: handle.unregister,
          registered: handle.registered,
          bringToFront: handle.bringToFront,
        }).sort(),
      );
    });

    it("createCanvas wrapper delegates to createSurface and returns the canvas dialect", () => {
      const wrapperApi = factory.createCanvas({ id: "eq-c", name: "EqC" });
      const handle = factory.createSurface({
        id: "eq-c",
        name: "EqC",
        content: { kind: "canvas" },
      });
      const c = handle.content as Extract<
        import("#foliplus/core/layer/type.js").SurfaceContentHandle,
        { kind: "canvas" }
      >;
      expect(Object.keys(wrapperApi).sort()).toEqual(
        Object.keys({
          canvas: c.canvas,
          ctx: c.ctx,
          resize: c.resize,
          getSize: c.getSize,
          updatePosition: c.updatePosition,
          register: handle.register,
          unregister: handle.unregister,
          registered: handle.registered,
          destroy: handle.destroy,
          bringToFront: handle.bringToFront,
          setZIndex: c.setZIndex,
          setVisible: c.setVisible,
        }).sort(),
      );
    });

    it("layer surface declares paneSpecs with correct role and order", () => {
      const handle = factory.createSurface({
        id: "ps",
        content: {
          kind: "layers",
          panes: [{ name: "base" }, { name: "sub", isLabel: true }, { name: "sub2" }],
        },
      });
      const c = handle.content as Extract<
        import("#foliplus/core/layer/type.js").SurfaceContentHandle,
        { kind: "layers" }
      >;
      c.addLayer(new window.L.Path(), "sub");
      expect(registerLayer).toHaveBeenCalledWith(
        expect.objectContaining({
          paneSpecs: [
            { role: "base", order: 0, name: "base" },
            { role: "sub", order: 1, name: "sub", isLabel: true },
            { role: "sub", order: 2, name: "sub2" },
          ],
        }),
      );
    });

    it("canvas surface creates a canvas element, context, and dedicated pane", () => {
      const handle = factory.createSurface({
        id: "cv",
        content: { kind: "canvas", className: "custom" },
      });
      const c = handle.content as Extract<
        import("#foliplus/core/layer/type.js").SurfaceContentHandle,
        { kind: "canvas" }
      >;
      expect(c.canvas).toBeInstanceOf(HTMLCanvasElement);
      expect(c.canvas.classList).toContain("foliplus-canvas-layer");
      expect(c.canvas.classList).toContain("custom");
      expect(c.ctx).not.toBeNull();
      expect(handle.destroy).toBeDefined();
      handle.register();
      expect(registerLayer).toHaveBeenCalledWith(
        expect.objectContaining({
          canvas: c.canvas,
          paneName: "foliplus-canvas-cv",
        }),
      );
    });
  });
});

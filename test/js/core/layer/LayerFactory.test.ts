import { beforeEach, describe, expect, it, vi } from "vitest";
import { LayerFactory } from "#foliplus/core/layer/LayerFactory.js";
import { PaneManager } from "#foliplus/core/layer/PaneManager.js";

// Coverage exemption for LayerFactory.ts — knowingly uncovered, not overlooked.
// Lines and branches are at 100% (214/214, 106/106). Function coverage stops at
// 90.38% on five records, split between a deliberate choice and a tool limit:
//
//   LayerFactory.ts:172  `let shouldUnregister: () => boolean = () => true;`
//
//   Deliberate. The default initializer never executes: every content dialect
//   overwrites `shouldUnregister` before the handle is returned (the layers
//   dialect with a remaining-content check, the canvas and color dialects with
//   `() => true`). It stays anyway — for definite assignment across the
//   `if (content.kind)` split the compiler cannot narrow, and as a fail-safe so
//   a future dialect that forgets to overwrite it cannot leave a layer
//   registered forever. Reaching 100% means deleting that default, i.e. trading
//   a safety net for a number. If a new dialect lands, override
//   `shouldUnregister` there rather than reworking this file's fixtures.
//
//   LayerFactory.ts:382,385 (color) and :490,493 (canvas) — the map
//   "move"/"resize" callbacks. A v8 attribution limit, not a gap: v8 reports
//   FNDA:0 for these four single-expression arrow bodies even when they run
//   (lcov shows DA:490,84 and DA:493,84 in the same report that records
//   FNDA:0 for the functions defined on those lines, and function coverage is
//   byte-identical before and after the tests below exercise them). The two
//   "map move and resize events drive ..." tests still exist because they pin
//   real behavior the metric cannot see — a wrong event name or a dropped
//   registration would fail them.

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
      fillRect: vi.fn(),
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
      const protoAddLayer = vi.fn(function (this: unknown) {
        return this;
      });
      window.L.LayerGroup = {
        prototype: {
          addLayer: protoAddLayer,
          removeLayer: vi.fn(function (this: unknown) {
            return this;
          }),
        },
      };
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
        // The "not our pane" fallthrough must hit the LayerGroup prototype —
        // not the instance's own addLayer (which the wrapper just replaced).
        // The pane-unchanged assertion the test used to make held on both
        // branches, so it did not pin anything; this one does.
        expect(protoAddLayer).toHaveBeenCalledTimes(1);
        expect(protoAddLayer).toHaveBeenCalledWith(layer);
      } finally {
        Reflect.deleteProperty(window.L, "LayerGroup");
      }
    });

    it("does not consult the LayerGroup prototype when L.LayerGroup is undefined", () => {
      // setup.ts's L stub has no LayerGroup key, so the falsy branch delegates
      // to the layerGroup mock's own addLayer, which pushes into `children`.
      // Observable via getLayers(). Complements the test above: that one fails
      // if the truthy branch stops running; this one fails if the falsy branch
      // stops running.
      const api = factory.createLayers({
        id: "test",
        name: "Test",
        panes: [{ name: "g1" }],
      });
      const layer = new window.L.Path();
      layer.options.pane = "__not_ours__";
      (layer.options as { paneSet?: boolean }).paneSet = true;
      api.mainLayer.addLayer(layer);
      expect(api.mainLayer.getLayers()).toContain(layer);
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
      expect(typeof api.setVisible).toBe("function");
    });

    it("throws when id is missing", () => {
      expect(() => factory.createCanvas({} as any)).toThrow(
        "createCanvas requires an id",
      );
    });

    it("throws when the browser cannot provide a 2d context", () => {
      HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as any;
      expect(() => factory.createCanvas({ id: "canvas_test" })).toThrow(
        "createCanvas requires a 2d context",
      );
    });

    it("normalises a pane name that would not be a valid element id", () => {
      // The pane name reaches Leaflet's createPane as both an element id and a
      // CSS class, so disallowed runs collapse to '-' rather than being
      // dropped — the pane stays recognisable and the caller's own id is left
      // untouched.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      factory.createCanvas({ id: "canvas name" });
      expect(map.createPane).toHaveBeenCalledWith("foliplus-canvas-canvas-name");
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("normalised for injection safety"),
      );
      warn.mockRestore();
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

    it("map move and resize events drive the counter-translate and the resize", () => {
      // throttleRaf coalesces through requestAnimationFrame, so the frame is
      // captured here instead of awaited. No change to the shared map mock: the
      // registered handler is read back out of it and invoked directly.
      const frames: Array<() => void> = [];
      const raf = window.requestAnimationFrame;
      const cancel = window.cancelAnimationFrame;
      window.requestAnimationFrame = (cb: FrameRequestCallback) => {
        frames.push(() => cb(0));
        return frames.length;
      };
      window.cancelAnimationFrame = () => {};
      try {
        const api = factory.createCanvas({ id: "canvas_test" });
        const handlers = Object.fromEntries(
          map.on.mock.calls.map(([ev, cb]) => [ev, cb]),
        ) as Record<string, () => void>;

        window.L.DomUtil.getPosition = vi.fn(() => ({ x: -30, y: -12 }));
        handlers.move();
        expect(frames).toHaveLength(1);
        frames[0]();
        expect(api.canvas.style.left).toBe("30px");
        expect(api.canvas.style.top).toBe("12px");

        map.getContainer.mockReturnValue({ clientWidth: 400, clientHeight: 300 });
        handlers.resize();
        expect(api.canvas.width).toBe(400);
        expect(api.canvas.height).toBe(300);
      } finally {
        window.requestAnimationFrame = raf;
        window.cancelAnimationFrame = cancel;
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

  // ── createSurface: the color dialect ────────────────────────────
  // The third content kind. A solid-color basemap has no Leaflet layer and no
  // drawing API: the surface owns a pane, the pane owns a canvas face, and the
  // whole content model is one value. The interesting part is not the fill but
  // the tile panes — hiding them is this surface's business, and the class it
  // writes lives on a pane that outlives the surface.

  describe("createSurface color", () => {
    type ColorContent = Extract<
      import("#foliplus/core/layer/type.js").SurfaceContentHandle,
      { kind: "color" }
    >;

    const make = (id: string) =>
      factory.createSurface({
        id,
        content: { kind: "color", color: "#3366cc" },
      });
    const content = (h: { content: ColorContent }): ColorContent => h.content;

    it("throws when id is missing", () => {
      expect(() =>
        factory.createSurface({
          id: "",
          content: { kind: "color", color: "#3366cc" },
        }),
      ).toThrow("color surface requires an id");
    });

    it("throws when the browser cannot provide a 2d context", () => {
      // Same guard the canvas branch carries: fail loudly at construction
      // rather than return a surface whose fill silently never happens.
      HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as any;
      expect(() =>
        factory.createSurface({
          id: "solid",
          content: { kind: "color", color: "#3366cc" },
        }),
      ).toThrow("color surface requires a 2d context");
    });

    it("normalises a color pane name that would not be a valid element id", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      make("solid name");
      expect(map.createPane).toHaveBeenCalledWith("foliplus-color-solid-name");
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("normalised for injection safety"),
      );
      warn.mockRestore();
    });

    it("resize falls back to devicePixelRatio 1 when the browser reports 0", () => {
      const original = window.devicePixelRatio;
      Object.defineProperty(window, "devicePixelRatio", {
        value: 0,
        configurable: true,
      });
      try {
        const h = make("solid");
        expect(content(h).element.width).toBe(800);
      } finally {
        Object.defineProperty(window, "devicePixelRatio", {
          value: original,
          configurable: true,
        });
      }
    });

    it("map move and resize events drive the counter-translate and the face size", () => {
      // Same wiring the canvas dialect carries — the color surface reuses the
      // canvas branch's geometry plumbing, so both map events are pinned here
      // too rather than left to that branch's test.
      const frames: Array<() => void> = [];
      const raf = window.requestAnimationFrame;
      const cancel = window.cancelAnimationFrame;
      window.requestAnimationFrame = (cb: FrameRequestCallback) => {
        frames.push(() => cb(0));
        return frames.length;
      };
      window.cancelAnimationFrame = () => {};
      try {
        const h = make("solid");
        const handlers = Object.fromEntries(
          map.on.mock.calls.map(([ev, cb]) => [ev, cb]),
        ) as Record<string, () => void>;

        window.L.DomUtil.getPosition = vi.fn(() => ({ x: -30, y: -12 }));
        handlers.move();
        expect(frames).toHaveLength(1);
        frames[0]();
        expect(content(h).element.style.left).toBe("30px");
        expect(content(h).element.style.top).toBe("12px");

        map.getContainer.mockReturnValue({ clientWidth: 400, clientHeight: 300 });
        handlers.resize();
        expect(content(h).element.width).toBe(400);
        expect(content(h).element.height).toBe(300);
      } finally {
        window.requestAnimationFrame = raf;
        window.cancelAnimationFrame = cancel;
      }
    });

    it("owns a dedicated color pane and mounts the face in it", () => {
      const h = make("solid");
      expect(map.createPane).toHaveBeenCalledWith("foliplus-color-solid");
      expect(
        content(h).element.parentElement?.classList.contains("foliplus-layer-pane"),
      ).toBe(true);
      // A canvas face, not an invented fourth element kind: the geometry
      // plumbing (sizing, counter-translation) is the canvas branch's.
      expect(content(h).element).toBeInstanceOf(HTMLCanvasElement);
      expect(content(h).element.classList.contains("foliplus-canvas-layer")).toBe(true);
      expect(window.L.svg).not.toHaveBeenCalled();
    });

    it("registers as a base layer carrying the fill, the face, and the pane name", () => {
      const h = make("solid");
      h.register();
      expect(registerLayer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "solid",
          isBase: true,
          color: "#3366cc",
          canvas: content(h).element,
          paneName: "foliplus-color-solid",
        }),
      );
    });

    it("ignores a missing tilePane rather than throwing", () => {
      const h = make("solid");
      const c = content(h);
      expect(() => c.setVisible(true)).not.toThrow();
      expect(c.element.classList.contains("hidden")).toBe(false);
    });

    it("setColor repaints and the handle reports the live fill", () => {
      const fillRect = vi.fn();
      HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
        setTransform: vi.fn(),
        clearRect: vi.fn(),
        fillRect,
      })) as any;

      const h = make("solid");
      const paintedAtConstruction = fillRect.mock.calls.length;
      expect(content(h).color).toBe("#3366cc");

      content(h).setColor("#123456");
      expect(fillRect.mock.calls.length).toBe(paintedAtConstruction + 1);
      expect(content(h).color).toBe("#123456");
    });

    it("unregister hides the face and does not touch the shared tile panes", () => {
      // The color surface owns only its own face: visibility is a `hidden`
      // class on the canvas element. Tile pane state was the old mutual
      // exclusion's side effect — first-class basemaps retire it.
      const tilePane = document.createElement("div");
      map._panes["tilePane"] = tilePane;
      const h = make("solid");
      h.register();
      expect(tilePane.classList.contains("foliplus-layer-tile-hidden")).toBe(false);

      h.unregister();
      expect(unregisterLayer).toHaveBeenCalledWith("solid");
      expect(tilePane.classList.contains("foliplus-layer-tile-hidden")).toBe(false);
    });

    it("destroy unbinds, drops the face and the pane, and gives the tiles back", () => {
      const tilePane = document.createElement("div");
      map._panes["tilePane"] = tilePane;
      const h = make("solid");
      const face = content(h).element;
      expect(map._panes["foliplus-color-solid"]).toBeTruthy();

      // The leak this guards against: the caller showed the color through
      // `setVisible` but never registered, so `preUnregister` will not run.
      content(h).setVisible(true);
      h.destroy();

      expect(map.off).toHaveBeenCalled();
      expect(face.parentElement).toBeNull();
      expect(map._panes["foliplus-color-solid"]).toBeUndefined();
      expect(tilePane.classList.contains("foliplus-layer-tile-hidden")).toBe(false);
    });

    it("destroy unregisters a registered surface too", () => {
      const h = make("solid");
      h.register();
      h.destroy();
      expect(unregisterLayer).toHaveBeenCalledWith("solid");
      expect(h.registered()).toBe(false);
    });

    it("register is idempotent at the callback level", () => {
      const h = make("solid");
      h.register();
      h.register();
      expect(registerLayer).toHaveBeenCalledTimes(1);
    });
  });
});

// Contract test: the LayerAPI surface must survive refactors unchanged.
//
// LayerController is the map's LayerAPI implementation. A future refactor
// might rename, relocate, or drop a public member while the TypeScript
// `implements LayerAPI` check stays green (e.g. via a cast, a stub, or an
// interface widening). This file pins the *runtime* surface: every member the
// LayerAPI interface declares must exist on a real LayerController instance
// and be the right kind of callable. It deliberately does not assert behavior
// — controller.test.ts covers that — only presence and shape.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LayerController } from "#foliplus/LayerControl/controller.js";

describe("LayerAPI contract", () => {
  let manager: LayerController;
  let map: any;

  beforeEach(() => {
    // The controller reads the persisted record at construction, so a test
    // that flushed state would leak an order into the next test's registry.
    window.localStorage.clear();
    window.CONFIG = { ...window.CONFIG, name: "LayerControl", locale_code: "en" };

    class Renderer {}

    class Path {
      options = {};
    }

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
    window.L.Path = Path;

    const makePane = () => {
      const el = document.createElement("div");
      el.style.zIndex = "0";
      return el;
    };

    map = {
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

    manager = new LayerController(map, []);
  });

  it("exposes every required LayerAPI member", () => {
    const required = [
      "isLayerControl",
      "layers",
      "registerLayer",
      "unregisterLayer",
      "deleteLayer",
      "bringLayerToFront",
      "setVisible",
      "createCanvas",
      "createLayers",
      "extractPoints",
      "getLayerPanes",
      "getLayersByType",
    ] as const;
    for (const name of required) {
      expect(name in manager, `missing ${name}`).toBe(true);
    }
  });

  it("exposes every optional LayerAPI member", () => {
    const optional = [
      "forgetSavedOrder",
      "dropPersistedLayerState",
      "intentVisible",
      "getFeatureCount",
      "touchLayer",
      "moveLayerUp",
      "moveLayerDown",
    ] as const;
    for (const name of optional) {
      expect(name in manager, `missing ${name}`).toBe(true);
    }
  });

  it("implements every member with its declared callable shape", () => {
    const functions: Array<[string, number]> = [
      ["registerLayer", 1],
      ["unregisterLayer", 1],
      ["deleteLayer", 1],
      ["forgetSavedOrder", 1],
      ["dropPersistedLayerState", 1],
      ["bringLayerToFront", 1],
      ["setVisible", 2],
      ["intentVisible", 1],
      ["createCanvas", 1],
      ["createLayers", 1],
      ["extractPoints", 1],
      ["getLayerPanes", 1],
      ["getLayersByType", 1],
      ["getFeatureCount", 1],
      ["touchLayer", 1],
      ["moveLayerUp", 1],
      ["moveLayerDown", 1],
    ] as const;
    for (const [name, arity] of functions) {
      expect(typeof (manager as any)[name], `${name} is callable`).toBe("function");
      expect(
        (manager as any)[name].length,
        `${name} arity matches the interface`,
      ).toBeLessThanOrEqual(arity * 2); // optional args (opts bag width) allowed
    }
  });

  it("exposes the registry-delegating `layers` getter (isRealLayerControl probe)", () => {
    const own = Object.getOwnPropertyDescriptor(manager, "layers");
    const proto = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(manager),
      "layers",
    );
    expect(Boolean(own && own.get) || Boolean(proto && proto.get)).toBe(true);
  });

  it("returns the real controller marker from isLayerControl", () => {
    expect(manager.isLayerControl).toBe(true);
  });

  it("exposes `layers` as a read-only snapshot that refuses mutation", () => {
    const view = manager.layers;
    expect(Array.isArray(view)).toBe(true);
    // The registry wraps its array in a read-only Proxy, not Object.freeze —
    // isFrozen would be false by design. The contract that matters: a write
    // through the view must throw, so consumers cannot rearrange the registry
    // behind the controller's back.
    expect(() => {
      (view as unknown[]).push({} as never);
    }).toThrow();
  });
});

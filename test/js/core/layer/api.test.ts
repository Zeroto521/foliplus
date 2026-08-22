import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureLayerAPI, requireLayerAPI } from "#foliplus/core/layer/api.js";

const mockShowHint = vi.fn();

describe("ensureLayerAPI", () => {
  let map: any;

  beforeEach(() => {
    vi.stubGlobal("foliplus", { showHint: mockShowHint });
    vi.stubGlobal("L", {
      layerGroup: vi.fn(() => ({
        addLayer: vi.fn(),
        removeLayer: vi.fn(),
        hasLayer: vi.fn(() => false),
        getLayers: vi.fn(() => []),
        clearLayers: vi.fn(),
        eachLayer: vi.fn(),
        options: {},
      })),
      DomUtil: { getPosition: vi.fn(() => ({ x: 0, y: 0 })) },
      stamp: vi.fn(() => 1),
      svg: vi.fn(() => ({ addTo: vi.fn() })),
      Path: class {},
      Marker: class {},
    });
    map = {
      foliplus: null as any,
      getContainer: vi.fn(() => ({ clientWidth: 800, clientHeight: 600 })),
      getPanes: vi.fn(() => ({ mapPane: document.createElement("div") })),
      getPane: vi.fn(() => document.createElement("div")),
      createPane: vi.fn(() => {
        const p = document.createElement("div");
        p.classList.add("foliplus-layer-pane");
        return p;
      }),
      hasLayer: vi.fn(() => false),
      addLayer: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
  });

  it("creates lightweight LayerAPI when missing", () => {
    const api = ensureLayerAPI(map);
    expect(api).toBeDefined();
    expect(typeof api.createLayers).toBe("function");
    expect(typeof api.createCanvas).toBe("function");
    expect(typeof api.registerLayer).toBe("function");
    expect(api.layers).toEqual([]);
    expect(api.extractPoints("x")).toEqual([]);
    expect(api.getLayersByType("x")).toEqual([]);
  });

  it("returns existing LayerAPI when already present", () => {
    const existing = { layers: [{ id: "a" }] } as any;
    map.foliplus = { LayerAPI: existing };
    const api = ensureLayerAPI(map);
    expect(api).toBe(existing);
  });

  it("is idempotent — repeated calls return the same instance", () => {
    const api1 = ensureLayerAPI(map);
    const api2 = ensureLayerAPI(map);
    expect(api2).toBe(api1);
  });

  it("createLayers returns a valid CreateLayersAPI", () => {
    const api = ensureLayerAPI(map);
    const layers = api.createLayers({ id: "test", name: "Test" });
    expect(layers.mainLayer).toBeDefined();
    expect(typeof layers.addLayer).toBe("function");
  });

  it("createCanvas returns a valid CreateCanvasAPI", () => {
    const api = ensureLayerAPI(map);
    const canvas = api.createCanvas({ id: "test", name: "Canvas" });
    expect(canvas.canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(typeof canvas.register).toBe("function");
    expect(typeof canvas.unregister).toBe("function");
    expect(typeof canvas.destroy).toBe("function");
  });

  it("lightweight registerLayer is a no-op — never touches the map", () => {
    const addLayer = vi.fn();
    const fresh = {
      foliplus: null as any,
      getContainer: vi.fn(() => ({ clientWidth: 800, clientHeight: 600 })),
      getPanes: vi.fn(() => ({ mapPane: document.createElement("div") })),
      getPane: vi.fn(() => document.createElement("div")),
      createPane: vi.fn(() => document.createElement("div")),
      hasLayer: vi.fn(() => false),
      addLayer,
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = ensureLayerAPI(fresh);
    // The lightweight stub does not register into the map — no-op by design.
    expect(api.registerLayer({ id: "x", layer: { options: {} } } as any)).toBeNull();
    expect(addLayer).not.toHaveBeenCalled();
    expect(fresh.hasLayer).not.toHaveBeenCalled();
  });

  it("lightweight createLayers registers layers into the map via the factory", () => {
    const addLayer = vi.fn();
    const hasLayer = vi.fn(() => false);
    const fresh = {
      foliplus: null as any,
      getContainer: vi.fn(() => ({ clientWidth: 800, clientHeight: 600 })),
      getPanes: vi.fn(() => ({ mapPane: document.createElement("div") })),
      getPane: vi.fn(() => document.createElement("div")),
      createPane: vi.fn(() => document.createElement("div")),
      hasLayer,
      addLayer,
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = ensureLayerAPI(fresh);
    const layers = api.createLayers({ id: "g", name: "Group", graphPane: "g" });
    const layer = { options: {} } as any;
    layers.addLayer(layer);
    // factory's registerLayer adds the mainLayer to the map
    expect(addLayer).toHaveBeenCalled();
  });

  it("no-op methods behave as specified", () => {
    const api = ensureLayerAPI(map);
    expect(api.unregisterLayer("x")).toBe(false);
    expect(api.bringLayerToFront("x")).toBeUndefined();
    expect(api.extractPoints("x")).toEqual([]);
    expect(api.getLayerPanes({} as any)).toEqual([]);
    expect(api.getLayersByType("point")).toEqual([]);
  });

  it("layers is a frozen empty array", () => {
    const api = ensureLayerAPI(map);
    expect(Object.isFrozen(api.layers)).toBe(true);
    expect(Array.isArray(api.layers)).toBe(true);
  });
});

describe("requireLayerAPI", () => {
  const _ = (s: string) => s;

  it("throws when LayerAPI is missing", () => {
    const map = { foliplus: { showHint: mockShowHint } } as any;
    expect(() => requireLayerAPI("Test", _, map)).toThrow("Test.no_layercontrol");
    expect(mockShowHint).toHaveBeenCalled();
  });

  it("throws when LayerAPI is missing even without showHint", () => {
    const map = { foliplus: {} } as any;
    expect(() => requireLayerAPI("Test", _, map)).toThrow("Test.no_layercontrol");
  });

  it("accepts a real LayerControl (LayerAPI._isLayerControl === true)", () => {
    const api = { layers: [], _isLayerControl: true } as any;
    const map = { foliplus: { LayerAPI: api } };
    expect(requireLayerAPI("Test", _, map as any)).toBe(api);
  });

  it("throws for ensureLayerAPI's lightweight stub (_isLayerControl === false)", () => {
    // Without this check, a lightweight stub installed by another foliplus
    // subsystem (hint/mode/interaction) would silently pass requireLayerAPI,
    // letting Export/Heatmap run without a real LayerControl.
    const api = { layers: [], _isLayerControl: false } as any;
    const map = { foliplus: { showHint: mockShowHint, LayerAPI: api } } as any;
    expect(() => requireLayerAPI("Test", _, map)).toThrow("Test.no_layercontrol");
    expect(mockShowHint).toHaveBeenCalled();
  });
});

import { ensureLayerAPI, requireLayerAPI } from "#foliplus/core/layer/api.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("createLayers returns a valid CreateLayersAPI", () => {
    const api = ensureLayerAPI(map);
    const layers = api.createLayers({ id: "test", name: "Test" });
    expect(layers.mainLayer).toBeDefined();
    expect(typeof layers.addLayer).toBe("function");
  });
});

describe("requireLayerAPI", () => {
  const _ = (s: string) => s;

  it("throws when LayerAPI is missing", () => {
    vi.stubGlobal("foliplus", { showHint: mockShowHint });
    vi.stubGlobal("map", {} as any);
    expect(() => requireLayerAPI("Test", _, {} as any)).toThrow("Test.no_layercontrol");
    expect(mockShowHint).toHaveBeenCalled();
  });

  it("returns LayerAPI when present", () => {
    const api = { layers: [] } as any;
    const map = { foliplus: { LayerAPI: api } };
    expect(requireLayerAPI("Test", _, map as any)).toBe(api);
  });
});

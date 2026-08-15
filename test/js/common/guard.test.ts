import { ensureLayerAPI, requireLayerAPI, requireRuntime } from "#common/guard.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockShowHint = vi.fn();

describe("requireRuntime", () => {
  it("throws when foliplus is missing", () => {
    vi.stubGlobal("foliplus", undefined);
    expect(() => requireRuntime("Test")).toThrow("foliplus runtime not found");
  });

  it("throws when showHint is not a function", () => {
    vi.stubGlobal("foliplus", {});
    expect(() => requireRuntime("Test")).toThrow("foliplus runtime not found");
  });

  it("passes when foliplus.showHint is available", () => {
    vi.stubGlobal("foliplus", { showHint: () => {} });
    expect(() => requireRuntime("Test")).not.toThrow();
  });
});

describe("requireLayerAPI", () => {
  const _ = s => s;

  it("throws when LayerAPI is missing", () => {
    vi.stubGlobal("foliplus", {
      showHint: mockShowHint,
      HINT_DURATION: { PERSIST: 0 },
    });
    vi.stubGlobal("map", {});
    expect(() => requireLayerAPI("Test", _, window.map)).toThrow(
      "Test.no_layercontrol",
    );
    expect(mockShowHint).toHaveBeenCalledWith("Test", "Test.no_layercontrol", 0);
  });

  it("passes when LayerAPI is present", () => {
    vi.stubGlobal("foliplus", { showHint: () => {} });
    vi.stubGlobal("map", { foliplus: { LayerAPI: {} } });
    expect(() => requireLayerAPI("Test", _, window.map)).not.toThrow();
  });
});

describe("ensureLayerAPI", () => {
  let map;

  beforeEach(() => {
    vi.stubGlobal("foliplus", { showHint: () => {} });
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
    map = { foliplus: null as any, getContainer: vi.fn(() => ({ clientWidth: 800, clientHeight: 600 })), getPanes: vi.fn(() => ({ mapPane: document.createElement("div") })), getPane: vi.fn(() => document.createElement("div")), createPane: vi.fn(() => { const p = document.createElement("div"); p.classList.add("foliplus-layer-pane"); return p; }), hasLayer: vi.fn(() => false), addLayer: vi.fn(), on: vi.fn(), off: vi.fn() };
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
    const existing = { layers: [{ id: "a" }], createLayers: () => ({} as any) } as any;
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

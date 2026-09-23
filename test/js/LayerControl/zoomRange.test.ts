import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import {
  applyZoomRangeStateOne,
  computeEffectiveShown,
  refreshZoomEffectiveShown,
} from "#foliplus/LayerControl/ui/state.js";

const mockMap = {
  getMinZoom: () => 0,
  getMaxZoom: () => 18,
  getZoom: () => 10,
  addLayer: vi.fn(),
  removeLayer: vi.fn(),
  hasLayer: vi.fn(() => false),
};

const mockUI: LayerUI = {
  m: {
    map: mockMap as any,
    layers: [] as any[],
    layerRegistry: {
      get: () => undefined,
    },
    surfaceFor: () => ({
      capabilities: { zoomRange: "pane" as const, opacity: "pane" as const },
      paneNames: new Set(["overlayPane"]),
    }),
    findLayer: () => undefined,
    annotation: { paneNameFor: () => null },
    events: { on: () => () => {}, emit: () => {} },
    persistence: {
      load: () => ({}) as any,
      schedule: () => {},
    },
    replaySavedOrder: () => {},
  },
  T: (key: string) => key,
  uiContainer: { querySelector: () => null } as any,
  hiddenIds: new Set(),
  rangeHiddenIds: new Set(),
  opacityMap: {},
  zoomRangeMap: {},
  userOverrides: {},
  foldedGroups: new Set(),
  renamedNames: {},
  labelConfigs: {},
  fieldCache: new Map(),
  stylePanelLayerId: null,
  styleOutsideHandler: null,
  pressInPanel: false,
  focusingLayerId: null,
  styleUnsubscribe: null,
  styleRefresh: null,
  styleZoomEndHandler: null,
  activeMenu: null,
  opacityMap: {},
} as any;

describe("computeEffectiveShown", () => {
  const makeLayerInfo = (id: string, overrides: Partial<any> = {}) =>
    ({
      id,
      layer: null,
      canvas: null,
      isBase: false,
      visible: true,
      opacity: 1,
      ...overrides,
    }) as any;

  it("returns false when layer is hidden", () => {
    mockUI.hiddenIds.add("layer1");
    expect(computeEffectiveShown(mockUI, makeLayerInfo("layer1"), false)).toBe(false);
    mockUI.hiddenIds.delete("layer1");
  });

  it("returns true when focus is active, even out of range", () => {
    mockUI.zoomRangeMap["layer1"] = [0, 5];
    const result = computeEffectiveShown(mockUI, makeLayerInfo("layer1"), true);
    expect(result).toBe(true);
    delete mockUI.zoomRangeMap["layer1"];
  });

  it("returns true when no range is set", () => {
    const result = computeEffectiveShown(mockUI, makeLayerInfo("layer1"), false);
    expect(result).toBe(true);
  });

  it("returns true when zoom is within range", () => {
    mockUI.zoomRangeMap["layer1"] = [5, 15];
    const result = computeEffectiveShown(mockUI, makeLayerInfo("layer1"), false);
    expect(result).toBe(true);
    delete mockUI.zoomRangeMap["layer1"];
  });

  it("returns false when zoom is below range", () => {
    mockUI.zoomRangeMap["layer1"] = [11, 15];
    const result = computeEffectiveShown(mockUI, makeLayerInfo("layer1"), false);
    expect(result).toBe(false);
    delete mockUI.zoomRangeMap["layer1"];
  });

  it("returns false when zoom is above range", () => {
    mockUI.zoomRangeMap["layer1"] = [5, 9];
    const result = computeEffectiveShown(mockUI, makeLayerInfo("layer1"), false);
    expect(result).toBe(false);
    delete mockUI.zoomRangeMap["layer1"];
  });

  it("returns false when range is inverted (min > max after clamp)", () => {
    mockUI.zoomRangeMap["layer1"] = [15, 5];
    const result = computeEffectiveShown(mockUI, makeLayerInfo("layer1"), false);
    expect(result).toBe(false);
    delete mockUI.zoomRangeMap["layer1"];
  });

  it("clamps range to map bounds", () => {
    mockUI.zoomRangeMap["layer1"] = [-5, 25];
    const result = computeEffectiveShown(mockUI, makeLayerInfo("layer1"), false);
    expect(result).toBe(true);
    delete mockUI.zoomRangeMap["layer1"];
  });
});

describe("applyZoomRangeStateOne", () => {
  const makeLayerInfo = (id: string, overrides: Partial<any> = {}) =>
    ({
      id,
      layer: { options: {} } as any,
      canvas: null,
      isBase: false,
      visible: true,
      opacity: 1,
      ...overrides,
    }) as any;

  it("writes minZoom/maxZoom for native carrier", () => {
    mockUI.m.surfaceFor = () => ({
      capabilities: { zoomRange: "native" as const, opacity: "pane" as const },
      paneNames: new Set(["overlayPane"]),
    });
    const li = makeLayerInfo("layer1");
    mockUI.m.layerRegistry.get = () => li;
    applyZoomRangeStateOne(mockUI, li, [5, 15]);
    expect(li.layer.options.minZoom).toBe(5);
    expect(li.layer.options.maxZoom).toBe(15);
  });

  it("deletes minZoom/maxZoom when range is null", () => {
    mockUI.m.surfaceFor = () => ({
      capabilities: { zoomRange: "native" as const, opacity: "pane" as const },
      paneNames: new Set(["overlayPane"]),
    });
    const li = makeLayerInfo("layer1");
    li.layer.options.minZoom = 5;
    li.layer.options.maxZoom = 15;
    mockUI.m.layerRegistry.get = () => li;
    applyZoomRangeStateOne(mockUI, li, null);
    expect(li.layer.options.minZoom).toBeUndefined();
    expect(li.layer.options.maxZoom).toBeUndefined();
  });

  it("applies visibility for pane carrier", () => {
    mockUI.m.surfaceFor = () => ({
      capabilities: { zoomRange: "pane" as const, opacity: "pane" as const },
      paneNames: new Set(["overlayPane"]),
    });
    const li = makeLayerInfo("layer1");
    li.layer = {} as any;
    mockUI.m.layerRegistry.get = () => li;
    mockUI.m.findLayer = () => li.layer;
    mockUI.zoomRangeMap["layer1"] = [5, 15];
    applyZoomRangeStateOne(mockUI, li, [5, 15]);
    expect(li.visible).toBe(true);
  });

  it("does nothing for none carrier", () => {
    mockUI.m.surfaceFor = () => ({
      capabilities: { zoomRange: "none" as const, opacity: "pane" as const },
      paneNames: new Set(["overlayPane"]),
    });
    const li = makeLayerInfo("layer1");
    mockUI.m.layerRegistry.get = () => li;
    expect(() => applyZoomRangeStateOne(mockUI, li, [5, 15])).not.toThrow();
  });
});

describe("refreshZoomEffectiveShown", () => {
  it("skips base layers", () => {
    mockUI.m.layers = [{ id: "base", isBase: true, canvas: null, layer: {} } as any];
    mockUI.m.surfaceFor = () => ({
      capabilities: { zoomRange: "pane" as const, opacity: "pane" as const },
      paneNames: new Set(["overlayPane"]),
    });
    expect(() => refreshZoomEffectiveShown(mockUI)).not.toThrow();
  });

  it("skips canvas layers", () => {
    mockUI.m.layers = [
      { id: "canvas", isBase: false, canvas: {} as any, layer: {} } as any,
    ];
    mockUI.m.surfaceFor = () => ({
      capabilities: { zoomRange: "pane" as const, opacity: "pane" as const },
      paneNames: new Set(["overlayPane"]),
    });
    expect(() => refreshZoomEffectiveShown(mockUI)).not.toThrow();
  });

  it("skips none carrier", () => {
    mockUI.m.layers = [{ id: "layer1", isBase: false, canvas: null, layer: {} } as any];
    mockUI.m.surfaceFor = () => ({
      capabilities: { zoomRange: "none" as const, opacity: "pane" as const },
      paneNames: new Set(["overlayPane"]),
    });
    expect(() => refreshZoomEffectiveShown(mockUI)).not.toThrow();
  });

  it("skips native carrier", () => {
    mockUI.m.layers = [{ id: "layer1", isBase: false, canvas: null, layer: {} } as any];
    mockUI.m.surfaceFor = () => ({
      capabilities: { zoomRange: "native" as const, opacity: "pane" as const },
      paneNames: new Set(["overlayPane"]),
    });
    expect(() => refreshZoomEffectiveShown(mockUI)).not.toThrow();
  });

  it("applies visibility for pane carrier layers", () => {
    mockUI.m.layers = [{ id: "layer1", isBase: false, canvas: null, layer: {} } as any];
    mockUI.m.surfaceFor = () => ({
      capabilities: { zoomRange: "pane" as const, opacity: "pane" as const },
      paneNames: new Set(["overlayPane"]),
    });
    mockUI.m.findLayer = () => mockUI.m.layers[0].layer;
    mockUI.zoomRangeMap["layer1"] = [5, 15];
    expect(() => refreshZoomEffectiveShown(mockUI)).not.toThrow();
  });
});

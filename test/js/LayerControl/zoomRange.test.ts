import { describe, expect, it, vi } from "vitest";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { projectLayer } from "#foliplus/LayerControl/ui/store.js";

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
  opacityMap: {},
  zoomRangeMap: {},
  userOverrides: {},
  authorVisible: new Map(),
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
    // The new projection reads `intent && policy`; a `hiddenIds` entry alone
    // is not enough — the user must have overridden `visible` for the hidden
    // state to be authoritative. Without the override the author default
    // wins, which is the §40.5 invariant.
    mockUI.hiddenIds.add("layer1");
    mockUI.userOverrides.layer1 = ["visible"];
    expect(projectLayer(mockUI, makeLayerInfo("layer1")).effectiveShown).toBe(false);
    mockUI.hiddenIds.delete("layer1");
    delete mockUI.userOverrides.layer1;
  });

  it("returns true when focus is active, even out of range", () => {
    mockUI.zoomRangeMap["layer1"] = [0, 5];
    mockUI.focusingLayerId = "focus";
    const result = projectLayer(mockUI, makeLayerInfo("layer1")).effectiveShown;
    expect(result).toBe(true);
    mockUI.focusingLayerId = null;
    delete mockUI.zoomRangeMap["layer1"];
  });

  it("returns true when no range is set", () => {
    const result = projectLayer(mockUI, makeLayerInfo("layer1")).effectiveShown;
    expect(result).toBe(true);
  });

  it("returns true when zoom is within range", () => {
    mockUI.zoomRangeMap["layer1"] = [5, 15];
    const result = projectLayer(mockUI, makeLayerInfo("layer1")).effectiveShown;
    expect(result).toBe(true);
    delete mockUI.zoomRangeMap["layer1"];
  });

  it("returns false when zoom is below range", () => {
    mockUI.zoomRangeMap["layer1"] = [11, 15];
    const result = projectLayer(mockUI, makeLayerInfo("layer1")).effectiveShown;
    expect(result).toBe(false);
    delete mockUI.zoomRangeMap["layer1"];
  });

  it("returns false when zoom is above range", () => {
    mockUI.zoomRangeMap["layer1"] = [5, 9];
    const result = projectLayer(mockUI, makeLayerInfo("layer1")).effectiveShown;
    expect(result).toBe(false);
    delete mockUI.zoomRangeMap["layer1"];
  });

  it("returns false when range is inverted (min > max after clamp)", () => {
    mockUI.zoomRangeMap["layer1"] = [15, 5];
    const result = projectLayer(mockUI, makeLayerInfo("layer1")).effectiveShown;
    expect(result).toBe(false);
    delete mockUI.zoomRangeMap["layer1"];
  });

  it("clamps range to map bounds", () => {
    mockUI.zoomRangeMap["layer1"] = [-5, 25];
    const result = projectLayer(mockUI, makeLayerInfo("layer1")).effectiveShown;
    expect(result).toBe(true);
    delete mockUI.zoomRangeMap["layer1"];
  });
});


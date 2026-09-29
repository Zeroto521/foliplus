import { describe, expect, it, vi } from "vitest";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { projectLayer } from "#foliplus/LayerControl/ui/projection.js";
import { clearIntent, setIntent } from "#foliplus/LayerControl/ui/intent.js";

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
    events: { on: () => () => {}, emit: () => {} },
    persistence: {
      load: () => ({}) as any,
      schedule: () => {},
    },
    replaySavedOrder: () => {},
  },
  T: (key: string) => key,
  uiContainer: { querySelector: () => null } as any,
  visibleMap: {},
  opacityMap: {},
  fillColorMap: {},
  fillOpacityMap: {},
  zoomRangeMap: {},
  intentProvenance: {},
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
      group: "overlay",
      visible: true,
      opacity: 1,
      ...overrides,
    }) as any;

  it("returns false when layer is hidden", () => {
    // The new projection reads `intent && policy`; a `visibleMap` entry alone
    // is not enough — the user must have overridden `visible` for the hidden
    // state to be authoritative. Without the override the author default
    // wins — a derived dimension may only suppress.
    setIntent(mockUI, "layer1", "visible", false);
    mockUI.intentProvenance.layer1 = ["visible"];
    expect(projectLayer(mockUI, makeLayerInfo("layer1")).effectiveShown).toBe(false);
    clearIntent(mockUI, "layer1", "visible");
    delete mockUI.intentProvenance.layer1;
  });

  it("returns true when focus is active, even out of range", () => {
    setIntent(mockUI, "layer1", "zoomRange", [0, 5]);
    mockUI.focusingLayerId = "focus";
    const result = projectLayer(mockUI, makeLayerInfo("layer1")).effectiveShown;
    expect(result).toBe(true);
    mockUI.focusingLayerId = null;
    clearIntent(mockUI, "layer1", "zoomRange");
  });

  it("returns true when no range is set", () => {
    const result = projectLayer(mockUI, makeLayerInfo("layer1")).effectiveShown;
    expect(result).toBe(true);
  });

  it("returns true when zoom is within range", () => {
    setIntent(mockUI, "layer1", "zoomRange", [5, 15]);
    const result = projectLayer(mockUI, makeLayerInfo("layer1")).effectiveShown;
    expect(result).toBe(true);
    clearIntent(mockUI, "layer1", "zoomRange");
  });

  it("returns false when zoom is below range", () => {
    setIntent(mockUI, "layer1", "zoomRange", [11, 15]);
    const result = projectLayer(mockUI, makeLayerInfo("layer1")).effectiveShown;
    expect(result).toBe(false);
    clearIntent(mockUI, "layer1", "zoomRange");
  });

  it("returns false when zoom is above range", () => {
    setIntent(mockUI, "layer1", "zoomRange", [5, 9]);
    const result = projectLayer(mockUI, makeLayerInfo("layer1")).effectiveShown;
    expect(result).toBe(false);
    clearIntent(mockUI, "layer1", "zoomRange");
  });

  it("returns false when range is inverted (min > max after clamp)", () => {
    setIntent(mockUI, "layer1", "zoomRange", [15, 5]);
    const result = projectLayer(mockUI, makeLayerInfo("layer1")).effectiveShown;
    expect(result).toBe(false);
    clearIntent(mockUI, "layer1", "zoomRange");
  });

  it("clamps range to map bounds", () => {
    setIntent(mockUI, "layer1", "zoomRange", [-5, 25]);
    const result = projectLayer(mockUI, makeLayerInfo("layer1")).effectiveShown;
    expect(result).toBe(true);
    clearIntent(mockUI, "layer1", "zoomRange");
  });
});

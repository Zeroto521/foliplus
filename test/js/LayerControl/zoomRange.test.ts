import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { clearIntent, setIntent } from "#foliplus/LayerControl/ui/intent.js";
import { IntentStore } from "#foliplus/LayerControl/ui/intentStore.js";
import { projectLayer } from "#foliplus/LayerControl/ui/projection.js";
import {
  applyZoomRangeLive,
  commitZoomRange,
  resetLayerZoomRange,
} from "#foliplus/LayerControl/ui/style/zoomRange.js";
import { initFixture, installLeafletGlobals } from "./ui/fixture.js";

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
      panes: [],
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
  intentStore: new IntentStore(),
  appliedState: new Map(),
  authorVisible: new Map(),
  foldedGroups: new Set(),
  renamedNames: {},
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
    // The new projection reads `intent && policy`; a `intents.visible` entry alone
    // is not enough 閳?the user must have overridden `visible` for the hidden
    // state to be authoritative. Without the override the author default
    // wins 閳?a derived dimension may only suppress.
    setIntent(mockUI, "layer1", "visible", false);
    mockUI.intentStore.seedProvenance("layer1", ["visible"]);
    expect(projectLayer(mockUI, makeLayerInfo("layer1")).effectiveShown).toBe(false);
    clearIntent(mockUI, "layer1", "visible");
    mockUI.intentStore.seedProvenance("layer1", []);
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

describe("zoomRange descriptor write/live/commit/reset", () => {
  let ui: ReturnType<typeof initFixture>["ui"];
  let cancel: (() => void) | undefined;

  beforeEach(() => {
    installLeafletGlobals();
    const fixture = initFixture({
      data: [
        {
          id: "overlay1",
          name: "Overlay",
          group: "overlay",
          layer: {
            options: {},
            getBounds: () => ({
              isValid: () => true,
              getSouthWest: () => ({ lat: 0, lng: 0 }),
              getNorthEast: () => ({ lat: 1, lng: 1 }),
            }),
          } as any,
        },
      ],
    });
    ui = fixture.ui;
    cancel = () => fixture.manager.debouncedEnforce?.cancel?.();
  });

  afterEach(() => {
    cancel?.();
    cancel = undefined;
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  const row = document.createElement("div");

  it("live preview writes the value without marking provenance", () => {
    applyZoomRangeLive(ui, "overlay1", row, 2, 8);
    expect(ui.intentStore.get("overlay1", "zoomRange")).toEqual([2, 8]);
    expect(ui.intentStore.isUserSet("overlay1", "zoomRange")).toBe(false);
  });

  it("commit marks the live value and persists", () => {
    const schedule = vi.fn();
    ui.m.persistence = { schedule } as never;
    applyZoomRangeLive(ui, "overlay1", row, 3, 7);
    commitZoomRange(ui, "overlay1");
    expect(ui.intentStore.get("overlay1", "zoomRange")).toEqual([3, 7]);
    expect(ui.intentStore.isUserSet("overlay1", "zoomRange")).toBe(true);
    expect(schedule).toHaveBeenCalled();
  });

  it("commit with no stored range is a no-op", () => {
    const schedule = vi.fn();
    ui.m.persistence = { schedule } as never;
    commitZoomRange(ui, "overlay1");
    expect(ui.intentStore.isUserSet("overlay1", "zoomRange")).toBe(false);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("reset clears the override", () => {
    const schedule = vi.fn();
    ui.m.persistence = { schedule } as never;
    applyZoomRangeLive(ui, "overlay1", row, 1, 5);
    commitZoomRange(ui, "overlay1");
    resetLayerZoomRange(ui, "overlay1");
    expect(ui.intentStore.get("overlay1", "zoomRange")).toBeUndefined();
    expect(ui.intentStore.isUserSet("overlay1", "zoomRange")).toBe(false);
  });
});

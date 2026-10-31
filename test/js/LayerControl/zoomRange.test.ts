import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LayerRuntimeStore } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import { LayerIntentStore } from "#foliplus/LayerControl/domain/index.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { clearIntent, setIntent } from "#foliplus/LayerControl/ui/intent.js";
import { projectLayer } from "#foliplus/LayerControl/ui/projection.js";
import {
  ZOOM_RANGE_DIMENSION,
  applyZoomRangeLive,
  commitZoomRange,
  resetLayerZoomRange,
} from "#foliplus/LayerControl/ui/style/zoomRange.js";
import { EVENTS } from "#foliplus/core/event/index.js";
import {
  findItem,
  initFixture,
  installLeafletGlobals,
  oneOverlay,
} from "./ui/fixture.js";

const mockMap = {
  getMinZoom: () => 0,
  getMaxZoom: () => 18,
  getZoom: () => 10,
  addLayer: vi.fn(),
  removeLayer: vi.fn(),
  hasLayer: vi.fn(() => false),
};

const mockUI: LayerUI = {
  c: {
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
  intentStore: new LayerIntentStore(),
  runtimeStore: new LayerRuntimeStore(),
  foldedRoles: new Set(),
  stylePanelLayerId: null,
  focusController: { focusingLayerId: null },
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
      role: "overlay",
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
    mockUI.focusController.focusingLayerId = "focus";
    const result = projectLayer(mockUI, makeLayerInfo("layer1")).effectiveShown;
    expect(result).toBe(true);
    mockUI.focusController.focusingLayerId = null;
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
          role: "overlay",
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

  it("live preview on a missing layer is a no-op", () => {
    const schedule = vi.fn();
    ui.c.persistence = { schedule } as never;
    applyZoomRangeLive(ui, "ghost", row, 1, 5);
    expect(ui.intentStore.get("ghost", "zoomRange")).toBeUndefined();
  });

  it("write with only min takes the else branch (no stored value)", () => {
    const schedule = vi.fn();
    ui.c.persistence = { schedule } as never;
    ZOOM_RANGE_DIMENSION.write!(ui, "overlay1", { min: 2 } as never);
    expect(ui.intentStore.isUserSet("overlay1", "zoomRange")).toBe(false);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("write with only min after a live preview commits the stored range", () => {
    const schedule = vi.fn();
    ui.c.persistence = { schedule } as never;
    ui.intentStore.setValue("overlay1", "zoomRange", [4, 9]);
    ZOOM_RANGE_DIMENSION.write!(ui, "overlay1", { min: 4 } as never);
    expect(ui.intentStore.get("overlay1", "zoomRange")).toEqual([4, 9]);
    expect(ui.intentStore.isUserSet("overlay1", "zoomRange")).toBe(true);
    expect(schedule).toHaveBeenCalled();
  });

  it("commit marks the live value and persists", () => {
    const schedule = vi.fn();
    ui.c.persistence = { schedule } as never;
    applyZoomRangeLive(ui, "overlay1", row, 3, 7);
    commitZoomRange(ui, "overlay1");
    expect(ui.intentStore.get("overlay1", "zoomRange")).toEqual([3, 7]);
    expect(ui.intentStore.isUserSet("overlay1", "zoomRange")).toBe(true);
    expect(schedule).toHaveBeenCalled();
  });

  it("commit with no stored range is a no-op", () => {
    const schedule = vi.fn();
    ui.c.persistence = { schedule } as never;
    commitZoomRange(ui, "overlay1");
    expect(ui.intentStore.isUserSet("overlay1", "zoomRange")).toBe(false);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("reset clears the override", () => {
    const schedule = vi.fn();
    ui.c.persistence = { schedule } as never;
    applyZoomRangeLive(ui, "overlay1", row, 1, 5);
    commitZoomRange(ui, "overlay1");
    resetLayerZoomRange(ui, "overlay1");
    expect(ui.intentStore.get("overlay1", "zoomRange")).toBeUndefined();
    expect(ui.intentStore.isUserSet("overlay1", "zoomRange")).toBe(false);
  });

  it("reset on a missing layer returns before touching state", () => {
    expect(() => resetLayerZoomRange(ui, "ghost")).not.toThrow();
  });
});

describe("zoomRange resolved endpoints (rowEndpoints)", () => {
  let ui: ReturnType<typeof initFixture>["ui"];
  let cancel: (() => void) | undefined;

  beforeEach(() => {
    installLeafletGlobals();
    const fixture = initFixture({
      maxZoom: 18,
      data: [
        {
          id: "overlay1",
          name: "Overlay",
          role: "overlay",
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

  it("collapses an above-map stored range onto the map's ceiling", () => {
    // stored [20,30] but the map only reaches 18 — the resolved value must not
    // be inverted (min > max). The band lies entirely above the rail, so it
    // collapses onto the ceiling: a degenerate [18,18].
    setIntent(ui, "overlay1", "zoomRange", [20, 30]);
    const value = ZOOM_RANGE_DIMENSION.value!(ui, "overlay1");
    expect(value).toEqual({ min: 18, max: 18 });
    clearIntent(ui, "overlay1", "zoomRange");
  });

  it("orders a reversed stored range (min > max) before collapsing", () => {
    // Reversed [30,20] carries the same band, so it resolves identically.
    setIntent(ui, "overlay1", "zoomRange", [30, 20]);
    const value = ZOOM_RANGE_DIMENSION.value!(ui, "overlay1");
    expect(value).toEqual({ min: 18, max: 18 });
    clearIntent(ui, "overlay1", "zoomRange");
  });

  it("collapses a below-map stored range onto the map's floor", () => {
    // Entirely below the floor: after clamping both ends land past each
    // other (min 0 > max -5), so the band collapses onto the floor.
    setIntent(ui, "overlay1", "zoomRange", [-10, -5]);
    const value = ZOOM_RANGE_DIMENSION.value!(ui, "overlay1");
    expect(value).toEqual({ min: 0, max: 0 });
    clearIntent(ui, "overlay1", "zoomRange");
  });

  it("resolves a stored range inside the map unchanged (no clamping)", () => {
    setIntent(ui, "overlay1", "zoomRange", [3, 9]);
    const value = ZOOM_RANGE_DIMENSION.value!(ui, "overlay1");
    expect(value).toEqual({ min: 3, max: 9 });
    clearIntent(ui, "overlay1", "zoomRange");
  });
});

// ── Notification-contract cases, moved from the former
// ── notifyContract.test.ts so they live with the script they drive. ──
it("a reset settles the row before it announces", () => {
  // The reset entry clears the override, re-projects and repaints the row
  // before it publishes, so a subscriber that re-enters reads the range the
  // reset just drew — not the "out of range" face the override was showing
  // when the operation started.
  const { ui, layer, onMap } = oneOverlay();

  setIntent(ui, "overlay1", "zoomRange", [0, 3]);
  ui.intentStore.seedProvenance("overlay1", ["zoomRange"]);
  ui.onZoomEnd?.();
  expect(onMap.get(layer)).toBe(false);

  ui.openStylePanel("overlay1");
  const row = findItem(ui, "overlay1").querySelector(
    `.${CONST.CLASSES.STYLE_ZOOM_RANGE_ROW}`,
  ) as HTMLElement;
  expect(row.classList.contains(CONST.CLASSES.STYLE_ZOOM_RANGE_OUT_OF_RANGE)).toBe(
    true,
  );

  const outOfRangeAtDelivery: boolean[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, () => {
    outOfRangeAtDelivery.push(
      row.classList.contains(CONST.CLASSES.STYLE_ZOOM_RANGE_OUT_OF_RANGE),
    );
  });

  resetLayerZoomRange(ui, "overlay1");

  expect(outOfRangeAtDelivery).toEqual([false]);
  expect(onMap.get(layer)).toBe(true);
});

it("a reset that lands after a teardown does not deref the container", () => {
  // The panel lookup runs before the notify, but a reset can still be queued
  // past a teardown — a scheduled reset, or a panel whose control was
  // destroyed first. The lookup tolerates the missing container, and the
  // projection it already ran still lands on the map.
  const { ui, layer, onMap } = oneOverlay();

  setIntent(ui, "overlay1", "zoomRange", [0, 3]);
  ui.intentStore.seedProvenance("overlay1", ["zoomRange"]);
  ui.onZoomEnd?.();
  ui.openStylePanel("overlay1");

  ui.c.uiContainer = null;
  expect(() => resetLayerZoomRange(ui, "overlay1")).not.toThrow();
  expect(onMap.get(layer)).toBe(true);
});

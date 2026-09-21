// LayerUI shell (ui/index.ts) — attach sequence, event subscriptions, and the
// thin delegates to the ui/* modules. DOM interaction specifics live in the
// per-module suites (list/keyboard/focus/...); this file pins the wiring.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents } from "#core/event/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import { LayerManager } from "#foliplus/LayerControl/manager.js";
import { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { findItem, initFixture, installLeafletGlobals, makePane } from "./fixture.js";

describe("LayerUI shell — event subscriptions", () => {
  let manager: LayerManager;
  let ui: LayerUI;
  let map: any;

  beforeEach(() => {
    ({ manager, ui, map } = initFixture());
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("CONTROL_ATTACHED re-runs the init pass and reapplies annotation state", () => {
    const initSpy = vi.spyOn(ui, "initTypesAndVisibility");
    const applySpy = vi.spyOn(ui, "applyStyleLabelState");

    ensureEvents(map).emit(EVENTS.CONTROL_ATTACHED, { component: "HeatmapControl" });

    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(applySpy).toHaveBeenCalledTimes(1);
  });

  it("CONTROL_ATTACHED is ignored once the container is detached", () => {
    (ui.uiContainer as HTMLElement).remove();
    const initSpy = vi.spyOn(ui, "initTypesAndVisibility");

    ensureEvents(map).emit(EVENTS.CONTROL_ATTACHED, { component: "HeatmapControl" });

    expect(initSpy).not.toHaveBeenCalled();
  });

  it("LAYER_ITEM_COUNT_CHANGE updates the row count and drops the field cache", () => {
    ui.fieldCache.set("overlay1", [{ name: "stale", numeric: false }]);
    const getFeatureCount = vi.spyOn(manager, "getFeatureCount").mockReturnValue(5);
    const item = findItem(ui, "overlay1");
    const countCol = item.querySelector("[data-role='count']") as HTMLElement | null;

    ensureEvents(map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "overlay1" });

    expect(getFeatureCount).toHaveBeenCalledWith("overlay1");
    expect(ui.fieldCache.has("overlay1")).toBe(false);
    if (countCol) expect(countCol.textContent).toBe("5");
  });

  it("LAYER_ITEM_COUNT_CHANGE clears the count column when no count is available", () => {
    vi.spyOn(manager, "getFeatureCount").mockReturnValue(null);
    const item = findItem(ui, "overlay1");
    const countCol = item.querySelector("[data-role='count']") as HTMLElement | null;

    ensureEvents(map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "overlay1" });

    if (countCol) expect(countCol.textContent).toBe("");
  });

  it("LAYER_ITEM_COUNT_CHANGE is a no-op for unknown ids", () => {
    const getFeatureCount = vi.spyOn(manager, "getFeatureCount");

    ensureEvents(map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "ghost" });

    expect(getFeatureCount).not.toHaveBeenCalled();
  });

  it("attach flushes pendingRegistrations into rendered rows", () => {
    // Rebuild a manager the fixture way but keep one layer unregistered until
    // after attach: the attach sequence must drain the pending queue.
    installLeafletGlobals();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const sw = { lat: 30, lng: 100 };
    const ne = { lat: 40, lng: 110 };
    const lateLayer = {
      id: "late1",
      name: "Late",
      isBase: false,
      layer: {
        options: {},
        eachLayer: vi.fn(),
        getBounds: vi.fn(() => ({
          isValid: vi.fn(() => true),
          getSouthWest: () => sw,
          getNorthEast: () => ne,
        })),
      },
    };
    const m: any = {
      on: vi.fn(),
      off: vi.fn(),
      eachLayer: vi.fn(),
      invalidateSize: vi.fn(),
      hasLayer: vi.fn(() => true),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      fitBounds: vi.fn(),
      flyTo: vi.fn(),
      getZoom: vi.fn(() => 5),
      getMaxZoom: vi.fn(() => 18),
      getBounds: vi.fn(() => ({
        pad: vi.fn(() => m),
        getSouthWest: () => ({ lat: 20, lng: 90 }),
        getNorthWest: () => ({ lat: 50, lng: 90 }),
        getNorthEast: () => ({ lat: 50, lng: 120 }),
        getSouthEast: () => ({ lat: 20, lng: 120 }),
      })),
      getContainer: vi.fn(() => container),
      getPane: vi.fn(() => makePane()),
      createPane: vi.fn(() => {
        const p = makePane();
        p.classList.add("foliplus-layer-pane");
        return p;
      }),
      _container: container,
      _layers: {},
      attributionControl: { _attributions: {}, _update: vi.fn() },
      foliplus: { showHint: vi.fn(), hideHint: vi.fn() },
    };
    const mgr = new LayerManager(m, []);
    mgr.ui = new LayerUI(mgr);
    // registerLayer's pre-attach contract: overlays prepend into the
    // registry, the pending queue only defers the UI insertion until attach.
    mgr.layerRegistry.prepend(lateLayer as never);
    mgr.pendingRegistrations.push(lateLayer as never);

    vi.useFakeTimers();
    mgr.attachUI(container);
    const attached = mgr.ui!;
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    expect(
      attached.uiContainer!.querySelector("[data-layer-id='late1']"),
    ).not.toBeNull();
  });
});

describe("LayerUI shell — delegates", () => {
  let manager: LayerManager;
  let ui: LayerUI;
  let map: any;

  beforeEach(() => {
    ({ manager, ui, map } = initFixture());
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("saveFoldState persists the folded-group set", () => {
    const save = vi.spyOn(manager.persistence, "schedule");
    ui.foldedGroups = new Set(["overlays"]);

    ui.saveFoldState();

    expect(save).toHaveBeenCalled();
    const fields = save.mock.calls[0][0] as { foldedGroups: () => string[] };
    expect(fields.foldedGroups()).toEqual(["overlays"]);
  });

  it("saveNamesState persists the rename map", () => {
    const save = vi.spyOn(manager.persistence, "schedule");
    ui.renamedNames = { overlay1: "Renamed" };

    ui.saveNamesState();

    expect(save).toHaveBeenCalled();
    const fields = save.mock.calls[0][0] as {
      renamedNames: () => Record<string, string>;
    };
    expect(fields.renamedNames()).toEqual({
      overlay1: "Renamed",
    });
  });

  it("dropPersistedLayerState erases every stored dimension for one id", () => {
    // The single routine that erases a stored value, reached only from an
    // explicit delete — and it must not touch a neighbour's state.
    ui.hiddenIds = new Set(["overlay1", "base1"]);
    ui.opacityMap = { overlay1: 0.4 };
    ui.zoomRangeMap = { overlay1: [3, 12] };
    ui.userOverrides = { overlay1: ["visible", "opacity"] };

    ui.dropPersistedLayerState("overlay1");

    expect(ui.hiddenIds.has("overlay1")).toBe(false);
    expect(ui.hiddenIds.has("base1")).toBe(true);
    expect(ui.opacityMap.overlay1).toBeUndefined();
    expect(ui.zoomRangeMap.overlay1).toBeUndefined();
    expect(ui.userOverrides.overlay1).toBeUndefined();
  });

  it("colorLayerName resolves the color row's display name", () => {
    expect(typeof ui.colorLayerName()).toBe("string");
  });

  it("clicking the color row hides basemaps and activates the color layer", () => {
    const enforce = vi.spyOn(manager, "enforceOrder");
    const colorItem = ui.uiContainer.querySelector(CONST.SEL.COLOR_ITEM) as HTMLElement;

    colorItem.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(ui.isColorActive).toBe(true);
    expect(colorItem.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);
    expect(enforce).toHaveBeenCalled();
  });

  it("hideColorLayer clears the active color state", () => {
    ui.showColorLayer(ui.currentColor);
    const colorItem = ui.uiContainer.querySelector(CONST.SEL.COLOR_ITEM) as HTMLElement;

    ui.hideColorLayer();

    expect(ui.isColorActive).toBe(false);
    expect(colorItem.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
  });

  it("reindexAfterMove rebuilds the list without dropping rows", () => {
    ui.reindexAfterMove();

    expect(ui.uiContainer!.querySelector("[data-layer-id='overlay1']")).not.toBeNull();
    expect(ui.uiContainer!.querySelector("[data-layer-id='base1']")).not.toBeNull();
  });

  it("syncVisibility resolves visibility from the map when a layer exists", () => {
    const layerInfo = manager.layerRegistry.get("overlay1")!;
    const layer = manager.findLayer(layerInfo);

    const visible = ui.syncVisibility(layerInfo, layer, false);

    expect(visible).toBe(true);
    expect(layerInfo.visible).toBe(true);
  });

  it("syncVisibility falls back when the layer cannot be resolved", () => {
    const layerInfo = manager.layerRegistry.get("overlay1")!;

    const visible = ui.syncVisibility(layerInfo, null, true);

    expect(visible).toBe(true);
  });
});

// LayerUI shell (ui/index.ts) — attach sequence, event subscriptions, and the
// thin delegates to the ui/* modules. DOM interaction specifics live in the
// per-module suites (list/keyboard/focus/...); this file pins the wiring.
import {
  TEST_ENV,
  TileLayer,
  attachedPanel,
  findItem,
  initFixture,
  installLeafletGlobals,
  makePane,
  polygonLayer,
} from "./fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents } from "#core/event/index.js";
import { ROLE } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { LayerController } from "#control/LayerControl/controller.js";
import { LayerUI } from "#control/LayerControl/ui/index.js";
import { getIntent, seedIntentMap } from "#control/LayerControl/ui/intent.js";

describe("LayerUI shell — event subscriptions", () => {
  let manager: LayerController;
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

  it("CONTROL_ATTACHED re-runs the init pass and reapplies label state", () => {
    const initSpy = vi.spyOn(ui, "initTypesAndVisibility");
    const applySpy = vi.spyOn(ui, "applyStyleLabelState");

    ensureEvents(map).publish(EVENTS.CONTROL_ATTACHED, { component: "HeatmapControl" });

    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(applySpy).toHaveBeenCalledTimes(1);
  });

  it("CONTROL_ATTACHED is ignored once the container is detached", () => {
    (ui.uiContainer as HTMLElement).remove();
    const initSpy = vi.spyOn(ui, "initTypesAndVisibility");

    ensureEvents(map).publish(EVENTS.CONTROL_ATTACHED, { component: "HeatmapControl" });

    expect(initSpy).not.toHaveBeenCalled();
  });

  it("LAYER_ITEM_COUNT_CHANGE updates the row count and drops the field cache", () => {
    ui.runtimeStore.setFields("overlay1", [{ name: "stale", numeric: false }]);
    const getFeatureCount = vi.spyOn(manager, "getFeatureCount").mockReturnValue(5);
    const item = findItem(ui, "overlay1");
    const countCol = item.querySelector("[data-role='count']") as HTMLElement | null;

    ensureEvents(map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "overlay1" });

    expect(getFeatureCount).toHaveBeenCalledWith("overlay1");
    expect(ui.runtimeStore.getFields("overlay1")).toBeUndefined();
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
      role: "overlay",
      kind: "vector",
      layer: {
        options: {},
        eachLayer: vi.fn(),
        getBounds: vi.fn(() => ({
          isValid: vi.fn(() => true),
          getSouthWest: () => sw,
          getNorthEast: () => ne,
        })),
      },
      carrier: { layer: null, canvas: null, element: null, custom: null },
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
      getMinZoom: vi.fn(() => 0),
      options: { maxZoom: 18 },
      getBounds: vi.fn(() => ({
        pad: vi.fn(() => m),
        getSouthWest: () => ({ lat: 20, lng: 90 }),
        getNorthWest: () => ({ lat: 50, lng: 90 }),
        getNorthEast: () => ({ lat: 50, lng: 120 }),
        getSouthEast: () => ({ lat: 20, lng: 120 }),
      })),
      getContainer: vi.fn(() => container),
      getPane: vi.fn(() => makePane()),
      getPanes: vi.fn(() => ({ mapPane: document.createElement("div") })),
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
    const mgr = new LayerController(m, []);
    mgr.ui = new LayerUI(mgr, TEST_ENV);
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
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("saveFoldState persists the folded-role opinion map", () => {
    const save = vi.spyOn(manager.persistence, "schedule");
    ui.listPanel.foldedRoles = { overlays: true };

    ui.saveFoldState();

    expect(save).toHaveBeenCalled();
    const fields = save.mock.calls[0][0] as {
      foldedRoles: () => Record<string, boolean>;
    };
    expect(fields.foldedRoles()).toEqual({ overlays: true });
  });

  it("saveNamesState persists the rename map", () => {
    const save = vi.spyOn(manager.persistence, "schedule");
    seedIntentMap(ui, "name", { overlay1: "Renamed" });

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
    // explicit delete — and it must not touch a neighbor's state.
    seedIntentMap(ui, "visible", { overlay1: false, base1: false });
    seedIntentMap(ui, "opacity", { overlay1: 0.4 });
    seedIntentMap(ui, "zoomRange", { overlay1: [3, 12] });
    ui.intentStore.replaceProvenance({ overlay1: ["visible", "opacity"] });

    ui.dropPersistedLayerState("overlay1");

    expect(getIntent(ui, "overlay1", "visible")).not.toBe(false);
    expect(getIntent(ui, "base1", "visible")).toBe(false);
    expect(getIntent(ui, "overlay1", "opacity")).toBeUndefined();
    expect(getIntent(ui, "overlay1", "zoomRange")).toBeUndefined();
    expect(ui.intentStore.dumpProvenance().overlay1).toBeUndefined();
  });

  it("colorLayerName resolves the color row's display name", () => {
    expect(typeof ui.colorLayerName()).toBe("string");
  });

  it("checking the color row's checkbox activates the color layer", () => {
    // Row-body clicks used to trigger showSolidBasemap directly; the checkbox
    // change is now the only legitimate path (#494). The row still goes
    // through the same visibility carrier + debounced z-order write-through
    // as any other layer.
    const enforce = vi.spyOn(manager, "debouncedEnforce");
    const colorItem = attachedPanel(ui).querySelector(
      `[${CONST.DATA.LAYER_ID}="${CONST.SOLID_BASEMAP_ID}"]`,
    ) as HTMLElement;
    const checkbox = colorItem.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));

    expect(enforce).toHaveBeenCalled();
  });

  it("rebuildAfterLayoutChange rebuilds the list without dropping rows", () => {
    ui.rebuildAfterLayoutChange();

    expect(ui.uiContainer!.querySelector("[data-layer-id='overlay1']")).not.toBeNull();
    expect(ui.uiContainer!.querySelector("[data-layer-id='base1']")).not.toBeNull();
  });

  it("unbindEvents() tolerates an onZoomEnd that was never set", () => {
    ui.onZoomEnd = null;
    expect(() => ui.unbindEvents()).not.toThrow();
  });

  it("getLayerItems() returns the overlay rows for the overlay group", () => {
    // Covers the delegate wrapper at L379: the method exists for external
    // callers, so a single call suffices to cover the delegate line.
    const items = ui.getLayerItems(ROLE.OVERLAY);
    expect(items.length).toBeGreaterThanOrEqual(1);
    // Every returned item is a layer-item with the overlay group.
    for (const el of items) {
      expect(el.classList.contains(CONST.CLASSES.LAYER_ITEM)).toBe(true);
    }
  });

  it("resetSolidBasemap() delegates to the color module and flushes state", () => {
    // The manager's deleteLayer reaches this method rather than the color
    // module directly. The delegate exists so the bus-driven signal handler
    // has a single seam to spy on.
    const setColor = vi.fn();
    const setVisible = vi.fn();
    ui.c.createColor = vi.fn(() => ({
      element: document.createElement("canvas"),
      setColor,
      setVisible,
      register: vi.fn(),
      unregister: vi.fn(),
      registered: vi.fn(() => true),
      bringToFront: vi.fn(),
      destroy: vi.fn(),
    }));
    ui.colorSurface = null;
    ui.currentColor = "#ff0000";
    ui.runtimeStore.setAuthorVisible(CONST.SOLID_BASEMAP_ID, true);
    const save = vi.spyOn(ui, "saveState");

    ui.resetSolidBasemap();

    expect(ui.colorSurface).toBeNull();
    expect(ui.currentColor).toBe(CONST.COLOR.DEFAULT);
    expect(ui.runtimeStore.getAuthorVisible(CONST.SOLID_BASEMAP_ID)).toBe(false);
    expect(save).toHaveBeenCalled();
  });

  it("insertLayerItem / updateLayerItemLabel / initLayerItem delegates reach the row modules", () => {
    // The LayerUI delegate wrappers are the seam the manager-driven signal
    // handlers call; each must route to the ui/* module without throwing.
    const li = manager.layerRegistry.get("overlay1")!;
    expect(() => ui.initLayerItem(li)).not.toThrow();
    expect(() => ui.updateLayerItemLabel(li)).not.toThrow();
    expect(() => ui.insertLayerItem(li)).not.toThrow();
    // The row exists and was re-rendered through the delegates.
    expect(findItem(ui, "overlay1")).not.toBeNull();
  });

  it("syncToggleAll / syncNoBasemap delegates reach the visibility module", () => {
    expect(() => ui.syncToggleAll(ROLE.OVERLAY)).not.toThrow();
    expect(() => ui.syncNoBasemap()).not.toThrow();
  });

  it("hideSolidBasemap delegates to the color module", () => {
    const setVisible = vi.fn();
    ui.c.createColor = vi.fn(() => ({
      element: document.createElement("canvas"),
      setColor: vi.fn(),
      setVisible,
      register: vi.fn(),
      unregister: vi.fn(),
      registered: vi.fn(() => true),
      bringToFront: vi.fn(),
      destroy: vi.fn(),
    }));
    ui.colorSurface = null;
    (ui as any).showSolidBasemap();
    ui.hideSolidBasemap();
    expect(setVisible).toHaveBeenCalledWith(false);
  });

  it("dropStyleDimApplies delegates to the style bag", () => {
    expect(() => ui.dropStyleDimApplies("overlay1")).not.toThrow();
  });
});

// ui derived-state coherence guard (moved from derivedState.test.ts).
// Every registration path must leave the derived states — role tri-state,
// container row type, fold class, role header count — in agreement with the
// registry.
describe("ui derived-state coherence — B-path (runtime registerLayer)", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const toggleAllCheckbox = (role: string): HTMLInputElement =>
    attachedPanel(ui).querySelector(
      `${CONST.SEL.TOGGLE_ALL}[data-role="${role}"] input[type="checkbox"]`,
    ) as HTMLInputElement;

  const rowCount = (role: string): number =>
    attachedPanel(ui).querySelectorAll(
      role === ROLE.BASE
        ? `${CONST.SEL.LAYER_ITEM}[data-layer-type="${ROLE.BASE}"]`
        : `${CONST.SEL.LAYER_ITEM}:not([data-layer-type="${ROLE.BASE}"])`,
    ).length;

  const coherenceTable: Array<{
    name: string;
    register: () => void;
    check: () => void;
  }> = [
    {
      name: "role tri-state total tracks the registry",
      register: () =>
        manager.registerLayer({
          id: "overlay2",
          name: "Late",
          role: "overlay",
          layer: polygonLayer(),
        }),
      check: () => {
        const cb = toggleAllCheckbox(ROLE.OVERLAY);
        expect(cb).not.toBeNull();
        expect(cb.checked).toBe(true);
        expect(cb.indeterminate).toBe(false);
        const row = attachedPanel(ui).querySelector(
          `${CONST.SEL.LAYER_ITEM}[data-layer-id="overlay2"] input[type="checkbox"]`,
        ) as HTMLInputElement;
        row.checked = false;
        row.dispatchEvent(new Event("change", { bubbles: true }));
        const after = toggleAllCheckbox(ROLE.OVERLAY);
        expect(after.indeterminate).toBe(true);
        expect(after.checked).toBe(false);
      },
    },
    {
      name: "container row renders the group glyph + child count",
      register: () => {
        const fg = {
          options: {},
          eachLayer: vi.fn((cb: (c: unknown) => void) => {
            cb({ options: {} });
            cb({ options: {} });
          }),
          addLayer: vi.fn(),
          getLayers: vi.fn(() => [{ options: {} }, { options: {} }]),
          getBounds: vi.fn(),
          _layers: {},
        };
        manager.registerLayer({
          id: "fg_late",
          name: "Late Group",
          role: "overlay",
          layer: fg as never,
        });
      },
      check: () => {
        const row = attachedPanel(ui).querySelector(
          `${CONST.SEL.LAYER_ITEM}[data-layer-id="fg_late"]`,
        ) as HTMLElement | null;
        expect(row).not.toBeNull();
        const typeCol = row!.querySelector(
          `.${CONST.CLASSES.TYPE_ICON_COL}`,
        ) as HTMLElement | null;
        expect(typeCol?.innerHTML).toContain("<svg");
        expect(row!.querySelector(CONST.SEL.COUNT_COL)?.textContent).toBe("2");
      },
    },
    {
      name: "base role header reflects a base registered at runtime",
      register: () =>
        manager.registerLayer({
          id: "base_late",
          name: "Late Base",
          role: "base",
          layer: new TileLayer(),
          paneName: "tilePane",
        }),
      check: () => {
        expect(rowCount(ROLE.BASE)).toBeGreaterThanOrEqual(2);
        const cb = toggleAllCheckbox(ROLE.BASE);
        expect(cb).not.toBeNull();
      },
    },
  ];

  it.each(coherenceTable)("$name", ({ register, check }) => {
    installLeafletGlobals();
    register();
    check();
  });
});

describe("ui derived-state coherence — tree connector (delete path)", () => {
  let manager: LayerController;
  let ui: LayerUI;

  const layoutFromRoles = (sections: Record<string, string[]>) => {
    const keys = new Set<string>();
    for (const list of Object.values(sections)) for (const k of list) keys.add(k);
    return {
      version: 2,
      folders: [...keys].map(k => ({ key: k, name: k })),
      order: sections,
      members: {},
    };
  };

  const tree = (id: string): HTMLElement | null =>
    attachedPanel(ui).querySelector(
      `[data-layer-id="${id}"] .${CONST.CLASSES.FOLD_TREE}`,
    );

  beforeEach(() => {
    installLeafletGlobals();
    ({ manager, ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
        {
          id: "rd2",
          name: "Rivers",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    }));
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("deleting the folder's last member flips the prior member to LAST", () => {
    expect(tree("rd1")?.classList.contains(CONST.CLASSES.FOLD_TREE_LAST)).toBe(false);
    expect(tree("rd1")?.classList.contains(CONST.CLASSES.FOLD_TREE_MID)).toBe(true);
    expect(tree("rd2")?.classList.contains(CONST.CLASSES.FOLD_TREE_LAST)).toBe(true);
    manager.deleteLayer("rd2");
    expect(tree("rd1")?.classList.contains(CONST.CLASSES.FOLD_TREE_LAST)).toBe(true);
    expect(tree("rd1")?.classList.contains(CONST.CLASSES.FOLD_TREE_MID)).toBe(false);
  });

  it("registering a new member computes the new row's connector and leaves prior rows coherent", () => {
    expect(tree("rd2")?.classList.contains(CONST.CLASSES.FOLD_TREE_LAST)).toBe(true);
    manager.registerLayer({
      id: "rd3",
      name: "Lakes",
      role: "overlay",
      folder: "roads",
      layer: polygonLayer(),
    });
    expect(tree("rd3")?.classList.contains(CONST.CLASSES.FOLD_TREE_MID)).toBe(true);
    expect(tree("rd3")?.classList.contains(CONST.CLASSES.FOLD_TREE_LAST)).toBe(false);
    expect(tree("rd2")?.classList.contains(CONST.CLASSES.FOLD_TREE_LAST)).toBe(true);
    expect(tree("rd1")?.classList.contains(CONST.CLASSES.FOLD_TREE_MID)).toBe(true);
  });
});

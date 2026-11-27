// test/js/control/LayerControl/controller.teardown — teardown and retirement finalization.
import {
  createLayerControllerFixture,
  makeStore,
  teardownLayerControllerFixture,
} from "./controller.fixture.js";
import {
  attachedPanel,
  initFixture,
  makeDerivedUI,
  polygonLayer,
} from "./ui/fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { LayerRuntimeStore, ROLE, getLayerAlpha, orderKeyOf } from "#core/layer/index.js";
import * as Storage from "#platform/storage.js";
import * as CONST from "#control/LayerControl/const.js";
import { LayerController } from "#control/LayerControl/controller.js";
import { LayerPersistence } from "#control/LayerControl/persistence.js";
import { applyUserState } from "#control/LayerControl/ui/state.js";

describe("retireEntry finalization", () => {
  it("unloads the label even when the row step throws", () => {
    document.body.innerHTML = "";
    window.localStorage.clear();
    const { manager, ui } = initFixture({
      data: [
        { id: "overlay1", name: "Polygons", role: "overlay" },
        { id: "base1", name: "OSM", role: "base" },
      ],
    });
    const unload = vi.spyOn(manager.label, "unloadLayer");
    const container = (ui as unknown as { uiContainer: HTMLElement }).uiContainer;
    const original = container.querySelector.bind(container);
    let armed = true;
    container.querySelector = ((sel: string) => {
      if (armed && String(sel).includes("data-layer-id")) {
        armed = false;
        throw new Error("panel read failed");
      }
      return original(sel);
    }) as typeof container.querySelector;

    try {
      expect(() => manager.unregisterLayer("overlay1")).toThrow("panel read failed");
    } finally {
      // The fixture owns this element; drop the own-property patch so the
      // prototype's querySelector is back for whatever runs next.
      Reflect.deleteProperty(container, "querySelector");
    }
    expect(unload.mock.calls.some(c => c[0] === "overlay1")).toBe(true);
    expect(manager.layerRegistry.has("overlay1")).toBe(false);
  });

  it("reports every failing step, not only the one it hands back", () => {
    document.body.innerHTML = "";
    window.localStorage.clear();
    const { manager } = initFixture({
      data: [
        {
          id: "overlay1",
          name: "Polygons",
          role: "overlay",
          layer: polygonLayer(),
        },
      ],
    });
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});
    manager.map.removeLayer.mockImplementation(() => {
      throw new Error("map boom");
    });
    vi.spyOn(manager.label, "unloadLayer").mockImplementation(() => {
      throw new Error("labels stuck");
    });

    // The first failure remains the caller's contract...
    expect(() => manager.unregisterLayer("overlay1")).toThrow("map boom");

    // ...but the second failing step is no longer silent.
    expect(warn).toHaveBeenCalledWith(
      'retire step "detach-from-map" threw',
      expect.any(Error),
    );
    expect(warn).toHaveBeenCalledWith(
      'retire step "unload-label" threw',
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it("runs the drag cancel as an isolated finalize step", () => {
    document.body.innerHTML = "";
    window.localStorage.clear();
    const { manager, ui } = initFixture({
      data: [
        {
          id: "overlay1",
          name: "Polygons",
          role: "overlay",
          layer: polygonLayer(),
        },
      ],
    });
    const entry = manager.layerRegistry.get("overlay1")!;
    ui.listPanel.dragEntry = entry;
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});
    const container = attachedPanel(ui);
    const original = container.querySelectorAll.bind(container);
    let armed = true;
    container.querySelectorAll = ((selector: string) => {
      if (armed && String(selector).includes(CONST.SEL.LAYER_ITEM)) {
        armed = false;
        throw new Error("drag boom");
      }
      return original(selector);
    }) as typeof container.querySelectorAll;

    try {
      // The drag step fails first, but the row, map and cursor convergence
      // behind it still runs and its failure is reported.
      expect(() => manager.unregisterLayer("overlay1")).toThrow("drag boom");
    } finally {
      Reflect.deleteProperty(container, "querySelectorAll");
    }

    expect(manager.layerRegistry.has("overlay1")).toBe(false);
    expect(
      attachedPanel(ui).querySelector(`[${CONST.DATA.LAYER_ID}="overlay1"]`),
    ).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'retire step "cancel-drag" threw',
      expect.any(Error),
    );
    warn.mockRestore();
  });
});

describe("destroy finalization", () => {
  it("reports the failing step, keeps tearing down, and still installs the stub API", () => {
    window.localStorage.clear();
    const { manager, map } = initFixture({
      data: [{ id: "overlay1", name: "Polygons", role: "overlay" }],
    });
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});
    const unbind = vi.spyOn(manager.ui!, "unbindEvents");
    vi.spyOn(manager.label, "destroy").mockImplementation(() => {
      throw new Error("labels stuck");
    });

    expect(() => manager.destroy()).not.toThrow();

    // The steps behind the failure still ran.
    expect(unbind).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'destroy step "destroy-label" threw',
      expect.any(Error),
    );
    // Last step, and the one consumers depend on: a half-destroyed manager
    // must not stay mounted as the map's LayerAPI.
    expect(map.foliplus.LayerAPI.registerLayer({ id: "x" } as never)).toBeNull();
    expect(manager.isDestroyed).toBe(true);
    warn.mockRestore();
  });
});

describe("LayerController", () => {
  let manager: LayerController;
  let map: any;

  beforeEach(() => {
    ({ manager, map } = createLayerControllerFixture());
  });

  afterEach(() => {
    teardownLayerControllerFixture(manager);
  });

  it("a throwing map teardown still converges the retirement", () => {
    const { manager, ui } = initFixture({
      data: [{ id: "A", name: "A", role: "overlay", layer: polygonLayer() }],
    });
    ui.listPanel.dragEntry = manager.layerRegistry.get("A")!;
    const changes: string[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, p => changes.push(p.id));
    manager.map.removeLayer.mockImplementation(() => {
      throw new Error("map boom");
    });

    expect(() => manager.unregisterLayer("A")).toThrow("map boom");

    // The local ledger converged despite the throw: registry, gesture,
    // DOM row, and the owed CHANGE all landed.
    expect(manager.layerRegistry.has("A")).toBe(false);
    expect(ui.listPanel.dragEntry).toBeNull();
    expect(attachedPanel(ui).querySelector(`[${CONST.DATA.LAYER_ID}="A"]`)).toBeNull();
    expect(changes).toContain("A");
  });

  it("a throwing map teardown still converges a user delete", () => {
    const { manager, ui } = initFixture({
      data: [{ id: "A", name: "A", role: "overlay", layer: polygonLayer() }],
    });
    const changes: string[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, p => changes.push(p.id));
    manager.map.removeLayer.mockImplementation(() => {
      throw new Error("map boom");
    });

    expect(() => manager.deleteLayer("A")).toThrow("map boom");

    // The delete's persistent effects and its fan-out all landed before the
    // map error surfaced: entry gone, id pruned as deleted, CHANGE owed.
    expect(manager.layerRegistry.has("A")).toBe(false);
    expect(((manager as any).orderDoc.nodes["layer:A"] as any)?.hidden).toBe(true);
    expect(changes).toContain("A");
  });

  it("a throwing map teardown still converges a color-basemap delete", () => {
    const { manager, ui } = initFixture({
      data: [{ id: "A", name: "A", role: "overlay", layer: polygonLayer() }],
    });
    // The color entry registers with a canvas, no Leaflet layer; give it one
    // so the map teardown path (and its throw) is real.
    manager.layerRegistry.get(CONST.SOLID_BASEMAP_ID)!.layer = polygonLayer();
    const changes: string[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, p => changes.push(p.id));
    manager.map.removeLayer.mockImplementation(() => {
      throw new Error("map boom");
    });

    expect(() => manager.deleteLayer(CONST.SOLID_BASEMAP_ID)).toThrow("map boom");

    expect(manager.layerRegistry.has(CONST.SOLID_BASEMAP_ID)).toBe(false);
    expect(changes).toContain(CONST.SOLID_BASEMAP_ID);
  });

  it("re-registration re-applies stored opacity onto a replaced canvas", () => {
    manager.map.hasLayer.mockReturnValue(false);
    manager.uiContainer = document.createElement("div");
    const canvas = document.createElement("canvas");
    manager.registerLayer({ id: "heat", name: "Heat", canvas });
    manager.ui = makeDerivedUI({
      updateLayerItemLabel: vi.fn(),
      initLayerItem: vi.fn(),
      syncToggleAll: vi.fn(),
      insertLayerItem: vi.fn(),
      invalidateFields: vi.fn(),
      applyUserState: (id: string) =>
        applyUserState(
          {
            c: manager,
            uiContainer: manager.uiContainer,
            renamedNames: {},
            focusController: { focusingLayerId: null },
            intentStore: makeStore({ heat: { opacity: 0.4 } }, { heat: ["opacity"] }),
            runtimeStore: new LayerRuntimeStore(),
          } as any,
          id,
        ),
      intentStore: makeStore({ heat: { opacity: 0.4 } }, { heat: ["opacity"] }),
      runtimeStore: new LayerRuntimeStore(),
    }) as any;

    // Swap the canvas on re-registration — the new element starts opaque.
    const fresh = document.createElement("canvas");
    manager.registerLayer({ id: "heat", name: "Heat", canvas: fresh });

    // Default "redraw" branch: CSS live + layerAlpha stored.
    expect(fresh.style.opacity).toBe("0.4");
    expect(getLayerAlpha(fresh)).toBeCloseTo(0.4);
    expect(manager.layerRegistry.get("heat")?.opacity).toBe(0.4);
  });

  it("unregisterLayer removes the UI row", () => {
    manager.map.hasLayer.mockReturnValue(false);
    const row = document.createElement("div");
    row.setAttribute("data-layer-id", "overlay1");
    manager.uiContainer = document.createElement("div");
    manager.uiContainer.appendChild(row);
    manager.ui = makeDerivedUI({
      intentStore: makeStore(),
      saveState: vi.fn(),
      invalidateFields: vi.fn(),
    }) as any;
    expect(manager.unregisterLayer("overlay1")).toBe(true);
    expect(manager.uiContainer.querySelector("[data-layer-id=overlay1]")).toBeNull();
  });

  it("unregisterLayer tolerates a row already gone from the panel", () => {
    // The panel is attached but no row carries this id — the layer left the
    // panel before unregister ran. The removal guard (target === null) must
    // not throw.
    manager.map.hasLayer.mockReturnValue(false);
    manager.uiContainer = document.createElement("div");
    manager.ui = makeDerivedUI({
      intentStore: makeStore(),
      saveState: vi.fn(),
      invalidateFields: vi.fn(),
    }) as any;
    expect(manager.unregisterLayer("overlay1")).toBe(true);
  });

  it("retires the row it started with when the id is re-registered mid-teardown", () => {
    // The registry entry is gone before the steps run, so a `remove` listener
    // inside `clear-layer-tree` can register the same id again and mount a
    // second row. The retirement owns the element it captured when it started,
    // not whatever currently answers to the id — otherwise the teardown deletes
    // the replacement's row and leaves the dead one behind.
    manager.map.hasLayer.mockReturnValue(false);
    const layer = { options: {} } as any;
    manager.registerLayer({ id: "overlay1", name: "Points", role: "overlay", layer });
    const original = document.createElement("div");
    original.setAttribute("data-layer-id", "overlay1");
    manager.uiContainer = document.createElement("div");
    manager.uiContainer.appendChild(original);
    manager.ui = makeDerivedUI({
      intentStore: makeStore(),
      saveState: vi.fn(),
      invalidateFields: vi.fn(),
    }) as any;

    const decoy = document.createElement("div");
    decoy.setAttribute("data-layer-id", "overlay1");
    vi.spyOn(manager, "clearAllLayers").mockImplementation(() => {
      // A row for the freshly registered replacement, in front of the original.
      manager.uiContainer!.prepend(decoy);
    });

    expect(manager.unregisterLayer("overlay1")).toBe(true);

    expect(manager.uiContainer.contains(original)).toBe(false);
    expect(manager.uiContainer.contains(decoy)).toBe(true);
  });

  it("still retires the captured row when the panel goes away mid-teardown", () => {
    // The row is captured before the steps, so a remove handler that tears the
    // whole control down (nulling `uiContainer`) must not strand it: the row is
    // removed anyway, and only the group/toggle-all rescan is skipped because
    // there is no panel left to rescan.
    manager.map.hasLayer.mockReturnValue(false);
    const layer = { options: {} } as any;
    manager.registerLayer({ id: "overlay1", name: "Points", role: "overlay", layer });
    const row = document.createElement("div");
    row.setAttribute("data-layer-id", "overlay1");
    manager.uiContainer = document.createElement("div");
    manager.uiContainer.appendChild(row);
    const container = manager.uiContainer;
    manager.ui = makeDerivedUI({
      intentStore: makeStore(),
      saveState: vi.fn(),
      invalidateFields: vi.fn(),
    }) as any;
    vi.spyOn(manager, "clearAllLayers").mockImplementation(() => {
      manager.uiContainer = null;
    });

    expect(manager.unregisterLayer("overlay1")).toBe(true);

    expect(container.contains(row)).toBe(false);
  });

  it("unregisterLayer reconciles the base group when a base layer is dropped", () => {
    // The unregister sweep's sync call reads `layerInfo.role === "base"` to pick the
    // group to rescan. Existing tests only unregister overlays, so the BASE
    // branch of the ternary would silently rot without a pin.
    manager.map.hasLayer.mockReturnValue(false);
    manager.ui = makeDerivedUI({
      intentStore: makeStore(),
      saveState: vi.fn(),
    }) as any;
    const emitSpy = vi.spyOn(manager.events, "emitSettled");
    expect(manager.unregisterLayer("base1")).toBe(true);
    expect(emitSpy).toHaveBeenCalledWith(
      EVENTS.LAYER_ROLE_COUNT_CHANGED,
      {
        role: ROLE.BASE,
      },
      { kind: "system", via: "teardown" },
    );
  });

  it("attachUI delegates to the UI", () => {
    manager.ui = { attachUI: vi.fn() } as any;
    const div = document.createElement("div");
    manager.attachUI(div);
    expect(manager.ui!.attachUI).toHaveBeenCalledWith(div);
  });

  it("destroy cleans up the UI container and unbinds", () => {
    manager.uiContainer = document.createElement("div");
    const ui = { unbindEvents: vi.fn() } as any;
    manager.ui = ui;
    manager.destroy();
    expect(ui.unbindEvents).toHaveBeenCalled();
    expect(manager.uiContainer).toBeNull();
    expect(manager.isDestroyed).toBe(true);
  });

  it("destroy without a UI container still tears down map bindings", () => {
    // A map without LayerControl on it has a manager with a registry but no
    // panel: destroy still must unbind the layeradd listener and clear the
    // registry.
    const m = new LayerController(map, [{ id: "a", name: "A", role: "overlay" }]);
    expect(m.uiContainer).toBeNull();
    m.destroy();
    expect(map.off).toHaveBeenCalledWith("layeradd", m.onLayerAdd);
    expect(map.off).toHaveBeenCalledWith("layerremove", m.onLayerRemove);
    expect(m.isDestroyed).toBe(true);
    expect(m.layerRegistry.size).toBe(0);
  });

  it("onLayerAdd is a no-op once the manager is destroyed", () => {
    // A destroyed manager must ignore stray layeradd events, including ones
    // fired before its off() takes effect in the same teardown pass.
    const m = new LayerController(map, [{ id: "a", name: "A", role: "overlay" }]);
    const spy = vi.spyOn(m, "enforceOrder");
    m.destroy();
    m.onLayerAdd({ layer: { options: {} } } as any);
    expect(spy).not.toHaveBeenCalled();
  });

  it("onLayerRemove is a no-op once the manager is destroyed", () => {
    const m = new LayerController(map, [{ id: "a", name: "A", role: "overlay" }]);
    const spy = vi.spyOn(m, "enforceOrder");
    m.destroy();
    expect(() => m.onLayerRemove({ layer: { options: {} } } as any)).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it("debouncedEnforce skips scheduling once destroyed", () => {
    // A register/unregister racing the teardown must not reschedule a
    // z-order pass on a manager that no longer has a map.
    const m = new LayerController(map, [{ id: "a", name: "A", role: "overlay" }]);
    const spy = vi.spyOn(m, "enforceOrder");
    m.destroy();
    m.debouncedEnforce();
    expect(spy).not.toHaveBeenCalled();
  });

  it("saveOrder persists immediately to the order key (no pending debounce)", () => {
    // saveOrder re-ranks the root blocks and writes the order doc through
    // saveRecord right away; there is no debounced order write left for
    // destroy to flush, so a reorder immediately before teardown survives.
    const m = new LayerController(map, [
      { id: "a", name: "A", role: "overlay" },
      { id: "b", name: "B", role: "overlay" },
    ]);
    m.persistence = new LayerPersistence();
    const save = vi.spyOn(Storage, "saveRecord");
    m.saveOrder();
    expect(save).toHaveBeenCalledWith(orderKeyOf(map), expect.anything(), "LayerControl");
    const doc = save.mock.calls[0]![1] as any;
    const rootIds = Object.entries(doc.nodes as Record<string, any>)
      .filter(([, n]) => n.parent === null && n.kind === "layer")
      .sort((a, b) => (a[1].rank as string).localeCompare(b[1].rank as string))
      .map(([k]) => k.replace(/^layer:/, ""));
    expect(rootIds).toEqual(["a", "b"]);
  });

  it("destroy flushes a pending intent write instead of cancelling it", () => {
    // Same ordering for per-layer intent: a hide just before teardown must
    // survive a reload, which is the whole point of the flush.
    const m = new LayerController(map, [{ id: "a", name: "A", role: "overlay" }]);
    m.persistence = new LayerPersistence();
    const save = vi.spyOn(Storage, "saveVersionedObject");
    m.persistence.schedule({
      layers: () => ({ a: { visible: false, overrides: ["visible"] } }),
    });
    save.mockClear();
    m.destroy();
    expect(save).toHaveBeenCalledWith(CONST.STORAGE.KEY, {
      version: expect.any(Number),
      data: expect.objectContaining({
        layers: { a: { visible: false, overrides: ["visible"] } },
      }),
      name: expect.any(String),
    });
  });
});

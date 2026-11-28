// test/js/control/LayerControl/controller.delete — deleting a layer and its ownership.
import {
  createLayerControllerFixture,
  makeStore,
  readOrderTreeStorage,
  seedOrderDoc,
  seedStorage,
  teardownLayerControllerFixture,
} from "./controller.fixture.js";
import { TEST_ENV, makeDerivedUI } from "./ui/fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { LayerRuntimeStore, ROLE, orderKeyOf } from "#core/layer/index.js";
import * as Storage from "#platform/storage.js";
import * as CONST from "#control/LayerControl/const.js";
import { LayerController } from "#control/LayerControl/controller.js";
import { LayerUI } from "#control/LayerControl/ui/index.js";
import { getIntent } from "#control/LayerControl/ui/intent.js";
import {
  dropPersistedLayerState,
  saveNamesState,
  saveState,
} from "#control/LayerControl/ui/state.js";

describe("LayerController", () => {
  let manager: LayerController;
  let map: any;

  beforeEach(() => {
    ({ manager, map } = createLayerControllerFixture());
  });

  afterEach(() => {
    teardownLayerControllerFixture(manager);
  });

  it("attachUI skips a null entry in pending registrations", () => {
    // attachUI drains pendingRegistrations in a loop and guards each shift()
    // result; a null entry must be skipped rather than reaching
    // insertLayerItem. A null cannot arise from registerLayer, so this is
    // defensive — and it must stay that way.
    const ui = new LayerUI(manager, TEST_ENV);
    manager.pendingRegistrations.push(null as any);
    manager.ui = ui;
    expect(() => ui.attachUI(document.createElement("div"))).not.toThrow();
  });

  it("unregisterLayer leaves every persisted role alone", () => {
    // Generic teardown cannot tell a temporarily-empty layer from a deleted
    // one — HeatmapControl unregisters its canvas whenever the data goes
    // empty — so it must not erase the user's stored values, including the
    // rename: the component may register the same id again and the user
    // expects the name they chose, not the registry's default.
    manager.map.hasLayer.mockReturnValue(false);
    const saveState = vi.fn();
    manager.ui = makeDerivedUI({
      intentStore: makeStore(
        {
          overlay1: {
            visible: false,
            opacity: 0.4,
            zoomRange: [3, 12],
            name: "Renamed",
          },
          base1: { visible: false, opacity: 1 },
        },
        {
          overlay1: ["visible", "opacity", "zoomRange"],
          base1: ["visible"],
        },
      ),
      saveState,
      saveNamesState: vi.fn(),
      invalidateFields: vi.fn(),
    }) as any;
    manager.unregisterLayer("overlay1");

    // Unregister keeps every stored dimension (maps + intents stay in step).
    expect(getIntent(manager.ui!, "overlay1", "visible")).toBe(false);
    expect(getIntent(manager.ui!, "overlay1", "opacity")).toBe(0.4);
    expect(getIntent(manager.ui!, "overlay1", "zoomRange")).toEqual([3, 12]);
    expect(getIntent(manager.ui!, "base1", "visible")).toBe(false);
    expect(getIntent(manager.ui!, "base1", "opacity")).toBe(1);
    expect(manager.ui!.intentStore.dumpProvenance()).toEqual({
      overlay1: ["visible", "opacity", "zoomRange"],
      base1: ["visible"],
    });
    expect(getIntent(manager.ui!, "overlay1", "name")).toBe("Renamed");
    expect(saveState).not.toHaveBeenCalled();
  });

  it("deleteLayer drops the layer id from every persisted role", () => {
    // The one call that knows a layer is gone for good, so the one call that
    // may erase its stored values — the per-layer intent and the rename.
    manager.map.hasLayer.mockReturnValue(false);
    const saveState = vi.fn();
    const saveNamesState = vi.fn();
    const store = makeStore(
      {
        overlay1: {
          visible: false,
          opacity: 0.4,
          zoomRange: [3, 12],
          name: "Renamed",
        },
        base1: { visible: false, opacity: 1 },
      },
      {
        overlay1: ["visible", "opacity", "zoomRange"],
        base1: ["visible"],
      },
    );
    manager.intentStore = store;
    manager.ui = makeDerivedUI({
      intentStore: store,
      dropPersistedLayerState: (id: string) => dropPersistedLayerState(manager.ui!, id),
      saveState,
      saveNamesState,
      invalidateFields: vi.fn(),
      syncToggleAll: vi.fn(),
      syncNoBasemap: vi.fn(),
    }) as any;
    manager.deleteLayer("overlay1");

    expect(getIntent(manager.ui!, "overlay1", "visible")).toBeUndefined();
    expect(getIntent(manager.ui!, "base1", "visible")).toBe(false);
    expect(getIntent(manager.ui!, "base1", "opacity")).toBe(1);
    expect(manager.ui!.intentStore.dumpProvenance()).toEqual({ base1: ["visible"] });
    expect(getIntent(manager.ui!, "overlay1", "name")).toBeUndefined();
    expect(saveState).toHaveBeenCalledTimes(1);
    expect(saveNamesState).toHaveBeenCalledTimes(1);
  });

  it("deleteLayer refuses an unknown id and writes nothing", () => {
    manager.map.hasLayer.mockReturnValue(false);
    const saveState = vi.fn();
    manager.ui = makeDerivedUI({
      intentStore: makeStore(
        { overlay1: { visible: false, opacity: 0.4 } },
        { overlay1: ["opacity"] },
      ),
      renamedNames: {},
      dropPersistedLayerState: vi.fn(),
      saveState,
      saveNamesState: vi.fn(),
      invalidateFields: vi.fn(),
    }) as any;

    expect(manager.deleteLayer("never-registered")).toBe(false);
    expect(getIntent(manager.ui!, "overlay1", "visible")).toBe(false);
    expect(saveState).not.toHaveBeenCalled();
  });

  it("deleteLayer completes when the panel never attached", () => {
    // A layer can be deleted before attachUI has created the UI, so the teardown
    // must not assume one exists — nothing was ever persisted to erase.
    manager.map.hasLayer.mockReturnValue(false);

    expect(manager.deleteLayer("overlay1")).toBe(true);
    expect(manager.layerRegistry.get("overlay1")).toBeUndefined();
  });

  it("deleteLayer skips the rename write when the id has no rename", () => {
    // The name map needs saving only when there was a rename to drop; the
    // per-layer intent write is separate, and an unrelated rename must survive.
    manager.map.hasLayer.mockReturnValue(false);
    const saveState = vi.fn();
    const saveNamesState = vi.fn();
    const store = makeStore(
      {
        overlay1: { visible: false, opacity: 0.4, zoomRange: [3, 12] },
        base1: { visible: false, name: "Renamed" },
      },
      { overlay1: ["visible", "opacity"] },
    );
    manager.intentStore = store;
    manager.ui = makeDerivedUI({
      intentStore: store,
      dropPersistedLayerState: (id: string) => dropPersistedLayerState(manager.ui!, id),
      saveState,
      saveNamesState,
      invalidateFields: vi.fn(),
      syncToggleAll: vi.fn(),
      syncNoBasemap: vi.fn(),
    }) as any;

    expect(manager.deleteLayer("overlay1")).toBe(true);

    expect(saveState).toHaveBeenCalledTimes(1);
    expect(saveNamesState).not.toHaveBeenCalled();
    expect(getIntent(manager.ui!, "base1", "visible")).toBe(false);
    expect(getIntent(manager.ui!, "base1", "name")).toBe("Renamed");
    expect(getIntent(manager.ui!, "overlay1", "visible")).toBeUndefined();
  });

  it("deleteLayer prunes every persisted role that keys by layer id", () => {
    // `order` and `renamedNames` both survive a plain
    // unregister, and both must die on a delete. `order` is the one that
    // needs care — saveOrder re-inserts any stored id that is not registered
    // yet, so the id has to leave the stored order itself or it comes straight
    // back as a pending position.
    seedOrderDoc(map, ["overlay1", "base1"]);
    seedStorage({
      renamedNames: { overlay1: "Renamed", base1: "Base" },
      layers: { overlay1: { opacity: 0.4, overrides: ["opacity"] } },
    });
    const m = new LayerController(map, [
      { id: "overlay1", name: "O", role: "overlay", layer: { options: {} } },
      { id: "base1", name: "B", role: "base", layer: { options: {} } },
    ]);
    m.label.setConfig("overlay1", {
      show: true,
      field: "name",
      color: "#e74c3c",
      size: 12,
      format: "auto",
      collide: true,
    });
    m.map.hasLayer.mockReturnValue(false);
    const store = makeStore(
      {
        overlay1: { opacity: 0.4, name: "Renamed" },
        base1: { name: "Base" },
      },
      { overlay1: ["opacity"] },
    );
    m.intentStore = store;
    m.ui = makeDerivedUI({
      c: m,
      intentStore: store,
      dropPersistedLayerState: (id: string) => dropPersistedLayerState(m.ui!, id),
      saveState: () => saveState(m.ui!),
      saveNamesState: () => saveNamesState(m.ui!),
      invalidateFields: vi.fn(),
      syncToggleAll: vi.fn(),
      syncNoBasemap: vi.fn(),
    }) as any;

    expect(m.deleteLayer("overlay1")).toBe(true);

    const stored = readOrderTreeStorage(map)!;
    const node = stored.nodes["layer:overlay1"];
    // The delete marks the doc node hidden (the single retire marker), so a
    // reload never rebuilds the layer; the base layer's slot is untouched.
    expect(node?.hidden).toBe(true);
    expect(stored.nodes["layer:base1"]?.hidden).toBeUndefined();
    const record = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!).data as {
      renamedNames: Record<string, string>;
      layers: Record<string, unknown>;
    };
    expect(record.renamedNames).toEqual({ base1: "Base" });
    expect(record.layers).toEqual({});
  });

  it("deleteLayer persists the retire marker on the order doc", () => {
    // The retire marker is a hidden flag on the doc node, written to the
    // order's own key immediately (saveOrderDoc -> saveRecord, no debounce).
    // There is no separate removed list to land on a different tick.
    vi.useFakeTimers();
    const save = vi.spyOn(Storage, "saveRecord").mockImplementation(() => true);
    seedOrderDoc(map, ["overlay1", "base1"]);
    const m = new LayerController(map, [
      { id: "overlay1", name: "O", role: "overlay", layer: { options: {} } },
      { id: "base1", name: "B", role: "base", layer: { options: {} } },
    ]);
    m.map.hasLayer.mockReturnValue(false);

    m.deleteLayer("overlay1");

    expect(save).toHaveBeenCalledWith(
      orderKeyOf(map),
      expect.anything(),
      "LayerControl",
    );
    const doc = save.mock.calls.find(c => c[0] === orderKeyOf(map))?.[1] as any;
    expect(doc.nodes["layer:overlay1"].hidden).toBe(true);
    save.mockRestore();
    vi.useRealTimers();
  });

  it("deleteLayer freezes the folder order before the last member leaves", () => {
    // Removing the last member of a folder must materialise the role's
    // block order into layout.order BEFORE the
    // removal (PRE-removal snapshot), so the emptied folder keeps its block
    // position instead of the order becoming self-contradictory.
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({
      id: "rd1",
      name: "Roads",
      role: "overlay",
      folder: "Roads",
    });
    manager.map.hasLayer.mockReturnValue(false);

    expect(manager.deleteLayer("rd1")).toBe(true);
    expect(manager.folderView.order.overlay).toContain("roads");
  });

  it("deleteLayer does not freeze a folder that still has a member", () => {
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({
      id: "rd1",
      name: "Roads",
      role: "overlay",
      folder: "Roads",
    });
    manager.registerLayer({
      id: "rd2",
      name: "Roads 2",
      role: "overlay",
      folder: "Roads",
    });
    manager.map.hasLayer.mockReturnValue(false);

    expect(manager.deleteLayer("rd1")).toBe(true);
    // The folder still has rd2, so its block survives by construction.
    expect(manager.folderView.order.overlay ?? []).toContain("roads");
  });

  it("deleteLayer freezes a base folder's block order too", () => {
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({
      id: "b1",
      name: "Base Roads",
      role: "base",
      folder: "Roads",
    });
    manager.map.hasLayer.mockReturnValue(false);

    expect(manager.deleteLayer("b1")).toBe(true);
    expect(manager.folderView.order.base).toContain("roads");
  });

  it("never builds a layer the user deleted", () => {
    // The registry is built from the initial data before anything registers at
    // runtime, so the discovery path has to be gated as well: gating
    // registerLayer alone would still put a deleted layer back into the panel
    // on the next reload.
    window.localStorage.setItem(
      orderKeyOf(map),
      JSON.stringify({
        nodes: {
          "layer:gone": { kind: "layer", parent: null, rank: "a0", hidden: true },
          "layer:kept": { kind: "layer", parent: null, rank: "a1" },
        },
      }),
    );
    const m = new LayerController(map, [
      { id: "gone", name: "G", role: "overlay", layer: { options: {} } },
      { id: "kept", name: "K", role: "overlay", layer: { options: {} } },
    ]);

    expect(m.layers.map(l => l.id)).toEqual(["kept"]);
  });

  it("evicts a deleted layer from the map at construction", () => {
    // Gating registration only removes the layer from the panel. The layer
    // itself is still painted: folium emits `addTo(map)` for every layer at
    // page load, so a reload re-adds a deleted layer exactly as before the
    // delete. Without the eviction the panel shows it gone and the map keeps
    // drawing it — the user's delete did nothing.
    window.localStorage.setItem(
      orderKeyOf(map),
      JSON.stringify({
        nodes: {
          "layer:gone": { kind: "layer", parent: null, rank: "a0", hidden: true },
          "layer:kept": { kind: "layer", parent: null, rank: "a1" },
        },
      }),
    );
    const gone = { options: {} };
    map._layers["gone"] = gone;
    map.hasLayer = vi.fn(l => l === gone);
    const removeLayer = vi.fn();
    map.removeLayer = removeLayer;
    const m = new LayerController(map, [
      { id: "gone", name: "G", role: "overlay" },
      { id: "kept", name: "K", role: "overlay" },
    ]);

    expect(m.layers.map(l => l.id)).toEqual(["kept"]);
    expect(removeLayer).toHaveBeenCalledWith(gone);
  });

  it("re-registering a user-deleted id restores it, without throwing", () => {
    // The delete is a hidden doc node (the reversible tombstone), not a
    // refused id: re-registering the same id un-hides the node and returns
    // the layer to its original slot. An exception would take down whatever
    // was registering (a rebuild loop, a late Heatmap/Measure component).
    window.localStorage.setItem(
      orderKeyOf(map),
      JSON.stringify({
        nodes: {
          "layer:gone": { kind: "layer", parent: null, rank: "a0", hidden: true },
        },
      }),
    );
    const m = new LayerController(map, [
      { id: "kept", name: "K", role: "overlay", layer: { options: {} } },
    ]);

    expect(() => m.registerLayer({ id: "gone", name: "G" })).not.toThrow();
    expect(m.layerRegistry.get("gone")).toBeDefined();
    const stored = readOrderTreeStorage(map)!;
    expect(stored.nodes["layer:gone"]?.hidden).toBeUndefined();
  });

  it("still accepts an id that is not in removed", () => {
    // The guard is keyed on the deleted list only: an unrelated stored id must
    // not start getting refused.
    window.localStorage.setItem(
      orderKeyOf(map),
      JSON.stringify({
        nodes: {
          "layer:gone": { kind: "layer", parent: null, rank: "a0", hidden: true },
        },
      }),
    );
    const m = new LayerController(map, [
      { id: "kept", name: "K", role: "overlay", layer: { options: {} } },
    ]);

    m.registerLayer({ id: "other", name: "Other" });
    expect(m.layerRegistry.get("other")).toBeDefined();
  });

  describe("deleteLayer — component ownership", () => {
    it("early-returns for a component layer, emits LAYER_DELETED, and keeps the id registerable", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.registerLayer({
        id: "measure1",
        name: "Measure",
        layer: { options: {} },
        styleSetters: { color: vi.fn() },
      } as any);
      const bus = map.foliplus!.events;
      const handler = vi.fn();
      bus.on(EVENTS.LAYER_DELETED, handler);
      const unregisterSpy = vi.spyOn(manager, "unregisterLayer");

      expect(manager.deleteLayer("measure1")).toBe(true);

      expect(handler).toHaveBeenCalledWith(
        { id: "measure1" },
        { origin: { kind: "system", via: "teardown" } },
      );
      expect(unregisterSpy).not.toHaveBeenCalled();
      expect(manager.layerRegistry.has("measure1")).toBe(true);
      expect(
        (readOrderTreeStorage(map)?.nodes["layer:measure1"] as any)?.hidden,
      ).toBeUndefined();
    });

    it("prunes the component's stored state too, so a redraw starts clean", () => {
      // The component's own LAYER_DELETED handler wipes its canvas and its
      // saved config; without this half LayerControl kept the intent row, so a
      // redraw inherited the previous draw's opacity and visibility.
      manager.map.hasLayer.mockReturnValue(false);
      const save = vi.fn(() => saveState(manager.ui!));
      const store = makeStore(
        {
          measure1: { visible: false, opacity: 0.35 },
          overlay1: { visible: false, opacity: 0.4 },
        },
        { measure1: ["visible", "opacity"], overlay1: ["visible", "opacity"] },
      );
      manager.intentStore = store;
      manager.ui = makeDerivedUI({
        c: manager,
        listPanel: {} as never,
        intentStore: store,
        dropPersistedLayerState: (id: string) =>
          dropPersistedLayerState(manager.ui!, id),
        saveState: save,
        saveNamesState: vi.fn(),
        invalidateFields: vi.fn(),
      }) as any;
      manager.registerLayer({
        id: "measure1",
        name: "Measure",
        layer: { options: {} },
        styleSetters: { color: vi.fn() },
      } as any);

      expect(manager.deleteLayer("measure1")).toBe(true);

      expect(getIntent(manager.ui!, "measure1", "visible")).toBeUndefined();
      expect(getIntent(manager.ui!, "measure1", "opacity")).toBeUndefined();
      // A sibling keeps its tuning: this is a clear, not a sweep.
      expect(getIntent(manager.ui!, "overlay1", "visible")).toBe(false);
      expect(getIntent(manager.ui!, "overlay1", "opacity")).toBe(0.4);
      expect(
        (readOrderTreeStorage(map)?.nodes["layer:measure1"] as any)?.hidden,
      ).toBeUndefined();
      expect(save).toHaveBeenCalledTimes(1);
    });

    it("retires a user layer and records the removed id", () => {
      manager.map.hasLayer.mockReturnValue(false);

      expect(manager.deleteLayer("overlay1")).toBe(true);

      expect(manager.layerRegistry.has("overlay1")).toBe(false);
      expect((readOrderTreeStorage(map)?.nodes["layer:overlay1"] as any)?.hidden).toBe(
        true,
      );
    });

    it("returns false when the entry is already gone", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.unregisterLayer("overlay1");

      expect(manager.deleteLayer("overlay1")).toBe(false);
      expect(
        (readOrderTreeStorage(map)?.nodes["layer:overlay1"] as any)?.hidden,
      ).toBeUndefined();
    });

    it("syncs toggle-all and no-basemap state after deleting a base layer", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.ui = makeDerivedUI({
        intentStore: makeStore(),
        dropPersistedLayerState: vi.fn(),
        saveState: vi.fn(),
        renamedNames: {},
        saveNamesState: vi.fn(),
        invalidateFields: vi.fn(),
      }) as any;
      const emitSpy = vi.spyOn(manager.events, "emitSettled");

      expect(manager.deleteLayer("base1")).toBe(true);

      expect(emitSpy).toHaveBeenCalledWith(
        EVENTS.LAYER_ROLE_COUNT_CHANGED,
        {
          role: ROLE.BASE,
        },
        { kind: "system", via: "teardown" },
      );
      expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_NO_BASEMAP_CHANGED, {
        kind: "system",
        via: "teardown",
      });
    });

    it("clears the color basemap — unregisters but keeps the id registerable", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.registerLayer({
        id: CONST.SOLID_BASEMAP_ID,
        name: "color",
        role: "base",
        layer: { options: {} },
      } as any);

      const resetSpy = vi.fn();
      manager.ui = makeDerivedUI({
        intentStore: makeStore(),
        resetSolidBasemap: resetSpy,
        invalidateFields: vi.fn(),
      }) as any;
      const emitSpy = vi.spyOn(manager.events, "emitSettled");

      expect(manager.deleteLayer(CONST.SOLID_BASEMAP_ID)).toBe(true);

      expect(manager.layerRegistry.has(CONST.SOLID_BASEMAP_ID)).toBe(false);
      expect(resetSpy).toHaveBeenCalled();
      expect(emitSpy).toHaveBeenCalledWith(
        EVENTS.LAYER_ROLE_COUNT_CHANGED,
        {
          role: ROLE.BASE,
        },
        { kind: "system", via: "teardown" },
      );
      expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_NO_BASEMAP_CHANGED, {
        kind: "system",
        via: "teardown",
      });
      expect(
        (readOrderTreeStorage(map)?.nodes["layer:color"] as any)?.hidden,
      ).toBeUndefined();
    });

    it("clears the color basemap without a panel attached", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.registerLayer({
        id: CONST.SOLID_BASEMAP_ID,
        name: "color",
        role: "base",
        layer: { options: {} },
      } as any);
      manager.ui = null;

      expect(manager.deleteLayer(CONST.SOLID_BASEMAP_ID)).toBe(true);

      expect(manager.layerRegistry.has(CONST.SOLID_BASEMAP_ID)).toBe(false);
      expect(
        (readOrderTreeStorage(map)?.nodes["layer:color"] as any)?.hidden,
      ).toBeUndefined();
    });

    it("returns false when the color basemap cannot be unregistered", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.registerLayer({
        id: CONST.SOLID_BASEMAP_ID,
        name: "color",
        role: "base",
        layer: { options: {} },
      } as any);
      manager.layerRegistry.remove(CONST.SOLID_BASEMAP_ID);

      expect(manager.deleteLayer(CONST.SOLID_BASEMAP_ID)).toBe(false);
      expect(
        (readOrderTreeStorage(map)?.nodes["layer:color"] as any)?.hidden,
      ).toBeUndefined();
    });

    it("removes the overlay toggle-all row when the last overlay layer is deleted", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.uiContainer = document.createElement("div");
      manager.uiContainer.innerHTML = `
        <div class="foliplus-layer-toggle-all" data-role="overlay">
          <div class="foliplus-checkbox"><input type="checkbox" data-role="toggle-all" /></div>
        </div>
        <div class="foliplus-layer-item" data-layer-id="overlay1" data-layer-type="overlay"></div>
        <div class="foliplus-layer-toggle-all" data-role="base">
          <div class="foliplus-checkbox"><input type="checkbox" data-role="toggle-all" /></div>
        </div>
        <div class="foliplus-layer-item" data-layer-id="base1" data-layer-type="base"></div>
      `;
      manager.ui = makeDerivedUI({
        intentStore: makeStore(),
        dropPersistedLayerState: vi.fn(),
        saveState: vi.fn(),
        syncToggleAll: vi.fn(),
        syncNoBasemap: vi.fn(),
        renamedNames: {},
        saveNamesState: vi.fn(),
        invalidateFields: vi.fn(),
      }) as any;

      expect(manager.deleteLayer("overlay1")).toBe(true);

      expect(
        manager.uiContainer.querySelector(
          `.foliplus-layer-toggle-all[data-role="overlay"]`,
        ),
      ).toBeNull();
      expect(
        manager.uiContainer.querySelector(
          `.foliplus-layer-toggle-all[data-role="base"]`,
        ),
      ).not.toBeNull();
    });

    it("removes the base toggle-all row when the last non-color base layer is deleted", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.registerLayer({
        id: CONST.SOLID_BASEMAP_ID,
        name: "color",
        role: "base",
        layer: { options: {} },
      } as any);
      manager.uiContainer = document.createElement("div");
      manager.uiContainer.innerHTML = `
        <div class="foliplus-layer-item" data-layer-id="overlay1" data-layer-type="overlay"></div>
        <div class="foliplus-layer-toggle-all" data-role="base">
          <div class="foliplus-checkbox"><input type="checkbox" data-role="toggle-all" /></div>
        </div>
        <div class="foliplus-layer-item" data-layer-id="base1" data-layer-type="base"></div>
        <div class="foliplus-layer-item" data-layer-id="${CONST.SOLID_BASEMAP_ID}" data-layer-type="base"></div>
      `;
      manager.ui = makeDerivedUI({
        intentStore: makeStore(),
        runtimeStore: (() => {
          const s = new LayerRuntimeStore();
          s.setAuthorVisible(CONST.SOLID_BASEMAP_ID, true);
          return s;
        })(),
        colorSurface: {} as any,
        currentColor: "#ff0000",
        dropPersistedLayerState: vi.fn(),
        saveState: vi.fn(),
        syncToggleAll: vi.fn(),
        syncNoBasemap: vi.fn(),
        renamedNames: {},
        saveNamesState: vi.fn(),
        invalidateFields: vi.fn(),
      }) as any;

      expect(manager.deleteLayer("base1")).toBe(true);

      expect(
        manager.uiContainer.querySelector(`[data-role="base"][data-role="toggle-all"]`),
      ).toBeNull();
      expect(
        manager.uiContainer.querySelector(
          `[data-layer-id="${CONST.SOLID_BASEMAP_ID}"]`,
        ),
      ).not.toBeNull();
    });
  });
});

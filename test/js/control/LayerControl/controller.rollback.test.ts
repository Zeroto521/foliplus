// test/js/control/LayerControl/controller.rollback — commit failures, pricing and rollback.
import {
  createLayerControllerFixture,
  teardownLayerControllerFixture,
} from "./controller.fixture.js";
import { attachedPanel, initFixture } from "./ui/fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { orderKeyOf } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { LayerController } from "#control/LayerControl/controller.js";

describe("LayerController", () => {
  let manager: LayerController;
  let map: any;

  beforeEach(() => {
    ({ manager, map } = createLayerControllerFixture());
  });

  afterEach(() => {
    teardownLayerControllerFixture(manager);
  });

  it("BEFORE_EXPORT warns when a layer cannot be priced, and the capture still runs", () => {
    // The pass isolates layers, so the export continues either way — but a
    // stale z in the capture is invisible in the image, so it must be logged.
    // `env.log` defaults to one shared logger for every controller built with
    // the no-op env, so the spy is restored rather than left in place.
    const log = (manager as any).log as { warn: (...args: unknown[]) => void };
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    const order = vi
      .spyOn(manager, "enforceOrder")
      .mockReturnValue({ failed: ["bad", "worse"], skipped: false });
    const captured: string[] = [];
    const off = manager.events.on(EVENTS.BEFORE_EXPORT as string, () =>
      captured.push("capture"),
    );

    try {
      manager.events.publish(EVENTS.BEFORE_EXPORT as string);

      expect(warn).toHaveBeenCalledWith(
        "enforceOrder failed for 2 layer(s) before export: bad, worse",
      );
      expect(captured).toEqual(["capture"]);
    } finally {
      off();
      warn.mockRestore();
      order.mockRestore();
    }
  });

  it("a runtime content change routes through invalidateType and the live count", () => {
    // clearLayers is how a group empties itself; the factory must invalidate the
    // cached type and refresh the count column, not just drop the layers.
    const invalidate = vi.spyOn(manager, "invalidateType").mockImplementation(() => {});
    const refresh = vi.spyOn(manager, "refreshCount").mockImplementation(() => {});
    const api = manager.createLayers({
      id: "g3",
      name: "Group",
      panes: [{ name: "g3_sub" }],
    });
    api.register();
    api.addLayer({ options: {} } as any, "g3_sub");
    api.clearLayers();
    expect(invalidate).toHaveBeenCalledWith("g3");
    expect(refresh).toHaveBeenCalledWith("g3");
  });

  it("re-registering a user-deleted id restores it and prices the pane", () => {
    // The delete is a hidden doc node (the reversible tombstone), not a
    // refused id: re-registering the same id un-hides it, re-enters the
    // registry, and prices the pane the component pre-mounted.
    window.localStorage.setItem(
      orderKeyOf(map),
      JSON.stringify({
        nodes: {
          "layer:gone": { kind: "layer", parent: null, rank: "a0", hidden: true },
        },
      }),
    );
    window.L.DomUtil = { getPosition: vi.fn(() => ({ x: 0, y: 0 })) };
    map.getPanes = vi.fn(() => ({ mapPane: document.createElement("div") }));
    const m2 = new LayerController(map, [
      { id: "kept", name: "K", role: "overlay", layer: { options: {} } },
    ]);
    try {
      const api = m2.createCanvas({ id: "gone" });
      expect(() => api.register()).not.toThrow();
      expect(m2.layerRegistry.has("gone")).toBe(true);
      expect(((m2 as any).orderDoc.nodes["layer:gone"] as any)?.hidden).toBeUndefined();
      expect(api.canvas.parentElement).toBeTruthy();
      api.destroy();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("a refused canvas pane does not mask the role gate's error", () => {
    // P2-1: a foreign element already occupies the canvas pane name, so
    // mountFace leaves facePane null. The registration then fails the role
    // gate; the rollback must not dereference the pane it never got, or the
    // caller sees a TypeError instead of the role error.
    const { manager } = initFixture({
      data: [{ id: "A", name: "A", role: "base" }],
    });
    const foreignPane = document.createElement("div");
    foreignPane.appendChild(document.createElement("canvas"));
    const paneName = "foliplus-canvas-A";
    const realGetPane = manager.map.getPane;
    manager.map.getPane = vi.fn((name: string) =>
      name === paneName ? foreignPane : realGetPane(name),
    );

    const canvas = manager.createCanvas({ id: "A", name: "A" });

    expect(() => canvas.register()).toThrow(/role change/);
    expect(canvas.registered()).toBe(false);
    expect(canvas.canvas.parentElement).toBeNull();
    // The refused pane kept only its own content.
    expect(foreignPane.childElementCount).toBe(1);

    // A second attempt re-runs the transaction and still reports the role
    // error: the failed rollback did not poison the surface.
    expect(() => canvas.register()).toThrow(/role change/);
  });

  it("a registration that throws after commit drops its own entry", () => {
    // The controller commits the registry entry before the notification
    // fan-out; a throwing consumer makes registerLayer throw after that
    // commit. The factory's rollback must still remove the entry it committed,
    // or the id stays registered with no surface painting it.
    const { manager, ui } = initFixture({
      data: [{ id: "base1", name: "OSM", role: "base" }],
    });
    const canvas = manager.createCanvas({ id: "heat", name: "Heat" });
    ui.events.on(EVENTS.LAYER_ITEM_ADDED, payload => {
      if (payload.id === "heat") throw new Error("notify boom");
    });

    expect(() => canvas.register()).toThrow("notify boom");

    expect(canvas.registered()).toBe(false);
    expect(canvas.canvas.parentElement).toBeNull();
    expect(manager.layerRegistry.has("heat")).toBe(false);
  });

  it("a failed registration leaves a same-id replacement alone", () => {
    // A subscriber can retire the committed entry and install a replacement
    // inside the same fan-out. The rollback must compare the commit token's
    // identity, not the id, or it deletes the replacement's entry.
    const { manager, ui } = initFixture({
      data: [{ id: "base1", name: "OSM", role: "base" }],
    });
    const canvas = manager.createCanvas({ id: "heat", name: "Heat" });
    let swapped = false;
    ui.events.on(EVENTS.LAYER_ITEM_ADDED, payload => {
      if (payload.id !== "heat" || swapped) return;
      swapped = true;
      manager.unregisterLayer("heat");
      manager.registerLayer({ id: "heat", name: "Replacement" });
      throw new Error("notify boom");
    });

    expect(() => canvas.register()).toThrow("notify boom");

    expect(canvas.registered()).toBe(false);
    expect(manager.layerRegistry.get("heat")?.name).toBe("Replacement");
  });

  it("a registration retired and replaced without a throw fails closed", () => {
    // P2-1b: the same-id swap does not have to throw. The controller's retired
    // path returns null after the notify, so the factory's catch never runs —
    // and the old read-back leased the replacement's entry as this surface's
    // own. The outer unregister then deleted the replacement by bare id.
    const { manager, ui } = initFixture({
      data: [{ id: "base1", name: "OSM", role: "base" }],
    });
    const canvas = manager.createCanvas({ id: "heat", name: "Heat" });
    let swapped = false;
    ui.events.on(EVENTS.LAYER_ITEM_ADDED, payload => {
      if (payload.id !== "heat" || swapped) return;
      swapped = true;
      manager.unregisterLayer("heat");
      manager.registerLayer({ id: "heat", name: "Replacement" });
    });

    expect(() => canvas.register()).not.toThrow();

    expect(canvas.registered()).toBe(false);
    expect(canvas.canvas.parentElement).toBeNull();
    expect(manager.layerRegistry.get("heat")?.name).toBe("Replacement");

    // The failed registration holds no authority over the id.
    canvas.unregister();
    expect(manager.layerRegistry.get("heat")?.name).toBe("Replacement");
  });

  it("a registration whose materialize throws drops its committed entry", () => {
    // P1c: the commit token used to be handed over only after registerEntry
    // returned, so a throw inside it (pane materialize / DOM work) left a
    // committed registry entry the factory never learned about — a ghost with
    // no row and no surface to reclaim it.
    const { manager } = initFixture({
      data: [{ id: "base1", name: "OSM", role: "base" }],
    });
    const canvas = manager.createCanvas({ id: "heat", name: "Heat" });
    const surfaceFor = vi.spyOn(manager.domain, "surfaceFor").mockReturnValue({
      materialize: () => {
        throw new Error("materialize boom");
      },
    } as never);

    expect(() => canvas.register()).toThrow("materialize boom");

    expect(canvas.registered()).toBe(false);
    expect(canvas.canvas.parentElement).toBeNull();
    expect(manager.layerRegistry.has("heat")).toBe(false);
    surfaceFor.mockRestore();
  });

  it("announces no LAYER_CHANGE for a registration that rolls back", () => {
    // P2-6: the projection CHANGE (absorbed from applyUserState) and the
    // registration CHANGE used to go out after the failing notify, so a
    // consumer that re-reads the registry saw the layer appear and then vanish.
    // A CHANGE for an id that is still registered at delivery time is exactly
    // that ghost announcement; only the rollback's retirement retraction (the
    // id is gone by then) may survive.
    const { manager, ui } = initFixture({
      data: [{ id: "base1", name: "OSM", role: "base" }],
    });
    const canvas = manager.createCanvas({ id: "heat", name: "Heat" });
    const announcements: { id: string; registered: boolean }[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, payload =>
      announcements.push({
        id: payload.id,
        registered: manager.layerRegistry.has(payload.id),
      }),
    );
    let thrown = false;
    ui.events.on(EVENTS.LAYER_ITEM_ADDED, payload => {
      if (payload.id !== "heat" || thrown) return;
      thrown = true;
      throw new Error("notify boom");
    });

    expect(() => canvas.register()).toThrow("notify boom");

    expect(canvas.registered()).toBe(false);
    expect(manager.layerRegistry.has("heat")).toBe(false);
    expect(announcements.filter(entry => entry.registered)).toEqual([]);
  });

  it("an old owner cannot unregister a same-id replacement and still ends in its terminal state", () => {
    const { manager } = initFixture({
      data: [{ id: "A", name: "A", role: "overlay" }],
    });
    const first = manager.createCanvas({ id: "A", name: "A" });
    first.register();
    expect(first.registered()).toBe(true);

    // A second surface replaces the entry under the same id; the first
    // owner's lease has lapsed.
    const second = manager.createCanvas({ id: "A", name: "A2" });
    second.register();
    first.unregister();

    // The registry stays with the replacement, and the lapsed surface ends
    // in its terminal state: not registered anymore, face hidden — the old
    // canvas must not keep drawing under the replacement's.
    expect(manager.layerRegistry.has("A")).toBe(true);
    expect(first.registered()).toBe(false);
    expect(first.canvas.classList.contains("hidden")).toBe(true);

    second.unregister();
    expect(manager.layerRegistry.has("A")).toBe(false);
  });

  it("a failing pricing pass still saves the order tree it committed", () => {
    // commitReorder's local-commit rule: the persisted order agrees with the
    // live registry whatever happens to the steps that follow the registry
    // move — a throwing pricing pass must not leave the record lagging.
    const { manager, ui } = initFixture({
      data: [
        { id: "A", name: "A", role: "overlay" },
        { id: "B", name: "B", role: "overlay" },
      ],
    });
    const changes: string[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, p => changes.push(p.id));
    vi.spyOn(manager, "enforceOrder").mockImplementation(() => {
      throw new Error("order boom");
    });
    const save = vi.spyOn(manager, "saveOrder");

    expect(() => manager.moveLayerUp("B")).toThrow("order boom");

    // The save is an owed step, not an alternative: finalize runs it even
    // though the pricing pass threw.
    expect(save).toHaveBeenCalledTimes(1);
    expect(manager.layers[0].id).toBe("B");
    const docRoots = Object.entries(
      ((manager as any).orderDoc?.nodes ?? {}) as Record<string, any>,
    )
      .filter(([, n]) => n.parent === null && n.kind === "layer")
      .sort((a, b) => (a[1].rank as string).localeCompare(b[1].rank as string))
      .map(([k]) => k.replace(/^layer:/, ""));
    expect(docRoots[0]).toBe("B");
    // The rows follow the committed arrangement too: a stale panel was the
    // visible half of the old failure path, and the row-order signal now
    // lands before the error surfaces.
    expect(
      Array.from(
        attachedPanel(ui).querySelectorAll<HTMLElement>(CONST.SEL.LEAF_ITEM),
      ).map(el => el.dataset.layerId),
    ).toEqual(manager.layers.map(l => l.id));
    // The operation still never opened: no announcement for a half-committed move.
    expect(changes).toEqual([]);
  });

  it("syncs rows when only saveOrder fails, then throws the save error", () => {
    const { manager, ui } = initFixture({
      data: [
        { id: "A", name: "A", role: "overlay" },
        { id: "B", name: "B", role: "overlay" },
      ],
    });
    const changes: string[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, p => changes.push(p.id));
    vi.spyOn(manager, "saveOrder").mockImplementation(() => {
      throw new Error("save boom");
    });

    expect(() => manager.moveLayerUp("B")).toThrow("save boom");

    // The registry move is a local commit: rows follow it even though the
    // persisted snapshot failed, and no CHANGE is announced for the partial
    // commit (the operation never opens).
    expect(manager.layers[0].id).toBe("B");
    expect(
      Array.from(
        attachedPanel(ui).querySelectorAll<HTMLElement>(CONST.SEL.LEAF_ITEM),
      ).map(el => el.dataset.layerId),
    ).toEqual(manager.layers.map(l => l.id));
    expect(changes).toEqual([]);
  });

  it("reports both commit failures and throws the first one", () => {
    const { manager, ui } = initFixture({
      data: [
        { id: "A", name: "A", role: "overlay" },
        { id: "B", name: "B", role: "overlay" },
      ],
    });
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});
    vi.spyOn(manager, "enforceOrder").mockImplementation(() => {
      throw new Error("order boom");
    });
    vi.spyOn(manager, "saveOrder").mockImplementation(() => {
      throw new Error("save boom");
    });

    expect(() => manager.moveLayerUp("B")).toThrow("order boom");

    // Both owed steps ran, and the second failure is recorded instead of
    // replacing the first.
    expect(warn).toHaveBeenCalledWith(
      'reorder commit step "save-order" failed after an earlier error',
      expect.any(Error),
    );
    expect(
      Array.from(
        attachedPanel(ui).querySelectorAll<HTMLElement>(CONST.SEL.LEAF_ITEM),
      ).map(el => el.dataset.layerId),
    ).toEqual(manager.layers.map(l => l.id));
    warn.mockRestore();
  });

  it("a pre-attach pricing failure syncs nothing and still rethrows", () => {
    // No UI yet: the failure path still owes the rethrow but has no panel to
    // signal. This is the coin's other side of the attached-failure tests.
    const m = new LayerController(map, [
      { id: "A", name: "A", role: "overlay" },
      { id: "B", name: "B", role: "overlay" },
    ]);
    vi.spyOn(m, "enforceOrder").mockImplementation(() => {
      throw new Error("order boom");
    });

    expect(() => m.moveLayerUp("B")).toThrow("order boom");
    expect(m.layers[0].id).toBe("B");
  });

  it("a throwing row-sync subscriber cannot replace the commit error", () => {
    const { manager, ui } = initFixture({
      data: [
        { id: "A", name: "A", role: "overlay" },
        { id: "B", name: "B", role: "overlay" },
      ],
    });
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});
    vi.spyOn(manager, "enforceOrder").mockImplementation(() => {
      throw new Error("order boom");
    });
    ui.events.on(EVENTS.LAYER_LIST_REBUILD, () => {
      throw new Error("sync boom");
    });

    expect(() => manager.moveLayerUp("B")).toThrow("order boom");

    expect(warn).toHaveBeenCalledWith(
      "reorder panel sync failed after a commit error",
      expect.any(Error),
    );
    warn.mockRestore();
  });
});

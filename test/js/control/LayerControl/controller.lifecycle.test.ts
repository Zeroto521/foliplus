// test/js/control/LayerControl/controller.lifecycle — the announce fan-out of lifecycle operations.
import {
  createLayerControllerFixture,
  makeStore,
  stableStamp,
  teardownLayerControllerFixture,
} from "./controller.fixture.js";
import {
  attachWithGroup,
  attachedPanel,
  initFixture,
  makeDerivedUI,
  polygonLayer,
  trackMembership,
} from "./ui/fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { ROLE } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { LayerController } from "#control/LayerControl/controller.js";
import { setIntent } from "#control/LayerControl/ui/intent.js";

// ── Notification-contract cases, moved from the former
// ── notifyContract.test.ts so they live with the script they drive. ──
it("a registration announces after the group count has settled", () => {
  // The registration entry inserts the row, replays the stored state,
  // refreshes the row cells and syncs the group count before it publishes —
  // so the first CHANGE the new layer gets out already names the full
  // group. Announcing from the row insertion itself would have handed a
  // subscriber the count taken before that row existed.
  const { ui, manager } = initFixture({
    data: [
      { id: "one", name: "One", role: "overlay", layer: polygonLayer() },
      { id: "two", name: "Two", role: "overlay", layer: polygonLayer() },
      {
        id: "three",
        name: "Three",
        role: "overlay",
        layer: polygonLayer(),
      },
    ],
  });
  // The header checkbox is the group count: 3 of 3 reads "all on".
  const headerState = () => {
    const row = ui.uiContainer!.querySelector(
      `.foliplus-layer-toggle-all[data-role="${ROLE.OVERLAY}"]`,
    );
    const cb = row?.querySelector(
      '[data-role="toggle-all"]',
    ) as HTMLInputElement | null;
    return {
      checked: cb?.checked ?? null,
      indeterminate: cb?.indeterminate ?? null,
    };
  };
  expect(headerState()).toEqual({ checked: true, indeterminate: false });

  // The late layer arrives already hidden: a stored dimension is the only
  // state a late registration can carry, and it is the delta the entry
  // holds until the row and the count have settled.
  setIntent(ui, "fourth", "visible", false);
  ui.intentStore.seedProvenance("fourth", ["visible"]);

  const headersAtDelivery: {
    checked: boolean | null;
    indeterminate: boolean | null;
  }[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    if (payload.id !== "fourth") return;
    headersAtDelivery.push(headerState());
  });

  manager.registerLayer({
    id: "fourth",
    name: "Fourth",
    role: "overlay",
    layer: polygonLayer(),
  });

  expect(headersAtDelivery.length).toBeGreaterThan(0);
  // 3 of 4 visible: the header is partial, not "all on" — the count settled
  // before the announce.
  expect(headersAtDelivery[0]).toEqual({
    checked: false,
    indeterminate: true,
  });
});

it("a register whose notify destroys the control returns null", () => {
  // The projection delta goes out last, but before the entry returns it still
  // publishes the separate registration CHANGE and reads the row back out of
  // the container. A subscriber that tears the control down inside that
  // notify takes the container and the registry with it: a second emission
  // would announce for an entry that no longer exists, and the row lookup
  // would deref a null container.
  const { ui, manager } = initFixture();
  const layer = polygonLayer();
  // Tracked membership keeps the projection's diff real instead of a
  // constant, and leaves the teardown sweep with nothing new to say: the
  // one delivery below is the projection's, so a registration CHANGE would
  // show up as a second.
  const onMap = trackMembership(ui.c.map);
  onMap.set(layer, true);
  // A stored dimension is what gives the projection something to write — a
  // late registration arrives hidden, and that flip is the delta the
  // subscriber tears down on.
  setIntent(ui, "fourth", "visible", false);
  ui.intentStore.seedProvenance("fourth", ["visible"]);

  let deliveries = 0;
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    if (payload.id !== "fourth") return;
    deliveries += 1;
    if (deliveries === 1) ui.c.destroy();
  });

  expect(
    manager.registerLayer({
      id: "fourth",
      name: "Fourth",
      role: "overlay",
      layer,
    }),
  ).toBeNull();
  expect(deliveries).toBe(1);
  expect(onMap.get(layer)).toBe(false);
  expect(ui.c.isDestroyed).toBe(true);
});

it("a register whose notify unregisters the entry returns null", () => {
  // The same boundary with the entry retired instead of the control: the id
  // is mapped to nothing, so the registration CHANGE would announce for a
  // layer that is already gone. Two CHANGEs are expected — the projection's,
  // then the unregister's own — not a third for the registration.
  const { ui, manager } = initFixture();

  setIntent(ui, "second", "visible", false);
  ui.intentStore.seedProvenance("second", ["visible"]);

  const changes: string[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    changes.push(payload.id);
    if (payload.id === "second" && changes.length === 1) {
      manager.unregisterLayer("second");
    }
  });

  expect(
    manager.registerLayer({
      id: "second",
      name: "Second",
      role: "overlay",
      layer: polygonLayer(),
    }),
  ).toBeNull();
  expect(changes).toEqual(["second", "second"]);
  expect(ui.c.layerRegistry.has("second")).toBe(false);
});

it("a register whose final notify destroys the control returns null", () => {
  // A layer that is already on the map and has no stored dimension carries no
  // projection delta, so the registration CHANGE is its only notify. It is
  // the last statement before the row is read back out of the container: a
  // subscriber that tears the control down there leaves a null container, and
  // the row lookup is reached by nothing else.
  const { ui, manager } = initFixture();
  const layer = polygonLayer();
  // Tracked membership keeps the teardown sweep from gaining a second opinion
  // about this layer, so the one delivery below is the registration's and a
  // spurious emit would show up as another.
  const onMap = trackMembership(ui.c.map);
  onMap.set(layer, true);

  let deliveries = 0;
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    if (payload.id !== "fourth") return;
    deliveries += 1;
    if (deliveries === 1) ui.c.destroy();
  });

  expect(
    manager.registerLayer({
      id: "fourth",
      name: "Fourth",
      role: "overlay",
      layer,
    }),
  ).toBeNull();
  expect(deliveries).toBe(1);
  expect(ui.c.isDestroyed).toBe(true);
  expect(ui.uiContainer).toBeNull();
});

it("a register whose final notify destroys the control after a projection delta returns null", () => {
  // The saved range hides the layer, so the registration carries a real
  // projection delta and gets two notifies: the projection's first, then its
  // own registration CHANGE. Tearing the control down in the second one
  // exercises the same boundary on the path that already had one notify.
  const { ui, manager } = initFixture();
  const layer = polygonLayer();
  const onMap = trackMembership(ui.c.map);
  onMap.set(layer, true);
  setIntent(ui, "fourth", "zoomRange", [0, 1]);
  ui.intentStore.seedProvenance("fourth", ["zoomRange"]);

  let deliveries = 0;
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    if (payload.id !== "fourth") return;
    deliveries += 1;
    if (deliveries === 2) ui.c.destroy();
  });

  expect(
    manager.registerLayer({
      id: "fourth",
      name: "Fourth",
      role: "overlay",
      layer,
    }),
  ).toBeNull();
  expect(deliveries).toBe(2);
  expect(onMap.get(layer)).toBe(false);
  expect(ui.c.isDestroyed).toBe(true);
});

it("a register whose final notify unregisters the entry returns null", () => {
  // The entry retired instead of the control, and by the registration's own
  // notify rather than the projection's: two CHANGEs are expected — the
  // registration's, then the unregister's own — not a third.
  const { ui, manager } = initFixture();
  const layer = polygonLayer();
  const onMap = trackMembership(ui.c.map);
  onMap.set(layer, true);

  const changes: string[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    if (payload.id !== "second") return;
    changes.push(payload.id);
    if (changes.length === 1) manager.unregisterLayer("second");
  });

  expect(
    manager.registerLayer({
      id: "second",
      name: "Second",
      role: "overlay",
      layer,
    }),
  ).toBeNull();
  expect(changes).toEqual(["second", "second"]);
  expect(ui.c.layerRegistry.has("second")).toBe(false);
});

it("a register replaced under the same id inside the final notify returns null", () => {
  // A re-registration with the same id replaces the entry this call created,
  // so handing back its row would hand back another instance's row. The inner
  // call carries no projection delta of its own, so it announces only once
  // and the outer call is left to notice the swap.
  const { ui, manager } = initFixture();
  const onMap = trackMembership(ui.c.map);
  const layer = polygonLayer();
  onMap.set(layer, true);
  const replacement = polygonLayer();

  const changes: string[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    if (payload.id !== "second") return;
    changes.push(payload.id);
    if (changes.length === 1) {
      manager.registerLayer({
        id: "second",
        name: "Second",
        role: "overlay",
        layer: replacement,
      });
    }
  });

  expect(
    manager.registerLayer({
      id: "second",
      name: "Second",
      role: "overlay",
      layer,
    }),
  ).toBeNull();
  expect(changes).toEqual(["second", "second"]);
  expect(onMap.get(replacement)).toBe(true);
  expect(ui.c.layerRegistry.get("second")?.layer).toBe(replacement);
});

it("a reorder announces after the row list has been rebuilt", () => {
  // The list rebuild is the reorder's own side effect, so it lands before the
  // notify: a subscriber reading the row order out of the panel during the
  // CHANGE sees the arrangement that was just made, not the one that is
  // about to be rendered.
  const { ui, manager } = initFixture({
    data: [
      { id: "alpha", name: "Alpha", role: "overlay", layer: polygonLayer() },
      { id: "beta", name: "Beta", role: "overlay", layer: polygonLayer() },
      { id: "gamma", name: "Gamma", role: "overlay", layer: polygonLayer() },
    ],
  });
  const { children } = attachWithGroup(ui);
  const order = () =>
    children()
      .map(row => row.dataset.layerId)
      .join(",");
  expect(order()).toBe("alpha,beta,gamma");

  const orderAtDelivery: string[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    if (payload.id !== "alpha") return;
    orderAtDelivery.push(order());
  });

  expect(manager.moveLayerDown("alpha")).toBe(true);
  expect(orderAtDelivery).toEqual(["beta,alpha,gamma"]);
  expect(order()).toBe("beta,alpha,gamma");
});

it("a reorder whose rebuild signal destroys the control announces nothing more", () => {
  // The rebuild signal's fan-out is the reorder's own side-effect window: the
  // in-tree subscriber relocates the rows, and a third-party subscriber (the
  // panel is a public event surface) can tear the control down in the same
  // emit. The reorder's own CHANGE is suppressed — the registry went with the
  // control, so there is nothing left to announce the arrangement against.
  // The move itself already landed, so the arrangement stands regardless.
  const layerAlpha = polygonLayer();
  const layerBeta = polygonLayer();
  const { ui, manager } = initFixture({
    data: [
      { id: "alpha", name: "Alpha", role: "overlay", layer: layerAlpha },
      { id: "beta", name: "Beta", role: "overlay", layer: layerBeta },
    ],
  });

  const changes: string[] = [];
  let orderAtSignal: string[] | null = null;
  ui.events.on(EVENTS.LAYER_LIST_REBUILD, () => {
    orderAtSignal = manager.layers
      .filter(layerInfo => layerInfo.role === ROLE.OVERLAY)
      .map(layerInfo => layerInfo.id);
    ui.c.destroy();
  });
  ui.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));

  expect(() => manager.moveLayerDown("alpha")).not.toThrow();
  expect(changes).toEqual([]);
  expect(ui.c.isDestroyed).toBe(true);
  expect(ui.uiContainer).toBeNull();
  // The reorder had already happened when the signal fired: the arrangement
  // the subscriber saw was the finished one. Overlay entries only — the
  // color basemap is a base-group layer outside this arrangement.
  expect(orderAtSignal).toEqual(["beta", "alpha"]);
});

it("a reorder whose rebuild signal retires its layer announces no reorder", () => {
  // The entry moved instead of the control going away: a subscriber that
  // retires the moved layer inside the signal has removed the thing the
  // reorder would announce for.
  const layerAlpha = polygonLayer();
  const layerBeta = polygonLayer();
  const { ui, manager } = initFixture({
    data: [
      { id: "alpha", name: "Alpha", role: "overlay", layer: layerAlpha },
      { id: "beta", name: "Beta", role: "overlay", layer: layerBeta },
    ],
  });

  const changes: string[] = [];
  ui.events.on(EVENTS.LAYER_LIST_REBUILD, () => {
    manager.unregisterLayer("alpha");
  });
  ui.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));

  expect(() => manager.moveLayerDown("alpha")).not.toThrow();
  // The unregister's own CHANGE for alpha — and no second one: the reorder
  // would announce an entry nobody holds any more.
  expect(changes).toEqual(["alpha"]);
  expect(ui.c.layerRegistry.has("alpha")).toBe(false);
});

it("a rebuild signal delivers an already-settled panel", () => {
  // A reorder relocates rows in place, so unlike the bare-rows rebuild the
  // panel never stops being settled: every subscriber in the signal's
  // fan-out — in-tree first, third parties after — reads the finished
  // arrangement, the preserved row faces and the readiness flag. What a
  // subscriber sees at delivery is what the panel looks like when the
  // operation returns.
  const layerAlpha = polygonLayer();
  const layerBeta = polygonLayer();
  const layerGamma = polygonLayer();
  const { ui, manager } = initFixture({
    data: [
      { id: "alpha", name: "Alpha", role: "overlay", layer: layerAlpha },
      { id: "beta", name: "Beta", role: "overlay", layer: layerBeta },
      { id: "gamma", name: "Gamma", role: "overlay", layer: layerGamma },
    ],
  });
  // A row the user hid through the real visibility path: a reorder must not
  // repaint it, so it still reads unchecked at signal delivery.
  manager.setVisible("gamma", false);

  const snapshot = () => {
    const rows = Array.from(
      attachedPanel(ui).querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-type="${ROLE.OVERLAY}"]`,
      ),
    );
    return {
      order: rows.map(row => row.dataset.layerId).join(","),
      checked: rows.map(
        row =>
          (row.querySelector('input[type="checkbox"]') as HTMLInputElement).checked,
      ),
      active: rows.map(row => row.classList.contains(CONST.CLASSES.ACTIVE)),
      counts: rows.map(
        row => row.querySelector(`.${CONST.CLASSES.COUNT_COL}`)?.textContent,
      ),
      ready: attachedPanel(ui).getAttribute("data-ready"),
    };
  };

  let atDelivery: ReturnType<typeof snapshot> | null = null;
  ui.events.on(EVENTS.LAYER_LIST_REBUILD, () => {
    if (!atDelivery) atDelivery = snapshot();
  });

  expect(manager.moveLayerDown("alpha")).toBe(true);

  expect(atDelivery).toEqual(snapshot());
  expect(atDelivery).toMatchObject({
    order: "beta,alpha,gamma",
    checked: [true, true, false],
    active: [true, true, false],
    ready: "true",
  });
});

it("a bringLayerToFront whose rebuild signal destroys the control announces nothing", () => {
  // Same retirement window as the move entries: a subscriber that destroys
  // the control inside the signal leaves no registry to announce the
  // reorder against.
  const layerAlpha = polygonLayer();
  const layerBeta = polygonLayer();
  const { ui, manager } = initFixture({
    data: [
      { id: "alpha", name: "Alpha", role: "overlay", layer: layerAlpha },
      { id: "beta", name: "Beta", role: "overlay", layer: layerBeta },
    ],
  });

  const changes: string[] = [];
  ui.events.on(EVENTS.LAYER_LIST_REBUILD, () => {
    if (!manager.isDestroyed) manager.destroy();
  });
  ui.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));

  expect(() => manager.bringLayerToFront("beta")).not.toThrow();
  expect(changes).toEqual([]);
  expect(manager.isDestroyed).toBe(true);
});

it("a moveLayerUp whose rebuild signal destroys the control announces nothing", () => {
  const layerAlpha = polygonLayer();
  const layerBeta = polygonLayer();
  const { ui, manager } = initFixture({
    data: [
      { id: "alpha", name: "Alpha", role: "overlay", layer: layerAlpha },
      { id: "beta", name: "Beta", role: "overlay", layer: layerBeta },
    ],
  });

  const changes: string[] = [];
  ui.events.on(EVENTS.LAYER_LIST_REBUILD, () => {
    if (!manager.isDestroyed) manager.destroy();
  });
  ui.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));

  expect(manager.moveLayerUp("beta")).toBe(true);
  expect(changes).toEqual([]);
  expect(manager.isDestroyed).toBe(true);
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

  describe("lifecycle operations settle their whole fan-out", () => {
    it("a throwing row signal stops the registration before its CHANGE", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.uiContainer = document.createElement("div");
      manager.ui = makeDerivedUI({
        intentStore: makeStore(),
        applyUserState: vi.fn(() => []),
      }) as any;
      const changes: string[] = [];
      manager.events.on(EVENTS.LAYER_ITEM_ADDED, () => {
        throw new Error("item boom");
      });
      manager.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));

      expect(() =>
        manager.registerLayer({
          id: "new1",
          name: "New",
          layer: { options: {} },
        } as any),
      ).toThrow("item boom");

      // P2-6: a failure recorded by the row signal dooms this registration. The
      // factory-backed path rolls the entry back; this direct LayerAPI call has
      // no surface to roll back, but the registration CHANGE must not announce a
      // layer whose registration already failed (consumers would see it appear
      // and, for the factory path, vanish again).
      expect(changes).toEqual([]);
      expect(manager.layerRegistry.has("new1")).toBe(true);
    });

    it("a throwing CHANGE consumer does not cut off LAYER_REMOVED", () => {
      manager.map.hasLayer.mockReturnValue(false);
      const removed: string[] = [];
      manager.events.on(EVENTS.LAYER_CHANGE, () => {
        throw new Error("change boom");
      });
      manager.events.on(EVENTS.LAYER_REMOVED, payload => removed.push(payload.id));

      expect(() => manager.unregisterLayer("overlay1")).toThrow("change boom");

      expect(removed).toEqual(["overlay1"]);
      expect(manager.layerRegistry.has("overlay1")).toBe(false);
    });

    it("a throwing consumer cannot leave a user delete half-applied", () => {
      manager.map.hasLayer.mockReturnValue(false);
      const removed: string[] = [];
      manager.events.on(EVENTS.LAYER_CHANGE, () => {
        throw new Error("change boom");
      });
      manager.events.on(EVENTS.LAYER_REMOVED, payload => removed.push(payload.id));

      expect(() => manager.deleteLayer("overlay1")).toThrow("change boom");

      // The retirement and every persisted prune committed before the fan-out;
      // a retry no longer finds an entry, so the delete cannot silently
      // degrade into a re-registerable unregister.
      expect(manager.layerRegistry.has("overlay1")).toBe(false);
      expect(((manager as any).orderDoc.nodes["layer:overlay1"] as any)?.hidden).toBe(true);
      expect(removed).toEqual(["overlay1"]);
      expect(manager.deleteLayer("overlay1")).toBe(false);
    });

    it("a throwing DELETED consumer does not starve the component owner or the prune", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.registerLayer({
        id: "measure1",
        name: "Measure",
        layer: { options: {} },
        styleSetters: { color: vi.fn() },
      } as any);
      const owner = vi.fn();
      const deleteEntrySpy = vi.spyOn((manager as any).domain, "deleteEntry");
      manager.events.on(EVENTS.LAYER_DELETED, () => {
        throw new Error("deleted boom");
      });
      manager.events.on(EVENTS.LAYER_DELETED, owner);

      expect(() => manager.deleteLayer("measure1")).toThrow("deleted boom");

      // The owner handler and LayerControl cleanup both ran even though a
      // consumer ahead of them threw.
      expect(owner).toHaveBeenCalledWith(
        { id: "measure1" },
        { origin: { kind: "system", via: "teardown" } },
      );
      expect(deleteEntrySpy).toHaveBeenCalledWith("measure1");
      // Component clear keeps the id registerable for the next draw.
      expect(manager.layerRegistry.has("measure1")).toBe(true);
    });

    it("a throwing rebuild signal does not cut off the reorder CHANGE", () => {
      const m = new LayerController(map, [
        { id: "a", name: "A", role: "overlay" },
        { id: "b", name: "B", role: "overlay" },
      ]);
      m.uiContainer = document.createElement("div");
      m.ui = {} as any;
      const changes: string[] = [];
      m.events.on(EVENTS.LAYER_LIST_REBUILD, () => {
        throw new Error("list boom");
      });
      m.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));

      expect(() => m.moveLayerUp("b")).toThrow("list boom");

      expect(changes).toEqual(["b"]);
      expect(m.layers[0].id).toBe("b");
    });

    it("a throwing consumer does not cut off a late-attach CHANGE", () => {
      const realStamp = window.L.stamp;
      window.L.stamp = stableStamp;
      try {
        manager.registerLayer({ id: "late2", name: "Late2", role: "overlay" });
        const arrived = new window.L.Path();
        map._layers["late2"] = arrived;
        const seen: string[] = [];
        manager.events.on(EVENTS.LAYER_CHANGE, () => {
          throw new Error("late boom");
        });
        manager.events.on(EVENTS.LAYER_CHANGE, payload => seen.push(payload.id));

        expect(() => manager.onLayerAdd({ layer: arrived })).toThrow("late boom");

        expect(seen).toEqual(["late2"]);
      } finally {
        window.L.stamp = realStamp;
      }
    });

    it("a replacement registered inside the retirement CHANGE gets no stale LAYER_REMOVED", () => {
      manager.map.hasLayer.mockReturnValue(false);
      const removed: string[] = [];
      manager.events.on(EVENTS.LAYER_CHANGE, payload => {
        if (payload.id !== "overlay1") return;
        if (manager.layerRegistry.has("overlay1")) return;
        manager.registerLayer({
          id: "overlay1",
          name: "Replacement",
          role: "overlay",
          layer: { options: {} },
        });
      });
      manager.events.on(EVENTS.LAYER_REMOVED, payload => removed.push(payload.id));

      expect(manager.unregisterLayer("overlay1")).toBe(true);

      // The id is live again, so the rest of the old retirement would assert
      // a false "gone" state; the replacement announced its own CHANGE.
      expect(removed).toEqual([]);
      expect(manager.layerRegistry.get("overlay1")?.name).toBe("Replacement");
    });

    it("a replacement registered inside LAYER_ITEM_REMOVED stops the rest of the retirement", () => {
      manager.map.hasLayer.mockReturnValue(false);
      // A panel is required for the replacement to announce its registration
      // CHANGE (a pre-attach register only queues the entry).
      manager.uiContainer = document.createElement("div");
      manager.ui = makeDerivedUI({
        intentStore: makeStore(),
        applyUserState: vi.fn(() => []),
      }) as any;
      const changes: string[] = [];
      const removed: string[] = [];
      manager.events.on(EVENTS.LAYER_ITEM_REMOVED, payload => {
        if (payload.id !== "overlay1") return;
        if (manager.layerRegistry.has("overlay1")) return;
        manager.registerLayer({
          id: "overlay1",
          name: "Replacement2",
          role: "overlay",
          layer: { options: {} },
        });
      });
      manager.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));
      manager.events.on(EVENTS.LAYER_REMOVED, payload => removed.push(payload.id));

      expect(manager.unregisterLayer("overlay1")).toBe(true);

      // Only the replacement registration CHANGE is announced; the old
      // retirement contributes no count/change/removed after its first event.
      expect(changes).toEqual(["overlay1"]);
      expect(removed).toEqual([]);
      expect(manager.layerRegistry.get("overlay1")?.name).toBe("Replacement2");
    });

    it("a replacement registered and unregistered inside the fan-out still stops the old REMOVED", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.uiContainer = document.createElement("div");
      manager.ui = makeDerivedUI({
        intentStore: makeStore(),
        applyUserState: vi.fn(() => []),
      }) as any;
      const removed: string[] = [];
      let swapped = false;
      manager.events.on(EVENTS.LAYER_CHANGE, payload => {
        if (payload.id !== "overlay1" || swapped) return;
        swapped = true;
        // Swap a replacement in, then immediately swap it out again inside the
        // same fan-out. Existence alone would let the old retirement re-pass
        // its gate and repeat LAYER_REMOVED.
        manager.registerLayer({
          id: "overlay1",
          name: "Swap",
          role: "overlay",
          layer: { options: {} },
        });
        manager.unregisterLayer("overlay1");
      });
      manager.events.on(EVENTS.LAYER_REMOVED, payload => removed.push(payload.id));

      expect(manager.unregisterLayer("overlay1")).toBe(true);

      // The inner unregister announced the removal once; the outer retirement
      // noticed the replacement and stayed silent — no identity-less repeat.
      expect(removed).toEqual(["overlay1"]);
      expect(manager.layerRegistry.has("overlay1")).toBe(false);
    });

    it("a replacement registered inside LAYER_ROLE_COUNT_CHANGED stops before the old change and removal", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.uiContainer = document.createElement("div");
      manager.ui = makeDerivedUI({
        intentStore: makeStore(),
        applyUserState: vi.fn(() => []),
      }) as any;
      const changes: string[] = [];
      const removed: string[] = [];
      let swapped = false;
      manager.events.on(EVENTS.LAYER_ROLE_COUNT_CHANGED, payload => {
        if (payload.role !== "overlay" || swapped) return;
        swapped = true;
        manager.registerLayer({
          id: "overlay1",
          name: "Repl",
          role: "overlay",
          layer: { options: {} },
        });
      });
      manager.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));
      manager.events.on(EVENTS.LAYER_REMOVED, payload => removed.push(payload.id));

      expect(manager.unregisterLayer("overlay1")).toBe(true);

      // Only the replacement's registration CHANGE is announced; the old
      // retirement stops right after its first group-count sync.
      expect(changes).toEqual(["overlay1"]);
      expect(removed).toEqual([]);
      expect(manager.layerRegistry.get("overlay1")?.name).toBe("Repl");
    });

    it("a different id registering during a retirement does not stop the retirement", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.uiContainer = document.createElement("div");
      manager.ui = makeDerivedUI({
        intentStore: makeStore(),
        applyUserState: vi.fn(() => []),
      }) as any;
      const removed: string[] = [];
      let otherDone = false;
      manager.events.on(EVENTS.LAYER_CHANGE, payload => {
        if (payload.id !== "overlay1" || otherDone) return;
        otherDone = true;
        manager.registerLayer({
          id: "other",
          name: "Other",
          role: "overlay",
          layer: { options: {} },
        });
      });
      manager.events.on(EVENTS.LAYER_REMOVED, payload => removed.push(payload.id));

      expect(manager.unregisterLayer("overlay1")).toBe(true);

      // The identity listener only reacts to the retired id, so a different
      // id registering in between is irrelevant — the retirement completes.
      expect(removed).toEqual(["overlay1"]);
      expect(manager.layerRegistry.has("other")).toBe(true);
    });

    it("a replacement registered inside a solid-basemap delete skips the old reset and extra events", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.registerLayer({
        id: CONST.SOLID_BASEMAP_ID,
        name: "color",
        role: "base",
        layer: { options: {} },
      } as any);
      const reset = vi.fn();
      manager.ui = makeDerivedUI({
        intentStore: makeStore(),
        resetSolidBasemap: reset,
        invalidateFields: vi.fn(),
      }) as any;
      const noBase = vi.fn();
      let swapped = false;
      manager.events.on(EVENTS.LAYER_CHANGE, payload => {
        if (payload.id !== CONST.SOLID_BASEMAP_ID || swapped) return;
        swapped = true;
        manager.registerLayer({
          id: CONST.SOLID_BASEMAP_ID,
          name: "NewColour",
          role: "base",
          layer: { options: {} },
        });
      });
      manager.events.on(EVENTS.LAYER_NO_BASEMAP_CHANGED, noBase);

      expect(manager.deleteLayer(CONST.SOLID_BASEMAP_ID)).toBe(true);

      // The old delete's post-announcement housekeeping is gated on the full
      // retirement having been announced: a replacement consumed it, so the
      // reset and the extra signals are skipped.
      expect(reset).not.toHaveBeenCalled();
      expect(noBase).not.toHaveBeenCalled();
      expect(manager.layerRegistry.get(CONST.SOLID_BASEMAP_ID)?.name).toBe("NewColour");
    });
  });
});

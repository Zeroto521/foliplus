// test/js/control/LayerControl/ui/style/apply.notify — subscriber fan-out and reentrancy.
import { cascadeGroup, headerState, makeCascadeMap } from "./apply.fixture.js";
import { findItem, initFixture, polygonLayer, trackMembership } from "./fixture.js";
import { expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { ROLE } from "#core/layer/index.js";
import { dispatchStateOp, notifyDelta } from "#control/LayerControl/ui/apply.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { setIntent } from "#control/LayerControl/ui/intent.js";
import { intentVisibleOf } from "#control/LayerControl/ui/projection.js";

// ── Notification-contract cases, moved from the former
// ── notifyContract.test.ts so they live with the script they drive. ──
it("a later subscriber observes the state the earlier subscriber left", () => {
  // Two subscribers share one emit. The first rewrites the intent; the
  // second must read the rewritten state, not the value the emit was
  // carrying. Only a last-step notify gives that: a notify fired mid-
  // operation would hand the second subscriber a panel the first had
  // already moved on from, and it would record [true, false] instead.
  // The reentrant rewrite supersedes the in-flight delivery, so the outer
  // round never reaches the second subscriber at all — the correction's
  // own round is the only one, and it already carries the rewritten state.
  const { ui, map } = initFixture();
  const id = "overlay1";

  // Track real membership: the executor reads the carrier back before it
  // writes, so a `hasLayer` that always answers true would make the
  // re-add a diff miss.
  const onMap = { current: true };
  map.hasLayer = vi.fn(() => onMap.current);
  map.addLayer = vi.fn(() => {
    onMap.current = true;
  });
  map.removeLayer = vi.fn(() => {
    onMap.current = false;
  });

  const secondSaw: boolean[] = [];
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, () => {
    ui.applyVisibility(id, true);
  });
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, () => {
    secondSaw.push(intentVisibleOf(ui, id));
  });

  ui.applyVisibility(id, false);

  expect(secondSaw).toEqual([true]);
  expect(intentVisibleOf(ui, id)).toBe(true);
  expect(onMap.current).toBe(true);
  expect(headerState(ui.uiContainer!, ROLE.OVERLAY)).toEqual({
    checked: true,
    indeterminate: false,
  });
});

it("a reentrant correction never hands a later subscriber a stale intent", () => {
  // Subscriber 1 reverses the hide synchronously inside the notify, which
  // fires a reentrant round for the same id; the outer delivery then
  // continues to subscriber 2. Subscriber 2 must never receive the outer
  // "hidden" value after the correction's own "visible" — the delivery is
  // superseded at the reentry point, so subscriber 2 reads only the
  // correction, and it is the final choice.
  const { ui, manager } = initFixture();
  const id = "overlay1";

  let corrected = false;
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, payload => {
    if (payload.id !== id || corrected) return;
    corrected = true;
    manager.setVisible(id, true);
  });
  const received: boolean[] = [];
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, payload => {
    if (payload.id !== id) return;
    received.push(payload.intent.visible);
  });

  manager.setVisible(id, false);

  expect(received).toEqual([true]);
  expect(intentVisibleOf(ui, id)).toBe(true);
});

it("a reentrant flip inside the CHANGE callback announces the intent once", () => {
  // The outer hide delivers its CHANGE first. A subscriber that reverses the
  // flip inside that delivery emits the correction's own CHANGE+INTENT while
  // the outer round is still between its two halves — and a CHANGE token
  // cannot stop an INTENT. The outer INTENT must still not follow: it would
  // duplicate the final state, and LAYER_INTENT_CHANGE is only supposed to
  // fire when the stored intent actually moves.
  const { ui, manager } = initFixture();
  const id = "overlay1";

  let corrected = false;
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    if (payload.id !== id || corrected) return;
    corrected = true;
    manager.setVisible(id, true);
  });
  const intents: boolean[] = [];
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, payload => {
    if (payload.id !== id) return;
    intents.push(payload.intent.visible);
  });

  manager.setVisible(id, false);

  expect(intents).toEqual([true]);
  expect(intentVisibleOf(ui, id)).toBe(true);
});

it("the group count reflects the intent a reentrant correction left", () => {
  const { ui } = initFixture({
    data: [
      { id: "one", name: "One", role: "overlay", layer: polygonLayer() },
      { id: "two", name: "Two", role: "overlay", layer: polygonLayer() },
    ],
  });
  const count = () => headerState(ui.uiContainer!, ROLE.OVERLAY);
  expect(count()).toEqual({ checked: true, indeterminate: false });

  // A subscriber that disagrees with the uncheck and pushes the layer back
  // on, synchronously, inside the notify.
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, () => {
    ui.applyVisibility("one", true);
  });

  ui.applyVisibility("one", false);

  // The header is the final intent, not the delta the outer operation
  // computed against the state it started from.
  expect(count()).toEqual({ checked: true, indeterminate: false });
  expect(intentVisibleOf(ui, "one")).toBe(true);
});

it("a subscriber that throws leaves every side effect applied", () => {
  // The notify is last, so a throwing handler can only interrupt delivery —
  // the carrier write, the row paint and the group count are already done.
  // A mid-operation notify would have left the checkbox and the count
  // behind while the map had already moved.
  const { ui } = initFixture();
  const id = "overlay1";
  const row = findItem(ui, id);
  ui.events.on(EVENTS.LAYER_CHANGE, () => {
    throw new Error("subscriber boom");
  });

  expect(() => ui.applyVisibility(id, false)).toThrow("subscriber boom");

  expect(ui.c.map.removeLayer).toHaveBeenCalled();
  expect(intentVisibleOf(ui, id)).toBe(false);
  expect(
    (row.querySelector('input[type="checkbox"]') as HTMLInputElement).checked,
  ).toBe(false);
  expect(headerState(ui.uiContainer!, ROLE.OVERLAY)).toEqual({
    checked: false,
    indeterminate: false,
  });
});

it("a subscriber that destroys the control leaves no null deref", () => {
  // A subscriber that tears the control down takes its panel container with
  // it. Every panel read of the operation happens *before* the notify, so
  // nothing after the callback dereferences the missing container — a
  // mid-operation notify would have left a row paint and a tri-state rescan
  // queued behind the teardown, and that rescan reads the container with a
  // non-null assertion.
  const { ui } = initFixture();
  const id = "overlay1";
  // Hold the panel root: the teardown nulls `ui.c.uiContainer`, but the DOM
  // the operation already painted is still there to read.
  const root = ui.uiContainer!;
  ui.events.on(EVENTS.LAYER_CHANGE, () => {
    // The container half of `LayerController.destroy()`.
    ui.c.uiContainer = null;
  });

  expect(() => ui.applyVisibility(id, false)).not.toThrow();
  expect(ui.c.map.removeLayer).toHaveBeenCalled();
  expect(intentVisibleOf(ui, id)).toBe(false);
  expect(headerState(root, ROLE.OVERLAY)).toEqual({
    checked: false,
    indeterminate: false,
  });
});

it("a zoom sweep notifies each moved layer once, in registry order", () => {
  const layerA = polygonLayer();
  const layerB = polygonLayer();
  const { ui, map } = initFixture({
    data: [
      { id: "alpha", name: "Alpha", role: "overlay", layer: layerA },
      { id: "beta", name: "Beta", role: "overlay", layer: layerB },
    ],
  });
  for (const id of ["alpha", "beta"]) {
    setIntent(ui, id, "zoomRange", [0, 1]);
    ui.intentStore.seedProvenance(id, ["zoomRange"]);
  }
  const removed: string[] = [];
  map.removeLayer = vi.fn((l: L.Layer) =>
    removed.push(l === layerA ? "alpha" : "beta"),
  );

  const seen: string[] = [];
  const removedAtDelivery: string[][] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    seen.push(payload.id);
    removedAtDelivery.push(removed.slice());
  });

  ui.onZoomEnd?.();

  expect(removed).toEqual(["alpha", "beta"]);
  expect(seen).toEqual(["alpha", "beta"]);
  // The whole sweep landed before the first notify: a mid-sweep notify
  // would have shown only ["alpha"] at the first delivery.
  expect(removedAtDelivery[0]).toEqual(["alpha", "beta"]);
});

it("a subscriber that unregisters a later layer does not strand the sweep", () => {
  // The sweep decides what moves before it announces anything, so a delta
  // can still name a layer that has left the registry by the time its own
  // delivery comes around. That is a no-delivery, not a throw: the sweep
  // skips the gone layer instead of dropping whatever came after it.
  const layerA = polygonLayer();
  const layerB = polygonLayer();
  const { ui } = initFixture({
    data: [
      { id: "alpha", name: "Alpha", role: "overlay", layer: layerA },
      { id: "beta", name: "Beta", role: "overlay", layer: layerB },
    ],
  });
  for (const id of ["alpha", "beta"]) {
    setIntent(ui, id, "zoomRange", [0, 1]);
    ui.intentStore.seedProvenance(id, ["zoomRange"]);
  }

  const seen: string[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    seen.push(payload.id);
    if (payload.id === "alpha") ui.c.layerRegistry.remove("beta");
  });

  expect(() => ui.onZoomEnd?.()).not.toThrow();
  expect(seen).toEqual(["alpha"]);
  expect(ui.c.layerRegistry.has("beta")).toBe(false);
});

it("a CHANGE that retires its layer suppresses the intent half", () => {
  // The two halves of one round belong to the entry that ran the pass. A
  // subscriber that retires that entry inside the CHANGE has answered for it
  // already, so the intent half is not delivered for an id nobody holds —
  // and in particular not for a replacement registered under the same id.
  const { ui, manager } = initFixture();

  const changes: string[] = [];
  const intents: string[] = [];
  let retired = false;
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    changes.push(payload.id);
    if (payload.id === "overlay1" && !retired) {
      retired = true;
      manager.unregisterLayer("overlay1");
    }
  });
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, payload => {
    intents.push(payload.id);
  });

  ui.applyVisibility("overlay1", false);

  expect(changes).toEqual(["overlay1", "overlay1"]);
  expect(intents).toEqual([]);
  expect(ui.c.layerRegistry.has("overlay1")).toBe(false);
});

it("a batch delta for a layer replaced under the same id delivers nothing", () => {
  // The sweep stamps each delta with the entry it ran against, so a
  // replacement registered under the same id by an earlier delivery of the
  // same round is not handed the delta it never produced. Delivery is
  // identity, not presence: the id is live, the entry is not.
  const layerAlpha = polygonLayer();
  const layerBeta = polygonLayer();
  const replacement = polygonLayer();
  const { ui, manager } = initFixture({
    data: [
      { id: "alpha", name: "Alpha", role: "overlay", layer: layerAlpha },
      { id: "beta", name: "Beta", role: "overlay", layer: layerBeta },
    ],
  });
  // Both layers sit on the map while their stored intent says hidden, so the
  // sweep has a flip for each. `visible` rather than `zoomRange`: with
  // `visible` false the re-registration below stays off the map, so its own
  // projection is a no-op and the only beta announce in the round is its
  // registration CHANGE.
  const onMap = trackMembership(ui.c.map);
  onMap.set(layerAlpha, true);
  onMap.set(layerBeta, true);
  setIntent(ui, "alpha", "visible", false);
  setIntent(ui, "beta", "visible", false);
  ui.intentStore.seedProvenance("alpha", ["visible"]);
  ui.intentStore.seedProvenance("beta", ["visible"]);

  const changes: string[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    changes.push(payload.id);
    if (payload.id === "alpha") {
      manager.registerLayer({
        id: "beta",
        name: "Beta",
        role: "overlay",
        layer: replacement,
      });
    }
  });

  ui.onZoomEnd?.();

  // alpha's flip, then the re-registration's own CHANGE — and nothing else.
  // The sweep's delta for the beta it replaced is the third one on a
  // build without the identity check.
  expect(changes).toEqual(["alpha", "beta"]);
  expect(ui.c.layerRegistry.get("beta")?.layer).toBe(replacement);
  expect(onMap.get(replacement) ?? false).toBe(false);
});

// ── Consumer-failure contract: a throwing subscriber must not truncate the
// ── rest of the operation. The state and the projection baselines are already
// ── committed before the notify, so a retry produces no delta and can never
// ── replay what a fail-fast delivery skipped.

it("a throwing CHANGE subscriber does not steal later subscribers or the intent half", () => {
  // Three independent consumers of one operation: a thrower first, then a
  // CHANGE consumer, then the INTENT half. The thrower must not starve the
  // subscriber behind it, and a CHANGE failure must not suppress the INTENT
  // that carries the user's choice — the two are separate public semantics.
  const { ui } = initFixture();
  const id = "overlay1";
  const changes: string[] = [];
  const intents: boolean[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, () => {
    throw new Error("change boom");
  });
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    changes.push(payload.id);
  });
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, payload => {
    intents.push(payload.intent.visible);
  });

  expect(() => ui.applyVisibility(id, false)).toThrow("change boom");

  expect(changes).toEqual([id]);
  expect(intents).toEqual([false]);
  expect(intentVisibleOf(ui, id)).toBe(false);
});

it("a throwing INTENT subscriber does not starve the subscribers behind it", () => {
  const { ui } = initFixture();
  const id = "overlay1";
  const seen: boolean[] = [];
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, () => {
    throw new Error("intent boom");
  });
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, payload => {
    seen.push(payload.intent.visible);
  });

  expect(() => ui.applyVisibility(id, false)).toThrow("intent boom");

  expect(seen).toEqual([false]);
});

it("both halves throwing completes both fan-outs and reports the CHANGE failure first", () => {
  const { ui } = initFixture();
  const id = "overlay1";
  const intents: boolean[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, () => {
    throw new Error("change boom");
  });
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, () => {
    throw new Error("intent boom");
  });
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, payload => {
    intents.push(payload.intent.visible);
  });

  expect(() => ui.applyVisibility(id, false)).toThrow("change boom");

  // The INTENT half still ran to the end; its failure was the second one and
  // is not the error the operation reports.
  expect(intents).toEqual([false]);
});

it("a throwing subscriber on the first swept layer does not strand the layers behind it", () => {
  // A zoom sweep announces several layers as one batch. Stopping at the first
  // throw would leave beta's membership change permanently unannounced.
  const layerA = polygonLayer();
  const layerB = polygonLayer();
  const { ui, map } = initFixture({
    data: [
      { id: "alpha", name: "Alpha", role: "overlay", layer: layerA },
      { id: "beta", name: "Beta", role: "overlay", layer: layerB },
    ],
  });
  for (const id of ["alpha", "beta"]) {
    setIntent(ui, id, "zoomRange", [0, 1]);
    ui.intentStore.seedProvenance(id, ["zoomRange"]);
  }
  map.removeLayer = vi.fn();

  const seen: string[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    if (payload.id === "alpha") throw new Error("alpha boom");
  });
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    seen.push(payload.id);
    if (payload.id === "beta") throw new Error("beta boom");
  });

  expect(() => ui.onZoomEnd?.()).toThrow("alpha boom");

  expect(seen).toEqual(["alpha", "beta"]);
  expect(map.removeLayer).toHaveBeenCalledWith(layerA);
  expect(map.removeLayer).toHaveBeenCalledWith(layerB);
});

it("a basemap switch still announces the sweep when the own layer throws", () => {
  // applyVisibility announces the acted-on layer and the basemap sweep as one
  // operation. The own layer's consumer failing must not strand the sweep —
  // the sweep layers were already re-projected and their baselines written.
  const { ui, map } = initFixture();
  const overlay = ui.c.layerRegistry.get("overlay1")!.layer!;
  const base = ui.c.layerRegistry.get("base1")!.layer!;
  // Real membership: the projection reads the carrier back before it writes,
  // and a hasLayer that always answers true turns every re-projection into a
  // fresh flip (the sweep would announce the base a second time).
  const onMap = trackMembership(map);
  onMap.set(overlay, true);
  onMap.set(base, true);
  setIntent(ui, "overlay1", "zoomRange", [0, 1]);
  ui.intentStore.seedProvenance("overlay1", ["zoomRange"]);

  const seen: string[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    if (payload.id === "base1") throw new Error("base boom");
  });
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    seen.push(payload.id);
  });

  expect(() => ui.applyVisibility("base1", false)).toThrow("base boom");

  expect(seen).toEqual(["base1", "overlay1"]);
  expect(map.removeLayer).toHaveBeenCalledWith(overlay);
  expect(onMap.get(base)).toBe(false);
});

it("a subscriber that destroys the control stops the remaining batch without throwing", () => {
  // Retirement is checked at each item, so the layers after the destroy have
  // no registered entry left to announce for — a no-delivery, not a throw.
  const layerA = polygonLayer();
  const layerB = polygonLayer();
  const { ui, manager, map } = initFixture({
    data: [
      { id: "alpha", name: "Alpha", role: "overlay", layer: layerA },
      { id: "beta", name: "Beta", role: "overlay", layer: layerB },
    ],
  });
  // Real membership: destroy() runs dismissFocus, which sweeps and would see a
  // phantom flip on a hasLayer that never notices the removal — a reentrant
  // notify into the handler that is already destroying the control.
  const onMap = trackMembership(map);
  onMap.set(layerA, true);
  onMap.set(layerB, true);
  for (const id of ["alpha", "beta"]) {
    setIntent(ui, id, "zoomRange", [0, 1]);
    ui.intentStore.seedProvenance(id, ["zoomRange"]);
  }

  const seen: string[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    seen.push(payload.id);
    if (payload.id === "alpha") manager.destroy();
  });

  expect(() => ui.onZoomEnd?.()).not.toThrow();
  expect(seen).toEqual(["alpha"]);
  expect(manager.layerRegistry.has("beta")).toBe(false);
});

it("notifyDelta raises a single layer's consumer failure after its fan-out", () => {
  // The single-entry notify (opacity / zoom-range / count paths) has no wider
  // batch left to finish, so it raises the first consumer failure itself —
  // after every subscriber of the CHANGE has seen the round.
  const { ui } = initFixture();
  const entry = ui.c.layerRegistry.get("overlay1")!;
  const seen: string[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, () => {
    throw new Error("single boom");
  });
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    seen.push(payload.id);
  });

  expect(() =>
    notifyDelta(ui, entry, { wroteVisible: true, intentMoved: false }),
  ).toThrow("single boom");

  expect(seen).toEqual([entry.id]);
});

it("unchecking a nested group hides its grandchild (Leaflet cascade)", () => {
  const { map, register } = makeCascadeMap();
  const marker = { options: {}, eachLayer: undefined };
  const inner = cascadeGroup([marker]);
  const outer = cascadeGroup([inner]);
  register(outer, [inner]);
  register(inner, [marker]);

  const layerInfo = {
    id: "a",
    layer: outer,
    canvas: undefined,
  } as unknown as Parameters<typeof dispatchStateOp>[1];
  const ui = {
    c: {
      map,
      surfaceFor: () => ({ capabilities: { visibility: "native" } }),
      findLayer: vi.fn(),
    },
  } as unknown as LayerUI;

  map.addLayer(outer);
  expect(map.hasLayer(marker)).toBe(true);

  dispatchStateOp(ui, layerInfo, { type: "visible", value: false });
  // The control removes the WHOLE group in one call and lets Leaflet cascade;
  // a per-child loop would call removeLayer for the inner group and the marker
  // too. The first call is the control's own: the whole group, not a child.
  expect(map.removeLayer.mock.calls[0][0]).toBe(outer);
  expect(map.hasLayer(marker)).toBe(false);
});

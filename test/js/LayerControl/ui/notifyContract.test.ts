// Notification contract: a layer notify is the *last* step of the operation
// that produced it. Every side effect of that operation — the carrier write,
// the row paint, the group tri-state count, the basemap hatch — has landed
// before the bus delivers. Subscribers therefore always observe a settled
// panel, no matter what they do synchronously inside the handler.
//
// These drive the real operation endpoints (`applyVisibility`, the zoomend
// sweep) rather than the executor: the executor no longer emits at all, it
// only reports what moved.
import { afterEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { GROUP } from "#core/layer/index.js";
import { setIntent } from "#foliplus/LayerControl/ui/intent.js";
import { intentVisibleOf } from "#foliplus/LayerControl/ui/projection.js";
import { findItem, initFixture } from "./fixture.js";

/** A polygon-shaped layer stub — enough for the surface to resolve. */
const polygonLayer = () =>
  ({
    options: {},
    eachLayer: vi.fn(),
    getBounds: vi.fn(() => ({
      isValid: vi.fn(() => true),
      getSouthWest: () => ({ lat: 30, lng: 100 }),
      getNorthEast: () => ({ lat: 40, lng: 110 }),
    })),
  }) as L.Layer;

describe("layer notification contract", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("a later subscriber observes the state the earlier subscriber left", () => {
    // Two subscribers share one emit. The first rewrites the intent; the
    // second must read the rewritten state, not the value the emit was
    // carrying. Only a last-step notify gives that: a notify fired mid-
    // operation would hand the second subscriber a panel the first had
    // already moved on from, and it would record [true, false] instead.
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

    expect(secondSaw).toEqual([true, true]);
    expect(intentVisibleOf(ui, id)).toBe(true);
    expect(onMap.current).toBe(true);
    expect(ui.listPanel.checkedCount[GROUP.OVERLAY]).toEqual({
      total: 1,
      on: 1,
    });
  });

  it("the group count reflects the intent a reentrant correction left", () => {
    const { ui } = initFixture({
      data: [
        { id: "one", name: "One", group: "overlay", layer: polygonLayer() },
        { id: "two", name: "Two", group: "overlay", layer: polygonLayer() },
      ],
    });
    const count = () => ui.listPanel.checkedCount[GROUP.OVERLAY];
    expect(count()).toEqual({ total: 2, on: 2 });

    // A subscriber that disagrees with the uncheck and pushes the layer back
    // on, synchronously, inside the notify.
    ui.events.on(EVENTS.LAYER_INTENT_CHANGE, () => {
      ui.applyVisibility("one", true);
    });

    ui.applyVisibility("one", false);

    // The count is the final intent, not the delta the outer operation
    // computed against the state it started from.
    expect(count()).toEqual({ total: 2, on: 2 });
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
    expect(ui.listPanel.checkedCount[GROUP.OVERLAY]).toEqual({
      total: 1,
      on: 0,
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
    ui.events.on(EVENTS.LAYER_CHANGE, () => {
      // The container half of `LayerController.destroy()`.
      ui.c.uiContainer = null;
    });

    expect(() => ui.applyVisibility(id, false)).not.toThrow();
    expect(ui.c.map.removeLayer).toHaveBeenCalled();
    expect(intentVisibleOf(ui, id)).toBe(false);
    expect(ui.listPanel.checkedCount[GROUP.OVERLAY]).toEqual({
      total: 1,
      on: 0,
    });
  });

  it("a zoom sweep notifies each moved layer once, in registry order", () => {
    const layerA = polygonLayer();
    const layerB = polygonLayer();
    const { ui, map } = initFixture({
      data: [
        { id: "alpha", name: "Alpha", group: "overlay", layer: layerA },
        { id: "beta", name: "Beta", group: "overlay", layer: layerB },
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
        { id: "alpha", name: "Alpha", group: "overlay", layer: layerA },
        { id: "beta", name: "Beta", group: "overlay", layer: layerB },
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

  it("a bulk toggle-all does not announce a layer a subscriber unregistered", () => {
    // The bulk path sweeps the DOM first, then announces. A delta can still
    // name a layer a subscriber unregistered inside an earlier delivery of the
    // same batch. That layer is gone — a no-delivery, not a delivery on a
    // snapshot the recipient no longer owns. Walking ids (not LayerInfo
    // snapshots) is what lets the delivery re-query the registry and drop it.
    const { ui } = initFixture({
      data: [
        { id: "alpha", name: "Alpha", group: "overlay", layer: polygonLayer() },
        { id: "beta", name: "Beta", group: "overlay", layer: polygonLayer() },
        { id: "gamma", name: "Gamma", group: "overlay", layer: polygonLayer() },
      ],
    });

    const seen: string[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, payload => {
      seen.push(payload.id);
      if (payload.id === "alpha") ui.c.layerRegistry.remove("beta");
    });

    expect(() => ui.toggleAll(GROUP.OVERLAY, false)).not.toThrow();

    // Alpha delivers before beta's unregister runs; beta is gone by the time
    // its slot comes around; gamma still delivers — the sweep does not stop
    // at the first subscriber action.
    expect(seen).toEqual(["alpha", "gamma"]);
    expect(ui.c.layerRegistry.has("beta")).toBe(false);
    expect(intentVisibleOf(ui, "gamma")).toBe(false);
  });
});

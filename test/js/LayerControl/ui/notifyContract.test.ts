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
import * as CONST from "#foliplus/LayerControl/const.js";
import { setIntent } from "#foliplus/LayerControl/ui/intent.js";
import { intentVisibleOf } from "#foliplus/LayerControl/ui/projection.js";
import { resetLayerZoomRange } from "#foliplus/LayerControl/ui/style/zoomRange.js";
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

/** A polygon-shaped layer whose bounds the test supplies — the flyTo branch
 *  needs a single-point area, the rectangle branch a real extent. */
const polygonLayerWith = (
  southWest: [number, number],
  northEast: [number, number],
): L.Layer => {
  const center = {
    lat: (southWest[0] + northEast[0]) / 2,
    lng: (southWest[1] + northEast[1]) / 2,
  };
  return {
    options: {},
    eachLayer: vi.fn(),
    getBounds: vi.fn(() => ({
      isValid: vi.fn(() => true),
      getSouthWest: () => ({ lat: southWest[0], lng: southWest[1] }),
      getNorthEast: () => ({ lat: northEast[0], lng: northEast[1] }),
      getCenter: () => center,
    })),
  } as L.Layer;
};

/** A polygon-shaped layer stub that reports no usable bounds — the focus
 *  entry has to bail instead of drawing a rectangle. */
const polygonLayerWithoutBounds = (): L.Layer =>
  ({
    options: {},
    eachLayer: vi.fn(),
    getBounds: vi.fn(() => ({ isValid: vi.fn(() => false) })),
  }) as L.Layer;

/** Track real map membership, keyed by the layer the projection diffs against.
 *  A `hasLayer` that always answers the same way turns every add and every
 *  remove into a diff miss. */
const trackMembership = (map: any): Map<L.Layer, boolean> => {
  const onMap = new Map<L.Layer, boolean>();
  map.hasLayer = vi.fn((l: L.Layer) => onMap.get(l) ?? false);
  map.addLayer = vi.fn((l: L.Layer) => {
    onMap.set(l, true);
  });
  map.removeLayer = vi.fn((l: L.Layer) => {
    onMap.set(l, false);
  });
  return onMap;
};

/** One overlay in a fixture whose map membership is tracked, so the
 *  projection's diff against the map is real instead of a constant. The layer
 *  starts on the map, the way attach leaves it. */
const oneOverlay = (makeLayer: () => L.Layer = polygonLayer) => {
  const layer = makeLayer();
  const fixture = initFixture({
    data: [{ id: "overlay1", name: "Polygons", group: "overlay", layer }],
  });
  const onMap = trackMembership(fixture.map);
  onMap.set(layer, true);
  return { ...fixture, layer, onMap };
};

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

  it("a focus cancel inside the rectangle announce is not undone", () => {
    // The rectangle branch draws the mask, the rect, the row highlight and the
    // auto-cancel, and only then announces. A subscriber that cancels inside
    // that notify wins: nothing after the announce re-arms the focus, so a
    // focus kicked off by focusLayer cannot still be live when it returns.
    const { ui, map, layer, onMap } = oneOverlay();
    onMap.set(layer, false);

    let deliveries = 0;
    ui.events.on(EVENTS.LAYER_CHANGE, () => {
      deliveries += 1;
      ui.cancelFocus();
    });

    expect(() => ui.focusLayer("overlay1")).not.toThrow();
    expect(map.fitBounds).toHaveBeenCalled();
    expect(deliveries).toBeGreaterThan(0);
    expect(ui.isFocusing()).toBe(false);
  });

  it("a focus cancel inside the flyTo announce is not undone", () => {
    // The flyTo branch takes the same ordering: fly to the center, highlight
    // the row, register the auto-cancel, and only then announce.
    const { ui, map, layer, onMap } = oneOverlay(() =>
      polygonLayerWith([30, 100], [30.0001, 100.0001]),
    );
    onMap.set(layer, false);

    let deliveries = 0;
    ui.events.on(EVENTS.LAYER_CHANGE, () => {
      deliveries += 1;
      ui.cancelFocus();
    });

    expect(() => ui.focusLayer("overlay1")).not.toThrow();
    expect(map.flyTo).toHaveBeenCalled();
    expect(deliveries).toBeGreaterThan(0);
    expect(ui.isFocusing()).toBe(false);
  });

  it("a rejected focus leaves no membership change behind", () => {
    // A layer the policy had pulled off rejoins the map so its bounds can be
    // read. When those bounds turn out unusable the re-add goes back, so the
    // call announces nothing and leaves the map as it found it.
    const { ui, layer, onMap } = oneOverlay(polygonLayerWithoutBounds);
    onMap.set(layer, false);

    const seen: string[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, payload => {
      seen.push(payload.id);
    });

    expect(() => ui.focusLayer("overlay1")).not.toThrow();

    expect(onMap.get(layer)).toBe(false);
    expect(seen).toEqual([]);
    expect(ui.isFocusing()).toBe(false);
  });

  it("a registration announces after the group count has settled", () => {
    // The registration entry inserts the row, replays the stored state,
    // refreshes the row cells and syncs the group count before it publishes —
    // so the first CHANGE the new layer gets out already names the full
    // group. Announcing from the row insertion itself would have handed a
    // subscriber the count taken before that row existed.
    const { ui, manager } = initFixture({
      data: [
        { id: "one", name: "One", group: "overlay", layer: polygonLayer() },
        { id: "two", name: "Two", group: "overlay", layer: polygonLayer() },
        {
          id: "three",
          name: "Three",
          group: "overlay",
          layer: polygonLayer(),
        },
      ],
    });
    expect(ui.listPanel.checkedCount[GROUP.OVERLAY]).toEqual({
      total: 3,
      on: 3,
    });

    // The late layer arrives already hidden: a stored dimension is the only
    // state a late registration can carry, and it is the delta the entry
    // holds until the row and the count have settled.
    setIntent(ui, "fourth", "visible", false);
    ui.intentStore.seedProvenance("fourth", ["visible"]);

    const countsAtDelivery: { total: number; on: number }[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, payload => {
      if (payload.id !== "fourth") return;
      countsAtDelivery.push({ ...ui.listPanel.checkedCount[GROUP.OVERLAY] });
    });

    manager.registerLayer({
      id: "fourth",
      name: "Fourth",
      group: "overlay",
      layer: polygonLayer(),
    });

    expect(countsAtDelivery.length).toBeGreaterThan(0);
    expect(countsAtDelivery[0]).toEqual({ total: 4, on: 3 });
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
        group: "overlay",
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
        group: "overlay",
        layer: polygonLayer(),
      }),
    ).toBeNull();
    expect(changes).toEqual(["second", "second"]);
    expect(ui.c.layerRegistry.has("second")).toBe(false);
  });

  it("a reset button announces once, after the panel is closed", () => {
    // The panel Reset restores every dimension, then the delegated defaults
    // (or the label config), then closes the panel — and only then announces,
    // once, for the whole operation. A notify fired by one dimension mid-way
    // would hand a subscriber a panel that is still open, and a subscriber
    // that tears the control down there would take the handler's own
    // closeStylePanel lookup with it.
    const { ui, layer, onMap } = oneOverlay();

    setIntent(ui, "overlay1", "zoomRange", [0, 3]);
    ui.intentStore.seedProvenance("overlay1", ["zoomRange"]);
    ui.onZoomEnd?.();
    expect(onMap.get(layer)).toBe(false);

    ui.openStylePanel("overlay1");
    const resetBtn = findItem(ui, "overlay1").querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLElement;
    expect(resetBtn).not.toBeNull();

    const atDelivery: Array<{ onMap: boolean; panelOpen: boolean }> = [];
    ui.events.on(EVENTS.LAYER_CHANGE, payload => {
      if (payload.id !== "overlay1") return;
      const item = ui.uiContainer?.querySelector(
        `[${CONST.DATA.LAYER_ID}="${payload.id}"]`,
      );
      atDelivery.push({
        onMap: onMap.get(layer) ?? false,
        panelOpen: !!item?.querySelector(`.${CONST.CLASSES.STYLE_PANEL}`),
      });
      if (atDelivery.length === 1) ui.c.destroy();
    });

    expect(() =>
      resetBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    ).not.toThrow();
    expect(atDelivery).toEqual([{ onMap: true, panelOpen: false }]);
    expect(ui.c.isDestroyed).toBe(true);
  });

  it("a zoomend announces after the open row's out-of-range chrome has settled", () => {
    // The map-level zoomend handler used to be one of two independent zoomend
    // listeners: the controller's sweep ran first and announced, and the
    // panel's row chrome caught up only after that notify had already fired.
    // A subscriber reading the row during the announce therefore saw the
    // pre-zoom "in range" face even though the current level was outside.
    // The sweep now syncs the open row before it publishes.
    const { ui, layer, onMap } = oneOverlay();

    setIntent(ui, "overlay1", "zoomRange", [0, 6]);
    ui.intentStore.seedProvenance("overlay1", ["zoomRange"]);
    expect(ui.c.map.getZoom()).toBe(5);

    ui.openStylePanel("overlay1");
    const row = findItem(ui, "overlay1").querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_ROW}`,
    ) as HTMLElement;
    expect(row.classList.contains(CONST.CLASSES.STYLE_ZOOM_RANGE_OUT_OF_RANGE)).toBe(
      false,
    );

    // Move past the range: the sweep removes the layer, and the row's
    // out-of-range state has to be true by the time the notify fires.
    ui.c.map.getZoom = vi.fn(() => 8);

    const outOfRangeAtDelivery: boolean[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, () => {
      outOfRangeAtDelivery.push(
        row.classList.contains(CONST.CLASSES.STYLE_ZOOM_RANGE_OUT_OF_RANGE),
      );
    });

    ui.onZoomEnd?.();

    expect(onMap.get(layer)).toBe(false);
    expect(outOfRangeAtDelivery).toEqual([true]);
    expect(row.classList.contains(CONST.CLASSES.STYLE_ZOOM_RANGE_OUT_OF_RANGE)).toBe(
      true,
    );
  });
});

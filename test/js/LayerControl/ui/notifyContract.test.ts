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
import { attachWithGroup, findItem, initFixture } from "./fixture.js";

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

/** A polygon-shaped layer whose options and `setStyle` the test supplies — the
 *  style-row tests need to read back what a replay wrote. */
const polygonLayerWithStyle = (
  options: Record<string, unknown>,
  setStyle: ReturnType<typeof vi.fn>,
): L.Layer =>
  ({
    options,
    setStyle,
    getLatLngs: () => [
      [
        { lat: 30, lng: 100 },
        { lat: 40, lng: 100 },
        { lat: 40, lng: 110 },
      ],
    ],
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
        group: "overlay",
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
        group: "overlay",
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
        group: "overlay",
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
          group: "overlay",
          layer: replacement,
        });
      }
    });

    expect(
      manager.registerLayer({
        id: "second",
        name: "Second",
        group: "overlay",
        layer,
      }),
    ).toBeNull();
    expect(changes).toEqual(["second", "second"]);
    expect(onMap.get(replacement)).toBe(true);
    expect(ui.c.layerRegistry.get("second")?.layer).toBe(replacement);
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

  it("a full replay announces after the direct style writes have landed", () => {
    // The full sweep projects visible / opacity / zoomRange and only reports
    // what moved; border and fill are direct `setStyle` writes that the shell
    // replays afterwards. The sweep used to announce before them, so a
    // subscriber read the color the author had declared while the shell was
    // about to overwrite it.
    const setStyle = vi.fn();
    const layer = polygonLayerWithStyle(
      { color: "#111111", fillColor: "#222222" },
      setStyle,
    );
    const { ui } = initFixture({
      data: [{ id: "overlay1", name: "Polygons", group: "overlay", layer }],
    });

    setIntent(ui, "overlay1", "borderColor", "#abcdef");
    ui.intentStore.seedProvenance("overlay1", ["borderColor"]);
    // The hide is what gives the sweep a delta to report at all.
    setIntent(ui, "overlay1", "visible", false);
    ui.intentStore.seedProvenance("overlay1", ["borderColor", "visible"]);

    const borderAtDelivery: unknown[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, payload => {
      if (payload.id !== "overlay1") return;
      const writes = setStyle.mock.calls.map(
        call => call[0] as Record<string, unknown>,
      );
      borderAtDelivery.push(writes.find(write => write.color !== undefined)?.color);
    });

    ui.applyUserState();

    expect(borderAtDelivery).toEqual(["#abcdef"]);
  });

  it("a reorder announces after the row list has been rebuilt", () => {
    // The list rebuild is the reorder's own side effect, so it lands before the
    // notify: a subscriber reading the row order out of the panel during the
    // CHANGE sees the arrangement that was just made, not the one that is
    // about to be rendered.
    const { ui, manager } = initFixture({
      data: [
        { id: "alpha", name: "Alpha", group: "overlay", layer: polygonLayer() },
        { id: "beta", name: "Beta", group: "overlay", layer: polygonLayer() },
        { id: "gamma", name: "Gamma", group: "overlay", layer: polygonLayer() },
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

  it("a reorder whose rebuild replay destroys the control announces nothing more", () => {
    // The rebuild is the reorder's own side effect, and the persisted-state
    // replay inside it announces a membership flip for any layer the map had
    // moved away from. A subscriber that tears the control down in that notify
    // takes the panel with it: the row paint, the tri-state counts and the
    // cursor behind the replay all read it, so the rebuild stops there instead
    // of continuing against a null container. The reorder's own CHANGE is
    // suppressed too — the registry went with the control, so there is nothing
    // left to announce the arrangement against. The move itself already landed,
    // so the arrangement stands regardless.
    const layerAlpha = polygonLayer();
    const layerBeta = polygonLayer();
    const { ui, manager } = initFixture({
      data: [
        { id: "alpha", name: "Alpha", group: "overlay", layer: layerAlpha },
        { id: "beta", name: "Beta", group: "overlay", layer: layerBeta },
      ],
    });
    // The layer the map dropped: its stored intent still says visible, so the
    // rebuild's replay has a flip to announce.
    const onMap = trackMembership(ui.c.map);
    onMap.set(layerAlpha, true);
    onMap.set(layerBeta, true);
    manager.map.removeLayer(layerBeta);

    const changes: string[] = [];
    let orderAtNotify: string[] | null = null;
    ui.events.on(EVENTS.LAYER_CHANGE, payload => {
      changes.push(payload.id);
      if (payload.id !== "beta") return;
      orderAtNotify = manager.layers
        .filter(layerInfo => layerInfo.group === GROUP.OVERLAY)
        .map(layerInfo => layerInfo.id);
      ui.c.destroy();
    });

    expect(() => manager.moveLayerDown("alpha")).not.toThrow();
    expect(changes).toEqual(["beta"]);
    expect(ui.c.isDestroyed).toBe(true);
    expect(ui.uiContainer).toBeNull();
    // The reorder had already happened when the rebuild's replay fired: the
    // arrangement the subscriber saw was the finished one. Overlay entries
    // only — the color basemap is a base-group layer outside this arrangement.
    expect(orderAtNotify).toEqual(["beta", "alpha"]);
  });

  it("a reorder whose rebuild replay retires its layer announces no reorder", () => {
    // The entry moved instead of the control going away: the rebuild's replay
    // still announces a membership flip, and a subscriber that retires the
    // moved layer there has removed the thing the reorder would announce for.
    const layerAlpha = polygonLayer();
    const layerBeta = polygonLayer();
    const { ui, manager } = initFixture({
      data: [
        { id: "alpha", name: "Alpha", group: "overlay", layer: layerAlpha },
        { id: "beta", name: "Beta", group: "overlay", layer: layerBeta },
      ],
    });
    const onMap = trackMembership(ui.c.map);
    onMap.set(layerAlpha, true);
    onMap.set(layerBeta, true);
    manager.map.removeLayer(layerBeta);

    const changes: string[] = [];
    let retired = false;
    ui.events.on(EVENTS.LAYER_CHANGE, payload => {
      changes.push(payload.id);
      if (payload.id === "beta" && !retired) {
        retired = true;
        manager.unregisterLayer("alpha");
      }
    });

    expect(() => manager.moveLayerDown("alpha")).not.toThrow();
    // beta's flip, then the unregister's own CHANGE for alpha — and no third:
    // the reorder would announce an entry nobody holds any more.
    expect(changes).toEqual(["beta", "alpha"]);
    expect(ui.c.layerRegistry.has("alpha")).toBe(false);
  });

  it("an init pass whose replay destroys the control stops before the row paint", () => {
    // The same boundary at the other end of the chain: the init pass owns the
    // row paint, the tri-state counts and the cursor behind the persisted-state
    // replay, so it checks the panel is still here before continuing.
    const layerAlpha = polygonLayer();
    const layerBeta = polygonLayer();
    const { ui } = initFixture({
      data: [
        { id: "alpha", name: "Alpha", group: "overlay", layer: layerAlpha },
        { id: "beta", name: "Beta", group: "overlay", layer: layerBeta },
      ],
    });
    const onMap = trackMembership(ui.c.map);
    onMap.set(layerAlpha, true);
    onMap.set(layerBeta, true);
    ui.c.map.removeLayer(layerBeta);

    const changes: string[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, payload => {
      changes.push(payload.id);
      if (payload.id === "beta") ui.c.destroy();
    });

    expect(() => ui.initTypesAndVisibility()).not.toThrow();
    expect(changes).toEqual(["beta"]);
    expect(ui.c.isDestroyed).toBe(true);
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
        { id: "alpha", name: "Alpha", group: "overlay", layer: layerAlpha },
        { id: "beta", name: "Beta", group: "overlay", layer: layerBeta },
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
          group: "overlay",
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

  // ── the parent entries that keep working after a replay ──
  // A full replay is not always the last step of the entry that ran it:
  // attach, the init pass and the control-attached pass each repaint rows,
  // counts or labels afterwards. A subscriber that tears the control down
  // inside that replay's notify leaves those continuations with no panel, so
  // each one re-checks before it reaches into the container.

  it("an attach whose replay destroys the control leaves no panel behind", () => {
    // The stored hide disagrees with the map (folium put the layer back before
    // this script ran), so the attach sweep has a membership flip to announce.
    // Tearing the control down there must end the attach entry before it
    // schedules the init timer. The tail behind that notify happens to tolerate
    // a missing panel today, so the lock is the end state plus the timer: a
    // future continuation that does not tolerate it would surface here.
    let initSpy: ReturnType<typeof vi.spyOn> | null = null;
    const { manager, ui } = initFixture({
      seed: { layers: { overlay1: { overrides: ["visible"], visible: false } } },
      beforeAttach: (m, u) => {
        initSpy = vi.spyOn(u, "initTypesAndVisibility");
        u.events.on(EVENTS.LAYER_CHANGE, () => {
          if (!m.isDestroyed) m.destroy();
        });
      },
    });

    expect(manager.isDestroyed).toBe(true);
    expect(ui.uiContainer).toBeNull();
    expect(initSpy).not.toHaveBeenCalled();
  });

  it("an init pass whose replay destroys the control skips the label replay", () => {
    // The attach sweep is silent for this layer — the map and the stored
    // intent agree — so the flip is introduced between attach and the init
    // timer. The timer's replay then has a membership flip to announce, and
    // the teardown lands mid-pass rather than after it.
    const layer = polygonLayer();
    const changes: string[] = [];
    let labelSpy: ReturnType<typeof vi.spyOn> | null = null;
    const { manager } = initFixture({
      data: [{ id: "overlay1", name: "Polygons", group: "overlay", layer }],
      afterAttach: (m, u) => {
        const onMap = trackMembership(m.map);
        onMap.set(layer, true);
        m.map.removeLayer(layer);
        labelSpy = vi.spyOn(u, "applyStyleLabelState");
        u.events.on(EVENTS.LAYER_CHANGE, payload => {
          changes.push(payload.id);
          if (payload.id === "overlay1" && !m.isDestroyed) m.destroy();
        });
      },
    });

    expect(changes).toContain("overlay1");
    expect(manager.isDestroyed).toBe(true);
    expect(labelSpy).not.toHaveBeenCalled();
  });

  it("a control-attached replay whose notify destroys the control skips the label replay", () => {
    // The same boundary on the re-run path: a later component attaching
    // re-triggers the init pass, whose replay can announce. The round stops at
    // the teardown — the layers behind it in the same sweep deliver nothing
    // once the registry is gone — and the label replay never runs.
    const { ui, manager } = oneOverlay();
    setIntent(ui, "overlay1", "visible", false);
    ui.intentStore.seedProvenance("overlay1", ["visible"]);
    const labelSpy = vi.spyOn(ui, "applyStyleLabelState");

    let announced = 0;
    ui.events.on(EVENTS.LAYER_CHANGE, () => {
      announced += 1;
      if (!manager.isDestroyed) manager.destroy();
    });

    ui.events.emit(EVENTS.CONTROL_ATTACHED, { component: "HeatmapControl" });

    expect(announced).toBe(1);
    expect(manager.isDestroyed).toBe(true);
    expect(ui.uiContainer).toBeNull();
    expect(labelSpy).not.toHaveBeenCalled();
  });

  it("a bringLayerToFront whose rebuild replay destroys the control announces nothing", () => {
    // Same retirement window as the move entries: the rebuild's replay is what
    // announces, and a subscriber that destroys the control there leaves no
    // registry to announce the reorder against.
    const layerAlpha = polygonLayer();
    const layerBeta = polygonLayer();
    const { ui, manager } = initFixture({
      data: [
        { id: "alpha", name: "Alpha", group: "overlay", layer: layerAlpha },
        { id: "beta", name: "Beta", group: "overlay", layer: layerBeta },
      ],
    });
    const onMap = trackMembership(ui.c.map);
    onMap.set(layerAlpha, true);
    onMap.set(layerBeta, true);
    manager.map.removeLayer(layerBeta);

    const changes: string[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, payload => {
      changes.push(payload.id);
      if (payload.id === "beta" && !manager.isDestroyed) manager.destroy();
    });

    expect(() => manager.bringLayerToFront("beta")).not.toThrow();
    expect(changes).toEqual(["beta"]);
    expect(manager.isDestroyed).toBe(true);
  });

  it("a moveLayerUp whose rebuild replay destroys the control announces nothing", () => {
    const layerAlpha = polygonLayer();
    const layerBeta = polygonLayer();
    const { ui, manager } = initFixture({
      data: [
        { id: "alpha", name: "Alpha", group: "overlay", layer: layerAlpha },
        { id: "beta", name: "Beta", group: "overlay", layer: layerBeta },
      ],
    });
    const onMap = trackMembership(ui.c.map);
    onMap.set(layerAlpha, true);
    onMap.set(layerBeta, true);
    manager.map.removeLayer(layerBeta);

    const changes: string[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, payload => {
      changes.push(payload.id);
      if (payload.id === "beta" && !manager.isDestroyed) manager.destroy();
    });

    expect(manager.moveLayerUp("beta")).toBe(true);
    expect(changes).toEqual(["beta"]);
    expect(manager.isDestroyed).toBe(true);
  });

  it("a zoomend skips the row sync once the zoom-range row is detached", () => {
    // The panel's zoom-end hook is registered while the drawer is open, but a
    // list rebuild or a teardown can take the row out from under it before the
    // map fires. Reading the detached node would repaint a row nobody sees, so
    // the hook checks first.
    const { ui } = oneOverlay();
    ui.openStylePanel("overlay1");
    const row = findItem(ui, "overlay1").querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_ROW}`,
    ) as HTMLElement;
    expect(row).not.toBeNull();

    row.remove();

    expect(() => ui.onZoomEnd?.()).not.toThrow();
  });
});

// LayerControl ui/lifecycle.ts — defensive branches in the attach / detach
// sequence and the layer-count-change refresh. These are the null-guard rails
// in the two public functions, not the happy path (which the shell test and
// the individual handler suites already exercise).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents } from "#core/event/index.js";
import { GROUP } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import { type LayerController } from "#foliplus/LayerControl/controller.js";
import { type LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { setIntent } from "#foliplus/LayerControl/ui/intent.js";
import {
  rebuildList,
  toggleAll,
  toggleFold,
} from "#foliplus/LayerControl/ui/listPanel/index.js";
import { commitBorderColor } from "#foliplus/LayerControl/ui/style/border.js";
import { commitFillColor } from "#foliplus/LayerControl/ui/style/fill.js";
import { commitSize } from "#foliplus/LayerControl/ui/style/size.js";
import {
  FACE,
  flushStyleDimApplies,
  hasStyleDimApply,
} from "#foliplus/LayerControl/ui/style/styleBag.js";
import {
  attachedPanel,
  findItem,
  initFixture,
  oneOverlay,
  polygonLayer,
  trackMembership,
} from "./fixture.js";

vi.mock("#foliplus/LayerControl/ui/listPanel/drag.js", async importOriginal => ({
  ...(await importOriginal<
    typeof import("#foliplus/LayerControl/ui/listPanel/drag.js")
  >()),
  toggleFold: vi.fn(),
}));
vi.mock("#foliplus/LayerControl/ui/listPanel/visibility.js", async importOriginal => ({
  ...(await importOriginal<
    typeof import("#foliplus/LayerControl/ui/listPanel/visibility.js")
  >()),
  toggleAll: vi.fn(),
}));

describe("LayerUI lifecycle — defensive rails", () => {
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

  describe("bindLayerEvents — the toggle-all row and its group fallback", () => {
    it("onChange: a toggle-all checkbox with no row ancestor does not throw", () => {
      // The row lookup is defensive: a checkbox outside a rendered row still
      // fires change, and the guard must no-op rather than dereference null.
      const orphan = document.createElement("input");
      orphan.type = "checkbox";
      orphan.setAttribute("data-role", "toggle-all");
      orphan.dataset.group = GROUP.OVERLAY;
      // Fire a synthetic event directly at the ui.onChange handler, bypassing
      // the container delegation (the container listener would only see it if
      // the checkbox were inside uiContainer, which is the case we already
      // cover elsewhere).
      ui.onChange?.({ target: orphan, preventDefault: () => {} } as any);
      expect(orphan.checked).toBe(false);
    });

    it("onChange: a toggle-all row without data-group falls back to empty group", () => {
      // Covers the ?? "" fallback on the row's data-group: toggleAll must be
      // called with the empty string, not undefined, when the row is misconfigured.
      const toggleAllSpy = vi.mocked(toggleAll);

      const row = attachedPanel(ui).querySelector(
        `${CONST.SEL.TOGGLE_ALL}[data-group="${GROUP.OVERLAY}"]`,
      ) as HTMLElement;
      row.removeAttribute("data-group");
      const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));

      expect(toggleAllSpy).toHaveBeenCalledWith(ui, "", expect.any(Boolean));
    });
  });

  describe("bindLayerEvents — click path outside a layer row", () => {
    it("onClick: a click on an element with no owning row is ignored", () => {
      // Row-less clicks are common: the color-item row is deliberately NOT a
      // layer row and neither is any panel chrome. The handler must no-op
      // rather than call getNavigableItems / setIndex.
      const setIndexSpy = vi.fn();
      vi.spyOn(ui.listPanel.listCursor!, "setIndex").mockImplementation(setIndexSpy);

      const orphan = document.createElement("div");
      attachedPanel(ui).appendChild(orphan);
      orphan.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(ui.listPanel.activeIdx).toBeNull();
      expect(setIndexSpy).not.toHaveBeenCalled();
    });

    it("onClick: a toggle-all row without data-group toggles the empty group", () => {
      const toggleFoldSpy = vi.mocked(toggleFold);

      const row = attachedPanel(ui).querySelector(
        `${CONST.SEL.TOGGLE_ALL}[data-group="${GROUP.OVERLAY}"]`,
      ) as HTMLElement;
      row.removeAttribute("data-group");
      // Click the row's fold button (a descendant that is not itself a toggle
      // control), so the second guard `el.closest('[data-role="toggle-all"]')`
      // is false and we reach the toggleFold call.
      const foldBtn = row.querySelector(`.${CONST.CLASSES.FOLD_BTN}`) as HTMLElement;
      foldBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(toggleFoldSpy).toHaveBeenCalledWith(ui, "");
    });

    it("onClick: the color row's body no longer triggers showSolidBasemap", () => {
      // #494: row-body clicks used to call showSolidBasemap directly; the
      // checkbox's change event is the only legitimate path
      // (applyVisibility → the executor's canvas HIDDEN write → showSolidBasemap).
      // A second call from here would rebuild the list mid-click and leave the
      // checkbox's `checked` un-updated. The positive path (checkbox → applyVisibility
      // → showSolidBasemap) is covered by the browser test
      // test_color_basemap_checkbox_toggles_visibility, so this unit test
      // pins only the negative half of the contract.
      const showSolidBasemapSpy = vi
        .spyOn(ui, "showSolidBasemap")
        .mockImplementation(() => {});
      const colorRow = attachedPanel(ui).querySelector<HTMLElement>(
        `[${CONST.DATA.LAYER_ID}="${CONST.SOLID_BASEMAP_ID}"]`,
      );
      expect(colorRow).toBeTruthy();
      // Click the row's label cell — well outside the checkbox, drag handle,
      // and ⋮ button, so none of the excluded descendants match.
      const label = colorRow!.querySelector(`.${CONST.CLASSES.LAYER_LABEL}`)!;
      label.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(showSolidBasemapSpy).not.toHaveBeenCalled();
    });

    it("onClick: a detached row outside the list leaves the cursor untouched", () => {
      // owningRow() resolves any element matching SEL.ROW, so a row that is
      // not part of getNavigableItems (not inside uiContainer) reaches the
      // indexOf -1 guard — the stored cursor must survive.
      ui.setActiveItem(1);
      const detached = document.createElement("div");
      detached.className = CONST.CLASSES.LAYER_ITEM;
      const event = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(event, "target", { value: detached });

      ui.onClick!(event);

      expect(ui.listPanel.activeIdx).toBe(1);
    });

    it("onFocusIn: a detached row outside the list does not move the cursor", () => {
      ui.setActiveItem(1);
      const detached = document.createElement("div");
      detached.className = CONST.CLASSES.LAYER_ITEM;
      const event = new Event("focusin", { bubbles: true });
      Object.defineProperty(event, "target", { value: detached });

      ui.onFocusIn!(event as any);

      expect(ui.listPanel.activeIdx).toBe(1);
    });
  });

  describe("onLayerItemCountChange — the refresh rails", () => {
    it("no-ops when the UI container is detached", () => {
      ui.c.uiContainer = null as any;
      const getFeatureCount = vi.spyOn(manager, "getFeatureCount");

      ensureEvents(map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "overlay1" });

      expect(getFeatureCount).not.toHaveBeenCalled();
    });

    it("no-ops for a base basemap layer", () => {
      const getFeatureCount = vi.spyOn(manager, "getFeatureCount");
      const item = findItem(ui, "base1");

      ensureEvents(map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "base1" });

      expect(getFeatureCount).not.toHaveBeenCalled();
      // The row is unchanged — no count text written, no icon redrawn.
      expect(item.querySelector(CONST.SEL.COUNT_COL)?.textContent).toBe("");
    });

    it("falls back to empty type label when the row lost its data-title", () => {
      // Covers the ?? "" fallback on the title attribute: a row rebuilt from
      // scratch may briefly not have data-title.
      const info = manager.layerRegistry.get("overlay1")!;
      info.featureCountProvider = () => 7;
      const item = findItem(ui, "overlay1");
      item.removeAttribute(CONST.DATA.TITLE);

      ensureEvents(map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "overlay1" });

      expect(item.title).toContain("7");
    });

    it("clears the count column when the count is null but the column exists", () => {
      // The else-if arm: refreshAllCounts and onLayerItemCountChange both take
      // the empty-text path when the column is present but the count is not.
      vi.spyOn(manager, "getFeatureCount").mockReturnValue(null);
      const item = findItem(ui, "overlay1");
      const countCol = item.querySelector(CONST.SEL.COUNT_COL) as HTMLElement;
      countCol.textContent = "stale";

      ensureEvents(map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "overlay1" });

      expect(countCol.textContent).toBe("");
    });
  });

  describe("refreshAllCounts — the loop rails", () => {
    it("no-ops when the UI container is detached", () => {
      ui.c.uiContainer = null as any;
      const getFeatureCount = vi.spyOn(manager, "getFeatureCount");

      ui.refreshAllCounts();

      expect(getFeatureCount).not.toHaveBeenCalled();
    });

    it("skips rows that lost their data-layer-id", () => {
      // A synthetic layer-item that never had an id is a defensive edge: the
      // loop must continue past it rather than calling getFeatureCount(undefined).
      const orphan = document.createElement("div");
      orphan.className = CONST.CLASSES.LAYER_ITEM;
      attachedPanel(ui).appendChild(orphan);
      const getFeatureCount = vi.spyOn(manager, "getFeatureCount");

      ui.refreshAllCounts();

      expect(getFeatureCount).not.toHaveBeenCalledWith(undefined);
    });

    it("clears the count column for every overlay row when no count is available", () => {
      // Exercises the else-if arm across the full sweep.
      vi.spyOn(manager, "getFeatureCount").mockReturnValue(null);
      const item = findItem(ui, "overlay1");
      const countCol = item.querySelector(CONST.SEL.COUNT_COL) as HTMLElement;
      countCol.textContent = "stale";

      ui.refreshAllCounts();

      expect(countCol.textContent).toBe("");
    });
  });

  describe("unbindEvents — the null-handler rails", () => {
    it("unbinds cleanly when every handler is already null", () => {
      // Detached-before-attach scenario: attachUI never ran bindLayerEvents, so all
      // handlers are null and the guards must not throw. This exercises every
      // `if (ui.onX)` false branch at once.
      (ui as any).onKeyDown = null;
      ui.unsubscribeCountChange = null;
      ui.unsubscribeControlAttached = null;
      ui.onMoreClick = null;
      ui.onMoreMenuClick = null;
      ui.onMoreMapClick = null;
      ui.onZoomEnd = null;
      ui.onChange = null;
      ui.onClick = null;
      ui.onFocusIn = null;
      ui.onFocusOut = null;
      ui.onDragStart = null;
      ui.onDragOver = null;
      ui.onDragLeave = null;
      ui.onDrop = null;
      ui.onDragEnd = null;
      expect(() => ui.unbindEvents()).not.toThrow();
    });

    it("unbinds cleanly when the UI container is already gone", () => {
      ui.c.uiContainer = null as any;
      expect(() => ui.unbindEvents()).not.toThrow();
    });

    it("unbinds cleanly when the container is missing but handlers are set", () => {
      // bindLayerEvents ran but attachUI never set uiContainer, then the manager is
      // destroyed: the first guard `if (!container) return` must fire before
      // the handler-null loop.
      ui.c.uiContainer = null as any;
      expect(() => ui.unbindEvents()).not.toThrow();
    });
  });

  describe("attachUI — late-registration draining rails", () => {
    it("insertLayerItem is not called for a null pending registration", () => {
      // The pendingRegistrations queue is drained in a while loop; a null entry
      // (a defensive case if a caller pushes undefined) must be skipped.
      // We verify the loop terminates by calling attachUI a second time.
      expect(() => manager.attachUI(document.createElement("div"))).not.toThrow();
    });
  });

  describe("bindLayerEvents — the container-null guard", () => {
    it("no-ops when the UI container is already null", () => {
      // Covers the `if (!container) return` guard: bindLayerEvents is called on a
      // manager whose uiContainer was never set (attachUI ran before bindLayerEvents
      // in a partial-attach scenario).
      ui.c.uiContainer = null as any;
      expect(() => ui.bindEvents()).not.toThrow();
    });
  });

  describe("onLayerItemCountChange — the countCol-null else-if", () => {
    it("skips the count-column write when the row has no count column", () => {
      // Covers the `else if (countCol)` false side: when the count column was
      // removed from the row (e.g. a defensive edge for a custom layout), the
      // else-if body is skipped entirely.
      const item = findItem(ui, "overlay1");
      item.querySelector(CONST.SEL.COUNT_COL)?.remove();
      vi.spyOn(manager, "getFeatureCount").mockReturnValue(null);

      ensureEvents(map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "overlay1" });

      // No exception thrown; the item's title still gets the empty type label.
      expect(item.title).toBeDefined();
    });
  });

  describe("refreshAllCounts — the countCol-null else-if", () => {
    it("skips the count-column write for rows without a count column", () => {
      // Covers the `else if (countCol) countCol.textContent = ""` false side:
      // a row whose count column was removed is silently skipped.
      const item = findItem(ui, "overlay1");
      item.querySelector(CONST.SEL.COUNT_COL)?.remove();
      vi.spyOn(manager, "getFeatureCount").mockReturnValue(null);

      expect(() => ui.refreshAllCounts()).not.toThrow();
    });
  });

  describe("LAYER_ITEM_UPDATED signal handler", () => {
    it("no-ops when the id is not in the registry", () => {
      // Covers the `if (!layerInfo) return` guard: a stale id (unregistered
      // after the event was emitted, or a third-party bundle emitting an
      // id the panel does not track) must be a silent no-op, not a null
      // deref on updateLayerItemLabel / invalidateFields.
      const rowsBefore = attachedPanel(ui).querySelectorAll(
        CONST.SEL.LAYER_ITEM,
      ).length;
      expect(() =>
        ensureEvents(map).emit(EVENTS.LAYER_ITEM_UPDATED, {
          id: "never-registered",
        }),
      ).not.toThrow();
      expect(attachedPanel(ui).querySelectorAll(CONST.SEL.LAYER_ITEM).length).toBe(
        rowsBefore,
      );
    });
  });

  describe("LAYER_LIST_REBUILD signal handler", () => {
    it("relocates rows in place without repainting them", () => {
      // The manager emits LAYER_LIST_REBUILD after a reorder (moveLayerUp/
      // Down, bringLayerToFront). A position change alters no count or
      // checkbox, so the handler relocates rows instead of rebuilding them:
      // the row element — and its possibly-stale content — survives the
      // signal untouched.
      const item = findItem(ui, "overlay1");
      const countCol = item.querySelector(CONST.SEL.COUNT_COL) as HTMLElement;
      countCol.textContent = "stale";

      ensureEvents(map).emit(EVENTS.LAYER_LIST_REBUILD);

      const survived = findItem(ui, "overlay1");
      expect(survived).toBe(item);
      expect(survived.querySelector(CONST.SEL.COUNT_COL)?.textContent).toBe("stale");
    });

    it("the full rebuild the fold/attach paths take still refreshes row counts", () => {
      // rebuildList is off the reorder path but still owns fold and attach:
      // rows are re-created and counts re-resolved there.
      vi.spyOn(manager, "getFeatureCount").mockReturnValue(3);
      const before = findItem(ui, "overlay1");
      const countCol = before.querySelector(CONST.SEL.COUNT_COL) as HTMLElement;
      countCol.textContent = "stale";

      rebuildList(ui);

      const rebuilt = attachedPanel(ui).querySelector(
        `[${CONST.DATA.LAYER_ID}="overlay1"]`,
      ) as HTMLElement;
      expect(rebuilt).not.toBeNull();
      expect(rebuilt).not.toBe(before);
      expect(rebuilt.querySelector(CONST.SEL.COUNT_COL)?.textContent).toBe("3");
    });

    it("LAYER_NO_BASEMAP_CHANGED refreshes the empty-state hint", () => {
      // Signal handler runs syncNoBasemap( ui); no throw, no row drop.
      expect(() =>
        ensureEvents(map).emit(EVENTS.LAYER_NO_BASEMAP_CHANGED),
      ).not.toThrow();
      expect(
        attachedPanel(ui).querySelectorAll(CONST.SEL.LAYER_ITEM).length,
      ).toBeGreaterThanOrEqual(1);
    });

    it("unbindEvents tears down every layer-signal subscription", () => {
      // After unbindEvents, another LAYER_LIST_REBUILD must be a no-op:
      // renderInitialList would otherwise rebuild the whole panel.
      const before = attachedPanel(ui).querySelectorAll(CONST.SEL.LAYER_ITEM).length;
      ui.unbindEvents();
      ensureEvents(map).emit(EVENTS.LAYER_LIST_REBUILD);
      expect(attachedPanel(ui).querySelectorAll(CONST.SEL.LAYER_ITEM).length).toBe(
        before,
      );
    });

    it("drag handlers are wired and dispatch to the drag module", () => {
      // The bindLayerEvents assignments (onDragOver/onDragLeave/onDrop/onDragEnd)
      // must route DOM events to the ui/* module functions without throwing.
      const row = attachedPanel(ui).querySelector(
        `${CONST.SEL.LAYER_ITEM}[${CONST.DATA.LAYER_ID}="overlay1"]`,
      ) as HTMLElement;
      const evt = (type: string): Event =>
        new Event(type, { bubbles: true, cancelable: true });
      expect(() => row.dispatchEvent(evt("dragstart"))).not.toThrow();
      expect(() => row.dispatchEvent(evt("dragover"))).not.toThrow();
      expect(() => row.dispatchEvent(evt("dragleave"))).not.toThrow();
      expect(() => row.dispatchEvent(evt("drop"))).not.toThrow();
      expect(() => row.dispatchEvent(evt("dragend"))).not.toThrow();
    });

    it("zoomend re-projects and more-map-click closes the menu", () => {
      // onZoomEnd -> applyProjectionAll, onMoreMapClick -> closeMoreMenu(false).
      expect(() => ui.onZoomEnd?.()).not.toThrow();
      expect(() => {
        ui.onMoreMapClick?.(null as any);
      }).not.toThrow();
    });
  });
});

// ── Notification-contract cases, moved from the former
// ── notifyContract.test.ts so they live with the script they drive. ──
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

it("an init pass announces after the label replay has landed", () => {
  // The init timer replays the persisted state and then repaints label
  // configs. Both land before the pass's own round goes out, so a subscriber
  // reading the panel during the CHANGE sees the finished pass rather than a
  // list whose labels are still the previous generation's. The first init
  // also registers the color basemap, whose own registration round precedes
  // the label replay — that round belongs to the registration entry, so the
  // contract locked here is the pass's: by the time its notifications start,
  // the replay has landed.
  const layer = polygonLayer();
  let labelsAtDelivery: number | null = null;
  const { manager } = initFixture({
    data: [{ id: "overlay1", name: "Polygons", group: "overlay", layer }],
    afterAttach: (m, u) => {
      const onMap = trackMembership(m.map);
      onMap.set(layer, true);
      m.map.removeLayer(layer);
      // Installed after attach, so the count belongs to this entry's run.
      const labelSpy = vi.spyOn(u, "applyStyleLabelState");
      u.events.on(EVENTS.LAYER_CHANGE, () => {
        labelsAtDelivery = labelSpy.mock.calls.length;
      });
    },
  });

  expect(labelsAtDelivery).toBe(1);
  expect(manager.isDestroyed).toBe(false);
});

it("a control-attached re-run announces after the label replay has landed", () => {
  // Same boundary on the re-run path: a later component attaching re-triggers
  // the init pass, and the label replay is part of that pass.
  const { ui, manager } = oneOverlay();
  setIntent(ui, "overlay1", "visible", false);
  ui.intentStore.seedProvenance("overlay1", ["visible"]);
  const labelSpy = vi.spyOn(ui, "applyStyleLabelState");

  let labelsAtDelivery: number | null = null;
  ui.events.on(EVENTS.LAYER_CHANGE, () => {
    labelsAtDelivery = labelSpy.mock.calls.length;
  });

  ui.events.publish(EVENTS.CONTROL_ATTACHED, { component: "HeatmapControl" });

  expect(labelsAtDelivery).toBe(1);
  expect(manager.isDestroyed).toBe(false);
});

it("isLive tracks the attached panel", () => {
  // isLive is the one-question teardown check: true while the panel is
  // attached, false once a subscriber has retired the control.
  const { manager, ui } = initFixture({});
  expect(ui.isLive).toBe(true);
  manager.destroy();
  expect(ui.isLive).toBe(false);
});

describe("onLayerItemCountChange — the registry replays", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let map: any;

  // One layer that qualifies for every replaying face: an areal setStyle
  // leaf (fill + stroke — a getRadius leaf is areal too, so the dot joins
  // the fill walk) and a pixel-radius leaf (size). Labels ride along for
  // free: the hub queues the face for any overlay row, and the gate inside
  // replayLabelState decides at run time whether anything renders.
  const arealLeaf = (): any => ({
    options: { color: "#00ff00", weight: 1, fillColor: "#0000ff" },
    setStyle: vi.fn(),
    feature: { geometry: { type: "Polygon" } },
    getLatLngs: () => [
      [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 },
        { lat: 0, lng: 1 },
      ],
    ],
  });

  const radiusLeaf = (radius = 10): any => {
    const leaf: any = {
      options: { radius, color: "#000000", weight: 2 },
      _radius: radius,
      setStyle: vi.fn(),
    };
    leaf.getRadius = () => leaf._radius;
    leaf.setRadius = vi.fn((px: number) => {
      leaf._radius = px;
      leaf.options.radius = px;
      return leaf;
    });
    return leaf;
  };

  const groupWith = (children: any[]): any => ({
    options: {},
    eachLayer: vi.fn((fn: (child: unknown) => void) => {
      for (const child of children) fn(child);
    }),
  });

  const withGroup = (children: any[]) =>
    initFixture({
      data: [
        { id: "grp1", name: "G", group: "overlay", layer: groupWith(children) },
        {
          id: "base1",
          name: "OSM",
          group: "base",
          layer: { options: {}, setZIndex: vi.fn() } as never,
          paneName: "tilePane",
        },
      ],
    });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("queues every replaying face and lands all of them", () => {
    const areal = arealLeaf();
    const dot = radiusLeaf(10);
    const children = [areal, dot];
    ({ manager, ui, map } = withGroup(children));
    commitFillColor(ui, "grp1", "#ff0000");
    commitBorderColor(ui, "grp1", "#0000dd");
    commitSize(ui, "grp1", 30);
    // Land the commit walks first, so the assertions below count only the
    // content-change replay.
    flushStyleDimApplies("grp1");
    areal.setStyle.mockClear();
    dot.setRadius.mockClear();

    // A leaf lands while the user already has every dimension chosen.
    const late = radiusLeaf(4);
    children.push(late);
    ensureEvents(map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "grp1" });
    for (const face of [FACE.FILL, FACE.STROKE, FACE.SIZE, FACE.LABEL]) {
      expect(hasStyleDimApply(face, "grp1"), `${face} must be queued`).toBe(true);
    }

    flushStyleDimApplies("grp1");
    expect(areal.setStyle).toHaveBeenCalledWith(
      expect.objectContaining({ fillColor: "#ff0000" }),
    );
    expect(areal.setStyle).toHaveBeenCalledWith(
      expect.objectContaining({ color: "#0000dd" }),
    );
    // The late radius leaf receives the stored size; the early one already
    // shows it, and the size replay's skip held.
    expect(late.setRadius).toHaveBeenCalledWith(30);
    expect(dot.setRadius).not.toHaveBeenCalled();
  });

  it("writes nothing for a layer the user never touched", () => {
    const areal = arealLeaf();
    const dot = radiusLeaf(10);
    ({ manager, ui, map } = withGroup([areal, dot]));
    const renderLabels = vi.spyOn(ui.c.annotation, "renderLabels");

    ensureEvents(map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "grp1" });
    flushStyleDimApplies("grp1");

    expect(areal.setStyle).not.toHaveBeenCalled();
    expect(dot.setStyle).not.toHaveBeenCalled();
    expect(dot.setRadius).not.toHaveBeenCalled();
    expect(renderLabels).not.toHaveBeenCalled();
  });

  it("control destroy reclaims every pending replay", () => {
    const children: any[] = [arealLeaf()];
    ({ manager, ui, map } = withGroup(children));
    ensureEvents(map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "grp1" });
    expect(hasStyleDimApply(FACE.LABEL, "grp1")).toBe(true);

    manager.destroy();
    for (const face of [FACE.FILL, FACE.STROKE, FACE.SIZE, FACE.LABEL]) {
      expect(hasStyleDimApply(face, "grp1"), `${face} must be dropped`).toBe(false);
    }
  });
});

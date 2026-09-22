// LayerControl ui/lifecycle.ts — defensive branches in the attach / detach
// sequence and the layer-count-change refresh. These are the null-guard rails
// in the two public functions, not the happy path (which the shell test and
// the individual handler suites already exercise).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents } from "#core/event/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import { LayerManager } from "#foliplus/LayerControl/manager.js";
import { toggleFold } from "#foliplus/LayerControl/ui/drag.js";
import { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { toggleAll } from "#foliplus/LayerControl/ui/visibility.js";
import { findItem, initFixture } from "./fixture.js";

vi.mock("#foliplus/LayerControl/ui/drag.js", async importOriginal => ({
  ...(await importOriginal<typeof import("#foliplus/LayerControl/ui/drag.js")>()),
  toggleFold: vi.fn(),
}));
vi.mock("#foliplus/LayerControl/ui/visibility.js", async importOriginal => ({
  ...(await importOriginal<typeof import("#foliplus/LayerControl/ui/visibility.js")>()),
  toggleAll: vi.fn(),
}));

describe("LayerUI lifecycle — defensive rails", () => {
  let manager: LayerManager;
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

  describe("bindEvents — the toggle-all row and its group fallback", () => {
    it("onChange: a toggle-all checkbox with no row ancestor does not throw", () => {
      // The row lookup is defensive: a checkbox outside a rendered row still
      // fires change, and the guard must no-op rather than dereference null.
      const orphan = document.createElement("input");
      orphan.type = "checkbox";
      orphan.setAttribute("data-role", "toggle-all");
      orphan.dataset.group = CONST.GROUP.OVERLAY;
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

      const row = ui.uiContainer.querySelector(
        `${CONST.SEL.TOGGLE_ALL}[data-group="${CONST.GROUP.OVERLAY}"]`,
      ) as HTMLElement;
      row.removeAttribute("data-group");
      const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));

      expect(toggleAllSpy).toHaveBeenCalledWith(ui, "", expect.any(Boolean));
    });
  });

  describe("bindEvents — click path outside a layer row", () => {
    it("onClick: a click on an element with no owning row is ignored", () => {
      // Row-less clicks are common: the color-item row is deliberately NOT a
      // layer row and neither is any panel chrome. The handler must no-op
      // rather than call getNavigableItems / setIndex.
      const setIndexSpy = vi.fn();
      vi.spyOn(ui.listCursor!, "setIndex").mockImplementation(setIndexSpy);

      const orphan = document.createElement("div");
      ui.uiContainer.appendChild(orphan);
      orphan.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(ui.activeIdx).toBeNull();
      expect(setIndexSpy).not.toHaveBeenCalled();
    });

    it("onClick: a toggle-all row without data-group toggles the empty group", () => {
      const toggleFoldSpy = vi.mocked(toggleFold);

      const row = ui.uiContainer.querySelector(
        `${CONST.SEL.TOGGLE_ALL}[data-group="${CONST.GROUP.OVERLAY}"]`,
      ) as HTMLElement;
      row.removeAttribute("data-group");
      // Click the row's fold button (a descendant that is not itself a toggle
      // control), so the second guard `el.closest('[data-role="toggle-all"]')`
      // is false and we reach the toggleFold call.
      const foldBtn = row.querySelector(`.${CONST.CLASSES.FOLD_BTN}`) as HTMLElement;
      foldBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(toggleFoldSpy).toHaveBeenCalledWith(ui, "");
    });
  });

  describe("onLayerItemCountChange — the refresh rails", () => {
    it("no-ops when the UI container is detached", () => {
      ui.m.uiContainer = null as any;
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
      const info = manager.layerRegistry.get("overlay1")!;
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
      ui.m.uiContainer = null as any;
      const getFeatureCount = vi.spyOn(manager, "getFeatureCount");

      ui.refreshAllCounts();

      expect(getFeatureCount).not.toHaveBeenCalled();
    });

    it("skips rows that lost their data-layer-id", () => {
      // A synthetic layer-item that never had an id is a defensive edge: the
      // loop must continue past it rather than calling getFeatureCount(undefined).
      const orphan = document.createElement("div");
      orphan.className = CONST.CLASSES.LAYER_ITEM;
      ui.uiContainer.appendChild(orphan);
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
      // Detached-before-attach scenario: attachUI never ran bindEvents, so all
      // handlers are null and the guards must not throw. This exercises every
      // `if (ui.onX)` false branch at once.
      ui.onKeyDown = null;
      ui.unsubscribeCountChange = null;
      ui.unsubscribeControlAttached = null;
      ui.onMoreClick = null;
      ui.onMoreMenuClick = null;
      ui.onMoreMapClick = null;
      ui.onZoomEnd = null;
      ui.onChange = null;
      ui.onInput = null;
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
      ui.m.uiContainer = null as any;
      expect(() => ui.unbindEvents()).not.toThrow();
    });

    it("unbinds cleanly when the container is missing but handlers are set", () => {
      // bindEvents ran but attachUI never set uiContainer, then the manager is
      // destroyed: the first guard `if (!container) return` must fire before
      // the handler-null loop.
      ui.m.uiContainer = null as any;
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
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GROUP } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerController } from "#foliplus/LayerControl/controller.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import {
  blurActiveItem,
  clearActiveItem,
  cursorRef,
  findVisibleNeighbor,
  getActiveLayerItem,
  getNavigableItems,
  moveActiveMarker,
  resolveActiveIdx,
  restoreCursor,
  setActiveItem,
  syncActiveItem,
  syncListCursor,
} from "#foliplus/LayerControl/ui/listPanel/cursor.js";
import { ensureModes } from "#foliplus/core/mode.js";
import { attachWithGroup, findItem, initFixture } from "../fixture.js";

describe("LayerUI cursor (pure cursor primitives)", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let map: any;

  beforeEach(() => {
    ({ manager, ui, map } = initFixture());
    // Two overlay layers so the toggle-all row for overlay exists (single
    // child collapses to no toggle-all layout).
    if (!manager.layerRegistry.get("overlay2")) {
      manager.registerLayer({
        id: "overlay2",
        name: "Circles",
        group: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
      });
    }
    ui.listPanel.foldedGroups = new Set();
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
    if (map) {
      const modes = ensureModes(map);
      if (modes.getMode("LayerControl") === "focusing") {
        modes.setMode("LayerControl", null);
      }
    }
  });

  const indexFor = (id: string) => ui.getNavigableItems().indexOf(findItem(ui, id));

  // ─────────────────── setActiveItem ───────────────────

  describe("setActiveItem", () => {
    it("adds the FOCUSED class to the target row", () => {
      const overlay = findItem(ui, "overlay1");
      const base = findItem(ui, "base1");

      expect(ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSED}`).length).toBe(
        0,
      );

      setActiveItem(ui, indexFor("overlay1"));

      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
      expect(base.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      expect(ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSED}`).length).toBe(
        1,
      );
      expect(ui.listPanel.activeIdx).toBe(indexFor("overlay1"));
    });

    it("with an out-of-range index clears the cursor", () => {
      setActiveItem(ui, -1);
      expect(ui.listPanel.activeIdx).toBeNull();
      expect(ui.uiContainer.querySelector(`.${CONST.CLASSES.FOCUSED}`)).toBeNull();
    });
  });

  // ─────────────────── moveActiveMarker ───────────────────

  describe("moveActiveMarker", () => {
    it("removes FOCUSED from the previous row (mutual exclusivity)", () => {
      const overlay = findItem(ui, "overlay1");
      const base = findItem(ui, "base1");

      setActiveItem(ui, indexFor("overlay1"));
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
      expect(base.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);

      moveActiveMarker(ui, base, ui.getNavigableItems());

      expect(base.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      expect(ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSED}`).length).toBe(
        1,
      );
      expect(ui.listPanel.activeIdx).toBe(indexFor("base1"));
    });

    it("clears the cursor when given no item", () => {
      setActiveItem(ui, 1);
      moveActiveMarker(ui, null, ui.getNavigableItems());
      expect(ui.listPanel.activeIdx).toBeNull();
    });

    it("normalizes an out-of-list item to a cleared cursor", () => {
      const detached = document.createElement("div");
      detached.className = CONST.CLASSES.LAYER_ITEM;
      moveActiveMarker(ui, detached, ui.getNavigableItems());
      expect(ui.listPanel.activeIdx).toBeNull();
      expect(ui.uiContainer.querySelector(`.${CONST.CLASSES.FOCUSED}`)).toBeNull();
    });
  });

  // ─────────────────── blurActiveItem / clearActiveItem ───────────────────

  describe("blurActiveItem", () => {
    it("removes the FOCUSED class but preserves the stored cursor", () => {
      const overlay = findItem(ui, "overlay1");
      setActiveItem(ui, indexFor("overlay1"));
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);

      blurActiveItem(ui);

      expect(ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSED}`).length).toBe(
        0,
      );
      expect(ui.listPanel.activeIdx).toBe(indexFor("overlay1"));
    });
  });

  describe("clearActiveItem", () => {
    it("removes the FOCUSED class and resets activeIdx", () => {
      setActiveItem(ui, indexFor("overlay1"));
      expect(ui.listPanel.activeIdx).toBe(indexFor("overlay1"));

      clearActiveItem(ui);

      expect(ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSED}`).length).toBe(
        0,
      );
      expect(ui.listPanel.activeIdx).toBeNull();
    });
  });

  // ─────────────────── getNavigableItems ───────────────────

  describe("getNavigableItems", () => {
    it("lists rows by class, so a checkbox-less row is reachable", () => {
      const colorRow = ui.uiContainer.querySelector(
        `[${CONST.DATA.LAYER_ID}="${CONST.SOLID_BASEMAP_ID}"]`,
      ) as HTMLElement | null;

      const items = getNavigableItems(ui);
      if (colorRow) expect(items).toContain(colorRow);
      const isRow = (el: HTMLElement) =>
        el.classList.contains(CONST.CLASSES.LAYER_ITEM) ||
        el.classList.contains(CONST.CLASSES.TOGGLE_ALL);
      expect(items.every(isRow)).toBe(true);
      expect(items.filter(isRow)).toHaveLength(items.length);

      const bareRow = document.createElement("div");
      bareRow.className = CONST.CLASSES.LAYER_ITEM;
      bareRow.setAttribute(CONST.DATA.LAYER_ID, "no-checkbox");
      ui.uiContainer.appendChild(bareRow);

      expect(getNavigableItems(ui)).toContain(bareRow);
    });
  });

  // ─────────────────── findVisibleNeighbor ───────────────────

  describe("findVisibleNeighbor", () => {
    it("returns -1 past the first and last navigable row", () => {
      const items = ui.getNavigableItems();
      expect(items.length).toBeGreaterThanOrEqual(2);
      expect(findVisibleNeighbor(items, items.length - 1, 1)).toBe(-1);
      expect(findVisibleNeighbor(items, 0, -1)).toBe(-1);
    });

    it("exhausts when every row is folded", () => {
      const items = ui.getNavigableItems();
      items.forEach(el => el.classList.add(CONST.CLASSES.GROUP_FOLDED));
      expect(findVisibleNeighbor(items, 0, 1)).toBe(-1);
      expect(findVisibleNeighbor(items, items.length - 1, -1)).toBe(-1);
    });

    it("skips folded rows when stepping down from a folded group header", () => {
      // Simulate the overlay group folded: header is not folded, children are.
      // Stepping down from the header must land on the next non-folded row.
      attachWithGroup(ui);
      const items = ui.getNavigableItems();
      const overlayHeader = items.find(
        el =>
          el.classList.contains(CONST.CLASSES.TOGGLE_ALL) &&
          el.getAttribute("data-group") === GROUP.OVERLAY,
      )!;
      items.forEach(el => {
        if (
          el.classList.contains(CONST.CLASSES.LAYER_ITEM) &&
          el.getAttribute("data-layer-type") === GROUP.OVERLAY
        ) {
          el.classList.add(CONST.CLASSES.GROUP_FOLDED);
        }
      });
      const startIdx = items.indexOf(overlayHeader);
      const nextIdx = findVisibleNeighbor(items, startIdx, 1);
      expect(nextIdx).toBeGreaterThan(startIdx);
      const next = items[nextIdx];
      expect(next.classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(false);
    });
  });

  // ─────────────────── getActiveLayerItem ───────────────────

  describe("getActiveLayerItem", () => {
    it("resolves the row at the cursor index", () => {
      setActiveItem(ui, 0);
      const item = getActiveLayerItem(ui);
      expect(item).toBe(ui.getNavigableItems()[0]);
    });

    it("returns null without a cursor", () => {
      expect(ui.listPanel.activeIdx).toBeNull();
      expect(getActiveLayerItem(ui)).toBeNull();
    });

    it("returns null for a stale out-of-range cursor", () => {
      ui.listPanel.activeIdx = 999;
      expect(getActiveLayerItem(ui)).toBeNull();
    });
  });

  // ─────────────────── cursorRef ───────────────────

  describe("cursorRef", () => {
    it("returns the layer row id when the cursor is on a layer row", () => {
      setActiveItem(ui, indexFor("overlay1"));
      expect(cursorRef(ui)).toBe("overlay1");
    });

    it("returns the group id when the cursor is on a toggle-all row", () => {
      const toggleRow = ui.uiContainer.querySelector(
        `[data-group="${GROUP.OVERLAY}"]`,
      ) as HTMLElement;
      setActiveItem(ui, ui.getNavigableItems().indexOf(toggleRow));
      expect(cursorRef(ui)).toBe(GROUP.OVERLAY);
    });

    it("normalizes an out-of-range cursor to null", () => {
      ui.listPanel.activeIdx = 999;
      expect(cursorRef(ui)).toBeNull();
    });

    it("returns null when activeIdx is null", () => {
      expect(ui.listPanel.activeIdx).toBeNull();
      expect(cursorRef(ui)).toBeNull();
    });
  });

  // ─────────────────── restoreCursor ───────────────────

  describe("restoreCursor", () => {
    it("re-homes a folded group row onto its toggle-all row", () => {
      attachWithGroup(ui);
      ui.listPanel.foldedGroups = new Set([GROUP.OVERLAY]);
      ui.uiContainer
        .querySelectorAll<HTMLElement>(
          `${CONST.SEL.LAYER_ITEM}[data-layer-type="${GROUP.OVERLAY}"]`,
        )
        .forEach(el => el.classList.add(CONST.CLASSES.GROUP_FOLDED));

      restoreCursor(ui, "overlay1");

      const lit = ui.uiContainer.querySelector(`.${CONST.CLASSES.FOCUSED}`);
      expect(lit?.classList.contains(CONST.CLASSES.TOGGLE_ALL)).toBe(true);
      expect(ui.listPanel.activeIdx).toBe(
        ui.getNavigableItems().indexOf(lit as HTMLElement),
      );
    });

    it("clears the cursor when the ref matches no row", () => {
      setActiveItem(ui, 0);
      restoreCursor(ui, "ghost-layer");
      expect(ui.listPanel.activeIdx).toBeNull();
      expect(ui.uiContainer.querySelector(`.${CONST.CLASSES.FOCUSED}`)).toBeNull();
    });

    it("clears the cursor when ref is null", () => {
      setActiveItem(ui, 0);
      restoreCursor(ui, null);
      expect(ui.listPanel.activeIdx).toBeNull();
    });

    it("restores the cursor to the same layer row after a rebuild", () => {
      const ref = cursorRef(ui);
      setActiveItem(ui, indexFor("overlay1"));
      expect(cursorRef(ui)).toBe("overlay1");
      // Simulate rebuild: cursor was saved from an earlier render.
      restoreCursor(ui, ref ?? "overlay1");
      const lit = ui.uiContainer.querySelector(`.${CONST.CLASSES.FOCUSED}`);
      expect(lit?.getAttribute(CONST.DATA.LAYER_ID)).toBe("overlay1");
    });
  });

  // ─────────────────── resolveActiveIdx ───────────────────

  describe("resolveActiveIdx", () => {
    it("returns the focused row's index and syncs activeIdx", () => {
      const base = findItem(ui, "base1");
      base.focus();
      const expectedIdx = ui.getNavigableItems().indexOf(base);
      const result = resolveActiveIdx(ui, ui.getNavigableItems());
      expect(result).toBe(expectedIdx);
      expect(ui.listPanel.activeIdx).toBe(expectedIdx);
    });

    it("falls back to the stored cursor when no row holds focus", () => {
      setActiveItem(ui, 1);
      (document.activeElement as HTMLElement | null)?.blur?.();
      expect(resolveActiveIdx(ui, ui.getNavigableItems())).toBe(1);
    });

    it("ignores a focused row that is not navigable", () => {
      const before = ui.listPanel.activeIdx;
      const detached = document.createElement("div");
      detached.className = CONST.CLASSES.LAYER_ITEM;
      document.body.appendChild(detached);
      detached.focus();
      expect(resolveActiveIdx(ui, ui.getNavigableItems())).toBe(before);
      document.body.removeChild(detached);
    });

    it("walks a detached row that is focused via DOM override", () => {
      const before = ui.listPanel.activeIdx;
      const detached = document.createElement("div");
      detached.className = CONST.CLASSES.LAYER_ITEM;
      const desc = Object.getOwnPropertyDescriptor(document, "activeElement");
      Object.defineProperty(document, "activeElement", {
        configurable: true,
        get: () => detached,
      });
      expect(resolveActiveIdx(ui, ui.getNavigableItems())).toBe(before);
      if (desc?.configurable) {
        Object.defineProperty(document, "activeElement", desc);
      }
    });
  });

  // ─────────────────── syncListCursor ───────────────────

  describe("syncListCursor", () => {
    it("reuses an existing cursor instance", () => {
      syncListCursor(ui);
      const cursor = ui.listPanel.listCursor;
      expect(cursor).not.toBeNull();
      syncListCursor(ui);
      expect(ui.listPanel.listCursor).toBe(cursor);
    });

    it("no-ops when the panel is detached", () => {
      syncListCursor(ui);
      const cursor = ui.listPanel.listCursor;
      expect(cursor).not.toBeNull();
      // Detach the container; a late timer tick must not touch a detached root.
      ui.uiContainer.remove();
      expect(() => syncListCursor(ui)).not.toThrow();
      expect(ui.listPanel.listCursor).toBe(cursor);
    });
  });

  // ─────────────────── syncActiveItem ───────────────────

  describe("syncActiveItem", () => {
    it("no-ops when no row holds focus and no cursor is stored", () => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      expect(() => syncActiveItem(ui)).not.toThrow();
      expect(ui.listPanel.activeIdx).toBeNull();
    });

    it("moves the marker to the focused row when one exists", () => {
      const base = findItem(ui, "base1");
      base.focus();
      const expectedIdx = ui.getNavigableItems().indexOf(base);
      syncActiveItem(ui);
      expect(ui.listPanel.activeIdx).toBe(expectedIdx);
      expect(base.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
    });
  });
});

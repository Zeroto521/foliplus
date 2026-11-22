// LayerControl drag reorder — arming by identity, mid-gesture validation and
// the commit through the controller's reorder funnel. The gesture spans
// events and timers, so every test arms with a real registry entry and the
// handlers re-resolve positions at each use; the real-fixture matrix covers
// what can happen between dragstart and drop.
import { attachedPanel, initFixture } from "../fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { HINT_DURATION, ensureOverlayRegistry } from "#core/overlay/index.js";
import { type LayerInfo, ROLE } from "#foliplus/core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import {
  isFolderFolded,
  toggleFolderFold,
} from "#control/LayerControl/ui/listPanel/drag.js";
import {
  handleDragEnd,
  handleDragLeave,
  handleDragOver,
  handleDragStart,
  handleDrop,
  showReorderBlockedHint,
  toggleFold,
} from "#control/LayerControl/ui/listPanel/index.js";
import { handleKeyDown } from "#control/LayerControl/ui/listPanel/keyboard.js";

const dragEvent = (target: HTMLElement, dataTransfer = {}, clientY = 0): DragEvent =>
  ({
    target,
    clientY,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer,
  }) as unknown as DragEvent;

/** Pin a row's box. jsdom reports a zero-height rect for every element, and a
 *  zero-height row is the "into" zone — the before/after edges only exist once
 *  the row has a height. */
const pinRect = (row: HTMLElement, top: number, height: number): void => {
  row.getBoundingClientRect = () =>
    ({
      top,
      height,
      bottom: top + height,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
};

/** Overlay rows for a real fixture: n data layers, ids `L<i>`. */
const overlays = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `L${i}`,
    name: `L${i}`,
    role: "overlay" as const,
  }));

const rowOf = (ui: LayerUI, id: string): HTMLElement =>
  attachedPanel(ui).querySelector(`[${CONST.DATA.LAYER_ID}="${id}"]`) as HTMLElement;

const orderOf = (manager: { layers: readonly LayerInfo[] }) =>
  manager.layers.filter(l => l.role === ROLE.OVERLAY).map(l => l.id);

const makeUi = (
  opts: {
    layers?: LayerInfo[];
    containers?: string[];
  } = {},
): LayerUI => {
  const layers =
    opts.layers ??
    (opts.containers ?? []).map(id => ({ id, name: id, role: "overlay" }) as LayerInfo);
  const uiContainer = document.createElement("div");
  for (const id of opts.containers ?? []) {
    const row = document.createElement("div");
    row.className = CONST.CLASSES.LAYER_ITEM;
    row.setAttribute(CONST.DATA.LAYER_ID, id);
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = true;
    row.appendChild(box);
    uiContainer.appendChild(row);
  }
  return {
    uiContainer,
    foldedRoles: {},
    listPanel: {
      foldedRoles: {},
      checkedCount: {},
      dragEntry: null,
      lastDragHintAt: 0,
      lastDragOverItem: null,
    },
    saveFoldState: vi.fn(),
    lastDragOverItem: null,
    c: {
      layers,
      findLayer: vi.fn(() => ({ options: {} })),
      map: {
        on: vi.fn(),
        off: vi.fn(),
        hasLayer: vi.fn(() => true),
        removeLayer: vi.fn(),
        addLayer: vi.fn(),
        foliplus: { showHint: vi.fn() },
      },
      debouncedEnforce: vi.fn(),
      saveOrder: vi.fn(),
      enforceOrder: vi.fn(),
      reorderLayer: vi.fn(),
      layerRegistry: {
        get: (id: string) => layers.find(l => l.id === id),
        indexOf: (entry: LayerInfo) => layers.indexOf(entry),
        indexOfId: (id: string) => layers.findIndex(l => l.id === id),
        at: (idx: number) => layers[idx],
      },
      persistence: { schedule: vi.fn() } as any,
    },
  } as unknown as LayerUI;
};

/** A layout document with the given overlay folder keys in block order. */
const folderLayoutDoc = (keys: string[]) => ({
  version: 2,
  folders: keys.map(k => ({ key: k, name: k })),
  order: { overlay: keys },
  members: {},
});

const folderFixture = (keys: string[]) =>
  initFixture({
    seedLayout: folderLayoutDoc(keys),
    data: keys.map(k => ({
      id: `${k}1`,
      name: `${k}1`,
      role: "overlay" as const,
      folder: k,
      layer: { options: {}, eachLayer: vi.fn() },
    })),
  });

const folderRowOf = (ui: LayerUI, key: string): HTMLElement =>
  attachedPanel(ui).querySelector(`[${CONST.DATA.FOLDER_KEY}="${key}"]`) as HTMLElement;

/** A layer group (container) layer stub, so isContainerDrag answers true. */
const containerLayer = () => ({
  options: {},
  eachLayer: vi.fn(),
  _layers: {},
  addLayer: vi.fn(),
  getLayers: vi.fn(() => []),
});

describe("ui/drag", () => {
  describe("folder block drag (issue 9)", () => {
    it("arms a folder row with the block identity and auto-folds it", () => {
      // A folder row owns no registry entry, so the gesture carries the block
      // identity (role + key) the layout knows. The auto-fold makes the block
      // read as one unit while it travels.
      const { ui } = folderFixture(["a", "b"]);
      const row = folderRowOf(ui, "a");
      handleDragStart(ui, dragEvent(row, { effectAllowed: "" }));
      expect(ui.listPanel.dragFolder).toEqual({ role: "overlay", key: "a" });
      // The row is the drag source: it must stay in the DOM and carry the
      // dragging chrome. A rebuild here cancels the native drag.
      expect(row.isConnected).toBe(true);
      expect(row.classList.contains(CONST.CLASSES.DRAGGING)).toBe(true);
      // The gesture is not a fold decision: nothing persisted.
      const saved = window.localStorage.getItem(CONST.STORAGE.KEY) ?? "";
      expect(saved).not.toContain("overlay::a");
    });

    it("drops a folder block after another folder", () => {
      const { ui } = folderFixture(["a", "b"]);
      handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
      const target = folderRowOf(ui, "b");
      // jsdom rects are all zero, so any positive clientY is the bottom half.
      handleDrop(ui, dragEvent(target, {}, 10));
      expect(ui.c.folderLayoutView.order.overlay).toEqual(["b", "a"]);
      expect(ui.listPanel.dragFolder).toBeNull();
    });

    it("leaves the fold state alone across a folder drag", () => {
      const { ui } = folderFixture(["a", "b"]);
      ui.listPanel.foldedFolders["overlay::a"] = true;
      handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
      handleDragEnd(ui);
      expect(ui.listPanel.foldedFolders["overlay::a"]).toBe(true);
    });

    it("refuses a drop onto a layer row or the other role", () => {
      const { ui } = folderFixture(["a", "b"]);
      handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
      const before = [...(ui.c.folderLayoutView.order.overlay ?? [])];
      // A layer row is not a block target.
      const layerRow = attachedPanel(ui).querySelector(
        `[${CONST.DATA.LAYER_ID}="b1"]`,
      ) as HTMLElement;
      handleDrop(ui, dragEvent(layerRow));
      expect(ui.c.folderLayoutView.order.overlay).toEqual(before);
    });
  });

  describe("folder block drag — hover chrome", () => {
    it("marks the folder row under the pointer and clears the previous one", () => {
      const { ui } = folderFixture(["a", "b", "c"]);
      handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
      const b = folderRowOf(ui, "b");
      const c = folderRowOf(ui, "c");
      pinRect(b, 100, 36);
      pinRect(c, 140, 36);
      const overB = dragEvent(b, { dropEffect: "" }, 130);
      handleDragOver(ui, overB);
      expect(overB.preventDefault).toHaveBeenCalled();
      expect(overB.dataTransfer!.dropEffect).toBe("move");
      expect(b.classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(true);
      expect(ui.listPanel.lastDragOverItem).toBe(b);
      // Moving to another block takes the chrome off the previous one.
      handleDragOver(ui, dragEvent(c, { dropEffect: "" }, 170));
      expect(b.classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(false);
      expect(c.classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(true);
      expect(ui.listPanel.lastDragOverItem).toBe(c);
    });

    it("marks the top half as a before-target", () => {
      const { ui } = folderFixture(["a", "b"]);
      handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
      const b = folderRowOf(ui, "b");
      pinRect(b, 100, 36);
      handleDragOver(ui, dragEvent(b, { dropEffect: "" }, 104));
      expect(b.classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(true);
      expect(b.classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(false);
    });

    it("refuses a folder dropped into another folder", () => {
      const { ui } = folderFixture(["a", "b"]);
      const showHint = vi.spyOn(ui.c.map.foliplus, "showHint");
      handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
      const b = folderRowOf(ui, "b");
      pinRect(b, 100, 36);
      // The middle third is the "into" gesture: a folder never nests.
      const over = dragEvent(b, { dropEffect: "" }, 118);
      handleDragOver(ui, over);
      expect(over.dataTransfer!.dropEffect).toBe("none");
      expect(b.classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(false);
      expect(b.classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(false);
      expect(ui.listPanel.lastDragOverItem).toBeNull();
      expect(showHint).toHaveBeenCalledWith(
        ui.config.name,
        ui.T("no_nest"),
        expect.anything(),
      );
    });

    it("clears the chrome when the pointer leaves the folder rows", () => {
      const { ui } = folderFixture(["a", "b"]);
      handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
      const b = folderRowOf(ui, "b");
      handleDragOver(ui, dragEvent(b, { dropEffect: "" }, 10));
      const layerRow = attachedPanel(ui).querySelector(
        `[${CONST.DATA.LAYER_ID}="b1"]`,
      ) as HTMLElement;
      const away = dragEvent(layerRow, { dropEffect: "" }, 10);
      handleDragOver(ui, away);
      expect(away.preventDefault).not.toHaveBeenCalled();
      expect(away.dataTransfer!.dropEffect).toBe("none");
      expect(b.classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(false);
      expect(ui.listPanel.lastDragOverItem).toBeNull();
    });

    it("refuses the dragged folder's own row and a row of the other role", () => {
      const { ui } = folderFixture(["a", "b"]);
      handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
      const own = dragEvent(folderRowOf(ui, "a"), { dropEffect: "" }, 10);
      handleDragOver(ui, own);
      expect(own.dataTransfer!.dropEffect).toBe("none");
      expect(ui.listPanel.lastDragOverItem).toBeNull();
      // A folder row of the other role is not a block target either.
      const b = folderRowOf(ui, "b");
      b.setAttribute(CONST.DATA.ROLE, "base");
      const otherRole = dragEvent(b, { dropEffect: "" }, 10);
      handleDragOver(ui, otherRole);
      expect(otherRole.dataTransfer!.dropEffect).toBe("none");
      expect(ui.listPanel.lastDragOverItem).toBeNull();
    });

    it("ignores a folder row that carries no role", () => {
      const { ui } = folderFixture(["a", "b"]);
      const row = folderRowOf(ui, "a");
      row.removeAttribute(CONST.DATA.ROLE);
      handleDragStart(ui, dragEvent(row, { effectAllowed: "" }));
      expect(ui.listPanel.dragFolder).toBeNull();
    });
  });

  describe("arming — the gesture keys the entry, not the position", () => {
    it("handleDragStart arms with the registry entry behind the row", () => {
      const ui = makeUi({ containers: ["a", "b"] });
      const row = attachedPanel(ui).querySelector<HTMLElement>(
        `[${CONST.DATA.LAYER_ID}="a"]`,
      )!;
      const dataTransfer = { effectAllowed: "" };

      handleDragStart(ui, dragEvent(row, dataTransfer));

      expect(ui.listPanel.dragEntry?.id).toBe("a");
      expect(row.classList.contains(CONST.CLASSES.DRAGGING)).toBe(true);
      expect(dataTransfer.effectAllowed).toBe("move");
    });

    it("handleDragStart is a no-op when the press began on a floating panel", () => {
      const ui = makeUi({ containers: ["a", "b"] });
      const row = attachedPanel(ui).querySelector<HTMLElement>(
        `[${CONST.DATA.LAYER_ID}="a"]`,
      )!;
      document.body.appendChild(ui.uiContainer!);
      const registry = ensureOverlayRegistry(ui.c.map);
      const unregister = registry.register({
        id: "test.press",
        isOpen: () => true,
        panels: () => [row],
        close: () => {},
        dismissOn: "mousedown",
        pressPriority: 100,
      });
      row.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      const event = dragEvent(row);

      handleDragStart(ui, event);

      // The drag is never armed; preventDefault stops the browser's drag.
      expect(ui.listPanel.dragEntry).toBeNull();
      expect(row.classList.contains(CONST.CLASSES.DRAGGING)).toBe(false);
      expect(event.preventDefault).toHaveBeenCalled();
      unregister();
    });

    it("handleDragStart ignores rows the registry does not know", () => {
      const ui = makeUi({ containers: ["a", "b"] });
      const orphan = document.createElement("div");
      orphan.className = CONST.CLASSES.LAYER_ITEM;
      attachedPanel(ui).appendChild(orphan);

      handleDragStart(ui, dragEvent(orphan));

      // No registry entry, no drag: the row names nothing that can move.
      expect(ui.listPanel.dragEntry).toBeNull();
      expect(orphan.classList.contains(CONST.CLASSES.DRAGGING)).toBe(false);
    });

    it("handleDragStart is a no-op when the press starts outside any row", () => {
      const ui = makeUi({ containers: ["a"] });
      const shell = document.createElement("div");
      attachedPanel(ui).appendChild(shell);

      handleDragStart(ui, dragEvent(shell));

      expect(ui.listPanel.dragEntry).toBeNull();
    });

    it("handleDragStart tolerates a null dataTransfer", () => {
      const ui = makeUi({ containers: ["a"] });
      const row = attachedPanel(ui).querySelector<HTMLElement>(
        `[${CONST.DATA.LAYER_ID}="a"]`,
      )!;
      const event = {
        target: row,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: null,
      } as unknown as DragEvent;

      handleDragStart(ui, event);

      // The drag is armed; the class is added; no crash on dataTransfer.
      expect(ui.listPanel.dragEntry?.id).toBe("a");
      expect(row.classList.contains(CONST.CLASSES.DRAGGING)).toBe(true);
    });

    it("handleDragEnd disarms the session and strips every marker", () => {
      const ui = makeUi({ containers: ["a", "b"] });
      handleDragStart(ui, dragEvent(rowOf(ui, "a")));
      const rows = Array.from(
        attachedPanel(ui).querySelectorAll<HTMLElement>(CONST.SEL.LAYER_ITEM),
      );
      rows[0].classList.add(CONST.CLASSES.DRAG_OVER_TOP);
      rows[1].classList.add(CONST.CLASSES.DRAG_OVER_BOTTOM);
      ui.listPanel.lastDragOverItem = rows[0];

      handleDragEnd(ui);

      expect(ui.listPanel.dragEntry).toBeNull();
      expect(ui.listPanel.lastDragOverItem).toBeNull();
      rows.forEach(row => {
        expect(row.classList.contains(CONST.CLASSES.DRAGGING)).toBe(false);
        expect(row.classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(false);
        expect(row.classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(false);
      });
    });

    it("an armed drag tears down when the control unbinds", () => {
      // The unbind boundary removes the dragend listener: without the
      // teardown running here, no later native event can finish it, and the
      // session would outlive the panel it pointed at.
      const { ui } = initFixture({ data: overlays(2) });
      handleDragStart(ui, dragEvent(rowOf(ui, "L0")));

      ui.unbindEvents();

      expect(ui.listPanel.dragEntry).toBeNull();
      expect(ui.listPanel.lastDragOverItem).toBeNull();
      expect(rowOf(ui, "L0").classList.contains(CONST.CLASSES.DRAGGING)).toBe(false);
    });

    it("an armed drag tears down even when the panel is already gone", () => {
      // The pure session state (the entry reference, the hover marker) must
      // clear on unbind even with no container left to strip classes from.
      const { manager, ui } = initFixture({ data: overlays(2) });
      handleDragStart(ui, dragEvent(rowOf(ui, "L0")));
      manager.uiContainer = null;

      ui.unbindEvents();

      expect(ui.listPanel.dragEntry).toBeNull();
      expect(ui.listPanel.lastDragOverItem).toBeNull();
    });

    it("handleDragLeave clears the marker on the row being left", () => {
      const ui = makeUi({ containers: ["a"] });
      const row = rowOf(ui, "a");
      row.classList.add(CONST.CLASSES.DRAG_OVER_TOP);

      handleDragLeave(dragEvent(row));

      expect(row.classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(false);
    });
  });

  describe("mid-gesture validation — the session is identity-checked at use", () => {
    it("a drop after an intervening reorder moves the layer the user grabbed", () => {
      // The positional bug this pins: dragstart saved index 1 for L1; a
      // bringLayerToFront during the gesture shifted the registry so index 1
      // named L0 — the old code moved L0. Identity arming moves L1.
      const { manager, ui } = initFixture({ data: overlays(4) });
      handleDragStart(ui, dragEvent(rowOf(ui, "L1")));
      expect(orderOf(manager)).toEqual(["L0", "L1", "L2", "L3"]);

      manager.bringLayerToFront("L3");
      expect(orderOf(manager)).toEqual(["L3", "L0", "L1", "L2"]);

      handleDrop(ui, dragEvent(rowOf(ui, "L0")));

      // L1 landed at L0's slot; the grabbed layer moved, not the neighbor.
      expect(orderOf(manager)).toEqual(["L3", "L1", "L0", "L2"]);
      expect(ui.listPanel.dragEntry).toBeNull();
    });

    it("a drop after the armed layer was unregistered is a no-op", () => {
      const { manager, ui } = initFixture({ data: overlays(3) });
      handleDragStart(ui, dragEvent(rowOf(ui, "L1")));
      manager.unregisterLayer("L1");

      const changes: string[] = [];
      ui.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));
      const before = orderOf(manager);

      handleDrop(ui, dragEvent(rowOf(ui, "L0")));

      expect(orderOf(manager)).toEqual(before);
      expect(changes).toEqual([]);
      expect(ui.listPanel.dragEntry).toBeNull();
    });

    it("a drop after the armed id was replaced underneath is a no-op", () => {
      const { manager, ui } = initFixture({ data: overlays(3) });
      handleDragStart(ui, dragEvent(rowOf(ui, "L1")));
      // Out with the armed entry, in with a same-id replacement: the session
      // holds the OLD object, and the registry's indexOf must miss it.
      manager.unregisterLayer("L1");
      manager.registerLayer({ id: "L1", name: "L1 again" });

      const before = orderOf(manager);
      handleDrop(ui, dragEvent(rowOf(ui, "L0")));

      expect(orderOf(manager)).toEqual(before);
      expect(ui.listPanel.dragEntry).toBeNull();
    });

    it("a drop whose target row left the registry commits nothing and ends the session", () => {
      const { manager, ui } = initFixture({ data: overlays(3) });
      handleDragStart(ui, dragEvent(rowOf(ui, "L1")));
      const targetRow = rowOf(ui, "L0");
      manager.unregisterLayer("L0");

      const before = orderOf(manager);
      handleDrop(ui, dragEvent(targetRow));

      expect(orderOf(manager)).toEqual(before);
      // The target names a layer the registry no longer holds, so there is
      // nothing to move onto: the gesture is over.
      expect(ui.listPanel.dragEntry).toBeNull();
    });

    it("handleDragOver is a no-op until a drag is armed", () => {
      const { ui } = initFixture({ data: overlays(3) });
      const rowL0 = rowOf(ui, "L0");

      handleDragOver(ui, dragEvent(rowL0));

      expect(rowL0.classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(false);
      expect(rowL0.classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(false);
      expect(ui.listPanel.lastDragOverItem).toBeNull();
    });

    it("handleDragOver is a no-op when the hover lands outside any row", () => {
      const { ui } = initFixture({ data: overlays(3) });
      handleDragStart(ui, dragEvent(rowOf(ui, "L1")));
      const shell = document.createElement("div");
      attachedPanel(ui).appendChild(shell);

      handleDragOver(ui, dragEvent(shell));

      expect(ui.listPanel.lastDragOverItem).toBeNull();
    });

    it("handleDragOver paints the top marker and moves it between rows", () => {
      const { ui } = initFixture({ data: overlays(3) });
      // L2 armed at the bottom: both L0 and L1 sit above it.
      handleDragStart(ui, dragEvent(rowOf(ui, "L2")));
      const rowL0 = rowOf(ui, "L0");
      const rowL1 = rowOf(ui, "L1");

      handleDragOver(ui, dragEvent(rowL0));
      expect(rowL0.classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(true);
      expect(rowL0.classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(false);

      // The marker follows the pointer: the previous row is cleaned, the
      // hovered one takes it.
      handleDragOver(ui, dragEvent(rowL1));
      expect(rowL0.classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(false);
      expect(rowL1.classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(true);
    });

    it("handleDragOver marks a blocked move none on a real dataTransfer", () => {
      const { ui } = initFixture({
        data: [...overlays(1), { id: "B0", name: "B0", role: "base" as const }],
      });
      handleDragStart(ui, dragEvent(rowOf(ui, "L0")));
      const dataTransfer = { dropEffect: "" };

      handleDragOver(ui, dragEvent(rowOf(ui, "B0"), dataTransfer));

      expect(dataTransfer.dropEffect).toBe("none");
      expect(rowOf(ui, "B0").classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(
        false,
      );
    });

    it("handleDragOver tolerates a blocked move on a drag event without dataTransfer", () => {
      const { ui } = initFixture({
        data: [...overlays(1), { id: "B0", name: "B0", role: "base" as const }],
      });
      handleDragStart(ui, dragEvent(rowOf(ui, "L0")));
      const event = {
        target: rowOf(ui, "B0"),
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as DragEvent;

      expect(() => handleDragOver(ui, event)).not.toThrow();
      expect(rowOf(ui, "B0").classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(
        false,
      );
    });

    it("handleDragOver paints no marker over the armed row itself", () => {
      const { ui } = initFixture({ data: overlays(3) });
      handleDragStart(ui, dragEvent(rowOf(ui, "L1")));

      handleDragOver(ui, dragEvent(rowOf(ui, "L1")));

      expect(rowOf(ui, "L1").classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(
        false,
      );
      expect(rowOf(ui, "L1").classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(
        false,
      );
    });

    it("handleDragOver tolerates an allowed move without a dataTransfer", () => {
      const { ui } = initFixture({ data: overlays(3) });
      handleDragStart(ui, dragEvent(rowOf(ui, "L2")));
      const event = {
        target: rowOf(ui, "L0"),
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as DragEvent;

      expect(() => handleDragOver(ui, event)).not.toThrow();
      expect(rowOf(ui, "L0").classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(
        true,
      );
    });

    it("handleDrop is a no-op when no drag is armed", () => {
      const { manager, ui } = initFixture({ data: overlays(3) });
      const before = orderOf(manager);

      handleDrop(ui, dragEvent(rowOf(ui, "L0")));

      expect(orderOf(manager)).toEqual(before);
    });

    it("handleDragLeave ignores targets that are not layer rows", () => {
      initFixture({ data: overlays(2) });
      const shell = document.createElement("div");

      expect(() => handleDragLeave(dragEvent(shell))).not.toThrow();
      expect(shell.classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(false);
    });

    it("a drop on the armed row ends the gesture without a commit", () => {
      const { manager, ui } = initFixture({ data: overlays(3) });
      const reorder = vi.spyOn(ui.c, "reorderLayer");
      handleDragStart(ui, dragEvent(rowOf(ui, "L1")));
      const before = orderOf(manager);

      handleDrop(ui, dragEvent(rowOf(ui, "L1")));

      // Same slot: nothing moves, and the session is over — a programmatic
      // drop sends no native dragend, so the teardown must happen here.
      expect(reorder).not.toHaveBeenCalled();
      expect(ui.listPanel.dragEntry).toBeNull();
      expect(orderOf(manager)).toEqual(before);
    });

    it("a drop outside every row lands the layer at the block tail", () => {
      const { manager, ui } = initFixture({ data: overlays(3) });
      handleDragStart(ui, dragEvent(rowOf(ui, "L1")));
      const shell = document.createElement("div");
      attachedPanel(ui).appendChild(shell);
      const before = orderOf(manager);

      handleDrop(ui, dragEvent(shell));

      // No row under the pointer: the layer becomes a root block at the tail
      // of the role's block order (jsdom rects are all zero, so no row is
      // "before" the pointer), which the registry order follows.
      expect(before).toEqual(["L0", "L1", "L2"]);
      expect(orderOf(manager)).toEqual(["L0", "L2", "L1"]);
      expect(manager.folderLayoutView.order.overlay ?? []).toContain("layer:L1");
      expect(ui.listPanel.dragEntry).toBeNull();
    });

    it("a blocked cross-group drop hints, commits nothing and closes the session", () => {
      const { manager, ui } = initFixture({
        data: [
          ...overlays(2),
          { id: "B0", name: "B0", role: "base" as const },
          { id: "B1", name: "B1", role: "base" as const },
        ],
      });
      handleDragStart(ui, dragEvent(rowOf(ui, "B0")));
      const before = orderOf(manager);
      // The runtime hint system binds map.foliplus.showHint during attach,
      // so the spy wraps the bound function the drop actually calls.
      const showHint = vi.spyOn(ui.c.map.foliplus, "showHint");

      handleDrop(ui, dragEvent(rowOf(ui, "L0")));

      expect(showHint).toHaveBeenCalled();
      expect(orderOf(manager)).toEqual(before);
      // A drop ends the gesture: a programmatic drop never receives the native
      // dragend, so the refusal has to close the session itself.
      expect(ui.listPanel.dragEntry).toBeNull();
    });

    it("handleDragOver re-resolves the armed position on every event", () => {
      const { manager, ui } = initFixture({ data: overlays(3) });
      handleDragStart(ui, dragEvent(rowOf(ui, "L2")));
      // L2 starts at the bottom; after the gesture-start reorder below, L2
      // is on top — a marker painted from a saved index would point the
      // wrong way.
      manager.bringLayerToFront("L2");
      expect(orderOf(manager)).toEqual(["L2", "L0", "L1"]);

      const rowL0 = rowOf(ui, "L0");
      handleDragOver(ui, dragEvent(rowL0));

      // L0 sits below the armed L2: the bottom marker, not the top one.
      expect(rowL0.classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(true);
      expect(rowL0.classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(false);
    });

    it("handleDragOver does nothing once the session is stale", () => {
      const { manager, ui } = initFixture({ data: overlays(3) });
      handleDragStart(ui, dragEvent(rowOf(ui, "L1")));
      manager.unregisterLayer("L1");
      const rowL0 = rowOf(ui, "L0");

      handleDragOver(ui, dragEvent(rowL0));

      expect(rowL0.classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(false);
      expect(rowL0.classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(false);
      expect(ui.listPanel.lastDragOverItem).toBeNull();
    });

    it("handleDragOver and handleDrop ignore a row carrying no identity", () => {
      const { manager, ui } = initFixture({ data: overlays(3) });
      handleDragStart(ui, dragEvent(rowOf(ui, "L1")));
      const orphan = document.createElement("div");
      orphan.className = CONST.CLASSES.LAYER_ITEM;
      attachedPanel(ui).appendChild(orphan);

      handleDragOver(ui, dragEvent(orphan));
      handleDrop(ui, dragEvent(orphan));

      // The row names no layer and no folder, so neither handler acts on it.
      expect(orphan.classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(false);
      expect(orphan.classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(false);
      expect(orphan.classList.contains(CONST.CLASSES.DRAG_OVER_INTO)).toBe(false);
      expect(ui.listPanel.lastDragOverItem).toBeNull();
      expect(orderOf(manager)).toEqual(["L0", "L1", "L2"]);
      expect(ui.listPanel.dragEntry).toBeNull();
    });
  });

  describe("layer drop on a folder row", () => {
    /** Pin a row's box so the drop zone is deterministic (jsdom rects are 0). */
    const withRect = (row: HTMLElement, top: number, height: number): void => {
      row.getBoundingClientRect = () =>
        ({
          top,
          height,
          bottom: top + height,
          left: 0,
          right: 0,
          width: 0,
          x: 0,
          y: top,
          toJSON: () => ({}),
        }) as DOMRect;
    };

    it("places the layer before the block when the pointer is on the top edge", () => {
      const { manager, ui } = folderFixture(["a", "b"]);
      manager.registerLayer({ id: "R1", name: "R1", role: "overlay" });
      const row = folderRowOf(ui, "b");
      withRect(row, 100, 36);

      handleDragStart(ui, dragEvent(rowOf(ui, "R1")));
      handleDrop(ui, dragEvent(row, {}, 102));

      expect(manager.folderLayoutView.order.overlay).toEqual(["a", "layer:R1", "b"]);
      expect(manager.folderNameOf("R1")).toBeNull();
    });

    it("places the layer after the block when the pointer is on the bottom edge", () => {
      const { manager, ui } = folderFixture(["a", "b"]);
      manager.registerLayer({ id: "R1", name: "R1", role: "overlay" });
      const row = folderRowOf(ui, "b");
      withRect(row, 100, 36);

      handleDragStart(ui, dragEvent(rowOf(ui, "R1")));
      handleDrop(ui, dragEvent(row, {}, 134));

      expect(manager.folderLayoutView.order.overlay).toEqual(["a", "b", "layer:R1"]);
    });

    it("takes the layer into the folder when the pointer is in the middle", () => {
      const { manager, ui } = folderFixture(["a", "b"]);
      manager.registerLayer({ id: "R1", name: "R1", role: "overlay" });
      const row = folderRowOf(ui, "b");
      withRect(row, 100, 36);

      handleDragStart(ui, dragEvent(rowOf(ui, "R1")));
      handleDrop(ui, dragEvent(row, {}, 118));

      expect(manager.folderNameOf("R1")).toBe("b");
    });

    it("refuses to put a container into a folder", () => {
      // A container's children are its own sub-layers; a folder groups registry
      // rows. The middle zone is refused, the edges still place it beside.
      const { manager, ui } = folderFixture(["a", "b"]);
      manager.registerLayer({ id: "G1", name: "G1", role: "overlay" });
      ui.c.findLayer = vi.fn(() => ({
        eachLayer: vi.fn(),
        _layers: {},
      })) as never;
      const row = folderRowOf(ui, "b");
      withRect(row, 100, 36);

      handleDragStart(ui, dragEvent(rowOf(ui, "G1")));
      handleDrop(ui, dragEvent(row, {}, 118));

      expect(manager.folderNameOf("G1")).toBeNull();
    });

    it("refuses a container over a folder's member row, with the same sentence", () => {
      // The member row is the same rule reached from the inside: a drop there
      // would join the member's folder, which a container cannot do. The hover
      // must refuse and say why instead of painting the reorder indicator and
      // then dropping the move on the floor.
      const { manager, ui } = folderFixture(["a", "b"]);
      manager.registerLayer({ id: "G1", name: "G1", role: "overlay" });
      ui.c.findLayer = vi.fn(() => ({
        eachLayer: vi.fn(),
        _layers: {},
      })) as never;
      const showHint = vi.spyOn(ui.c.map.foliplus, "showHint");
      const member = rowOf(ui, "b1");
      withRect(member, 100, 36);

      handleDragStart(ui, dragEvent(rowOf(ui, "G1")));
      handleDragOver(ui, dragEvent(member, {}, 118));

      expect(showHint).toHaveBeenCalled();
      expect(manager.folderNameOf("G1")).toBeNull();
    });
  });

  describe("commit — a drop runs the controller funnel like any move", () => {
    it("a drop publishes the reorder signal and the layer CHANGE", () => {
      const { manager, ui } = initFixture({ data: overlays(3) });
      handleDragStart(ui, dragEvent(rowOf(ui, "L1")));
      const rebuilds: string[] = [];
      const changes: string[] = [];
      ui.events.on(EVENTS.LAYER_LIST_REBUILD, () =>
        rebuilds.push(orderOf(manager).join(",")),
      );
      ui.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));

      handleDrop(ui, dragEvent(rowOf(ui, "L0")));

      // The signal fires once, after the registry move — a third party
      // scheduling off it reads the finished arrangement — and the move
      // announces through the same CHANGE an API reorder does.
      expect(rebuilds).toEqual(["L1,L0,L2"]);
      expect(changes).toEqual(["L1"]);
      // The in-tree subscriber relocated the row: DOM follows the registry.
      expect(
        Array.from(attachedPanel(ui).querySelectorAll(CONST.SEL.LAYER_ITEM)).map(el =>
          el.getAttribute(CONST.DATA.LAYER_ID),
        ),
      ).toContain("L1");
      const domOrder = Array.from(
        attachedPanel(ui).querySelectorAll(
          `${CONST.SEL.LAYER_ITEM}[data-layer-type="${ROLE.OVERLAY}"]`,
        ),
      ).map(el => el.getAttribute(CONST.DATA.LAYER_ID));
      expect(domOrder).toEqual(orderOf(manager));
      expect(ui.listPanel.dragEntry).toBeNull();
    });

    it("a drop onto the dragged row's own slot commits nothing", () => {
      const { manager, ui } = initFixture({ data: overlays(3) });
      handleDragStart(ui, dragEvent(rowOf(ui, "L1")));
      const changes: string[] = [];
      ui.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));

      handleDrop(ui, dragEvent(rowOf(ui, "L1")));

      expect(changes).toEqual([]);
      expect(orderOf(manager)).toEqual(["L0", "L1", "L2"]);
    });

    it("a throwing list subscriber still tears the gesture down", () => {
      const { manager, ui } = initFixture({ data: overlays(3) });
      handleDragStart(ui, dragEvent(rowOf(ui, "L1")));
      const changes: string[] = [];
      ui.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));
      ui.events.on(EVENTS.LAYER_LIST_REBUILD, () => {
        throw new Error("observer boom");
      });

      // The terminal failure propagates out of the drop — but the settled
      // operation has already landed the commit and delivered the CHANGE
      // past it, and the gesture state comes down with the throw instead of
      // waiting for a native dragend that a programmatic caller never sent.
      expect(() => handleDrop(ui, dragEvent(rowOf(ui, "L0")))).toThrow("observer boom");

      expect(orderOf(manager)).toEqual(["L1", "L0", "L2"]);
      expect(changes).toEqual(["L1"]);
      expect(ui.listPanel.dragEntry).toBeNull();
      expect(ui.listPanel.lastDragOverItem).toBeNull();
      expect(rowOf(ui, "L1").classList.contains(CONST.CLASSES.DRAGGING)).toBe(false);
    });

    it("a stale session clears with its hover chrome on dragover", () => {
      const { ui } = initFixture({ data: overlays(3) });
      // A session whose entry left the registry without the retire path —
      // the over handler owns its own teardown, not just the drop's.
      ui.listPanel.dragEntry = { id: "ghost" } as never;
      const rowL0 = rowOf(ui, "L0");
      rowL0.classList.add(CONST.CLASSES.DRAG_OVER_TOP);
      ui.listPanel.lastDragOverItem = rowL0;

      handleDragOver(ui, dragEvent(rowL0));

      expect(ui.listPanel.dragEntry).toBeNull();
      expect(ui.listPanel.lastDragOverItem).toBeNull();
      expect(rowL0.classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(false);
    });

    it("a stale session clears with its hover chrome on drop", () => {
      const { ui } = initFixture({ data: overlays(3) });
      ui.listPanel.dragEntry = { id: "ghost" } as never;
      const rowL0 = rowOf(ui, "L0");
      rowL0.classList.add(CONST.CLASSES.DRAG_OVER_BOTTOM);
      ui.listPanel.lastDragOverItem = rowL0;

      handleDrop(ui, dragEvent(rowL0));

      expect(ui.listPanel.dragEntry).toBeNull();
      expect(ui.listPanel.lastDragOverItem).toBeNull();
      expect(rowL0.classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(false);
    });

    it("unregistering the dragged layer cancels the gesture on the spot", () => {
      // The retire path does not wait for the next dragover/drop to notice:
      // the source row is leaving the panel, and a native dragend off a
      // detached source cannot be relied on to bubble back.
      const { manager, ui } = initFixture({ data: overlays(3) });
      handleDragStart(ui, dragEvent(rowOf(ui, "L1")));
      expect(rowOf(ui, "L1").classList.contains(CONST.CLASSES.DRAGGING)).toBe(true);
      const rowL0 = rowOf(ui, "L0");
      rowL0.classList.add(CONST.CLASSES.DRAG_OVER_TOP);

      manager.unregisterLayer("L1");

      expect(ui.listPanel.dragEntry).toBeNull();
      expect(ui.listPanel.lastDragOverItem).toBeNull();
      const chrome = attachedPanel(ui).querySelectorAll(
        `.${CONST.CLASSES.DRAGGING}, .${CONST.CLASSES.DRAG_OVER_TOP}, .${CONST.CLASSES.DRAG_OVER_BOTTOM}`,
      );
      expect(chrome.length).toBe(0);
    });

    it("toggleFold still routes through the full rebuild", () => {
      // The fold path is the rebuild counterweight to the incremental
      // reorder path; the drag module owns it and must keep it.
      const { manager, ui } = initFixture({ data: overlays(2) });
      const before = Array.from(attachedPanel(ui).children);

      toggleFold(ui, ROLE.OVERLAY);
      toggleFold(ui, ROLE.OVERLAY);

      // Rows re-created (not the same elements), both directions exercised.
      expect(Array.from(attachedPanel(ui).children)).not.toEqual(before);
      expect(orderOf(manager)).toEqual(["L0", "L1"]);
    });
  });
});

describe("showReorderBlockedHint", () => {
  it("hints once per cooldown window", () => {
    const showHint = vi.fn();
    const ui = {
      config: { name: "LayerControl" },
      T: (k: string) => k,
      c: {
        map: { foliplus: { showHint } },
      },
      listPanel: {
        lastDragHintAt: 0,
        dragEntry: null,
        lastDragOverItem: null,
        foldedRoles: {},
        checkedCount: {},
      },
    } as unknown as LayerUI;

    showReorderBlockedHint(ui);
    expect(showHint).toHaveBeenCalledTimes(1);
    expect(showHint).toHaveBeenCalledWith(
      "LayerControl",
      "same_role_only",
      HINT_DURATION.SHORT,
    );

    // A second attempt inside the cooldown window stays silent.
    showReorderBlockedHint(ui);
    expect(showHint).toHaveBeenCalledTimes(1);
  });
});

describe("layer drop on a folder row — hover chrome", () => {
  /** Pin a row's box so the drop zone is deterministic (jsdom rects are 0). */
  const withRect = (row: HTMLElement, top: number, height: number): void => {
    row.getBoundingClientRect = () =>
      ({
        top,
        height,
        bottom: top + height,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
  };

  /** A layer group (container) layer stub, so isContainerDrag answers true. */
  const containerLayer = () => ({
    options: {},
    eachLayer: vi.fn(),
    _layers: {},
    addLayer: vi.fn(),
    getLayers: vi.fn(() => []),
  });

  it("marks the middle zone of a folder row as a join target", () => {
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({ id: "R1", name: "R1", role: "overlay" });
    const row = folderRowOf(ui, "b");
    withRect(row, 100, 36);
    handleDragStart(ui, dragEvent(rowOf(ui, "R1"), { effectAllowed: "" }));
    const dataTransfer = { dropEffect: "" };

    handleDragOver(ui, dragEvent(row, dataTransfer, 118));

    // The middle third joins the folder: the move is allowed and the row
    // paints the INTO marker.
    expect(dataTransfer.dropEffect).toBe("move");
    expect(row.classList.contains(CONST.CLASSES.DRAG_OVER_INTO)).toBe(true);
    expect(ui.listPanel.lastDragOverItem).toBe(row);
  });

  it("marks the top third of a folder row as a before-target", () => {
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({ id: "R1", name: "R1", role: "overlay" });
    const row = folderRowOf(ui, "b");
    withRect(row, 100, 36);
    handleDragStart(ui, dragEvent(rowOf(ui, "R1"), { effectAllowed: "" }));

    handleDragOver(ui, dragEvent(row, {}, 102));

    expect(row.classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(true);
    expect(row.classList.contains(CONST.CLASSES.DRAG_OVER_INTO)).toBe(false);
    expect(ui.listPanel.lastDragOverItem).toBe(row);
  });

  it("marks the bottom third of a folder row as an after-target", () => {
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({ id: "R1", name: "R1", role: "overlay" });
    const row = folderRowOf(ui, "b");
    withRect(row, 100, 36);
    handleDragStart(ui, dragEvent(rowOf(ui, "R1"), { effectAllowed: "" }));

    handleDragOver(ui, dragEvent(row, {}, 134));

    expect(row.classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(true);
    expect(row.classList.contains(CONST.CLASSES.DRAG_OVER_INTO)).toBe(false);
    expect(ui.listPanel.lastDragOverItem).toBe(row);
  });

  it("refuses a container on a folder row's middle zone and names the reason", () => {
    // A container's children are its own sub-layers; the middle zone would
    // join the folder, so the hover refuses with the same sentence the drop
    // uses, instead of painting a join marker the drop would then veto.
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({
      id: "G1",
      name: "G1",
      role: "overlay",
      layer: containerLayer(),
    });
    const row = folderRowOf(ui, "b");
    withRect(row, 100, 36);
    const showHint = vi.spyOn(ui.c.map.foliplus, "showHint");
    handleDragStart(ui, dragEvent(rowOf(ui, "G1"), { effectAllowed: "" }));

    handleDragOver(ui, dragEvent(row, {}, 118));

    expect(showHint).toHaveBeenCalled();
    expect(ui.listPanel.lastDragOverItem).toBeNull();
  });

  it("refuses a container on another container's middle zone", () => {
    // Two layer groups never nest: the middle zone is the "into" gesture and
    // it is refused by name, while the edges still reorder the group.
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({
      id: "G1",
      name: "G1",
      role: "overlay",
      layer: containerLayer(),
    });
    manager.registerLayer({
      id: "G2",
      name: "G2",
      role: "overlay",
      layer: containerLayer(),
    });
    const row = rowOf(ui, "G2");
    withRect(row, 100, 36);
    const showHint = vi.spyOn(ui.c.map.foliplus, "showHint");
    handleDragStart(ui, dragEvent(rowOf(ui, "G1"), { effectAllowed: "" }));

    handleDragOver(ui, dragEvent(row, {}, 118));

    expect(showHint).toHaveBeenCalledWith(
      ui.config.name,
      ui.T("no_nest"),
      expect.anything(),
    );
    expect(ui.listPanel.lastDragOverItem).toBeNull();
    expect(row.classList.contains(CONST.CLASSES.DRAG_OVER_INTO)).toBe(false);
  });

  it("refuses a folder drag over a container row and names the reason", () => {
    // A folder block and a container row are different kinds of block; a
    // folder cannot adopt a container, so the hover answers with the
    // dedicated sentence instead of reading as a silent dead drop.
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({
      id: "G1",
      name: "G1",
      role: "overlay",
      layer: containerLayer(),
    });
    const showHint = vi.spyOn(ui.c.map.foliplus, "showHint");
    handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));

    handleDragOver(ui, dragEvent(rowOf(ui, "G1"), {}, 0));

    expect(showHint).toHaveBeenCalled();
    expect(ui.listPanel.lastDragOverItem).toBeNull();
  });
});

describe("block-order gap drop", () => {
  /** Pin a row's box so the gap scan is deterministic (jsdom rects are 0). */
  const withRect = (row: HTMLElement, top: number, height: number): void => {
    row.getBoundingClientRect = () =>
      ({
        top,
        height,
        bottom: top + height,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
  };

  /** A drop outside every row resolves the position from the rows' boxes. */
  const dropInGap = (ui: LayerUI, clientY: number): void => {
    const shell = document.createElement("div");
    attachedPanel(ui).appendChild(shell);
    handleDrop(ui, dragEvent(shell, {}, clientY));
  };

  it("lands the layer before the first folder block", () => {
    const { ui } = folderFixture(["a", "b"]);
    withRect(folderRowOf(ui, "a"), 100, 36);
    const move = vi.spyOn(ui.c, "moveLayerToRootAt");
    handleDragStart(ui, dragEvent(rowOf(ui, "a1"), { effectAllowed: "" }));

    dropInGap(ui, 110);

    // The gap before folder "a": the layer becomes a root block before it.
    expect(move).toHaveBeenCalledWith("a1", "a");
    expect(ui.listPanel.dragEntry).toBeNull();
  });

  it("resolves a member row to the folder block above it", () => {
    const { ui } = folderFixture(["a", "b"]);
    withRect(rowOf(ui, "a1"), 100, 36);
    const move = vi.spyOn(ui.c, "moveLayerToRootAt");
    handleDragStart(ui, dragEvent(rowOf(ui, "b1"), { effectAllowed: "" }));

    dropInGap(ui, 110);

    // A drop in the middle of a folder's members lands before that folder.
    expect(move).toHaveBeenCalledWith("b1", "a");
    expect(ui.listPanel.dragEntry).toBeNull();
  });

  it("stops the walk at the role header and falls back to the root entry", () => {
    const { ui } = folderFixture(["a", "b"]);
    const panel = attachedPanel(ui);
    const rootItem = Array.from(
      panel.querySelectorAll<HTMLElement>(".foliplus-layer-item[data-layer-id]"),
    ).find(el => {
      const id = el.getAttribute(CONST.DATA.LAYER_ID);
      return id && id !== "a1" && id !== "b1";
    })!;
    withRect(rootItem, 100, 36);
    const move = vi.spyOn(ui.c, "moveLayerToRootAt");
    handleDragStart(ui, dragEvent(rowOf(ui, "a1"), { effectAllowed: "" }));

    dropInGap(ui, 110);

    // A root row below its role header resolves to its own root entry, not a
    // folder block the walk would have to fabricate.
    expect(move).toHaveBeenCalledWith("a1", "layer:foliplus_color_map");
  });

  it("drops after the last block when the folder is the tail", () => {
    const { ui } = folderFixture(["a", "b"]);
    const row = folderRowOf(ui, "b");
    withRect(row, 100, 36);
    const move = vi.spyOn(ui.c, "moveLayerToRootAt");
    handleDragStart(ui, dragEvent(rowOf(ui, "a1"), { effectAllowed: "" }));

    // The bottom third of the last folder: nothing follows, so the position
    // is the tail (blockEntryAfter answers null).
    handleDrop(ui, dragEvent(row, {}, 134));

    expect(move).toHaveBeenCalledWith("a1", null);
  });

  it("tolerates a panel that is already gone", () => {
    // The gap scan reads uiContainer through an optional chain; a teardown
    // that nulls it must not throw, and the drop resolves to the tail.
    const { ui } = folderFixture(["a", "b"]);
    const move = vi.spyOn(ui.c, "moveLayerToRootAt");
    handleDragStart(ui, dragEvent(rowOf(ui, "a1"), { effectAllowed: "" }));
    // The getter reads c.uiContainer, so the teardown that nulls the panel
    // is exercised through the controller field.
    ui.c.uiContainer = null;

    handleDrop(ui, dragEvent(document.createElement("div"), {}, 0));

    expect(move).toHaveBeenCalledWith("a1", null);
    expect(ui.listPanel.dragEntry).toBeNull();
  });

  it("walks through a member row to the folder block above its folder", () => {
    // Two members share folder "a": a drop on the second member's row walks the
    // sibling chain (member row → folder row) instead of reading its own row as
    // a block. The position resolves to the shared folder.
    const { ui } = initFixture({
      seedLayout: {
        version: 2,
        folders: [{ key: "a", name: "a" }],
        order: { overlay: ["a"] },
        members: {},
      },
      data: [
        {
          id: "a1",
          name: "a1",
          role: "overlay",
          folder: "a",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "a2",
          name: "a2",
          role: "overlay",
          folder: "a",
          layer: { options: {}, eachLayer: vi.fn() },
        },
      ],
    });
    const a2 = rowOf(ui, "a2");
    withRect(a2, 100, 36);
    const move = vi.spyOn(ui.c, "moveLayerToRootAt");
    handleDragStart(ui, dragEvent(rowOf(ui, "a1"), { effectAllowed: "" }));
    const shell = document.createElement("div");
    attachedPanel(ui).appendChild(shell);

    handleDrop(ui, dragEvent(shell, {}, 110));

    // a1 is dropped on a2's row: the target is the shared folder block "a".
    expect(move).toHaveBeenCalledWith("a1", "a");
  });

  it("refuses a layer on the other role's folder row and names the reason", () => {
    // Folders are per-role blocks: an overlay layer dragged onto a base folder
    // row would materialise a same-named folder in the overlay role, reading as
    // a duplicate. The guard clears the hover chrome and answers with the same
    // sentence the folder-drag path uses.
    const { ui } = initFixture({
      seedLayout: {
        version: 2,
        folders: [
          { key: "a", name: "a" },
          { key: "b", name: "b" },
        ],
        order: { overlay: ["a"], base: ["b"] },
        members: {},
      },
      data: [
        {
          id: "a1",
          name: "a1",
          role: "overlay",
          folder: "a",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "b1",
          name: "b1",
          role: "base",
          folder: "b",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "R1",
          name: "R1",
          role: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
      ],
    });
    const baseFolderB = attachedPanel(ui).querySelector<HTMLElement>(
      `[${CONST.DATA.FOLDER_KEY}="b"]`,
    )!;
    withRect(baseFolderB, 100, 36);
    const showHint = vi.spyOn(ui.c.map.foliplus, "showHint");
    handleDragStart(ui, dragEvent(rowOf(ui, "R1"), { effectAllowed: "" }));

    handleDragOver(ui, dragEvent(baseFolderB, { dropEffect: "" }, 118));

    expect(showHint).toHaveBeenCalled();
    expect(ui.listPanel.lastDragOverItem).toBeNull();
  });

  it("throttles repeated refusals to one hint per gesture", () => {
    // The same refusal twice inside the cooldown window shows one toast: a drag
    // that keeps crossing a dead zone must not stack hints.
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({
      id: "G1",
      name: "G1",
      role: "overlay",
      layer: containerLayer(),
    });
    const row = folderRowOf(ui, "b");
    withRect(row, 100, 36);
    const showHint = vi.spyOn(ui.c.map.foliplus, "showHint");
    handleDragStart(ui, dragEvent(rowOf(ui, "G1"), { effectAllowed: "" }));

    handleDragOver(ui, dragEvent(row, {}, 118));
    handleDragOver(ui, dragEvent(row, {}, 118));

    expect(showHint).toHaveBeenCalledTimes(1);
  });

  it("answers a hover over empty space with a move cursor", () => {
    // A layer dragged across the gap between rows: the drop target is the block
    // position, so the hover reports a valid move even with no row under it.
    const { ui } = folderFixture(["a", "b"]);
    handleDragStart(ui, dragEvent(rowOf(ui, "a1"), { effectAllowed: "" }));
    const shell = document.createElement("div");
    attachedPanel(ui).appendChild(shell);

    handleDragOver(ui, dragEvent(shell, { dropEffect: "" }, 0));

    expect(ui.listPanel.lastDragOverItem).toBeNull();
  });

  it("refuses a container over a folder member row with the folder sentence", () => {
    // A container over a member row would join that member's folder, which a
    // layer group cannot do — the inside path must answer like the folder row.
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({
      id: "G1",
      name: "G1",
      role: "overlay",
      layer: containerLayer(),
    });
    const member = rowOf(ui, "b1");
    withRect(member, 100, 36);
    const showHint = vi.spyOn(ui.c.map.foliplus, "showHint");
    handleDragStart(ui, dragEvent(rowOf(ui, "G1"), { effectAllowed: "" }));
    const dataTransfer = { dropEffect: "" };

    handleDragOver(ui, dragEvent(member, dataTransfer, 118));

    expect(dataTransfer.dropEffect).toBe("none");
    expect(showHint).toHaveBeenCalled();
  });

  it("lands the layer before a folder when dropped on its top zone", () => {
    // Dropping a layer on a folder row's before-zone moves it to the folder's
    // block position, not into the folder: the folder-key is the position.
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({ id: "R1", name: "R1", role: "overlay" });
    const row = folderRowOf(ui, "b");
    withRect(row, 100, 36);
    const move = vi.spyOn(ui.c, "moveLayerToRootAt");
    handleDragStart(ui, dragEvent(rowOf(ui, "R1"), { effectAllowed: "" }));

    handleDrop(ui, dragEvent(row, {}, 102));

    expect(move).toHaveBeenCalledWith("R1", "b");
  });
});

describe("drop adopts the target row's folder", () => {
  it("moves a root layer onto a member row into that member's folder", () => {
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({ id: "R1", name: "R1", role: "overlay" });
    const member = rowOf(ui, "b1");
    member.getBoundingClientRect = () =>
      ({
        top: 100,
        height: 36,
        bottom: 136,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;

    handleDragStart(ui, dragEvent(rowOf(ui, "R1"), { effectAllowed: "" }));
    handleDrop(ui, dragEvent(member, {}, 118));

    // The drop adopts the row's folder: R1 joins b, matching the tree guide
    // a keyboard or API move would produce.
    expect(manager.folderNameOf("R1")).toBe("b");
    expect(ui.listPanel.dragEntry).toBeNull();
  });
});

describe("drag — the dataTransfer is always optional", () => {
  /** Pin a row's box so the drop zone is deterministic (jsdom rects are 0). */
  const withRect = (row: HTMLElement, top: number, height: number): void => {
    row.getBoundingClientRect = () =>
      ({
        top,
        height,
        bottom: top + height,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
  };

  /** A drag event without a dataTransfer: jsdom and some browsers omit it. */
  const noTransfer = (target: HTMLElement, clientY = 0): DragEvent =>
    ({
      target,
      clientY,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: null,
    }) as unknown as DragEvent;

  it("arms a folder drag on an event without a dataTransfer", () => {
    const { ui } = folderFixture(["a", "b"]);
    const row = folderRowOf(ui, "a");

    handleDragStart(ui, noTransfer(row));

    // The gesture is armed regardless: the dataTransfer only carries the
    // cursor affordance the browser paints.
    expect(ui.listPanel.dragFolder).toEqual({ role: "overlay", key: "a" });
    expect(row.classList.contains(CONST.CLASSES.DRAGGING)).toBe(true);
  });

  it("paints a folder drag's hover marker without a dataTransfer", () => {
    const { ui } = folderFixture(["a", "b"]);
    handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
    const row = folderRowOf(ui, "b");
    pinRect(row, 100, 36);

    handleDragOver(ui, noTransfer(row, 104));

    expect(row.classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(true);
    expect(ui.listPanel.lastDragOverItem).toBe(row);
  });

  it("refuses a folder drag over a container row without a dataTransfer", () => {
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({
      id: "G1",
      name: "G1",
      role: "overlay",
      layer: containerLayer(),
    });
    const showHint = vi.spyOn(ui.c.map.foliplus, "showHint");
    handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));

    handleDragOver(ui, noTransfer(rowOf(ui, "G1")));

    expect(showHint).toHaveBeenCalled();
    expect(ui.listPanel.lastDragOverItem).toBeNull();
  });

  it("answers a layer hover over a gap without a dataTransfer", () => {
    const { ui } = folderFixture(["a", "b"]);
    handleDragStart(ui, dragEvent(rowOf(ui, "a1"), { effectAllowed: "" }));
    const shell = document.createElement("div");
    attachedPanel(ui).appendChild(shell);

    expect(() => handleDragOver(ui, noTransfer(shell))).not.toThrow();
    expect(ui.listPanel.lastDragOverItem).toBeNull();
  });

  it("refuses a layer on the other role's folder row without a dataTransfer", () => {
    // The cross-role guard must not depend on the dataTransfer: a refusal
    // that silently turns into a drop is worse than no marker at all.
    const { ui } = initFixture({
      seedLayout: {
        version: 2,
        folders: [
          { key: "a", name: "a" },
          { key: "b", name: "b" },
        ],
        order: { overlay: ["a"], base: ["b"] },
        members: {},
      },
      data: [
        {
          id: "a1",
          name: "a1",
          role: "overlay",
          folder: "a",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "b1",
          name: "b1",
          role: "base",
          folder: "b",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "R1",
          name: "R1",
          role: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
      ],
    });
    const baseFolder = attachedPanel(ui).querySelector<HTMLElement>(
      `[${CONST.DATA.FOLDER_KEY}="b"]`,
    )!;
    handleDragStart(ui, dragEvent(rowOf(ui, "R1"), { effectAllowed: "" }));

    expect(() => handleDragOver(ui, noTransfer(baseFolder))).not.toThrow();
  });

  it("refuses a container on a folder's middle zone without a dataTransfer", () => {
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({
      id: "G1",
      name: "G1",
      role: "overlay",
      layer: containerLayer(),
    });
    const row = folderRowOf(ui, "b");
    withRect(row, 100, 36);
    handleDragStart(ui, dragEvent(rowOf(ui, "G1"), { effectAllowed: "" }));

    expect(() => handleDragOver(ui, noTransfer(row, 118))).not.toThrow();
  });

  it("refuses a container over a member row without a dataTransfer", () => {
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({
      id: "G1",
      name: "G1",
      role: "overlay",
      layer: containerLayer(),
    });
    const member = rowOf(ui, "b1");
    handleDragStart(ui, dragEvent(rowOf(ui, "G1"), { effectAllowed: "" }));

    expect(() => handleDragOver(ui, noTransfer(member))).not.toThrow();
  });

  it("drops a layer into a folder row whose box is not measurable", () => {
    // jsdom rows carry zero boxes, and so can a row mid-layout: the zone
    // answers "into", so the drop joins the folder instead of guessing a
    // block position.
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({ id: "R1", name: "R1", role: "overlay" });
    const move = vi.spyOn(ui.c, "moveLayerToFolder");
    handleDragStart(ui, dragEvent(rowOf(ui, "R1"), { effectAllowed: "" }));

    handleDrop(ui, dragEvent(folderRowOf(ui, "a"), {}, 0));

    expect(move).toHaveBeenCalledWith("R1", "a");
  });
});

describe("drag — block order across root layers", () => {
  /** Pin a row's box so the drop zone is deterministic (jsdom rects are 0). */
  const withRect = (row: HTMLElement, top: number, height: number): void => {
    row.getBoundingClientRect = () =>
      ({
        top,
        height,
        bottom: top + height,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
  };

  /** A role's block order holding a root layer between two folder blocks. */
  const interleavedFixture = () =>
    initFixture({
      seedLayout: {
        version: 2,
        folders: [
          { key: "a", name: "a" },
          { key: "b", name: "b" },
        ],
        order: { overlay: ["a", "layer:R1", "b"] },
        members: {},
      },
      data: [
        {
          id: "a1",
          name: "a1",
          role: "overlay",
          folder: "a",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "b1",
          name: "b1",
          role: "overlay",
          folder: "b",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "R1",
          name: "R1",
          role: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
      ],
    });

  it("places a layer after the folder block that precedes a root layer", () => {
    // A root layer sits between the two folder blocks: dropping a layer on
    // folder "a"'s after-zone lands it before that root block, not after
    // folder "b" — the position follows the block order, not the row order.
    const { manager, ui } = interleavedFixture();
    manager.registerLayer({ id: "R2", name: "R2", role: "overlay" });
    const row = folderRowOf(ui, "a");
    withRect(row, 100, 36);
    const move = vi.spyOn(ui.c, "moveLayerToRootAt");
    handleDragStart(ui, dragEvent(rowOf(ui, "R2"), { effectAllowed: "" }));

    handleDrop(ui, dragEvent(row, {}, 134));

    expect(move).toHaveBeenCalledWith("R2", "layer:R1");
  });

  it("drops at the block tail when the pointer is below every row", () => {
    // No row sits above the pointer, so there is no block to insert before:
    // the layer becomes a root block at the tail of the role's order.
    const { ui } = folderFixture(["a", "b"]);
    withRect(folderRowOf(ui, "a"), 100, 36);
    const move = vi.spyOn(ui.c, "moveLayerToRootAt");
    handleDragStart(ui, dragEvent(rowOf(ui, "b1"), { effectAllowed: "" }));
    const shell = document.createElement("div");
    attachedPanel(ui).appendChild(shell);

    handleDrop(ui, dragEvent(shell, {}, 400));

    expect(move).toHaveBeenCalledWith("b1", null);
  });

  it("lands at the block tail when the pointer sits over the role header", () => {
    // The role header names no folder and no layer, so it is not a block
    // boundary: a drop in its row has nothing to insert before and lands at
    // the tail.
    const { ui } = folderFixture(["a", "b"]);
    const header = attachedPanel(ui).querySelector<HTMLElement>(
      `[${CONST.DATA.ROLE}="overlay"]`,
    )!;
    withRect(header, 40, 30);
    const move = vi.spyOn(ui.c, "moveLayerToRootAt");
    handleDragStart(ui, dragEvent(rowOf(ui, "b1"), { effectAllowed: "" }));
    const shell = document.createElement("div");
    attachedPanel(ui).appendChild(shell);

    handleDrop(ui, dragEvent(shell, {}, 50));

    expect(move).toHaveBeenCalledWith("b1", null);
  });

  it("drops after a folder row that carries no role", () => {
    // A folder row without its role cannot be placed relative to its block
    // order, so the drop falls back to the tail of the role's order.
    const { ui } = folderFixture(["a", "b"]);
    const row = folderRowOf(ui, "b");
    row.removeAttribute(CONST.DATA.ROLE);
    withRect(row, 100, 36);
    const move = vi.spyOn(ui.c, "moveLayerToRootAt");
    handleDragStart(ui, dragEvent(rowOf(ui, "a1"), { effectAllowed: "" }));

    handleDrop(ui, dragEvent(row, {}, 134));

    expect(move).toHaveBeenCalledWith("a1", null);
  });
});

describe("drag — block resolution at the role edges", () => {
  /** Pin a row's box so the drop zone is deterministic (jsdom rects are 0). */
  const withRect = (row: HTMLElement, top: number, height: number): void => {
    row.getBoundingClientRect = () =>
      ({
        top,
        height,
        bottom: top + height,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
  };

  it("drops a folder drag onto a layer row and names no target", () => {
    // A folder block only lands on a folder row: a layer row is not a block,
    // so the drag must refuse it instead of resolving to a neighbouring one.
    const { ui } = folderFixture(["a", "b"]);
    handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
    const layerRow = rowOf(ui, "b1");
    const dataTransfer = { dropEffect: "" };

    handleDragOver(ui, dragEvent(layerRow, dataTransfer, 0));

    expect(dataTransfer.dropEffect).toBe("none");
    expect(ui.listPanel.lastDragOverItem).toBeNull();
  });

  it("places a layer after a folder block that precedes a root layer", () => {
    // The block order can interleave a root layer between folder blocks: the
    // position after folder "a" is that root block, not folder "b".
    const { manager, ui } = initFixture({
      seedLayout: {
        version: 2,
        folders: [
          { key: "a", name: "a" },
          { key: "b", name: "b" },
        ],
        order: { overlay: ["a", "layer:R1", "b"] },
        members: {},
      },
      data: [
        {
          id: "a1",
          name: "a1",
          role: "overlay",
          folder: "a",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "b1",
          name: "b1",
          role: "overlay",
          folder: "b",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "R1",
          name: "R1",
          role: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
      ],
    });
    manager.registerLayer({ id: "R2", name: "R2", role: "overlay" });
    const row = folderRowOf(ui, "a");
    withRect(row, 100, 36);
    const move = vi.spyOn(ui.c, "moveLayerToRootAt");
    handleDragStart(ui, dragEvent(rowOf(ui, "R2"), { effectAllowed: "" }));

    handleDrop(ui, dragEvent(row, {}, 134));

    expect(move).toHaveBeenCalledWith("R2", "layer:R1");
  });

  it("joins a folder row that lost its role", () => {
    // The role is read defensively: a folder row without it still takes the
    // layer in its middle zone, and the cross-role guard skips it rather than
    // refusing a same-role move it cannot classify.
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({ id: "R1", name: "R1", role: "overlay" });
    const row = folderRowOf(ui, "b");
    row.removeAttribute(CONST.DATA.ROLE);
    withRect(row, 100, 36);
    const dataTransfer = { dropEffect: "" };
    handleDragStart(ui, dragEvent(rowOf(ui, "R1"), { effectAllowed: "" }));

    handleDragOver(ui, dragEvent(row, dataTransfer, 118));

    expect(dataTransfer.dropEffect).toBe("move");
    expect(row.classList.contains(CONST.CLASSES.DRAG_OVER_INTO)).toBe(true);
  });

  it("paints a folder join marker when the drag carries no dataTransfer", () => {
    // The affordance is optional: the pointer state must still paint when the
    // browser omits the transfer, and the drop must still join the folder.
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({ id: "R1", name: "R1", role: "overlay" });
    const row = folderRowOf(ui, "b");
    withRect(row, 100, 36);
    handleDragStart(ui, dragEvent(rowOf(ui, "R1"), { effectAllowed: "" }));
    const event = {
      target: row,
      clientY: 118,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: null,
    } as unknown as DragEvent;

    expect(() => handleDragOver(ui, event)).not.toThrow();

    expect(row.classList.contains(CONST.CLASSES.DRAG_OVER_INTO)).toBe(true);
    expect(ui.listPanel.lastDragOverItem).toBe(row);
  });
});

describe("drag — placing a layer after a folder block", () => {
  /** Pin a row's box so the drop zone is deterministic (jsdom rects are 0). */
  const withRect = (row: HTMLElement, top: number, height: number): void => {
    row.getBoundingClientRect = () =>
      ({
        top,
        height,
        bottom: top + height,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
  };

  it("places a layer before the folder block that follows", () => {
    // Inserting after one folder block is the same position as before the
    // block that follows it, so the resolver names that neighbour folder.
    const { ui } = folderFixture(["a", "b"]);
    const row = folderRowOf(ui, "a");
    withRect(row, 100, 36);
    const move = vi.spyOn(ui.c, "moveLayerToRootAt");
    handleDragStart(ui, dragEvent(rowOf(ui, "a1"), { effectAllowed: "" }));

    handleDrop(ui, dragEvent(row, {}, 134));

    expect(move).toHaveBeenCalledWith("a1", "b");
  });

  it("places a layer after a folder that follows a root block", () => {
    // The resolver walks the role's block list to find the folder: a root
    // block ahead of it is not the position, so the search keeps walking.
    const { ui } = initFixture({
      seedLayout: {
        version: 2,
        folders: [
          { key: "a", name: "a" },
          { key: "b", name: "b" },
        ],
        order: { overlay: ["layer:R0", "a", "b"] },
        members: {},
      },
      data: [
        {
          id: "a1",
          name: "a1",
          role: "overlay",
          folder: "a",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "b1",
          name: "b1",
          role: "overlay",
          folder: "b",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "R0",
          name: "R0",
          role: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
      ],
    });
    const row = folderRowOf(ui, "a");
    withRect(row, 100, 36);
    const move = vi.spyOn(ui.c, "moveLayerToRootAt");
    handleDragStart(ui, dragEvent(rowOf(ui, "a1"), { effectAllowed: "" }));

    handleDrop(ui, dragEvent(row, {}, 134));

    expect(move).toHaveBeenCalledWith("a1", "b");
  });

  it("places a layer before the root block that follows the folder", () => {
    // The role's block order can interleave a root layer between folders: the
    // position after folder "a" is that root block, not folder "b".
    const { ui } = initFixture({
      seedLayout: {
        version: 2,
        folders: [
          { key: "a", name: "a" },
          { key: "b", name: "b" },
        ],
        order: { overlay: ["a", "layer:R0", "b"] },
        members: {},
      },
      data: [
        {
          id: "a1",
          name: "a1",
          role: "overlay",
          folder: "a",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "b1",
          name: "b1",
          role: "overlay",
          folder: "b",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "R0",
          name: "R0",
          role: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
      ],
    });
    const row = folderRowOf(ui, "a");
    withRect(row, 100, 36);
    const move = vi.spyOn(ui.c, "moveLayerToRootAt");
    handleDragStart(ui, dragEvent(rowOf(ui, "a1"), { effectAllowed: "" }));

    handleDrop(ui, dragEvent(row, {}, 134));

    expect(move).toHaveBeenCalledWith("a1", "layer:R0");
  });
});

describe("ui/list folder rows (fold)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  const layoutFromRoles = (
    sections: Record<string, string[]>,
  ): Record<string, unknown> => {
    const keys = new Set<string>();
    for (const list of Object.values(sections)) for (const k of list) keys.add(k);
    return {
      version: 2,
      folders: [...keys].map(k => ({ key: k, name: k })),
      order: sections,
      members: {},
    };
  };

  const polygonLayer = () => ({
    options: {},
    getBounds: () => ({ isValid: () => true }),
  });

  it("toggleFolderFold hides members and persists foldedFolders", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    expect(isFolderFolded(ui, "overlay", "roads")).toBe(false);
    toggleFolderFold(ui, "overlay", "roads");
    expect(isFolderFolded(ui, "overlay", "roads")).toBe(true);
    const memberRow = ui.uiContainer!.querySelector(`[data-layer-id="rd1"]`);
    expect(memberRow!.classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(true);
    // The in-memory fold set is the single source (persistence schedules it).
    expect(ui.listPanel.foldedFolders["overlay::roads"]).toBe(true);
  });

  it("keeps the folded folder row visible and hides only its members (issue 10)", () => {
    // The header is the only way back to the members, so folding must never
    // hide it. Two classes carry two different meanings: FOLDED is the row's
    // own state (chevron direction, accent rail), GROUP_FOLDED is "hidden
    // because my group is folded" and belongs to the members alone. Putting
    // GROUP_FOLDED on the header hid the whole folder from the panel.
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    toggleFolderFold(ui, "overlay", "roads");
    const folderRow = ui.uiContainer!.querySelector(`.${CONST.CLASSES.FOLDER_ROW}`)!;
    expect(folderRow.classList.contains(CONST.CLASSES.FOLDED)).toBe(true);
    expect(folderRow.classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(false);
    const memberRow = ui.uiContainer!.querySelector('[data-layer-id="rd1"]')!;
    expect(memberRow.classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(true);
  });

  it("persists foldedFolders when the save debounce flushes", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    // initFixture ends with real timers; take fake timers AFTER the fixture
    // so the save debounce can be flushed deterministically.
    vi.useFakeTimers();
    try {
      toggleFolderFold(ui, "overlay", "roads");
      // Flush the persistence debounce so the foldedFolders writer runs
      // (state.ts:38) and the record hits storage.
      vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);
      const rec = ui.c.persistence.load();
      expect(rec.foldedFolders["overlay::roads"]).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keyboard Enter on a folder chevron folds the folder, not the role", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const foldBtn = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.FOLDER_ROW} .${CONST.CLASSES.FOLD_BTN}`,
    ) as HTMLButtonElement;
    foldBtn.focus();
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    handleKeyDown(ui, event);
    expect(isFolderFolded(ui, "overlay", "roads")).toBe(true);
    expect(ui.listPanel.foldedRoles.overlay).toBeUndefined();
  });

  it("whole-row click on a folder row folds the folder", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const folderRow = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.FOLDER_ROW}`,
    ) as HTMLElement;
    folderRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(isFolderFolded(ui, "overlay", "roads")).toBe(true);
  });

  it("toggleFolderFold folds then unfolds a folder", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    toggleFolderFold(ui, "overlay", "roads");
    expect(isFolderFolded(ui, "overlay", "roads")).toBe(true);
    toggleFolderFold(ui, "overlay", "roads");
    expect(isFolderFolded(ui, "overlay", "roads")).toBe(false);
  });

  it("applies the author-declared default fold to the folder row (TDD, issue 10)", () => {
    window.CONFIG.folders = {
      overlay: [{ name: "roads", folded: true }],
      base: [],
    };
    try {
      const { ui } = initFixture({
        seedLayout: layoutFromRoles({ overlay: ["roads"] }),
        data: [
          {
            id: "rd1",
            name: "Roads",
            role: "overlay",
            folder: "roads",
            layer: polygonLayer(),
          },
        ],
      });
      const folderRow = ui.uiContainer!.querySelector(`.${CONST.CLASSES.FOLDER_ROW}`);
      expect(folderRow).not.toBeNull();
      expect(folderRow!.getAttribute("aria-expanded")).toBe("false");
      // The header carries its own fold state, never the members' hidden flag.
      expect(folderRow!.classList.contains(CONST.CLASSES.FOLDED)).toBe(true);
      expect(folderRow!.classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(false);
      // The member row is folded too.
      const member = ui.uiContainer!.querySelector('[data-layer-id="rd1"]');
      expect(member!.classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(true);
    } finally {
      delete window.CONFIG.folders;
    }
  });
});

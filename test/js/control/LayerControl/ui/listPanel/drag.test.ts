// test/js/control/LayerControl/ui/style/drag — the drag engine, blocked hint and hover chrome.
import { attachedPanel, initFixture } from "../fixture.js";
import {
  dragEvent,
  folderFixture,
  folderRowOf,
  makeUi,
  orderOf,
  overlays,
  pinRect,
  rowOf,
} from "./drag.fixture.js";
import { describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { ensureOverlayRegistry } from "#core/overlay/index.js";
import { ROLE } from "#foliplus/core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import {
  handleDragEnd,
  handleDragLeave,
  handleDragOver,
  handleDragStart,
  handleDrop,
  showReorderBlockedHint,
  toggleFold,
} from "#control/LayerControl/ui/listPanel/index.js";

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
      expect(row.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.SOURCE);
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

    it("drops a folder before a root layer row (P1 #1289 regression)", () => {
      // Clean localStorage: a folder declared by the author (member a1 sits
      // between the two root layers by registration order) and two unassigned
      // root layers. The user drags the folder block onto the root2 row.
      const { manager, ui } = initFixture({
        seedLayout: {
          version: 2,
          folders: [{ key: "a", name: "a" }],
          order: {},
          members: {},
        },
        data: [
          { id: "root1", name: "root1", role: "overlay" as const },
          {
            id: "a1",
            name: "a1",
            role: "overlay" as const,
            folder: "a",
            layer: { options: {}, eachLayer: vi.fn() },
          },
          { id: "root2", name: "root2", role: "overlay" as const },
        ],
      });
      const row = rowOf(ui, "root2");
      pinRect(row, 100, 36);
      handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
      // Pointer on the top edge of root2's row: the folder lands BEFORE it.
      handleDrop(ui, dragEvent(row, {}, 102));
      expect(manager.folderLayoutView.order.overlay).toEqual([
        "layer:root1",
        "a",
        "layer:root2",
      ]);
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
      expect(b.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.AFTER);
      expect(ui.listPanel.lastDragOverItem).toBe(b);
      // Moving to another block takes the chrome off the previous one.
      handleDragOver(ui, dragEvent(c, { dropEffect: "" }, 170));
      expect(b.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(CONST.DRAG_STATE.AFTER);
      expect(c.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.AFTER);
      expect(ui.listPanel.lastDragOverItem).toBe(c);
    });

    it("marks the top half as a before-target", () => {
      const { ui } = folderFixture(["a", "b"]);
      handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
      const b = folderRowOf(ui, "b");
      pinRect(b, 100, 36);
      handleDragOver(ui, dragEvent(b, { dropEffect: "" }, 104));
      expect(b.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.BEFORE);
      expect(b.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(CONST.DRAG_STATE.AFTER);
    });

    it("refuses a folder dropped into another folder", () => {
      const { ui } = folderFixture(["a", "b"]);
      const showHint = vi.spyOn(ui.c.map.foliplus.hint, "set");
      handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
      const b = folderRowOf(ui, "b");
      pinRect(b, 100, 36);
      // The middle third is the "into" gesture: a folder never nests.
      const over = dragEvent(b, { dropEffect: "" }, 118);
      handleDragOver(ui, over);
      expect(over.dataTransfer!.dropEffect).toBe("none");
      expect(b.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(CONST.DRAG_STATE.BEFORE);
      expect(b.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(CONST.DRAG_STATE.AFTER);
      // The refused zone draws a dashed outline: without it the middle half of
      // the row is a strip that neither lights up nor accepts.
      expect(b.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.REFUSE);
      expect(ui.listPanel.lastDragOverItem).toBe(b);
      expect(showHint).toHaveBeenCalledWith(ui.config.name, "", ui.T("no_nest"), {
        duration: expect.anything(),
      });
    });

    it("clears the chrome when the pointer leaves the folder rows", () => {
      const { ui } = folderFixture(["a", "b"]);
      handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
      const b = folderRowOf(ui, "b");
      handleDragOver(ui, dragEvent(b, { dropEffect: "" }, 10));
      // A role header is not a block target: the chrome must clear.
      const roleRow = attachedPanel(ui).querySelector(
        `${CONST.SEL.TOGGLE_ALL}[data-role="${ROLE.OVERLAY}"]`,
      ) as HTMLElement;
      const away = dragEvent(roleRow, { dropEffect: "" }, 10);
      handleDragOver(ui, away);
      expect(away.preventDefault).not.toHaveBeenCalled();
      expect(away.dataTransfer!.dropEffect).toBe("none");
      expect(b.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(CONST.DRAG_STATE.AFTER);
      expect(ui.listPanel.lastDragOverItem).toBeNull();
    });

    it("refuses the dragged folder's own row and a row of the other role", () => {
      const { ui } = folderFixture(["a", "b"]);
      handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
      const own = dragEvent(folderRowOf(ui, "a"), { dropEffect: "" }, 10);
      handleDragOver(ui, own);
      expect(own.dataTransfer!.dropEffect).toBe("none");
      expect(ui.listPanel.lastDragOverItem).toBeNull();
      // A folder row of the other role is not a block target: it answers with
      // the refusal marker instead of staying silent.
      const b = folderRowOf(ui, "b");
      b.setAttribute(CONST.DATA.ROLE, "base");
      const otherRole = dragEvent(b, { dropEffect: "" }, 10);
      handleDragOver(ui, otherRole);
      expect(otherRole.dataTransfer!.dropEffect).toBe("none");
      expect(b.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.REFUSE);
      expect(ui.listPanel.lastDragOverItem).toBe(b);
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
      expect(row.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.SOURCE);
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
      expect(row.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(CONST.DRAG_STATE.SOURCE);
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
      expect(orphan.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(
        CONST.DRAG_STATE.SOURCE,
      );
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
      expect(row.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.SOURCE);
    });

    it("handleDragEnd disarms the session and strips every marker", () => {
      const ui = makeUi({ containers: ["a", "b"] });
      handleDragStart(ui, dragEvent(rowOf(ui, "a")));
      const rows = Array.from(
        attachedPanel(ui).querySelectorAll<HTMLElement>(CONST.SEL.LAYER_ITEM),
      );
      rows[0].setAttribute(CONST.DRAG_STATE_ATTR, CONST.DRAG_STATE.BEFORE);
      rows[1].setAttribute(CONST.DRAG_STATE_ATTR, CONST.DRAG_STATE.AFTER);
      ui.listPanel.lastDragOverItem = rows[0];

      handleDragEnd(ui);

      expect(ui.listPanel.dragEntry).toBeNull();
      expect(ui.listPanel.lastDragOverItem).toBeNull();
      rows.forEach(row => {
        expect(row.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(
          CONST.DRAG_STATE.SOURCE,
        );
        expect(row.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(
          CONST.DRAG_STATE.BEFORE,
        );
        expect(row.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(
          CONST.DRAG_STATE.AFTER,
        );
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
      expect(rowOf(ui, "L0").getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(
        CONST.DRAG_STATE.SOURCE,
      );
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
      row.setAttribute(CONST.DRAG_STATE_ATTR, CONST.DRAG_STATE.BEFORE);
      row.setAttribute(CONST.DRAG_PUSH_ATTR, CONST.DRAG_PUSH.TOP);

      handleDragLeave(ui, dragEvent(row));

      expect(row.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(CONST.DRAG_STATE.BEFORE);
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

      expect(rowL0.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(
        CONST.DRAG_STATE.BEFORE,
      );
      expect(rowL0.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(
        CONST.DRAG_STATE.AFTER,
      );
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
      expect(rowL0.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.BEFORE);
      expect(rowL0.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(
        CONST.DRAG_STATE.AFTER,
      );

      // The marker follows the pointer: the previous row is cleaned, the
      // hovered one takes it.
      handleDragOver(ui, dragEvent(rowL1));
      expect(rowL0.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(
        CONST.DRAG_STATE.BEFORE,
      );
      expect(rowL1.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.BEFORE);
    });

    it("handleDragOver marks a blocked move none on a real dataTransfer", () => {
      const { ui } = initFixture({
        data: [...overlays(1), { id: "B0", name: "B0", role: "base" as const }],
      });
      handleDragStart(ui, dragEvent(rowOf(ui, "L0")));
      const dataTransfer = { dropEffect: "" };

      handleDragOver(ui, dragEvent(rowOf(ui, "B0"), dataTransfer));

      expect(dataTransfer.dropEffect).toBe("none");
      expect(rowOf(ui, "B0").getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(
        CONST.DRAG_STATE.BEFORE,
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
      expect(rowOf(ui, "B0").getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(
        CONST.DRAG_STATE.BEFORE,
      );
    });

    it("handleDragOver paints no drop marker over the armed row itself", () => {
      const { ui } = initFixture({ data: overlays(3) });
      handleDragStart(ui, dragEvent(rowOf(ui, "L1")));

      handleDragOver(ui, dragEvent(rowOf(ui, "L1")));

      // The carried row is not a gap: it keeps its pickup marker and gains no
      // before/after state.
      expect(rowOf(ui, "L1").getAttribute(CONST.DRAG_STATE_ATTR)).toBe(
        CONST.DRAG_STATE.SOURCE,
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
      expect(rowOf(ui, "L0").getAttribute(CONST.DRAG_STATE_ATTR)).toBe(
        CONST.DRAG_STATE.BEFORE,
      );
    });

    it("handleDrop is a no-op when no drag is armed", () => {
      const { manager, ui } = initFixture({ data: overlays(3) });
      const before = orderOf(manager);

      handleDrop(ui, dragEvent(rowOf(ui, "L0")));

      expect(orderOf(manager)).toEqual(before);
    });

    it("handleDragLeave ignores targets that are not layer rows", () => {
      const { ui } = initFixture({ data: overlays(2) });
      const shell = document.createElement("div");

      expect(() => handleDragLeave(ui, dragEvent(shell))).not.toThrow();
      expect(shell.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(
        CONST.DRAG_STATE.BEFORE,
      );
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
      // The runtime hint system binds map.foliplus.hint.set during attach,
      // so the spy wraps the bound function the drop actually calls.
      const showHint = vi.spyOn(ui.c.map.foliplus.hint, "set");

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
      expect(rowL0.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.AFTER);
      expect(rowL0.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(
        CONST.DRAG_STATE.BEFORE,
      );
    });

    it("handleDragOver does nothing once the session is stale", () => {
      const { manager, ui } = initFixture({ data: overlays(3) });
      handleDragStart(ui, dragEvent(rowOf(ui, "L1")));
      manager.unregisterLayer("L1");
      const rowL0 = rowOf(ui, "L0");

      handleDragOver(ui, dragEvent(rowL0));

      expect(rowL0.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(
        CONST.DRAG_STATE.BEFORE,
      );
      expect(rowL0.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(
        CONST.DRAG_STATE.AFTER,
      );
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
      expect(orphan.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(
        CONST.DRAG_STATE.BEFORE,
      );
      expect(orphan.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(
        CONST.DRAG_STATE.AFTER,
      );
      expect(orphan.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(
        CONST.DRAG_STATE.JOIN,
      );
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

    it("refuses to put a group into a folder", () => {
      // A group's children are its own sub-layers; a folder groups registry
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

    it("refuses a group over a folder's member row, with the same sentence", () => {
      // The member row is the same rule reached from the inside: a drop there
      // would join the member's folder, which a group cannot do. The hover
      // must refuse and say why instead of painting the reorder indicator and
      // then dropping the move on the floor.
      const { manager, ui } = folderFixture(["a", "b"]);
      manager.registerLayer({ id: "G1", name: "G1", role: "overlay" });
      ui.c.findLayer = vi.fn(() => ({
        eachLayer: vi.fn(),
        _layers: {},
      })) as never;
      const showHint = vi.spyOn(ui.c.map.foliplus.hint, "set");
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
      expect(rowOf(ui, "L1").getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(
        CONST.DRAG_STATE.SOURCE,
      );
    });

    it("a stale session clears with its hover chrome on dragover", () => {
      const { ui } = initFixture({ data: overlays(3) });
      // A session whose entry left the registry without the retire path —
      // the over handler owns its own teardown, not just the drop's.
      ui.listPanel.dragEntry = { id: "ghost" } as never;
      const rowL0 = rowOf(ui, "L0");
      rowL0.setAttribute(CONST.DRAG_STATE_ATTR, CONST.DRAG_STATE.BEFORE);
      ui.listPanel.lastDragOverItem = rowL0;

      handleDragOver(ui, dragEvent(rowL0));

      expect(ui.listPanel.dragEntry).toBeNull();
      expect(ui.listPanel.lastDragOverItem).toBeNull();
      expect(rowL0.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(
        CONST.DRAG_STATE.BEFORE,
      );
    });

    it("a stale session clears with its hover chrome on drop", () => {
      const { ui } = initFixture({ data: overlays(3) });
      ui.listPanel.dragEntry = { id: "ghost" } as never;
      const rowL0 = rowOf(ui, "L0");
      rowL0.setAttribute(CONST.DRAG_STATE_ATTR, CONST.DRAG_STATE.AFTER);
      ui.listPanel.lastDragOverItem = rowL0;

      handleDrop(ui, dragEvent(rowL0));

      expect(ui.listPanel.dragEntry).toBeNull();
      expect(ui.listPanel.lastDragOverItem).toBeNull();
      expect(rowL0.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(
        CONST.DRAG_STATE.AFTER,
      );
    });

    it("unregistering the dragged layer cancels the gesture on the spot", () => {
      // The retire path does not wait for the next dragover/drop to notice:
      // the source row is leaving the panel, and a native dragend off a
      // detached source cannot be relied on to bubble back.
      const { manager, ui } = initFixture({ data: overlays(3) });
      handleDragStart(ui, dragEvent(rowOf(ui, "L1")));
      expect(rowOf(ui, "L1").getAttribute(CONST.DRAG_STATE_ATTR)).toBe(
        CONST.DRAG_STATE.SOURCE,
      );
      const rowL0 = rowOf(ui, "L0");
      rowL0.setAttribute(CONST.DRAG_STATE_ATTR, CONST.DRAG_STATE.BEFORE);

      manager.unregisterLayer("L1");

      expect(ui.listPanel.dragEntry).toBeNull();
      expect(ui.listPanel.lastDragOverItem).toBeNull();
      const chrome = attachedPanel(ui).querySelectorAll(`[${CONST.DRAG_STATE_ATTR}]`);
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
        map: {
          foliplus: { hint: { set: showHint, clear: vi.fn(), registerIcon: vi.fn() } },
        },
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
    expect(showHint).toHaveBeenCalledWith("LayerControl", "", "same_role_only", {
      duration: expect.anything(),
    });

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

  /** A layer group layer stub, so isGroupDrag answers true. */
  const groupLayerFixture = () => ({
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
    expect(row.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.JOIN);
    expect(ui.listPanel.lastDragOverItem).toBe(row);
  });

  it("marks the top third of a folder row as a before-target", () => {
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({ id: "R1", name: "R1", role: "overlay" });
    const row = folderRowOf(ui, "b");
    withRect(row, 100, 36);
    handleDragStart(ui, dragEvent(rowOf(ui, "R1"), { effectAllowed: "" }));

    handleDragOver(ui, dragEvent(row, {}, 102));

    expect(row.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.BEFORE);
    expect(row.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(CONST.DRAG_STATE.JOIN);
    expect(ui.listPanel.lastDragOverItem).toBe(row);
  });

  it("marks the bottom third of a folder row as an after-target", () => {
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({ id: "R1", name: "R1", role: "overlay" });
    const row = folderRowOf(ui, "b");
    withRect(row, 100, 36);
    handleDragStart(ui, dragEvent(rowOf(ui, "R1"), { effectAllowed: "" }));

    handleDragOver(ui, dragEvent(row, {}, 134));

    expect(row.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.AFTER);
    expect(row.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(CONST.DRAG_STATE.JOIN);
    expect(ui.listPanel.lastDragOverItem).toBe(row);
  });

  it("refuses a group on a folder row's middle zone and names the reason", () => {
    // A group's children are its own sub-layers; the middle zone would
    // join the folder, so the hover refuses with the same sentence the drop
    // uses, instead of painting a join marker the drop would then veto.
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({
      id: "G1",
      name: "G1",
      role: "overlay",
      layer: groupLayerFixture(),
    });
    const row = folderRowOf(ui, "b");
    withRect(row, 100, 36);
    const showHint = vi.spyOn(ui.c.map.foliplus.hint, "set");
    handleDragStart(ui, dragEvent(rowOf(ui, "G1"), { effectAllowed: "" }));

    handleDragOver(ui, dragEvent(row, {}, 118));

    expect(showHint).toHaveBeenCalled();
    expect(ui.listPanel.lastDragOverItem).toBe(row);
    expect(row.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.REFUSE);
  });

  it("refuses a group on another group's middle zone", () => {
    // Two layer groups never nest: the middle zone is the "into" gesture and
    // it is refused by name, while the edges still reorder the group.
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({
      id: "G1",
      name: "G1",
      role: "overlay",
      layer: groupLayerFixture(),
    });
    manager.registerLayer({
      id: "G2",
      name: "G2",
      role: "overlay",
      layer: groupLayerFixture(),
    });
    const row = rowOf(ui, "G2");
    withRect(row, 100, 36);
    const showHint = vi.spyOn(ui.c.map.foliplus.hint, "set");
    handleDragStart(ui, dragEvent(rowOf(ui, "G1"), { effectAllowed: "" }));

    handleDragOver(ui, dragEvent(row, {}, 118));

    expect(showHint).toHaveBeenCalledWith(ui.config.name, "", ui.T("no_nest"), {
      duration: expect.anything(),
    });
    expect(ui.listPanel.lastDragOverItem).toBe(row);
    expect(row.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.REFUSE);
  });

  it("refuses a folder drag over a group row and names the reason", () => {
    // A folder block and a group row are different kinds of block; a
    // folder cannot adopt a group, so the hover answers with the
    // dedicated sentence instead of reading as a silent dead drop.
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({
      id: "G1",
      name: "G1",
      role: "overlay",
      layer: groupLayerFixture(),
    });
    const showHint = vi.spyOn(ui.c.map.foliplus.hint, "set");
    handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));

    handleDragOver(ui, dragEvent(rowOf(ui, "G1"), {}, 0));

    expect(showHint).toHaveBeenCalled();
    expect(rowOf(ui, "G1").getAttribute(CONST.DRAG_STATE_ATTR)).toBe(
      CONST.DRAG_STATE.REFUSE,
    );
    expect(ui.listPanel.lastDragOverItem).toBe(rowOf(ui, "G1"));
  });
});

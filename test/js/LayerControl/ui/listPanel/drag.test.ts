// LayerControl drag reorder — arming by identity, mid-gesture validation and
// the commit through the controller's reorder funnel. The gesture spans
// events and timers, so every test arms with a real registry entry and the
// handlers re-resolve positions at each use; the real-fixture matrix covers
// what can happen between dragstart and drop.
import { describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { HINT_DURATION } from "#core/hint.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import {
  handleDragEnd,
  handleDragLeave,
  handleDragOver,
  handleDragStart,
  handleDrop,
  showReorderBlockedHint,
  toggleFold,
} from "#foliplus/LayerControl/ui/listPanel/index.js";
import { GROUP, type LayerInfo } from "#foliplus/core/layer/index.js";
import { attachedPanel, initFixture } from "../fixture.js";

const dragEvent = (target: HTMLElement, dataTransfer = {}): DragEvent =>
  ({
    target,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer,
  }) as unknown as DragEvent;

/** Overlay rows for a real fixture: n data layers, ids `L<i>`. */
const overlays = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `L${i}`,
    name: `L${i}`,
    group: "overlay" as const,
  }));

const rowOf = (ui: LayerUI, id: string): HTMLElement =>
  attachedPanel(ui).querySelector(`[${CONST.DATA.LAYER_ID}="${id}"]`) as HTMLElement;

const orderOf = (manager: { layers: readonly LayerInfo[] }) =>
  manager.layers.filter(l => l.group === GROUP.OVERLAY).map(l => l.id);

const makeUi = (
  opts: {
    layers?: LayerInfo[];
    containers?: string[];
  } = {},
): LayerUI => {
  const layers =
    opts.layers ??
    (opts.containers ?? []).map(
      id => ({ id, name: id, group: "overlay" }) as LayerInfo,
    );
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
    foldedGroups: new Set<string>(),
    listPanel: {
      foldedGroups: new Set<string>(),
      checkedCount: {},
      dragEntry: null,
      lastDragHintAt: 0,
      lastDragOverItem: null,
      pressInPanel: false,
    },
    saveFoldState: vi.fn(),
    lastDragOverItem: null,
    c: {
      layers,
      findLayer: vi.fn(() => ({ options: {} })),
      map: {
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
      },
      persistence: { schedule: vi.fn() } as any,
    },
  } as unknown as LayerUI;
};

describe("ui/drag", () => {
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
      ui.listPanel.pressInPanel = true;
      const event = dragEvent(row);

      handleDragStart(ui, event);

      // The drag is never armed; preventDefault stops the browser's drag.
      expect(ui.listPanel.dragEntry).toBeNull();
      expect(row.classList.contains(CONST.CLASSES.DRAGGING)).toBe(false);
      expect(event.preventDefault).toHaveBeenCalled();
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

    it("a drop whose target row left the registry is a no-op", () => {
      const { manager, ui } = initFixture({ data: overlays(3) });
      handleDragStart(ui, dragEvent(rowOf(ui, "L1")));
      const targetRow = rowOf(ui, "L0");
      manager.unregisterLayer("L0");

      const before = orderOf(manager);
      handleDrop(ui, dragEvent(targetRow));

      expect(orderOf(manager)).toEqual(before);
      // A target that no longer resolves leaves the session armed for a
      // valid drop, the same way an out-of-row drop does.
      expect(ui.listPanel.dragEntry).not.toBeNull();
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
        data: [...overlays(1), { id: "B0", name: "B0", group: "base" as const }],
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
        data: [...overlays(1), { id: "B0", name: "B0", group: "base" as const }],
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

    it("handleDrop is a no-op when the drop lands outside every row", () => {
      const { manager, ui } = initFixture({ data: overlays(3) });
      handleDragStart(ui, dragEvent(rowOf(ui, "L1")));
      const shell = document.createElement("div");
      attachedPanel(ui).appendChild(shell);
      const before = orderOf(manager);

      handleDrop(ui, dragEvent(shell));

      // No target row: nothing reorders; the drag stays armed for a valid
      // drop.
      expect(orderOf(manager)).toEqual(before);
      expect(ui.listPanel.dragEntry).not.toBeNull();
    });

    it("a blocked cross-group drop hints, commits nothing and stays armed", () => {
      const { manager, ui } = initFixture({
        data: [
          ...overlays(2),
          { id: "B0", name: "B0", group: "base" as const },
          { id: "B1", name: "B1", group: "base" as const },
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
      expect(ui.listPanel.dragEntry).not.toBeNull();
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

    it("handleDragOver and handleDrop ignore a row carrying no data-layer-id", () => {
      const { manager, ui } = initFixture({ data: overlays(3) });
      handleDragStart(ui, dragEvent(rowOf(ui, "L1")));
      const orphan = document.createElement("div");
      orphan.className = CONST.CLASSES.LAYER_ITEM;
      attachedPanel(ui).appendChild(orphan);

      handleDragOver(ui, dragEvent(orphan));
      handleDrop(ui, dragEvent(orphan));

      // The row names no layer, so neither handler acts on it: the drag
      // stays armed for a row that does.
      expect(orphan.classList.contains(CONST.CLASSES.DRAG_OVER_TOP)).toBe(false);
      expect(orphan.classList.contains(CONST.CLASSES.DRAG_OVER_BOTTOM)).toBe(false);
      expect(ui.listPanel.lastDragOverItem).toBeNull();
      expect(orderOf(manager)).toEqual(["L0", "L1", "L2"]);
      expect(ui.listPanel.dragEntry).not.toBeNull();
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
          `${CONST.SEL.LAYER_ITEM}[data-layer-type="${GROUP.OVERLAY}"]`,
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

      toggleFold(ui, GROUP.OVERLAY);
      toggleFold(ui, GROUP.OVERLAY);

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
        pressInPanel: false,
        foldedGroups: new Set<string>(),
        checkedCount: {},
      },
    } as unknown as LayerUI;

    showReorderBlockedHint(ui);
    expect(showHint).toHaveBeenCalledTimes(1);
    expect(showHint).toHaveBeenCalledWith(
      "LayerControl",
      "reorder_group_only",
      HINT_DURATION.SHORT,
    );

    // A second attempt inside the cooldown window stays silent.
    showReorderBlockedHint(ui);
    expect(showHint).toHaveBeenCalledTimes(1);
  });
});

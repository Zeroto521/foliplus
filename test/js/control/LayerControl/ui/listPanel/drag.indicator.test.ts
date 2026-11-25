// LayerControl drag indicator — one row attribute, one state, one visual.
//
// The old vocabulary was four independent classes, so two indicators could sit
// on one row at once (a layer dragged over a folder row's edge added the
// position class AND the blocked class: solid border + pulse + dashed outline).
// This suite pins the single-attribute contract: the writer leaves at most one
// row marked, the clearer leaves none, and every (drag kind × target × zone)
// resolves to exactly one state.
import { attachedPanel, initFixture } from "../fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#control/LayerControl/const.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import { clearDragState } from "#control/LayerControl/ui/listPanel/drag.js";
import {
  handleDragEnd,
  handleDragLeave,
  handleDragOver,
  handleDragStart,
  handleDrop,
} from "#control/LayerControl/ui/listPanel/index.js";

const dragEvent = (target: HTMLElement, dataTransfer = {}, clientY = 0): DragEvent =>
  ({
    target,
    clientY,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer,
  }) as unknown as DragEvent;

/** Pin a row's box: jsdom reports zero height, and a zero-height row is the
 *  "into" zone — the before/after edges only exist once the row has a height. */
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

const overlays = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `L${i}`,
    name: `L${i}`,
    role: "overlay" as const,
  }));

const rowOf = (ui: LayerUI, id: string): HTMLElement =>
  attachedPanel(ui).querySelector(`[${CONST.DATA.LAYER_ID}="${id}"]`) as HTMLElement;

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

/** The row's drag indicator state, or null when the row carries none. */
const stateOf = (row: HTMLElement | null): string | null =>
  row?.getAttribute(CONST.DRAG_STATE_ATTR) ?? null;

/** Every row in the panel that currently carries a drag indicator. */
const markedRows = (ui: LayerUI): HTMLElement[] =>
  Array.from(
    attachedPanel(ui).querySelectorAll<HTMLElement>(`[${CONST.DRAG_STATE_ATTR}]`),
  );

/** The rows carrying a drop-target state. The carried row's `source` state is
 *  the pickup marker, not a drop indicator: source + one target is the legal
 *  two-row picture, and the invariant is that there is never a second target. */
const targetRows = (ui: LayerUI): HTMLElement[] =>
  markedRows(ui).filter(row => stateOf(row) !== CONST.DRAG_STATE.SOURCE);

describe("ui/drag indicator state", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("marks the carried row as the source", () => {
    const { ui } = initFixture({ data: overlays(3) });
    const row = rowOf(ui, "L0");
    handleDragStart(ui, dragEvent(row, { effectAllowed: "" }));
    expect(stateOf(row)).toBe(CONST.DRAG_STATE.SOURCE);
    expect(markedRows(ui)).toEqual([row]);
  });

  it("marks an accepted edge as before or after", () => {
    // A layer reorder is positional: dropping on a row above the source moves
    // it before that row, below moves it after. Each half of the target row
    // resolves to the one legal side, so the pair is one state per gesture.
    const first = initFixture({ data: overlays(3) });
    handleDragStart(first.ui, dragEvent(rowOf(first.ui, "L0"), { effectAllowed: "" }));
    const after = rowOf(first.ui, "L1");
    pinRect(after, 100, 36);
    handleDragOver(first.ui, dragEvent(after, { dropEffect: "" }, 130));
    expect(stateOf(after)).toBe(CONST.DRAG_STATE.AFTER);
    expect(targetRows(first.ui)).toEqual([after]);

    document.body.innerHTML = "";
    const second = initFixture({ data: overlays(3) });
    handleDragStart(second.ui, dragEvent(rowOf(second.ui, "L2"), { effectAllowed: "" }));
    const before = rowOf(second.ui, "L1");
    pinRect(before, 100, 36);
    handleDragOver(second.ui, dragEvent(before, { dropEffect: "" }, 104));
    expect(stateOf(before)).toBe(CONST.DRAG_STATE.BEFORE);
    expect(targetRows(second.ui)).toEqual([before]);
  });

  it("marks a folder middle as join", () => {
    const { ui } = folderFixture(["a"]);
    handleDragStart(ui, dragEvent(rowOf(ui, "a1"), { effectAllowed: "" }));
    const folder = folderRowOf(ui, "a");
    pinRect(folder, 100, 36);
    handleDragOver(ui, dragEvent(folder, { dropEffect: "" }, 118));
    expect(stateOf(folder)).toBe(CONST.DRAG_STATE.JOIN);
  });

  it("marks a refused folder-into-folder as refuse", () => {
    const { ui } = folderFixture(["a", "b"]);
    handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
    const b = folderRowOf(ui, "b");
    pinRect(b, 100, 36);
    handleDragOver(ui, dragEvent(b, { dropEffect: "" }, 118));
    expect(stateOf(b)).toBe(CONST.DRAG_STATE.REFUSE);
    expect(targetRows(ui)).toEqual([b]);
  });

  it("treats a layer over a folder edge as an accepted position, not a refusal", () => {
    // The regression this redesign exists for: the old writer added the
    // position class AND the blocked class here, so the row showed a solid
    // border, the pulse and a dashed outline at once. The edge is a legal
    // move (the drop handler places the layer before/after the folder block).
    const { ui } = folderFixture(["a"]);
    handleDragStart(ui, dragEvent(rowOf(ui, "a1"), { effectAllowed: "" }));
    const folder = folderRowOf(ui, "a");
    pinRect(folder, 100, 36);
    handleDragOver(ui, dragEvent(folder, { dropEffect: "" }, 104));
    expect(stateOf(folder)).toBe(CONST.DRAG_STATE.BEFORE);
    handleDragOver(ui, dragEvent(folder, { dropEffect: "" }, 130));
    expect(stateOf(folder)).toBe(CONST.DRAG_STATE.AFTER);
  });

  it("never leaves two rows marked while the pointer moves", () => {
    const { ui } = initFixture({ data: overlays(4) });
    handleDragStart(ui, dragEvent(rowOf(ui, "L0"), { effectAllowed: "" }));
    const targets = ["L1", "L2", "L3"].map(id => rowOf(ui, id));
    targets.forEach((target, i) => {
      pinRect(target, 100 + i * 40, 36);
      handleDragOver(ui, dragEvent(target, { dropEffect: "" }, 104 + i * 40));
      expect(targetRows(ui)).toHaveLength(1);
      expect(markedRows(ui)).toHaveLength(2); // the carried row + one target
    });
  });

  it("clears the hover state on dragleave and every row on dragend", () => {
    const { ui } = initFixture({ data: overlays(3) });
    handleDragStart(ui, dragEvent(rowOf(ui, "L0"), { effectAllowed: "" }));
    const target = rowOf(ui, "L1");
    pinRect(target, 100, 36);
    handleDragOver(ui, dragEvent(target, { dropEffect: "" }, 130));
    handleDragLeave(dragEvent(target));
    expect(targetRows(ui)).toHaveLength(0);
    // The carried row keeps its pickup marker until the gesture ends.
    expect(markedRows(ui)).toHaveLength(1);
    handleDragOver(ui, dragEvent(target, { dropEffect: "" }, 130));
    expect(targetRows(ui)).toHaveLength(1);
    handleDragEnd(ui);
    expect(markedRows(ui)).toHaveLength(0);
  });

  it("flashes the committed state after a drop, then clears it", () => {
    const { ui } = initFixture({ data: overlays(3) });
    // Fake timers start after the fixture's own init flush; the commit beat is
    // the only timer this test advances.
    vi.useFakeTimers();
    handleDragStart(ui, dragEvent(rowOf(ui, "L0"), { effectAllowed: "" }));
    const target = rowOf(ui, "L1");
    pinRect(target, 100, 36);
    handleDragOver(ui, dragEvent(target, { dropEffect: "" }, 130));
    handleDrop(ui, dragEvent(target, {}, 130));
    // The commit acknowledgement is the same single state, held for one
    // --foliplus-drag-commit beat on the row's new position.
    expect(stateOf(rowOf(ui, "L1"))).toBe(CONST.DRAG_STATE.AFTER);
    vi.advanceTimersByTime(400);
    expect(markedRows(ui)).toHaveLength(0);
  });

  it("clears the attribute from every row through the shared clearer", () => {
    const { ui } = initFixture({ data: overlays(3) });
    const rows = ["L0", "L1", "L2"].map(id => rowOf(ui, id));
    rows.forEach(row => row.setAttribute(CONST.DRAG_STATE_ATTR, CONST.DRAG_STATE.BEFORE));
    clearDragState(ui);
    expect(markedRows(ui)).toHaveLength(0);
  });
});

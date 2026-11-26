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

const dragEvent = (
  target: HTMLElement,
  dataTransfer: Record<string, unknown> | null = {},
  clientY = 0,
): DragEvent =>
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
    handleDragStart(
      second.ui,
      dragEvent(rowOf(second.ui, "L2"), { effectAllowed: "" }),
    );
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
    handleDragLeave(ui, dragEvent(target));
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

  it("holds the commit beat for the duration the stylesheet declares", () => {
    const { ui } = initFixture({ data: overlays(3) });
    // The beat is a CSS token, so the page owns the timing. jsdom inherits
    // custom properties, which lets the test declare the stylesheet's value
    // instead of hard-coding the module's fallback.
    attachedPanel(ui).style.setProperty("--foliplus-drag-commit", "40ms");
    vi.useFakeTimers();
    handleDragStart(ui, dragEvent(rowOf(ui, "L0"), { effectAllowed: "" }));
    const target = rowOf(ui, "L1");
    pinRect(target, 100, 36);
    handleDragOver(ui, dragEvent(target, { dropEffect: "" }, 130));
    handleDrop(ui, dragEvent(target, {}, 130));

    expect(targetRows(ui)).toHaveLength(1);
    vi.advanceTimersByTime(60);
    expect(markedRows(ui)).toHaveLength(0);
  });

  it("acknowledges a folder block placed before another folder", () => {
    const { ui } = folderFixture(["a", "b"]);
    const folderRow = (key: string) =>
      attachedPanel(ui).querySelector(
        `[${CONST.DATA.FOLDER_KEY}="${key}"]`,
      ) as HTMLElement;
    const target = folderRow("b");
    pinRect(target, 100, 36);
    handleDragStart(ui, dragEvent(folderRow("a"), { effectAllowed: "" }));
    handleDrop(ui, dragEvent(target, {}, 102));

    // A folder is a block: the acknowledgement is what the block's own layout
    // became, so a block placed above its target flashes the BEFORE state.
    expect(stateOf(folderRow("b"))).toBe(CONST.DRAG_STATE.BEFORE);
  });

  it("acknowledges a drop after the panel is already gone", () => {
    const { ui } = initFixture({ data: overlays(3) });
    handleDragStart(ui, dragEvent(rowOf(ui, "L0"), { effectAllowed: "" }));
    const target = rowOf(ui, "L1");
    pinRect(target, 100, 36);
    handleDragOver(ui, dragEvent(target, { dropEffect: "" }, 130));
    // The unmount wins the race: the commit still lands, and the flash lookup
    // and the clearer must both survive a container that is already detached
    // (an unbound panel must not turn a drop into a throw).
    // uiContainer is a getter: shadow it with an own data property, then drop
    // the shadow to restore the panel's own view.
    Object.defineProperty(ui, "uiContainer", { configurable: true, value: null });
    try {
      expect(() => handleDrop(ui, dragEvent(target, {}, 130))).not.toThrow();
    } finally {
      delete (ui as unknown as { uiContainer?: HTMLElement | null }).uiContainer;
    }
    expect(ui.listPanel.dragEntry).toBeNull();
    // With no container the rows cannot be reached: the clearer is a no-op, not
    // a throw. The next attach starts from a clean panel.
    clearDragState(ui);
    expect(markedRows(ui)).toHaveLength(0);
  });

  it("clears the attribute from every row through the shared clearer", () => {
    const { ui } = initFixture({ data: overlays(3) });
    const rows = ["L0", "L1", "L2"].map(id => rowOf(ui, id));
    rows.forEach(row =>
      row.setAttribute(CONST.DRAG_STATE_ATTR, CONST.DRAG_STATE.BEFORE),
    );
    clearDragState(ui);
    expect(markedRows(ui)).toHaveLength(0);
  });

  it("keeps the running gap pulse while the pointer moves inside one row", () => {
    // The pulse is a one-shot animation on the gap line. Re-writing the same
    // attribute on every dragover tick would restart it, so the line would sit
    // frozen at 0% for as long as the pointer moves inside the row.
    const { ui } = initFixture({ data: overlays(3) });
    handleDragStart(ui, dragEvent(rowOf(ui, "L0"), { effectAllowed: "" }));
    const target = rowOf(ui, "L1");
    pinRect(target, 100, 36);
    const observer = new MutationObserver(() => {});
    observer.observe(target, {
      attributes: true,
      attributeFilter: [CONST.DRAG_STATE_ATTR],
    });
    handleDragOver(ui, dragEvent(target, { dropEffect: "" }, 130));
    handleDragOver(ui, dragEvent(target, { dropEffect: "" }, 132));
    handleDragOver(ui, dragEvent(target, { dropEffect: "" }, 134));
    const seen = observer.takeRecords();
    observer.disconnect();
    expect(stateOf(target)).toBe(CONST.DRAG_STATE.AFTER);
    expect(seen).toHaveLength(1);
  });

  it("restarts the pulse when the gap moves to another row", () => {
    // A new gap is a new animation: the old row is cleared and the returning
    // row is re-marked, so the pulse starts again instead of staying finished.
    const { ui } = initFixture({ data: overlays(4) });
    handleDragStart(ui, dragEvent(rowOf(ui, "L0"), { effectAllowed: "" }));
    const first = rowOf(ui, "L1");
    const second = rowOf(ui, "L2");
    pinRect(first, 100, 36);
    pinRect(second, 140, 36);
    const observer = new MutationObserver(() => {});
    observer.observe(first, {
      attributes: true,
      attributeOldValue: true,
      attributeFilter: [CONST.DRAG_STATE_ATTR],
    });
    handleDragOver(ui, dragEvent(first, { dropEffect: "" }, 130));
    handleDragOver(ui, dragEvent(second, { dropEffect: "" }, 170));
    handleDragOver(ui, dragEvent(first, { dropEffect: "" }, 130));
    const seen = observer.takeRecords();
    observer.disconnect();
    // set, clear, set: the returning gap starts the animation again.
    expect(seen.map(record => record.oldValue)).toEqual([
      null,
      CONST.DRAG_STATE.AFTER,
      null,
    ]);
    expect(stateOf(first)).toBe(CONST.DRAG_STATE.AFTER);
  });

  it("leaves an unmarked row alone when the pointer leaves it", () => {
    // The clearer is idempotent: a dragleave on a row that carries no state
    // must not write, so the animation of a neighbouring gap is untouched.
    const { ui } = initFixture({ data: overlays(3) });
    const row = rowOf(ui, "L2");
    handleDragLeave(ui, dragEvent(row));
    expect(stateOf(row)).toBeNull();
  });

  it("places a dragged folder beside a layer row", () => {
    // A folder's block can sit between layer rows, so hovering a layer row
    // paints the same gap a layer drag would.
    const { ui } = initFixture({
      seedLayout: folderLayoutDoc(["a"]),
      data: [
        {
          id: "a1",
          name: "a1",
          role: "overlay" as const,
          folder: "a",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        { id: "L0", name: "L0", role: "overlay" as const },
      ],
    });
    handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
    const last = rowOf(ui, "L0");
    pinRect(last, 100, 36);
    handleDragOver(ui, dragEvent(last, { dropEffect: "" }, 130));
    expect(stateOf(last)).toBe(CONST.DRAG_STATE.AFTER);
    // No row follows the gap, so nothing is pressed — the walk ends quietly.
    expect(
      attachedPanel(ui).querySelectorAll(`[${CONST.DRAG_PUSH_ATTR}]`),
    ).toHaveLength(0);
  });

  it("leaves a dragged folder's own row unmarked", () => {
    // Dropping a block on itself is not a move: it is a no-op, not a gap
    // between the block and itself.
    const { ui } = folderFixture(["a"]);
    const own = folderRowOf(ui, "a");
    handleDragStart(ui, dragEvent(own, { effectAllowed: "" }));
    pinRect(own, 100, 36);
    handleDragOver(ui, dragEvent(own, { dropEffect: "" }, 130));
    // Only the pickup marker stays: no gap, no refusal.
    expect(stateOf(own)).toBe(CONST.DRAG_STATE.SOURCE);
  });

  it("does not place a folder over a role header", () => {
    // A role header is a section title, not a block: no position exists there.
    const { ui } = folderFixture(["a"]);
    const header = attachedPanel(ui).querySelector(
      `.${CONST.CLASSES.ROLE_ROW}`,
    ) as HTMLElement;
    handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
    pinRect(header, 100, 36);
    handleDragOver(ui, dragEvent(header, { dropEffect: "" }, 130));
    expect(
      attachedPanel(ui).querySelectorAll(`[${CONST.DRAG_STATE_ATTR}]`),
    ).toHaveLength(1); // only the carried row keeps its pickup marker
  });

  it("refuses a folder over the other role's rows", () => {
    // Blocks belong to one section: an overlay folder never lands among the
    // basemaps, so the base row answers with a refusal.
    const { ui } = initFixture({
      seedLayout: folderLayoutDoc(["a"]),
      data: [
        {
          id: "a1",
          name: "a1",
          role: "overlay" as const,
          folder: "a",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        { id: "B0", name: "B0", role: "base" as const },
      ],
    });
    handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
    const base = attachedPanel(ui).querySelector(
      `[${CONST.DATA.LAYER_ID}="B0"]`,
    ) as HTMLElement;
    pinRect(base, 100, 36);
    handleDragOver(ui, dragEvent(base, { dropEffect: "" }, 130));
    expect(stateOf(base)).toBe(CONST.DRAG_STATE.REFUSE);
  });

  it("leaves the gap unpainted when the reorder is blocked", () => {
    // The registry is the authority on what may move: when it says no, the
    // indicator stays clear instead of naming a position the drop cannot take.
    const { ui } = initFixture({ data: overlays(2) });
    vi.spyOn(ui.c, "canReorderBetween").mockReturnValue(false);
    handleDragStart(ui, dragEvent(rowOf(ui, "L0"), { effectAllowed: "" }));
    const second = rowOf(ui, "L1");
    pinRect(second, 100, 36);
    handleDragOver(ui, dragEvent(second, { dropEffect: "" }, 130));
    expect(stateOf(second)).toBeNull();
    expect(
      attachedPanel(ui).querySelectorAll(`[${CONST.DRAG_PUSH_ATTR}]`),
    ).toHaveLength(0);
  });

  it("leaves the end of a section unpressed", () => {
    // A gap after the last row of the list has no far side, so nothing sinks.
    const { ui } = initFixture({
      data: [
        { id: "L0", name: "L0", role: "overlay" as const },
        { id: "B0", name: "B0", role: "base" as const },
      ],
    });
    const base = attachedPanel(ui).querySelector(
      `[${CONST.DATA.LAYER_ID}="B0"]`,
    ) as HTMLElement;
    handleDragStart(ui, dragEvent(base, { effectAllowed: "" }));
    pinRect(base, 100, 36);
    handleDragOver(ui, dragEvent(base, { dropEffect: "" }, 130));
    expect(
      attachedPanel(ui).querySelectorAll(`[${CONST.DRAG_PUSH_ATTR}]`),
    ).toHaveLength(0);
  });

  it("places a folder above the first layer row of a section", () => {
    // A root row that opens the section has no folder block above it: the gap
    // lands on its top edge, and the section boundary is the block edge.
    const { ui } = initFixture({
      seedLayout: folderLayoutDoc(["a"]),
      data: [
        { id: "L0", name: "L0", role: "overlay" as const },
        {
          id: "a1",
          name: "a1",
          role: "overlay" as const,
          folder: "a",
          layer: { options: {}, eachLayer: vi.fn() },
        },
      ],
    });
    handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
    const first = rowOf(ui, "L0");
    pinRect(first, 100, 36);
    handleDragOver(ui, dragEvent(first, { dropEffect: "" }, 104));
    expect(stateOf(first)).toBe(CONST.DRAG_STATE.BEFORE);
  });

  it("clears the gap without a transfer object", () => {
    // A synthetic event may carry no dataTransfer: the writer still paints and
    // the blocked branch still clears, so the indicator never depends on it.
    const { ui } = initFixture({ data: overlays(2) });
    vi.spyOn(ui.c, "canReorderBetween").mockReturnValue(false);
    handleDragStart(ui, dragEvent(rowOf(ui, "L0"), null));
    const second = rowOf(ui, "L1");
    pinRect(second, 100, 36);
    handleDragOver(ui, dragEvent(second, null, 130));
    expect(stateOf(second)).toBeNull();
  });

  it("gaps a layer over a folder row's edge", () => {
    // A folder row carries no layer id; the gap is still a legal position, so
    // the edge places the layer before/after the whole block.
    const { ui } = initFixture({
      seedLayout: folderLayoutDoc(["a"]),
      data: [
        {
          id: "a1",
          name: "a1",
          role: "overlay" as const,
          folder: "a",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        { id: "L0", name: "L0", role: "overlay" as const },
      ],
    });
    handleDragStart(ui, dragEvent(rowOf(ui, "L0"), { effectAllowed: "" }));
    const folderRow = folderRowOf(ui, "a");
    pinRect(folderRow, 100, 36);
    handleDragOver(ui, dragEvent(folderRow, { dropEffect: "" }, 130));
    expect(stateOf(folderRow)).toBe(CONST.DRAG_STATE.AFTER);
  });

  it("reorders a member beside its own sibling", () => {
    // Siblings stay in one block, so their gap is a reorder, not a join.
    const { ui } = initFixture({
      seedLayout: folderLayoutDoc(["a"]),
      data: [
        {
          id: "a1",
          name: "a1",
          role: "overlay" as const,
          folder: "a",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "a2",
          name: "a2",
          role: "overlay" as const,
          folder: "a",
          layer: { options: {}, eachLayer: vi.fn() },
        },
      ],
    });
    handleDragStart(ui, dragEvent(rowOf(ui, "a1"), { effectAllowed: "" }));
    const sibling = rowOf(ui, "a2");
    pinRect(sibling, 100, 36);
    handleDragOver(ui, dragEvent(sibling, { dropEffect: "" }, 130));
    expect(stateOf(sibling)).toBe(CONST.DRAG_STATE.AFTER);
  });

  it("moves a member out of its folder on a root row", () => {
    // Dropping a member row on a root row is the documented way out of a
    // folder: the folder assignment changes, not the block order.
    const { ui } = initFixture({
      seedLayout: folderLayoutDoc(["a"]),
      data: [
        {
          id: "a1",
          name: "a1",
          role: "overlay" as const,
          folder: "a",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        { id: "L0", name: "L0", role: "overlay" as const },
      ],
    });
    const move = vi.spyOn(ui.c, "moveLayerToFolder");
    handleDragStart(ui, dragEvent(rowOf(ui, "a1"), { effectAllowed: "" }));
    const root = rowOf(ui, "L0");
    pinRect(root, 100, 36);
    handleDragOver(ui, dragEvent(root, { dropEffect: "" }, 130));
    handleDrop(ui, dragEvent(root));
    expect(move).toHaveBeenCalledWith("a1", "");
  });

  it("commits a folder beside a layer row without a transfer", () => {
    // A root layer row is a block of its own: dropping the folder there commits
    // the block order, and the writer never depends on a dataTransfer object.
    const { ui } = initFixture({
      seedLayout: folderLayoutDoc(["a"]),
      data: [
        {
          id: "a1",
          name: "a1",
          role: "overlay" as const,
          folder: "a",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        { id: "L0", name: "L0", role: "overlay" as const },
      ],
    });
    const reorder = vi.spyOn(ui.c, "reorderFolder");
    handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), null));
    const root = rowOf(ui, "L0");
    pinRect(root, 100, 36);
    handleDragOver(ui, dragEvent(root, null, 130));
    handleDrop(ui, dragEvent(root, null));
    expect(reorder).toHaveBeenCalled();
  });

  it("sinks the row on the far side of the gap", () => {
    // The gap line sits on one row, but the insertion PRESSES the row on the
    // far side: above the gap for BEFORE, below it for AFTER. The marker names
    // the edge that sinks, and it is derived from the state, never written on
    // its own.
    const { ui } = initFixture({ data: overlays(3) });
    const pushOf = (id: string) => rowOf(ui, id).getAttribute(CONST.DRAG_PUSH_ATTR);
    const pushedRows = () =>
      Array.from(
        attachedPanel(ui).querySelectorAll<HTMLElement>(`[${CONST.DRAG_PUSH_ATTR}]`),
      );

    handleDragStart(ui, dragEvent(rowOf(ui, "L0"), { effectAllowed: "" }));
    const lower = rowOf(ui, "L1");
    pinRect(lower, 100, 36);
    handleDragOver(ui, dragEvent(lower, { dropEffect: "" }, 130));
    expect(stateOf(lower)).toBe(CONST.DRAG_STATE.AFTER);
    // The gap is below L1, so L2 (below the gap) sinks at its top edge.
    expect(pushOf("L2")).toBe(CONST.DRAG_PUSH.TOP);
    expect(pushedRows()).toHaveLength(1);

    handleDragEnd(ui);
    document.body.innerHTML = "";

    const second = initFixture({ data: overlays(3) });
    handleDragStart(
      second.ui,
      dragEvent(rowOf(second.ui, "L2"), { effectAllowed: "" }),
    );
    const upper = rowOf(second.ui, "L1");
    pinRect(upper, 100, 36);
    handleDragOver(second.ui, dragEvent(upper, { dropEffect: "" }, 104));
    expect(stateOf(upper)).toBe(CONST.DRAG_STATE.BEFORE);
    // The gap is above L1, so L0 (above the gap) sinks at its bottom edge.
    expect(rowOf(second.ui, "L0").getAttribute(CONST.DRAG_PUSH_ATTR)).toBe(
      CONST.DRAG_PUSH.BOTTOM,
    );
  });

  it("does not press a row across a role boundary", () => {
    // The role header ends the section: a gap at the edge of a role has no row
    // on the far side, so nothing is dented — denting the next section's first
    // row would claim a pressure that never happens.
    const { ui } = initFixture({
      data: [...overlays(2), { id: "B0", name: "B0", role: "base" as const }],
    });
    handleDragStart(ui, dragEvent(rowOf(ui, "L0"), { effectAllowed: "" }));
    const last = rowOf(ui, "L1");
    pinRect(last, 100, 36);
    handleDragOver(ui, dragEvent(last, { dropEffect: "" }, 130));
    expect(stateOf(last)).toBe(CONST.DRAG_STATE.AFTER);
    expect(
      attachedPanel(ui).querySelectorAll(`[${CONST.DRAG_PUSH_ATTR}]`),
    ).toHaveLength(0);
  });

  it("clears the sunk edge when the gap moves away", () => {
    const { ui } = initFixture({ data: overlays(4) });
    handleDragStart(ui, dragEvent(rowOf(ui, "L0"), { effectAllowed: "" }));
    const first = rowOf(ui, "L1");
    const second = rowOf(ui, "L2");
    pinRect(first, 100, 36);
    pinRect(second, 140, 36);

    handleDragOver(ui, dragEvent(first, { dropEffect: "" }, 130));
    expect(rowOf(ui, "L2").getAttribute(CONST.DRAG_PUSH_ATTR)).toBe(
      CONST.DRAG_PUSH.TOP,
    );

    handleDragOver(ui, dragEvent(second, { dropEffect: "" }, 170));
    // One gap at a time: the first dent is gone, the new one is painted on the
    // row below the NEW gap.
    expect(rowOf(ui, "L2").getAttribute(CONST.DRAG_PUSH_ATTR)).toBeNull();
    expect(rowOf(ui, "L3").getAttribute(CONST.DRAG_PUSH_ATTR)).toBe(
      CONST.DRAG_PUSH.TOP,
    );
    const marked = attachedPanel(ui).querySelectorAll(`[${CONST.DRAG_PUSH_ATTR}]`);
    expect(marked).toHaveLength(1);

    handleDragEnd(ui);
    expect(
      attachedPanel(ui).querySelectorAll(`[${CONST.DRAG_PUSH_ATTR}]`),
    ).toHaveLength(0);
  });

  it("refuses a row of the other role instead of staying silent", () => {
    // An overlay never becomes a base layer: the row answers with the refusal
    // marker, because a silent no-op reads as a broken drag.
    const { ui } = initFixture({
      data: [...overlays(1), { id: "B0", name: "B0", role: "base" as const }],
    });
    handleDragStart(ui, dragEvent(rowOf(ui, "L0"), { effectAllowed: "" }));
    const base = rowOf(ui, "B0");

    handleDragOver(ui, dragEvent(base, { dropEffect: "" }));

    expect(stateOf(base)).toBe(CONST.DRAG_STATE.REFUSE);
    expect(ui.listPanel.lastDragOverItem).toBe(base);
  });

  it("refuses another folder's member row", () => {
    // Joining a folder happens on its header row: a member row is inside
    // another block, so a gap drawn there would name a position the drop never
    // takes.
    const { ui } = folderFixture(["a", "b"]);
    handleDragStart(ui, dragEvent(rowOf(ui, "b1"), { effectAllowed: "" }));
    const foreign = rowOf(ui, "a1");
    pinRect(foreign, 100, 36);

    handleDragOver(ui, dragEvent(foreign, { dropEffect: "" }, 104));

    expect(stateOf(foreign)).toBe(CONST.DRAG_STATE.REFUSE);
  });

  it("folds the dragged block's members for the gesture only", () => {
    // The dragged block travels as one unit, so its members stop being rows
    // while it moves: they are not drop targets and they would stretch the gap
    // geometry. The fold is session-only — the persisted state never changes.
    const { ui } = folderFixture(["a", "b"]);
    const memberA = rowOf(ui, "a1");
    handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));

    expect(memberA.hasAttribute(CONST.DRAG_FOLDED_ATTR)).toBe(true);
    expect(rowOf(ui, "b1").hasAttribute(CONST.DRAG_FOLDED_ATTR)).toBe(false);
    expect(folderRowOf(ui, "a").hasAttribute(CONST.DRAG_FOLDED_ATTR)).toBe(false);

    handleDragEnd(ui);
    expect(memberA.hasAttribute(CONST.DRAG_FOLDED_ATTR)).toBe(false);
  });

  it("leaves no drop state when the pointer is over the carried row", () => {
    // Hovering the row being carried is not a gap: the layer cannot land on
    // itself, so the pickup marker is the only state it keeps.
    const { ui } = initFixture({ data: overlays(3) });
    const source = rowOf(ui, "L0");
    handleDragStart(ui, dragEvent(source, { effectAllowed: "" }));
    pinRect(source, 100, 36);
    handleDragOver(ui, dragEvent(source, { dropEffect: "" }, 130));
    expect(targetRows(ui)).toHaveLength(0);
    expect(stateOf(source)).toBe(CONST.DRAG_STATE.SOURCE);
  });
});

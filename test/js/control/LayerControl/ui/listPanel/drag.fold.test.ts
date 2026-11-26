// test/js/control/LayerControl/ui/style/drag.fold — folder rows and folder drag.
import { attachedPanel, initFixture } from "../fixture.js";
import {
  dragEvent,
  folderFixture,
  folderRowOf,
  groupLayerFixture,
  rowOf,
} from "./drag.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#control/LayerControl/const.js";
import {
  isFolderFolded,
  toggleFolderFold,
} from "#control/LayerControl/ui/listPanel/drag.js";
import {
  handleDragOver,
  handleDragStart,
  handleDrop,
} from "#control/LayerControl/ui/listPanel/index.js";
import { handleKeyDown } from "#control/LayerControl/ui/listPanel/keyboard.js";

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

describe("folder drag — beside-placement and refusal arms (round 4)", () => {
  /** A drag event with no dataTransfer: the pointer affordance is optional. */
  const noTransfer = (target: HTMLElement, clientY = 0): DragEvent =>
    ({
      target,
      clientY,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: null,
    }) as unknown as DragEvent;

  /** Pin a row's box so the drop zone is deterministic (jsdom rects are 0). */
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

  it("a folder drag refuses another block's member row without a transfer", () => {
    // A member row sits INSIDE another block: only the folder header is a block
    // target, because a gap between members names a position the drop never
    // takes. The pointer affordance is optional, so the refusal must paint
    // without one.
    const { ui } = folderFixture(["a", "b"]);
    handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
    const row = rowOf(ui, "b1");
    pinRect(row, 100, 36);

    handleDragOver(ui, noTransfer(row, 104));

    expect(row.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.REFUSE);
    expect(ui.listPanel.lastDragOverItem).toBe(row);
  });

  it("a folder drag over its own member row is a no-op", () => {
    // A member row belongs to the folder block above it. Hovering the dragged
    // folder's own members resolves to the dragged block, which is a no-op:
    // the folder cannot be placed beside itself.
    const { ui } = folderFixture(["a", "b"]);
    handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
    const member = rowOf(ui, "a1");
    pinRect(member, 100, 36);
    const over = dragEvent(member, { dropEffect: "" }, 130);

    handleDragOver(ui, over);

    expect(over.preventDefault).not.toHaveBeenCalled();
    expect(member.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(
      CONST.DRAG_STATE.BEFORE,
    );
    expect(member.getAttribute(CONST.DRAG_STATE_ATTR)).not.toBe(CONST.DRAG_STATE.AFTER);
    expect(ui.listPanel.lastDragOverItem).toBeNull();
  });

  it("a folder drag over a base-layer row names drop_base_layer", () => {
    // A layer row of the other role is not a block target: the folder can only
    // reorder blocks inside its own section, so the refusal is named — and a
    // base-layer row gets the section-specific sentence, not the generic one.
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
      ],
    });
    const showHint = vi.spyOn(ui.c.map.foliplus.hint, "set");
    handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
    const member = rowOf(ui, "b1");
    pinRect(member, 100, 36);
    const over = dragEvent(member, { dropEffect: "" }, 130);

    handleDragOver(ui, over);

    expect(showHint).toHaveBeenCalledWith(ui.config.name, "", ui.T("drop_base_layer"), {
      duration: expect.anything(),
    });
    expect(member.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.REFUSE);
    expect(ui.listPanel.lastDragOverItem).toBe(member);
  });

  it("a folder dragged into a folder's middle zone without a transfer still draws the refusal", () => {
    // The "into" refusal does not depend on the pointer affordance: the dashed
    // blocked chrome and the no_nest sentence must appear without it.
    const { ui } = folderFixture(["a", "b"]);
    const showHint = vi.spyOn(ui.c.map.foliplus.hint, "set");
    handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
    const b = folderRowOf(ui, "b");
    pinRect(b, 100, 36);

    handleDragOver(ui, noTransfer(b, 118));

    expect(b.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.REFUSE);
    expect(ui.listPanel.lastDragOverItem).toBe(b);
    expect(showHint).toHaveBeenCalled();
  });

  it("a folder over a row it cannot place refuses instead of ignoring", () => {
    // A row with neither a folder key nor a layer id names no block, so there
    // is no gap to draw: silence would read as a broken drag, so the refusal is
    // painted and named.
    const { ui } = folderFixture(["a", "b"]);
    const showHint = vi.spyOn(ui.c.map.foliplus.hint, "set");
    handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
    const stray = document.createElement("div");
    stray.className = CONST.CLASSES.LAYER_ITEM;
    attachedPanel(ui).appendChild(stray);
    pinRect(stray, 200, 36);

    handleDragOver(ui, dragEvent(stray, { dropEffect: "" }, 218));

    expect(stray.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.REFUSE);
    expect(ui.listPanel.lastDragOverItem).toBe(stray);
    expect(showHint).toHaveBeenCalled();
  });

  it("a member row over a sibling member is a gap, not a refusal", () => {
    // Siblings inside one block are the one place a member row names a gap:
    // the same folder key on both sides means the drop stays inside the block.
    const { ui } = initFixture({
      seedLayout: {
        version: 2,
        folders: [{ key: "a", name: "a" }],
        order: { overlay: ["a"] },
        members: {},
      },
      data: [
        {
          id: "m1",
          name: "m1",
          role: "overlay",
          folder: "a",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "m2",
          name: "m2",
          role: "overlay",
          folder: "a",
          layer: { options: {}, eachLayer: vi.fn() },
        },
      ],
    });
    const target = rowOf(ui, "m2");
    pinRect(target, 100, 36);

    handleDragStart(ui, dragEvent(rowOf(ui, "m1"), { effectAllowed: "" }));
    handleDragOver(ui, dragEvent(target, { dropEffect: "" }, 102));

    // Position, not the pointer half, decides the side: the target sits after
    // the carried row, so the gap is below it.
    expect(target.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.AFTER);
  });

  it("a base folder over an overlay row is refused by its section name", () => {
    // A block belongs to one role: the copy names the section the drop would
    // cross instead of the generic "same section" wording.
    const { ui } = initFixture({
      seedLayout: {
        version: 2,
        folders: [{ key: "b", name: "b" }],
        order: { overlay: [], base: ["b"] },
        members: {},
      },
      data: [
        {
          id: "b1",
          name: "b1",
          role: "base",
          folder: "b",
          layer: { options: {}, eachLayer: vi.fn() },
        },
        {
          id: "O1",
          name: "O1",
          role: "overlay",
          layer: { options: {}, eachLayer: vi.fn() },
        },
      ],
    });
    const showHint = vi.spyOn(ui.c.map.foliplus.hint, "set");
    const overlayRow = rowOf(ui, "O1");
    pinRect(overlayRow, 100, 36);

    handleDragStart(ui, dragEvent(folderRowOf(ui, "b"), { effectAllowed: "" }));
    handleDragOver(ui, dragEvent(overlayRow, { dropEffect: "" }, 118));

    expect(overlayRow.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(
      CONST.DRAG_STATE.REFUSE,
    );
    expect(showHint).toHaveBeenCalled();
  });

  it("a group on another group's middle zone without a transfer refuses by name", () => {
    // Two layer groups never nest; the refusal is named whether or not the
    // browser supplied a dataTransfer.
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
    pinRect(row, 100, 36);
    const showHint = vi.spyOn(ui.c.map.foliplus.hint, "set");
    handleDragStart(ui, dragEvent(rowOf(ui, "G1"), { effectAllowed: "" }));

    handleDragOver(ui, noTransfer(row, 118));

    expect(showHint).toHaveBeenCalled();
    expect(ui.listPanel.lastDragOverItem).toBe(row);
    expect(row.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.REFUSE);
  });

  it("a folder dropped on a row of the other role commits nothing", () => {
    // The else-if block-order resolution refuses a cross-role target: the drop
    // must not move the folder into the other section.
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
      ],
    });
    handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
    const before = [...(ui.c.folderLayoutView.order.overlay ?? [])];

    handleDrop(ui, dragEvent(rowOf(ui, "b1"), {}, 130));

    expect(ui.c.folderLayoutView.order.overlay).toEqual(before);
    expect(ui.listPanel.dragFolder).toBeNull();
  });

  it("a folder dropped on a member of its own folder commits nothing", () => {
    // A member row belongs to the folder block above it; dropping a folder on
    // a member of ITS OWN block resolves to the dragged block, which is a
    // no-op rather than a reorder against itself.
    const { ui } = folderFixture(["a", "b"]);
    handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
    const before = [...(ui.c.folderLayoutView.order.overlay ?? [])];

    handleDrop(ui, dragEvent(rowOf(ui, "a1"), {}, 130));

    expect(ui.c.folderLayoutView.order.overlay).toEqual(before);
    expect(ui.listPanel.dragFolder).toBeNull();
  });

  it("folderDropTarget returns null when no folder drag is armed", () => {
    // The defensive guard at drag.ts:148: a dragover with no armed folder
    // drag (dragFolder null) must no-op rather than dereference it.
    const { ui } = initFixture({
      data: [
        {
          id: "fold1",
          name: "F1",
          role: "overlay",
          folder: "roads",
          layer: { options: {}, eachLayer: vi.fn() },
        },
      ],
    });
    const row = attachedPanel(ui).querySelector(
      `.${CONST.CLASSES.FOLDER_ROW}`,
    ) as HTMLElement;
    const before = row.className;
    handleDragOver(ui, dragEvent(row));
    expect(row.className).toBe(before);
  });
});

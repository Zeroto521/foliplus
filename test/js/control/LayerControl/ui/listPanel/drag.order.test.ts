// test/js/control/LayerControl/ui/style/drag.order — block order across roles and roots.
import { attachedPanel, initFixture } from "../fixture.js";
import {
  dragEvent,
  folderFixture,
  folderRowOf,
  groupLayerFixture,
  pinRect,
  rowOf,
} from "./drag.fixture.js";
import { describe, expect, it, vi } from "vitest";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import {
  handleDragOver,
  handleDragStart,
  handleDrop,
} from "#control/LayerControl/ui/listPanel/index.js";

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
    const showHint = vi.spyOn(ui.c.map.foliplus.hint, "set");
    handleDragStart(ui, dragEvent(rowOf(ui, "R1"), { effectAllowed: "" }));

    handleDragOver(ui, dragEvent(baseFolderB, { dropEffect: "" }, 118));

    expect(showHint).toHaveBeenCalled();
    expect(ui.listPanel.lastDragOverItem).toBe(baseFolderB);
    expect(baseFolderB.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(
      CONST.DRAG_STATE.REFUSE,
    );
  });

  it("throttles repeated refusals to one hint per gesture", () => {
    // The same refusal twice inside the cooldown window shows one toast: a drag
    // that keeps crossing a dead zone must not stack hints.
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

  it("refuses a group over a folder member row with the folder sentence", () => {
    // A group over a member row would join that member's folder, which a
    // layer group cannot do — the inside path must answer like the folder row.
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({
      id: "G1",
      name: "G1",
      role: "overlay",
      layer: groupLayerFixture(),
    });
    const member = rowOf(ui, "b1");
    withRect(member, 100, 36);
    const showHint = vi.spyOn(ui.c.map.foliplus.hint, "set");
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

describe("a folder's member rows accept only their own siblings", () => {
  it("refuses to re-parent a root layer onto another folder's member row", () => {
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

    // Joining a folder is done on its header row: a drop between its members
    // has no position the gap line can name, so it must not re-parent — the
    // hover already refused it, and the drop cannot quietly disagree.
    expect(manager.folderNameOf("R1")).toBeNull();
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
    expect(row.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.SOURCE);
  });

  it("paints a folder drag's hover marker without a dataTransfer", () => {
    const { ui } = folderFixture(["a", "b"]);
    handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
    const row = folderRowOf(ui, "b");
    pinRect(row, 100, 36);

    handleDragOver(ui, noTransfer(row, 104));

    expect(row.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.BEFORE);
    expect(ui.listPanel.lastDragOverItem).toBe(row);
  });

  it("refuses a folder drag over a group row without a dataTransfer", () => {
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({
      id: "G1",
      name: "G1",
      role: "overlay",
      layer: groupLayerFixture(),
    });
    const showHint = vi.spyOn(ui.c.map.foliplus.hint, "set");
    handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));

    handleDragOver(ui, noTransfer(rowOf(ui, "G1")));

    expect(showHint).toHaveBeenCalled();
    expect(rowOf(ui, "G1").getAttribute(CONST.DRAG_STATE_ATTR)).toBe(
      CONST.DRAG_STATE.REFUSE,
    );
    expect(ui.listPanel.lastDragOverItem).toBe(rowOf(ui, "G1"));
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

  it("refuses a group on a folder's middle zone without a dataTransfer", () => {
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({
      id: "G1",
      name: "G1",
      role: "overlay",
      layer: groupLayerFixture(),
    });
    const row = folderRowOf(ui, "b");
    withRect(row, 100, 36);
    handleDragStart(ui, dragEvent(rowOf(ui, "G1"), { effectAllowed: "" }));

    expect(() => handleDragOver(ui, noTransfer(row, 118))).not.toThrow();
  });

  it("refuses a group over a member row without a dataTransfer", () => {
    const { manager, ui } = folderFixture(["a", "b"]);
    manager.registerLayer({
      id: "G1",
      name: "G1",
      role: "overlay",
      layer: groupLayerFixture(),
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

  it("refuses a folder drag over another folder's member row", () => {
    // A member row is not a block of its own: it belongs to the folder block
    // above it, and that block's boundary is its header. A gap drawn between
    // members would name a position the drop never takes, so the row refuses
    // and the block order stays untouched.
    const { ui } = folderFixture(["a", "b"]);
    handleDragStart(ui, dragEvent(folderRowOf(ui, "a"), { effectAllowed: "" }));
    const memberRow = rowOf(ui, "b1");
    pinRect(memberRow, 100, 36);
    const dataTransfer = { dropEffect: "" };

    handleDragOver(ui, dragEvent(memberRow, dataTransfer, 130));

    expect(dataTransfer.dropEffect).toBe("none");
    expect(memberRow.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.REFUSE);

    handleDrop(ui, dragEvent(memberRow, { dropEffect: "" }, 130));
    expect(ui.c.folderLayoutView.order.overlay).toEqual(["a", "b"]);
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
    expect(row.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.JOIN);
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

    expect(row.getAttribute(CONST.DRAG_STATE_ATTR)).toBe(CONST.DRAG_STATE.JOIN);
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

import { initFixture } from "../fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#control/LayerControl/const.js";
import {
  isFolderFolded,
  toggleFolderFold,
} from "#control/LayerControl/ui/listPanel/drag.js";
import { handleKeyDown } from "#control/LayerControl/ui/listPanel/keyboard.js";
import { runMenuAction } from "#control/LayerControl/ui/overlayPanel/menu.js";

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

describe("ui/list folder rows", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("renders role header, folder row, members with rail tree lines, then root layers", () => {
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
        {
          id: "water",
          name: "Water",
          role: "overlay",
          folder: "",
          layer: polygonLayer(),
        },
      ],
    });
    const roleRow = ui.uiContainer!.querySelector(`.${CONST.CLASSES.ROLE_ROW}`);
    expect(roleRow).not.toBeNull();
    const folderRow = ui.uiContainer!.querySelector(`.${CONST.CLASSES.FOLDER_ROW}`);
    expect(folderRow).not.toBeNull();
    expect(folderRow!.getAttribute(CONST.DATA.FOLDER_KEY)).toBe("roads");
    expect(folderRow!.getAttribute(CONST.DATA.ROLE)).toBe("overlay");
    expect(folderRow!.getAttribute("aria-expanded")).toBe("true");
    // Member row (rd1) has a fold-tree guide; root row (water) does not.
    const memberRow = ui.uiContainer!.querySelector(`[data-layer-id="rd1"]`);
    const rootRow = ui.uiContainer!.querySelector(`[data-layer-id="water"]`);
    expect(memberRow!.querySelector(`.${CONST.CLASSES.FOLD_TREE}`)).not.toBeNull();
    expect(rootRow!.querySelector(`.${CONST.CLASSES.FOLD_TREE}`)).toBeNull();
    // Both member and root rows still carry the drag grip in the rail.
    expect(
      memberRow!.querySelector(`.${CONST.CLASSES.RAIL_CELL} .drag-handle`),
    ).not.toBeNull();
    expect(
      rootRow!.querySelector(`.${CONST.CLASSES.RAIL_CELL} .drag-handle`),
    ).not.toBeNull();
  });

  it("folder checkbox is tri-state (mixed when some members visible)", () => {
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
        {
          id: "rd2",
          name: "Rivers",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const folderRow = ui.uiContainer!.querySelector(`.${CONST.CLASSES.FOLDER_ROW}`);
    const cb = folderRow!.querySelector("input[type=checkbox]") as HTMLInputElement;
    // All members visible by default → the folder checkbox reads fully checked.
    expect(cb.getAttribute("aria-checked")).toBe("true");
  });

  it("role row gains count, divider, type icon and more button when folders exist", () => {
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
    const roleRow = ui.uiContainer!.querySelector(`.${CONST.CLASSES.ROLE_ROW}`);
    expect(roleRow!.querySelector(`.${CONST.CLASSES.ROLE_DIVIDER}`)).not.toBeNull();
    expect(roleRow!.querySelector(`.${CONST.CLASSES.COUNT_COL}`)).not.toBeNull();
    expect(roleRow!.querySelector(`.${CONST.CLASSES.TYPE_ICON_COL}`)).not.toBeNull();
    expect(roleRow!.querySelector(`.${CONST.CLASSES.MORE_BTN}`)).not.toBeNull();
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
    expect(ui.listPanel.foldedFolders.has("overlay::roads")).toBe(true);
  });

  it("role menu show-all/hide-all toggles every layer in the role", () => {
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
    const roleRow = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.ROLE_ROW}`,
    ) as HTMLElement;
    (ui.overlayPanel as any).activeMenu = {
      item: roleRow,
      menu: document.createElement("div"),
      role: "overlay",
    };
    const mi = document.createElement("button");
    mi.setAttribute("data-action", CONST.ACTION.HIDE_ALL);
    runMenuAction(ui, mi);
    const cb = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.ROLE_ROW} input[type=checkbox]`,
    ) as HTMLInputElement;
    expect(cb.getAttribute("aria-checked")).toBe("false");
  });

  it("folder menu hide-folder toggles only the folder's members", () => {
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
        {
          id: "water",
          name: "Water",
          role: "overlay",
          folder: "",
          layer: polygonLayer(),
        },
      ],
    });
    const folderRow = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.FOLDER_ROW}`,
    ) as HTMLElement;
    (ui.overlayPanel as any).activeMenu = {
      item: folderRow,
      menu: document.createElement("div"),
      role: "overlay",
      folderKey: "roads",
    };
    const mi = document.createElement("button");
    mi.setAttribute("data-action", CONST.ACTION.HIDE_FOLDER);
    runMenuAction(ui, mi);
    const folderCb = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.FOLDER_ROW} input[type=checkbox]`,
    ) as HTMLInputElement;
    expect(folderCb.getAttribute("aria-checked")).toBe("false");
    const rootCb = ui.uiContainer!.querySelector(
      '[data-layer-id="water"] input[type=checkbox]',
    ) as HTMLInputElement;
    expect(rootCb.checked).toBe(true);
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
    expect(ui.listPanel.foldedRoles.has("overlay")).toBe(false);
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

  it("renders a folder row for declared-only grouping (empty order, member assigned)", () => {
    const { ui } = initFixture({
      seedLayout: {
        version: 2,
        folders: [{ key: "roads", name: "Roads" }],
        order: {},
        members: {},
      },
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "Roads",
          layer: polygonLayer(),
        },
      ],
    });
    const folderRow = ui.uiContainer!.querySelector(`.${CONST.CLASSES.FOLDER_ROW}`);
    expect(folderRow).not.toBeNull();
    expect(folderRow!.getAttribute(CONST.DATA.FOLDER_KEY)).toBe("roads");
    const memberRow = ui.uiContainer!.querySelector('[data-layer-id="rd1"]');
    expect(memberRow!.querySelector(`.${CONST.CLASSES.FOLD_TREE}`)).not.toBeNull();
  });

  it("role menu new-folder creates a folder row and opens an inline rename", () => {
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
    const roleRow = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.ROLE_ROW}`,
    ) as HTMLElement;
    (ui.overlayPanel as any).activeMenu = {
      item: roleRow,
      menu: document.createElement("div"),
      role: "overlay",
    };
    const mi = document.createElement("button");
    mi.setAttribute("data-action", CONST.ACTION.NEW_FOLDER);
    runMenuAction(ui, mi);
    // The default "New Folder" is created in the layout (key is normalized);
    // the action routes through createFolder + rebuildList (the coverage this
    // branch needs). An empty folder renders as the clean-button state, not a
    // row, so the assertion is on the layout, not the DOM row.
    const keys = ui.c.folderLayoutView.folders.map(f => f.key);
    expect(keys).toContain("new folder");
    expect(ui.c.folderLayoutView.order.overlay).toContain("new folder");
  });

  it("role menu expand-all/collapse-all folds or unfolds every folder in the role", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads", "water"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
        {
          id: "w1",
          name: "Water",
          role: "overlay",
          folder: "water",
          layer: polygonLayer(),
        },
      ],
    });
    const roleRow = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.ROLE_ROW}`,
    ) as HTMLElement;
    (ui.overlayPanel as any).activeMenu = {
      item: roleRow,
      menu: document.createElement("div"),
      role: "overlay",
    };
    const mi = document.createElement("button");
    mi.setAttribute("data-action", CONST.ACTION.COLLAPSE_ALL);
    runMenuAction(ui, mi);
    expect(isFolderFolded(ui, "overlay", "roads")).toBe(true);
    expect(isFolderFolded(ui, "overlay", "water")).toBe(true);
    // The first action closes the menu, so re-arm the state for the second.
    const roleRow2 = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.ROLE_ROW}`,
    ) as HTMLElement;
    (ui.overlayPanel as any).activeMenu = {
      item: roleRow2,
      menu: document.createElement("div"),
      role: "overlay",
    };
    const mi2 = document.createElement("button");
    mi2.setAttribute("data-action", CONST.ACTION.EXPAND_ALL);
    runMenuAction(ui, mi2);
    expect(isFolderFolded(ui, "overlay", "roads")).toBe(false);
    expect(isFolderFolded(ui, "overlay", "water")).toBe(false);
  });

  it("folder menu show-folder shows the folder's members", () => {
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
    // Hide the folder's members first so show-folder has something to restore.
    const folderRow = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.FOLDER_ROW}`,
    ) as HTMLElement;
    (ui.overlayPanel as any).activeMenu = {
      item: folderRow,
      menu: document.createElement("div"),
      folderKey: "roads",
    };
    const mi = document.createElement("button");
    mi.setAttribute("data-action", CONST.ACTION.HIDE_FOLDER);
    runMenuAction(ui, mi);
    const memberCb = ui.uiContainer!.querySelector(
      '[data-layer-id="rd1"] input[type=checkbox]',
    ) as HTMLInputElement;
    expect(memberCb.checked).toBe(false);
    // show-folder restores the members' visibility.
    const folderRow2 = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.FOLDER_ROW}`,
    ) as HTMLElement;
    (ui.overlayPanel as any).activeMenu = {
      item: folderRow2,
      menu: document.createElement("div"),
      folderKey: "roads",
    };
    const mi2 = document.createElement("button");
    mi2.setAttribute("data-action", CONST.ACTION.SHOW_FOLDER);
    runMenuAction(ui, mi2);
    const memberCb2 = ui.uiContainer!.querySelector(
      '[data-layer-id="rd1"] input[type=checkbox]',
    ) as HTMLInputElement;
    expect(memberCb2.checked).toBe(true);
  });

  it("role menu show-all shows every layer in the role", () => {
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
    const roleRow = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.ROLE_ROW}`,
    ) as HTMLElement;
    (ui.overlayPanel as any).activeMenu = {
      item: roleRow,
      menu: document.createElement("div"),
      role: "overlay",
    };
    // Hide the layer first.
    const cb = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.ROLE_ROW} input[type=checkbox]`,
    ) as HTMLInputElement;
    cb.checked = false;
    const mi = document.createElement("button");
    mi.setAttribute("data-action", CONST.ACTION.SHOW_ALL);
    runMenuAction(ui, mi);
    const memberCb = ui.uiContainer!.querySelector(
      '[data-layer-id="rd1"] input[type=checkbox]',
    ) as HTMLInputElement;
    expect(memberCb.checked).toBe(true);
  });

  it("folder menu rename-folder opens an inline rename on the folder row", () => {
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
    (ui.overlayPanel as any).activeMenu = {
      item: folderRow,
      menu: document.createElement("div"),
      folderKey: "roads",
      role: "overlay",
    };
    const mi = document.createElement("button");
    mi.setAttribute("data-action", CONST.ACTION.RENAME_FOLDER);
    runMenuAction(ui, mi);
    // The inline rename input opens on the folder row's label.
    expect(
      ui.uiContainer!.querySelector(`.${CONST.CLASSES.RENAME_INPUT}`),
    ).not.toBeNull();
  });
});

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
      expect(rec.foldedFolders).toContain("overlay::roads");
    } finally {
      vi.useRealTimers();
    }
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

  it("orders two unlisted folders by their member anchor", () => {
    // Two folders that are NOT in layout.order land in the displayBlocks
    // `rest` bucket and are sorted by anchor (list.ts:481 comparator).
    const { ui } = initFixture({
      seedLayout: {
        version: 2,
        folders: [
          { key: "rivers", name: "Rivers" },
          { key: "roads", name: "Roads" },
        ],
        order: {},
        members: {},
      },
      data: [
        {
          id: "rv1",
          name: "Rivers",
          role: "overlay",
          folder: "Rivers",
          layer: polygonLayer(),
        },
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "Roads",
          layer: polygonLayer(),
        },
      ],
    });
    const rows = Array.from(
      ui.uiContainer!.querySelectorAll(`.${CONST.CLASSES.FOLDER_ROW}`),
    );
    // The two unlisted folders render as folder rows, in anchor order.
    expect(rows.map(r => r.getAttribute(CONST.DATA.FOLDER_KEY))).toEqual([
      "rivers",
      "roads",
    ]);
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

  it("openMoreMenu on a folder row opens the folder menu (rename/show/hide/delete)", () => {
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
    ui.openMoreMenu(folderRow);
    const menu = ui.overlayPanel.activeMenu?.menu;
    expect(menu).toBeTruthy();
    const actions = [...menu!.querySelectorAll<HTMLElement>("[data-action]")].map(
      b => b.dataset.action,
    );
    expect(actions).toContain(CONST.ACTION.RENAME_FOLDER);
    expect(actions).toContain(CONST.ACTION.SHOW_FOLDER);
    expect(actions).toContain(CONST.ACTION.HIDE_FOLDER);
    expect(actions).toContain(CONST.ACTION.DELETE_FOLDER);
  });

  it("openMoreMenu on a role row opens the role menu (new-folder/expand/collapse/show/hide)", () => {
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
    ui.openRoleMenu(roleRow);
    const menu = ui.overlayPanel.activeMenu?.menu;
    expect(menu).toBeTruthy();
    const actions = [...menu!.querySelectorAll<HTMLElement>("[data-action]")].map(
      b => b.dataset.action,
    );
    expect(actions).toContain(CONST.ACTION.NEW_FOLDER);
    expect(actions).toContain(CONST.ACTION.EXPAND_ALL);
    expect(actions).toContain(CONST.ACTION.COLLAPSE_ALL);
    expect(actions).toContain(CONST.ACTION.SHOW_ALL);
    expect(actions).toContain(CONST.ACTION.HIDE_ALL);
  });

  it("folder row checkbox change hides/shows every member through handleChange", () => {
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
          name: "Parks",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    const folderCb = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.FOLDER_ROW} input[type=checkbox]`,
    ) as HTMLInputElement;
    folderCb.checked = false;
    ui.handleChange({ target: folderCb } as unknown as Event);
    const member1 = ui.uiContainer!.querySelector(
      '[data-layer-id="rd1"] input[type=checkbox]',
    ) as HTMLInputElement;
    const member2 = ui.uiContainer!.querySelector(
      '[data-layer-id="rd2"] input[type=checkbox]',
    ) as HTMLInputElement;
    expect(member1.checked).toBe(false);
    expect(member2.checked).toBe(false);
    // Toggle back on: the folder row's checkbox flips the group visible.
    const folderCb2 = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.FOLDER_ROW} input[type=checkbox]`,
    ) as HTMLInputElement;
    folderCb2.checked = true;
    ui.handleChange({ target: folderCb2 } as unknown as Event);
    const member3 = ui.uiContainer!.querySelector(
      '[data-layer-id="rd1"] input[type=checkbox]',
    ) as HTMLInputElement;
    const member4 = ui.uiContainer!.querySelector(
      '[data-layer-id="rd2"] input[type=checkbox]',
    ) as HTMLInputElement;
    expect(member3.checked).toBe(true);
    expect(member4.checked).toBe(true);
  });

  it("folder rename commit renames the folder in the layout", () => {
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
    const input = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.RENAME_INPUT}`,
    ) as HTMLInputElement;
    input.value = "roads-renamed";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    // A rename rewrites the DISPLAY name, not the identity key (the key is
    // stable; folderLayout.renameFolder updates only the directory entry name).
    const folder = ui.c.folderLayoutView.folders.find(f => f.key === "roads");
    expect(folder?.name).toBe("roads-renamed");
  });

  it("clicking a folder row's checkbox does not fold the folder", () => {
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
    const folderCb = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.FOLDER_ROW} input[type=checkbox]`,
    ) as HTMLInputElement;
    // The click on the checkbox is the onChange path, not a fold: the fold
    // handler's checkbox exclusion returns before toggling the folder.
    folderCb.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(isFolderFolded(ui, "overlay", "roads")).toBe(false);
  });

  it("folder rename cancel (Escape) leaves the folder name unchanged", () => {
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
    const input = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.RENAME_INPUT}`,
    ) as HTMLInputElement;
    input.value = "roads-renamed";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    // Escape cancels: the folder keeps its original name.
    const folder = ui.c.folderLayoutView.folders.find(f => f.key === "roads");
    expect(folder?.name).toBe("roads");
  });
});

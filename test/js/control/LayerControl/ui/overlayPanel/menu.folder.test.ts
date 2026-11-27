// test/js/control/LayerControl/ui/style/menu.folder — folder rows in the menu.
import { findItem, initFixture } from "../fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { normalizeFolderName } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { folderFoldKey } from "#control/LayerControl/declaredFolder.js";
import { handleMoreClick } from "#control/LayerControl/interaction.js";
import { isFolderFolded } from "#control/LayerControl/ui/listPanel/drag.js";
import { runMenuAction } from "#control/LayerControl/ui/overlayPanel/menu.js";

describe("ui/list folder rows (menu)", () => {
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

  it("role menu new-folder creates a folder row and opens a focused inline rename", () => {
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
    (ui.overlayPanel as any).surface = {
      kind: "menu",
      item: roleRow,
      menu: document.createElement("div"),
      role: "overlay",
    };
    const mi = document.createElement("button");
    mi.setAttribute("data-action", CONST.ACTION.NEW_FOLDER);
    runMenuAction(ui, mi);

    const defaultName = ui.T("new_folder_default_name");
    const key = normalizeFolderName(defaultName);
    expect(ui.c.folderLayoutView.order.overlay).toContain(key);
    // The empty folder owns a row, and the inline rename opens on it with the
    // default name selected so the user can type over it immediately.
    const row = ui.uiContainer!.querySelector(
      `[data-folder-key="${key}"]`,
    ) as HTMLElement | null;
    expect(row).not.toBeNull();
    // The row's first input is its checkbox; the rename input is the text one.
    const input = row!.querySelector('input[type="text"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input!.value).toBe(defaultName);
    expect(document.activeElement).toBe(input);
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
    (ui.overlayPanel as any).surface = {
      kind: "menu",
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
    (ui.overlayPanel as any).surface = {
      kind: "menu",
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

  it("role menu disables expand/collapse entries for the reason they would do nothing", () => {
    // The expand/collapse entries are disabled when the role owns no folder, or
    // when every folder is already in the target state. An all-folded role
    // disables only expand (collapse is the state they are in); a role with no
    // folders disables both. The tooltip carries the reason, the same contract
    // as the empty-folder cleanup.
    const base = {
      version: 2,
      folders: [{ key: "roads", name: "roads" }],
      order: { overlay: ["roads"] },
      members: {},
    };
    const { ui } = initFixture({
      seedLayout: { ...base },
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
    const openRole = () => {
      const roleRow = ui.uiContainer!.querySelector(
        `.${CONST.CLASSES.ROLE_ROW}`,
      ) as HTMLElement;
      ui.openRoleMenu(roleRow);
      return ui.overlayPanel.activeMenu!.menu!;
    };
    const entry = (menu: HTMLElement, action: string) =>
      menu.querySelector<HTMLElement>(`button[data-action="${action}"]`)!;

    // Every folder folded: expand has work to do, collapse is the state the
    // role is already in.
    ui.listPanel.foldedFolders[folderFoldKey("overlay", "roads")] = true;
    {
      const menu = openRole();
      const expand = entry(menu, CONST.ACTION.EXPAND_ALL);
      const collapse = entry(menu, CONST.ACTION.COLLAPSE_ALL);
      expect(expand.getAttribute("aria-disabled")).toBe("false");
      expect(expand.getAttribute("title")).toBe(ui.T("expand_all_tooltip"));
      expect(collapse.getAttribute("aria-disabled")).toBe("true");
      expect(collapse.getAttribute("title")).toBe(ui.T("collapse_all_none"));
    }

    // Every folder unfolded: the mirror image.
    ui.listPanel.foldedFolders[folderFoldKey("overlay", "roads")] = false;
    {
      const menu = openRole();
      const expand = entry(menu, CONST.ACTION.EXPAND_ALL);
      const collapse = entry(menu, CONST.ACTION.COLLAPSE_ALL);
      expect(expand.getAttribute("aria-disabled")).toBe("true");
      expect(expand.getAttribute("title")).toBe(ui.T("expand_all_none"));
      expect(collapse.getAttribute("aria-disabled")).toBe("false");
      expect(collapse.getAttribute("title")).toBe(ui.T("collapse_all_tooltip"));
    }
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
    (ui.overlayPanel as any).surface = {
      kind: "menu",
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

  it("openMoreMenu on a folder row opens the folder menu (rename/delete only)", () => {
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
    expect(actions).toContain(CONST.ACTION.DELETE_FOLDER);
    // Show/hide is the row checkbox's job; a menu entry for it duplicated the
    // control the user already has (issue 13).
    expect(actions).not.toContain("show-folder");
    expect(actions).not.toContain("hide-folder");
  });

  it("openMoreMenu on a role row opens the role menu (new-folder/expand/collapse)", () => {
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
    // The role checkbox already shows/hides the whole role (issue 13).
    expect(actions).not.toContain("show-all");
    expect(actions).not.toContain("hide-all");
  });

  it("flags the folder row as renaming, exactly like a layer row (issue 16)", () => {
    // The RENAMING class is what stretches the inline input across the
    // label+count area. The layer rename set it; the folder rename did not, so
    // the two inputs rendered at different widths from the same component.
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
    (ui.overlayPanel as any).surface = {
      kind: "menu",
      item: folderRow,
      menu: document.createElement("div"),
      folderKey: "roads",
      role: "overlay",
    };
    const mi = document.createElement("button");
    mi.setAttribute("data-action", CONST.ACTION.RENAME_FOLDER);
    runMenuAction(ui, mi);
    expect(folderRow.classList.contains(CONST.CLASSES.RENAMING)).toBe(true);
    expect(folderRow.querySelector(`.${CONST.CLASSES.RENAME_INPUT}`)).not.toBeNull();
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
    (ui.overlayPanel as any).surface = {
      kind: "menu",
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
    (ui.overlayPanel as any).surface = {
      kind: "menu",
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

  it("menu actions no-op when the role or folder key is missing", () => {
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
    (ui.overlayPanel as any).surface = {
      kind: "menu",
      item: document.createElement("div"),
      menu: document.createElement("div"),
      role: "",
    };
    for (const action of [CONST.ACTION.EXPAND_ALL, CONST.ACTION.COLLAPSE_ALL]) {
      const mi = document.createElement("button");
      mi.setAttribute("data-action", action);
      expect(() => runMenuAction(ui, mi)).not.toThrow();
    }
    (ui.overlayPanel as any).surface = {
      kind: "menu",
      item: document.createElement("div"),
      menu: document.createElement("div"),
      folderKey: undefined,
      role: "overlay",
    };
    for (const action of [CONST.ACTION.RENAME_FOLDER]) {
      const mi = document.createElement("button");
      mi.setAttribute("data-action", action);
      expect(() => runMenuAction(ui, mi)).not.toThrow();
    }
  });

  it("role actions fall through when activeMenu has no role", () => {
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
    const item = document.createElement("div");
    (ui.overlayPanel as any).surface = {
      kind: "menu",
      item,
      menu: document.createElement("div"),
    };
    for (const action of [
      CONST.ACTION.NEW_FOLDER,
      CONST.ACTION.EXPAND_ALL,
      CONST.ACTION.COLLAPSE_ALL,
      CONST.ACTION.RENAME_FOLDER,
    ]) {
      const mi = document.createElement("button");
      mi.setAttribute("data-action", action);
      expect(() => runMenuAction(ui, mi)).not.toThrow();
    }
  });

  it("new-folder gives each new folder a free default name", () => {
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
    const create = () => {
      (ui.overlayPanel as any).surface = {
        kind: "menu",
        item: roleRow,
        menu: document.createElement("div"),
        role: "overlay",
      };
      const mi = document.createElement("button");
      mi.setAttribute("data-action", CONST.ACTION.NEW_FOLDER);
      runMenuAction(ui, mi);
    };
    create();
    create();
    // The second create must not collide with the first: the default name
    // takes the smallest free ordinal.
    const base = ui.T("new_folder_default_name");
    const keys = ui.c.folderLayoutView.order.overlay;
    expect(keys).toContain(normalizeFolderName(base));
    expect(keys).toContain(normalizeFolderName(`${base} 2`));
  });

  it("more-click on a row-less button is ignored", () => {
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
    const btn = document.createElement("button");
    btn.className = CONST.CLASSES.MORE_BTN;
    ui.uiContainer!.appendChild(btn);
    // A row-less more button: handleMoreClick must ignore it (no closest row).
    const ev = {
      target: btn,
      stopPropagation: () => {},
      preventDefault: () => {},
    } as unknown as Event;
    expect(() => handleMoreClick(ui, ev)).not.toThrow();
  });

  it("folderKeysOfRole skips a root layer in the role", () => {
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
          id: "root1",
          name: "Root",
          role: "overlay",
          folder: "",
          layer: polygonLayer(),
        },
      ],
    });
    const roleRow = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.ROLE_ROW}`,
    ) as HTMLElement;
    (ui.overlayPanel as any).surface = {
      kind: "menu",
      item: roleRow,
      menu: document.createElement("div"),
      role: "overlay",
    };
    const mi = document.createElement("button");
    mi.setAttribute("data-action", CONST.ACTION.COLLAPSE_ALL);
    expect(() => runMenuAction(ui, mi)).not.toThrow();
  });

  it("rename-folder no-ops when the folder row is not found", () => {
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
    const stub = document.createElement("div");
    stub.setAttribute(CONST.DATA.FOLDER_KEY, "missing");
    stub.setAttribute(CONST.DATA.ROLE, "overlay");
    stub.setAttribute(CONST.DATA.FOLDER_NAME, "Missing");
    (ui.overlayPanel as any).surface = {
      kind: "menu",
      item: stub,
      menu: document.createElement("div"),
      folderKey: "missing",
      role: "overlay",
    };
    const mi = document.createElement("button");
    mi.setAttribute("data-action", CONST.ACTION.RENAME_FOLDER);
    expect(() => runMenuAction(ui, mi)).not.toThrow();
  });

  it("rename-folder commit with the same name is a no-op", () => {
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
      `[data-folder-key="roads"]`,
    ) as HTMLElement;
    (ui.overlayPanel as any).surface = {
      kind: "menu",
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
    input.value = "roads";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const folder = ui.c.folderLayoutView.folders.find(f => f.key === "roads");
    expect(folder?.name).toBe("roads");
  });

  it("open-role-menu with a row-less item still opens", () => {
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
    const bare = document.createElement("div");
    ui.uiContainer!.appendChild(bare);
    expect(() => ui.openRoleMenu(bare)).not.toThrow();
  });

  it("open-folder-menu with a key but no folder-name still opens", () => {
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
    const bare = document.createElement("div");
    bare.setAttribute(CONST.DATA.FOLDER_KEY, "roads");
    // No data-folder-name: the menu's name fallback (?? "") is exercised.
    ui.uiContainer!.appendChild(bare);
    expect(() => ui.openMoreMenu(bare)).not.toThrow();
  });

  it("new-folder with an existing default name is a duplicate no-op", () => {
    const { ui } = initFixture({
      seedLayout: {
        version: 2,
        folders: [{ key: "new folder", name: "New Folder" }],
        order: { overlay: ["new folder", "roads"] },
        members: {},
      },
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
    (ui.overlayPanel as any).surface = {
      kind: "menu",
      item: roleRow,
      menu: document.createElement("div"),
      role: "overlay",
    };
    const mi = document.createElement("button");
    mi.setAttribute("data-action", CONST.ACTION.NEW_FOLDER);
    // "New Folder" already exists in the order → createFolder returns a
    // duplicate error → startNewFolder returns early.
    expect(() => runMenuAction(ui, mi)).not.toThrow();
  });

  it("folder menu focusout outside the menu closes it", () => {
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
    const row = ui.uiContainer!.querySelector(
      `[data-folder-key="roads"]`,
    ) as HTMLElement;
    ui.openMoreMenu(row);
    const menu = (ui.overlayPanel.activeMenu as any)?.menu as HTMLElement;
    expect(menu).toBeTruthy();
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    menu.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }),
    );
    expect(ui.overlayPanel.activeMenu).toBeNull();
    outside.remove();
  });
  it("clean-empty-folders confirms on the first click and fires on the second", () => {
    // An empty folder is a key in the role's block order with no member. A root
    // layer (folder: "") is not a member of any folder, so "empty" stays empty.
    const cleanSpy = vi.fn();
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["empty"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "",
          layer: polygonLayer(),
        },
      ],
    });
    ui.c.cleanEmptyFolders = cleanSpy;
    const roleRow = ui.uiContainer!.querySelector(
      `.${CONST.CLASSES.ROLE_ROW}`,
    ) as HTMLElement;
    ui.openRoleMenu(roleRow);
    const menu = ui.overlayPanel.activeMenu!.menu!;
    const btn = menu.querySelector<HTMLElement>(
      `button[data-action="${CONST.ACTION.CLEAN_EMPTY_FOLDERS}"]`,
    )!;
    expect(btn.getAttribute("aria-disabled")).toBe("false");
    const label = btn.querySelector(CONST.SEL.MENU_DELETE_LABEL)!;
    expect(label.textContent).toBe(ui.T("clean_empty_folders"));

    // The menu-local click listener dispatches through handleMenuClick: the first
    // activation only confirms (label swaps to the confirm text, menu stays open).
    const clickOn = (el: HTMLElement) => {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "target", { value: el });
      menu.dispatchEvent(event);
    };
    clickOn(btn);
    expect(btn.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(true);
    expect(label.textContent).toBe(ui.T("delete_confirm"));
    expect(cleanSpy).not.toHaveBeenCalled();

    // The second activation fires: the menu closes and the role is cleaned.
    clickOn(btn);
    expect(cleanSpy).toHaveBeenCalledWith("overlay");
    expect(ui.overlayPanel.activeMenu).toBeNull();
  });

  it("disables clean-empty-folders when the role owns no empty folder", () => {
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
    const btn = ui.overlayPanel.activeMenu!.menu!.querySelector<HTMLElement>(
      `button[data-action="${CONST.ACTION.CLEAN_EMPTY_FOLDERS}"]`,
    )!;
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.getAttribute("title")).toBe(ui.T("clean_empty_folders_none"));
  });

  it("rename-folder falls back to the item's own role and folder name when the menu record lacks them", () => {
    // The menu record's folderKey is the handle; role and display name may be
    // missing from the record but live on the row (data-role / data-folder-name).
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
    const stub = document.createElement("div");
    stub.setAttribute(CONST.DATA.ROLE, "overlay");
    stub.setAttribute(CONST.DATA.FOLDER_NAME, "Roads");
    (ui.overlayPanel as any).surface = {
      kind: "menu",
      item: stub,
      menu: document.createElement("div"),
      folderKey: "roads",
    };
    const mi = document.createElement("button");
    mi.setAttribute("data-action", CONST.ACTION.RENAME_FOLDER);
    runMenuAction(ui, mi);
    expect(
      ui.uiContainer!.querySelector(`.${CONST.CLASSES.RENAME_INPUT}`),
    ).not.toBeNull();
  });

  it("new-folder with a refused create is a silent no-op", () => {
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
    (ui.overlayPanel as any).surface = {
      kind: "menu",
      item: roleRow,
      menu: document.createElement("div"),
      role: "overlay",
    };
    // A refused create (duplicate / blank / too-long) makes startNewFolder return
    // before opening the inline rename: no input, no throw.
    ui.c.createFolder = () => ({ ok: false, reason: "duplicate" });
    const mi = document.createElement("button");
    mi.setAttribute("data-action", CONST.ACTION.NEW_FOLDER);
    expect(() => runMenuAction(ui, mi)).not.toThrow();
    expect(ui.uiContainer!.querySelector(`.${CONST.CLASSES.RENAME_INPUT}`)).toBeNull();
  });
  it("role menu closes through the panel controller when the map is clicked outside", () => {
    // attachRowMenu registers a PanelController with dismiss.outsidePress=click.
    // An outside click reaches the overlay registry, which calls the entry's
    // close → controller.close → the spec's close callback (closeMoreMenu).
    // This is the only path that exercises the spec.close body.
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
    expect(ui.overlayPanel.activeMenu).not.toBeNull();

    // A press outside the menu (the map container) closes it via the overlay
    // registry's click-capture pass.
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(ui.overlayPanel.activeMenu).toBeNull();
  });

  it("layer menu closes when the anchored layer is torn down", () => {
    // subscribeLayerTearDown subscribes the menu's close to LAYER_REMOVED /
    // LAYER_DELETED for the anchored layer id. The teardown contract is that an
    // anchor teardown must close the menu through that callback, independent of
    // any row-removal path that would also close it.
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
    const item = findItem(ui, "rd1");
    // The menu anchors on the row's data-layer-id (the layer row).
    ui.openMoreMenu(item);
    expect(ui.overlayPanel.activeMenu).not.toBeNull();

    // The registry's teardown signal for the anchored id reaches the
    // tear-down subscriber, which closes the menu.
    ui.events.emit(EVENTS.LAYER_REMOVED, { id: "rd1" });

    expect(ui.overlayPanel.activeMenu).toBeNull();
  });

  it("layer menu closes when the anchored layer is component-deleted", () => {
    // The tear-down subscriber also routes LAYER_DELETED (the component-owned
    // delete channel) to closeMoreMenu — the same contract as LAYER_REMOVED.
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
    const item = findItem(ui, "rd1");
    ui.openMoreMenu(item);
    expect(ui.overlayPanel.activeMenu).not.toBeNull();

    // The component-delete signal for the anchored id closes the menu.
    ui.events.emit(EVENTS.LAYER_DELETED, { id: "rd1" });

    expect(ui.overlayPanel.activeMenu).toBeNull();
  });
});

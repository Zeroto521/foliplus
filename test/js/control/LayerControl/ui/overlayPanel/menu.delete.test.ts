// test/js/control/LayerControl/ui/style/menu.delete — the delete and focus menu entries.
import { attachedPanel, findItem, initFixture } from "../fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeFolderName } from "#core/layer/index.js";
import { ensureModes } from "#core/lifecycle/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { seedIntentMap } from "#control/LayerControl/ui/intent.js";
import { rebuildList } from "#control/LayerControl/ui/listPanel/index.js";
import { activateDeleteItem } from "#control/LayerControl/ui/overlayPanel/index.js";
import { handleMenuClick } from "#control/LayerControl/ui/overlayPanel/menu.js";

describe("LayerUI menu", () => {
  let manager: LayerController;

  let ui: LayerUI;

  let map: any;

  beforeEach(() => {
    ({ manager, ui, map } = initFixture());
    // Fold tests need two overlay layers, so overlay1 isn't collapsed into the
    // single-child "no toggle-all" layout. Registered here (not in the tests)
    // because initFixture() flushes the 300ms initTypesAndVisibility timeout
    // AFTER any nested beforeEach, which would drop a layer added inside a test.
    if (!manager.layerRegistry.get("overlay2")) {
      manager.registerLayer({
        id: "overlay2",
        name: "Circles",
        role: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
      });
    }
    ui.listPanel.foldedRoles = {};
    seedIntentMap(ui, "visible", {});
    // Folded-group state is persisted to localStorage, so a fold from one test
    // would be re-read by the next test's LayerUI constructor and present as
    // already-folded.
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    // Drop the debounced enforceOrder before tearing down the DOM — a real
    // timer would otherwise fire after body.innerHTML = "" and hit a detached
    // container (PaneManager.ensurePane).
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
    // LayerControl holds "focusing" mode during an in-flight focus; clear it
    // on the FIXTURE map (not window.map) so a focus-holding test cannot leak.
    if (map) {
      const modes = ensureModes(map);
      if (modes.getMode("LayerControl") === "focusing") {
        modes.setMode("LayerControl", null);
      }
    }
  });
  // ─────────────────── hidden layer disables focus menu item ───────────────────

  describe("focus-layer menu item when layer is hidden", () => {
    it("marks the menu item disabled when checkbox is unchecked", () => {
      const checkbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      if (checkbox) checkbox.checked = false;

      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const li = item.querySelector(
        ".foliplus-layer-more-menu button[data-action='focus-layer']",
      ) as HTMLElement | null;
      expect(li).not.toBeNull();
      expect(li?.getAttribute("aria-disabled")).toBe("true");
      expect(li?.getAttribute("title")).toBeDefined();
    });

    it("clicking the disabled menu item does not call focusLayer", () => {
      const checkbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      if (checkbox) checkbox.checked = false;

      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const focusSpy = vi.fn();
      ui.focusLayer = focusSpy;

      const li = item.querySelector(
        ".foliplus-layer-more-menu button[data-action='focus-layer']",
      ) as HTMLElement;
      li.click();

      expect(focusSpy).not.toHaveBeenCalled();
      // Menu stays open — user sees the disabled state and tooltip.
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
    });

    it("marks the menu item disabled on a base basemap row", () => {
      const item = findItem(ui, "base1");
      ui.openMoreMenu(item);

      const li = item.querySelector(
        ".foliplus-layer-more-menu button[data-action='focus-layer']",
      ) as HTMLElement | null;
      expect(li).not.toBeNull();
      expect(li?.getAttribute("aria-disabled")).toBe("true");
    });

    it("double-click on a base basemap row does not call focusLayer", () => {
      const item = findItem(ui, "base1");
      const focusSpy = vi.spyOn(ui, "focusLayer");
      ui.handleDblClick({ target: item, bubbles: true } as unknown as MouseEvent);
      expect(focusSpy).not.toHaveBeenCalled();
      focusSpy.mockRestore();
    });

    it("menu item is not disabled when layer is visible", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const li = item.querySelector(
        ".foliplus-layer-more-menu button[data-action='focus-layer']",
      ) as HTMLElement | null;
      expect(li?.getAttribute("aria-disabled")).not.toBe("true");
    });

    it("a focused menu button’s Enter fires one native click that triggers focusLayer and closes the menu", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const li = item.querySelector(
        ".foliplus-layer-more-menu button[data-action='focus-layer']",
      ) as HTMLElement;
      li.focus();
      expect(document.activeElement).toBe(li);

      const focusSpy = vi.fn();
      ui.focusLayer = focusSpy;

      li.click();

      expect(focusSpy).toHaveBeenCalledWith("overlay1");
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(0);
    });

    it("a focused disabled menu button’s Enter fires one click that shows a hint and does not call focusLayer", () => {
      const checkbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      if (checkbox) checkbox.checked = false;

      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const li = item.querySelector(
        ".foliplus-layer-more-menu button[data-action='focus-layer']",
      ) as HTMLElement;
      li.focus();

      const focusSpy = vi.fn();
      ui.focusLayer = focusSpy;

      const hintSpy = vi.fn();
      map.foliplus.hint.set = hintSpy;

      li.click();

      expect(focusSpy).not.toHaveBeenCalled();
      expect(hintSpy).toHaveBeenCalledWith(
        "LayerControl",
        "",
        "LayerControl.focus_hidden",
        { duration: expect.any(Number) },
      );
      // Menu stays open — user sees why focus is unavailable.
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
    });

    it("a focused disabled menu button’s Enter with no title shows no hint", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const li = item.querySelector(
        ".foliplus-layer-more-menu button[data-action='focus-layer']",
      ) as HTMLElement;
      li.setAttribute("aria-disabled", "true");
      li.removeAttribute("title");
      li.focus();

      const hintSpy = vi.fn();
      map.foliplus.hint.set = hintSpy;

      li.click();

      // The title is the reason, and no builder leaves it empty — with none
      // there is nothing to say rather than a message about the wrong entry.
      expect(hintSpy).not.toHaveBeenCalled();
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
    });
  });

  // ─────────────────── delete (pending two-click) ───────────────────

  describe("delete-layer menu item", () => {
    const deleteSpy = vi.fn();

    beforeEach(() => {
      ui.c.deleteLayer = deleteSpy;
    });

    function click(li: HTMLLIElement) {
      // interaction.ts owns the click; synthesize the event it reads.
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "target", { value: li });
      handleMenuClick(ui, event);
    }

    function clickMenu(targetUi: LayerUI, li: HTMLElement) {
      // The interaction hub dispatches with the menu owner's ui — the second
      // control on the page has its own arm state.
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "target", { value: li });
      handleMenuClick(targetUi, event);
    }

    function deleteEntryOf(root: HTMLElement): HTMLLIElement {
      return root.querySelector(
        `button[data-action="${CONST.ACTION.DELETE_LAYER}"]`,
      ) as HTMLLIElement;
    }

    it("renders a divider then delete for a data layer", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const lis = Array.from(item.querySelectorAll(".foliplus-layer-more-menu > li"));
      const divider = lis.find(li => li.classList.contains(CONST.CLASSES.MENU_DIVIDER));
      const deleteBtn = item.querySelector(
        `button[data-action="${CONST.ACTION.DELETE_LAYER}"]`,
      ) as HTMLElement | null;
      expect(divider).toBeDefined();
      expect(deleteBtn).not.toBeNull();
      // The divider is the item immediately before the destructive entry.
      expect(divider!.nextElementSibling).toBe(deleteBtn);
      expect(deleteBtn!.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(
        false,
      );
    });

    it("renders a delete entry for the color basemap, not disabled", () => {
      const colorItem = attachedPanel(ui).querySelector(
        `[${CONST.DATA.LAYER_ID}="${CONST.SOLID_BASEMAP_ID}"]`,
      ) as HTMLElement;
      ui.openMoreMenu(colorItem);

      const deleteLi = deleteEntryOf(colorItem);
      expect(deleteLi).not.toBeNull();
      expect(deleteLi.dataset.mode).toBe("delete");
      expect(deleteLi.title).toBe("LayerControl.delete_layer_tooltip");
      expect(
        colorItem.querySelector("li.foliplus-layer-more-menu-divider"),
      ).not.toBeNull();
    });

    it("renders delete for a layer registered by id only, the way folium does", () => {
      // foliplus ships the Python layer list without the Leaflet object, so the
      // registry entry keeps `layer: null` until something resolves it from the
      // map's own child registry. Gating delete on the registry field would read
      // every layer on a real folium map as a component layer.
      map._layers.folium_fg = { options: {} };
      manager.registerLayer({
        id: "folium_fg",
        name: "Points",
        layer: null,
        config: {},
      } as never);

      const item = attachedPanel(ui).querySelector(
        `[data-layer-id="folium_fg"]`,
      ) as HTMLElement;
      expect(item).not.toBeNull();

      ui.openMoreMenu(item);
      expect(
        item.querySelector(`button[data-action="${CONST.ACTION.DELETE_LAYER}"]`),
      ).not.toBeNull();
      expect(item.querySelector(".foliplus-layer-more-menu-divider")).not.toBeNull();
    });
    it("omits the delete item for a component layer", () => {
      manager.registerLayer({
        id: "search1",
        name: "Search",
        config: { position: "topright" },
      } as never);
      expect(manager.layers.map(l => l.id)).toContain("search1");

      // The row carries its identity in data-layer-id, and a component layer
      // row gets a more-menu too — the menu just must not offer a delete.
      const item = attachedPanel(ui).querySelector(
        `[data-layer-id="search1"]`,
      ) as HTMLElement;
      expect(item).not.toBeNull();

      ui.openMoreMenu(item);
      expect(
        item.querySelector(`button[data-action="${CONST.ACTION.DELETE_LAYER}"]`),
      ).toBeNull();
      expect(item.querySelector(".foliplus-layer-more-menu-divider")).toBeNull();
    });

    it("omits the delete item for a row without a layer id", () => {
      // A row registered in the layer registry but never added to the map's
      // own child registry — `deleteModeFor` returns "absent" (nothing to
      // retire) and the menu skips the destructive entry.
      manager.registerLayer({
        id: "orphan1",
        name: "Orphan",
        config: {},
      } as never);

      const item = attachedPanel(ui).querySelector(
        `[${CONST.DATA.LAYER_ID}="orphan1"]`,
      ) as HTMLElement;
      expect(item).not.toBeNull();

      ui.openMoreMenu(item);
      expect(
        item.querySelector(`button[data-action="${CONST.ACTION.DELETE_LAYER}"]`),
      ).toBeNull();
      expect(item.querySelector(".foliplus-layer-more-menu-divider")).toBeNull();
    });

    it("renders a delete item for a component layer with styleSetters, with the component tooltip", () => {
      // Measure/Heatmap own a live handle and register styleSetters, so
      // deleteModeFor treats them as "clear" — the tooltip distinguishes the
      // "clear data" branch from the user-layer "retire the id" branch.
      manager.registerLayer({
        id: "measure1",
        name: "Measure",
        role: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
        styleSetters: { labelShow: vi.fn() },
      } as never);

      const item = attachedPanel(ui).querySelector(
        `[data-layer-id="measure1"]`,
      ) as HTMLElement;
      expect(item).not.toBeNull();

      ui.openMoreMenu(item);

      const deleteLi = deleteEntryOf(item);
      expect(deleteLi).not.toBeNull();
      expect(deleteLi.getAttribute("aria-disabled")).not.toBe("true");
      expect(deleteLi.dataset.mode).toBe("clear");
      expect(deleteLi.title).toBe("LayerControl.clear_data_tooltip");
    });

    it("confirms on the first click and deletes on the second, then closes", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const deleteLi = deleteEntryOf(item);

      click(deleteLi);
      expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(true);
      expect(deleteLi.querySelector(CONST.SEL.MENU_DELETE_LABEL)!.textContent).toBe(
        "LayerControl.delete_confirm",
      );
      expect(deleteSpy).not.toHaveBeenCalled();
      // Menu stays open so the user sees the confirming.
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);

      click(deleteLi);
      expect(deleteSpy).toHaveBeenCalledWith("overlay1");
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(0);
    });

    it("confirms on the first click and deletes on the second for the color basemap", () => {
      const item = attachedPanel(ui).querySelector(
        `[${CONST.DATA.LAYER_ID}="${CONST.SOLID_BASEMAP_ID}"]`,
      ) as HTMLElement;
      ui.openMoreMenu(item);
      const deleteLi = deleteEntryOf(item);

      click(deleteLi);
      expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(true);
      expect(deleteLi.querySelector(CONST.SEL.MENU_DELETE_LABEL)!.textContent).toBe(
        "LayerControl.delete_confirm",
      );
      expect(deleteLi.title).toBe("LayerControl.delete_confirm");
      expect(deleteSpy).not.toHaveBeenCalled();

      click(deleteLi);
      expect(deleteSpy).toHaveBeenCalledWith(CONST.SOLID_BASEMAP_ID);
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(0);
    });

    it("confirms again rather than firing when the menu is reopened", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      let deleteLi = deleteEntryOf(item);
      click(deleteLi);
      expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(true);

      ui.closeMoreMenu(true);
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(0);

      // The pending state belongs to the open menu, not to the layer: a fresh
      // menu must start unpending instead of firing the delete on its first click.
      ui.openMoreMenu(item);
      deleteLi = deleteEntryOf(item);
      expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(
        false,
      );
      click(deleteLi);
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it("confirms on the first click and deletes on the second for a component layer's clear entry", () => {
      // Component layers (Measure, Heatmap) render the clear branch of
      // confirmDelete / disconfirmDelete: isClear=true flows through the confirm
      // label, the tooltip, and the disarm text. Exercising the delete-mode
      // path alone leaves those branches partial.
      manager.registerLayer({
        id: "measure1",
        name: "Measure",
        role: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
        styleSetters: {},
      } as never);
      const item = attachedPanel(ui).querySelector(
        `[${CONST.DATA.LAYER_ID}="measure1"]`,
      ) as HTMLElement;
      ui.openMoreMenu(item);
      const deleteLi = deleteEntryOf(item)!;
      expect(deleteLi.dataset.mode).toBe("clear");

      click(deleteLi);
      expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(true);
      expect(deleteLi.querySelector(CONST.SEL.MENU_DELETE_LABEL)!.textContent).toBe(
        "LayerControl.clear_data_confirm",
      );
      expect(deleteLi.title).toBe("LayerControl.clear_data_confirm");
      expect(deleteSpy).not.toHaveBeenCalled();

      click(deleteLi);
      expect(deleteSpy).toHaveBeenCalledWith("measure1");
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(0);
    });

    it("auto-disconfirms after the arm timeout", () => {
      vi.useFakeTimers();
      try {
        const item = findItem(ui, "overlay1");
        ui.openMoreMenu(item);
        const deleteLi = deleteEntryOf(item);

        click(deleteLi);
        expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(
          true,
        );

        vi.advanceTimersByTime(3000);
        expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(
          false,
        );
        expect(deleteLi.querySelector(CONST.SEL.MENU_DELETE_LABEL)!.textContent).toBe(
          "LayerControl.delete",
        );
        expect(deleteLi.title).toBe("LayerControl.delete_layer_tooltip");

        // A click after the timeout re-confirms rather than firing.
        click(deleteLi);
        expect(deleteSpy).not.toHaveBeenCalled();
        expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(
          true,
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps another control's pending delete armed", () => {
      // Two LayerControls on one page are a supported rendering model: each
      // control owns its arming state, so one control arming or closing its
      // delete entry never walks back the other's. This used to be module-level
      // state, so the second control's confirm/close silently disarmed the
      // first one's pending delete.
      //
      // A document has a single focus owner, so two live menus cannot stay open
      // at the same time (opening the second one blurs the first). The second
      // control's panel is detached here so the first menu keeps focus and the
      // assertion is about the arm state machine, not about focus.
      const second = initFixture();
      second.ui.uiContainer?.remove();

      const itemA = findItem(ui, "overlay1");
      ui.openMoreMenu(itemA);
      const deleteA = deleteEntryOf(itemA);
      click(deleteA);
      expect(deleteA.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(true);

      const itemB = findItem(second.ui, "overlay1");
      second.ui.openMoreMenu(itemB);
      const deleteB = deleteEntryOf(itemB);
      clickMenu(second.ui, deleteB);

      expect(deleteB.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(true);
      // Arming B leaves A armed, still showing its confirm label.
      expect(deleteA.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(true);
      expect(deleteA.querySelector(CONST.SEL.MENU_DELETE_LABEL)!.textContent).toBe(
        "LayerControl.delete_confirm",
      );

      // Closing B's menu disarms B only.
      second.ui.closeMoreMenu(false);
      expect(deleteB.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(false);
      expect(deleteA.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(true);
      second.manager?.debouncedEnforce?.cancel?.();
    });

    it("runs each control's arm timeout on its own clock", () => {
      const second = initFixture();
      second.ui.uiContainer?.remove();
      // initFixture runs its attach pass on fake timers and restores the real
      // clock, so the arm timers under test start here.
      vi.useFakeTimers();
      try {
        const itemA = findItem(ui, "overlay1");
        ui.openMoreMenu(itemA);
        const deleteA = deleteEntryOf(itemA);
        click(deleteA);

        vi.advanceTimersByTime(1000);
        const itemB = findItem(second.ui, "overlay1");
        second.ui.openMoreMenu(itemB);
        const deleteB = deleteEntryOf(itemB);
        clickMenu(second.ui, deleteB);

        // B arming must not clear A's timer: A is still inside its 3s window.
        expect(deleteA.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(
          true,
        );

        // A's deadline is 1000ms before B's, so A disarms alone.
        vi.advanceTimersByTime(2100);
        expect(deleteA.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(
          false,
        );
        expect(deleteB.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(
          true,
        );

        vi.advanceTimersByTime(1000);
        expect(deleteB.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(
          false,
        );
        second.manager?.debouncedEnforce?.cancel?.();
      } finally {
        vi.useRealTimers();
      }
    });

    it("teardown disarms a pending confirm and leaves no timer behind", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const deleteLi = deleteEntryOf(item);
      click(deleteLi);
      expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(true);

      ui.unbindEvents();

      // The arm timeout is the panel's timer, not a module-level one: its
      // teardown disposes the owner, so no later tick can walk the confirm
      // back on a panel that is gone.
      expect(ui.timers.disposed).toBe(true);
      expect(ui.timers.names()).toEqual([]);
      expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(
        false,
      );
    });

    it("activateDeleteItem confirms on the first call and fires on the second", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const deleteLi = deleteEntryOf(item);

      expect(activateDeleteItem(ui, deleteLi)).toBe(false);
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(activateDeleteItem(ui, deleteLi)).toBe(true);
      expect(deleteSpy).toHaveBeenCalledWith("overlay1");
    });

    it("activateDeleteItem no-ops on an entry it cannot arm", () => {
      // confirmDelete needs the label span to swap its text. Without one it stops
      // rather than confirming a blank entry, and reports false so the caller
      // leaves the menu open.
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const deleteLi = deleteEntryOf(item);
      deleteLi.querySelector(CONST.SEL.MENU_DELETE_LABEL)!.remove();

      expect(activateDeleteItem(ui, deleteLi)).toBe(false);
      expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(
        false,
      );
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it("an orphaned pending entry deletes nothing", () => {
      // The confirm path reads the layer id off activeMenu. If the entry is
      // still pending after the menu it belonged to is gone, the id is empty and
      // no layer is touched rather than a wrong one.
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const deleteLi = deleteEntryOf(item);
      click(deleteLi);
      expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(true);

      ui.overlayPanel.surface = null;

      expect(activateDeleteItem(ui, deleteLi)).toBe(true);
      expect(deleteSpy).toHaveBeenCalledWith("");
    });

    it("native activation (Enter -> click) confirms then deletes the layer", () => {
      const item = findItem(ui, "overlay1");
      // Open the menu the way the keyboard does: Enter on the ⋮ button. This
      // also establishes the row cursor that handleKeyDown needs in place.
      const moreBtn = item.querySelector(".foliplus-layer-more-btn") as HTMLElement;
      moreBtn.focus();
      ui.handleKeyDown(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(ui.overlayPanel.activeMenu).not.toBeNull();

      const deleteLi = deleteEntryOf(item);
      deleteLi.focus();

      deleteLi.click();
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(true);

      deleteLi.click();
      expect(deleteSpy).toHaveBeenCalledWith("overlay1");
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(0);
    });

    describe("delete-folder menu item", () => {
      // A folder row only materialises once the layout owns the folder key, so
      // create the folder before registering its member.
      const seedFolder = (name: string) => {
        manager.createFolder("overlay", name);
      };
      const openFolderRowMenu = () => {
        // A full rebuild is what materialises the folder row: createFolder
        // records the key and registerLayer inserts the member row, but the
        // folder block itself is a render-pass product.
        rebuildList(ui);
        const folderRow = attachedPanel(ui).querySelector(
          `.${CONST.CLASSES.FOLDER_ROW}`,
        ) as HTMLElement;
        ui.openMoreMenu(folderRow);
        return folderRow;
      };

      it("dispatches deleteFolder(role, folder) from the folder row's entry", () => {
        const folderSpy = vi.fn();
        ui.c.deleteFolder = folderSpy;
        seedFolder("My Folder");
        manager.registerLayer({
          id: "folder1",
          name: "Roads",
          role: "overlay",
          folder: "My Folder",
          layer: { options: {}, eachLayer: vi.fn() },
        } as never);
        const folderRow = openFolderRowMenu();
        const folderLi = folderRow.querySelector(
          `button[data-action="${CONST.ACTION.DELETE_FOLDER}"]`,
        ) as HTMLLIElement;
        expect(folderLi).not.toBeNull();
        const event = new MouseEvent("click", { bubbles: true, cancelable: true });
        Object.defineProperty(event, "target", { value: folderLi });
        // First activation only confirms the entry (issue 11: every delete is a
        // two-step confirm, folders included).
        handleMenuClick(ui, event);
        expect(folderSpy).not.toHaveBeenCalled();
        expect(folderLi.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(
          true,
        );
        handleMenuClick(ui, event);
        // The KEY, not the display name: after a rename the two diverge and a
        // name-keyed delete would silently miss the folder. The row's key is
        // the handle that survives that rename.
        expect(folderSpy).toHaveBeenCalledWith(
          "overlay",
          normalizeFolderName("My Folder"),
        );
      });

      it("takes the role from the folder row, not from a member's stale assignment", () => {
        const folderSpy = vi.fn();
        ui.c.deleteFolder = folderSpy;
        seedFolder("Green Space");
        manager.registerLayer({
          id: "folder2",
          name: "Parks",
          role: "overlay",
          folder: "Green Space",
          layer: { options: {}, eachLayer: vi.fn() },
        } as never);
        // A stale member assignment pins folder2 to a DIFFERENT section than
        // the folder row it renders under. The row is the identity the user
        // acted on, so its own role is what dispatch must use.
        (
          ui.c.folderLayoutView.members as Record<
            string,
            { role: string; folder: string }
          >
        )["folder2"] = {
          role: "base",
          folder: "green space",
        };
        const folderRow = openFolderRowMenu();
        const folderLi = folderRow.querySelector(
          `button[data-action="${CONST.ACTION.DELETE_FOLDER}"]`,
        ) as HTMLLIElement;
        expect(folderLi).not.toBeNull();
        const event = new MouseEvent("click", { bubbles: true, cancelable: true });
        Object.defineProperty(event, "target", { value: folderLi });
        // Arm, then confirm.
        handleMenuClick(ui, event);
        handleMenuClick(ui, event);
        // Again the key: the member's assignment was overwritten above to the
        // normalized "green space", and the dispatch must agree with it.
        expect(folderSpy).toHaveBeenCalledWith(
          "overlay",
          normalizeFolderName("Green Space"),
        );
      });

      it("loses its folder name by dispatch time but keeps the key: the delete still lands", () => {
        const folderSpy = vi.fn();
        ui.c.deleteFolder = folderSpy;
        seedFolder("My Folder");
        manager.registerLayer({
          id: "folder1",
          name: "Roads",
          role: "overlay",
          folder: "My Folder",
          layer: { options: {}, eachLayer: vi.fn() },
        } as never);
        const folderRow = openFolderRowMenu();
        const folderLi = folderRow.querySelector(
          `button[data-action="${CONST.ACTION.DELETE_FOLDER}"]`,
        ) as HTMLLIElement;
        expect(folderLi).not.toBeNull();
        // The display name is cosmetic: dropping it must not kill the delete.
        // The key is the identity, and the row still carries it, so the confirm
        // goes through.
        folderRow.removeAttribute(CONST.DATA.FOLDER_NAME);
        const event = new MouseEvent("click", { bubbles: true, cancelable: true });
        Object.defineProperty(event, "target", { value: folderLi });
        // Arm, then confirm.
        handleMenuClick(ui, event);
        handleMenuClick(ui, event);
        expect(folderSpy).toHaveBeenCalledWith(
          "overlay",
          normalizeFolderName("My Folder"),
        );
      });

      it("does not dispatch deleteFolder when the row has lost its folder key", () => {
        const folderSpy = vi.fn();
        ui.c.deleteFolder = folderSpy;
        seedFolder("My Folder");
        manager.registerLayer({
          id: "folder1",
          name: "Roads",
          role: "overlay",
          folder: "My Folder",
          layer: { options: {}, eachLayer: vi.fn() },
        } as never);
        const folderRow = openFolderRowMenu();
        const folderLi = folderRow.querySelector(
          `button[data-action="${CONST.ACTION.DELETE_FOLDER}"]`,
        ) as HTMLLIElement;
        expect(folderLi).not.toBeNull();
        // Without the key there is nothing to delete: the row has no identity to
        // hand the controller, so the confirm must be a no-op rather than
        // dispatching with an empty string.
        folderRow.removeAttribute(CONST.DATA.FOLDER_KEY);
        // The menu record agrees — it too carries no folderKey, which is the
        // other half of the dispatch's key lookup.
        (ui.overlayPanel as any).surface = {
          kind: "menu",
          ...((ui.overlayPanel as any).surface ?? {}),
          folderKey: undefined,
        };
        const event = new MouseEvent("click", { bubbles: true, cancelable: true });
        Object.defineProperty(event, "target", { value: folderLi });
        // Arm, then confirm: the confirm is the no-op, not the arm.
        handleMenuClick(ui, event);
        handleMenuClick(ui, event);
        expect(folderSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe("focus-layer menu item when the surface has no bounds carrier", () => {
    // A layer that is visible and configurable but has no geographic extent to
    // zoom to (a MarkerCluster group, a canvas without a `getBounds` provider).
    // Focus must be disabled with the reason as its tooltip, while the Style
    // entry stays enabled — the capability gate is per dimension, not a blanket
    // "this layer is broken".
    it("disables focus with the no-bounds tooltip and keeps Style enabled", () => {
      const layerInfo = manager.layerRegistry.get("overlay1")!;
      ui.c.surfaceFor(layerInfo).capabilities.bounds = false;

      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const focusLi = item.querySelector(
        ".foliplus-layer-more-menu button[data-action='focus-layer']",
      ) as HTMLElement;
      expect(focusLi.getAttribute("aria-disabled")).toBe("true");
      expect(focusLi.getAttribute("title")).toBe("LayerControl.focus_no_bounds");

      const styleLi = item.querySelector(
        ".foliplus-layer-more-menu button[data-action='style-layer']",
      ) as HTMLElement;
      expect(styleLi.getAttribute("aria-disabled")).not.toBe("true");
      ui.closeMoreMenu(false);
    });
  });
});

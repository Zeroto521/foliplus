import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerController } from "#foliplus/LayerControl/controller.js";
import { handleMoreMenuClick } from "#foliplus/LayerControl/interaction.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { seedIntentMap } from "#foliplus/LayerControl/ui/intent.js";
import { activateDeleteItem } from "#foliplus/LayerControl/ui/overlayPanel/menu.js";
import { ensureModes } from "#foliplus/core/mode.js";
import { findItem, initFixture } from "./fixture.js";

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
        group: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
      });
    }
    ui.listPanel.foldedGroups = new Set();
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

  // ─────────────────── focusLayer() ───────────────────

  describe("openMoreMenu() / closeMoreMenu()", () => {
    it("orders the entries focus, style, rename, attributes, then delete behind a divider", () => {
      // Deliberate ordering, not append order: the view action leads (the
      // trigger-adjacent slot is the mis-click zone), then the style panel,
      // then the one entry that writes to the layer, the display-only
      // attributes entry, and finally the destructive one behind its own
      // separator.
      const item = findItem(ui, "overlay1");

      ui.openMoreMenu(item);

      const actions = Array.from(
        item.querySelectorAll(".foliplus-layer-more-menu li"),
      ).map(li => (li as HTMLElement).dataset.action);
      expect(actions).toEqual([
        CONST.ACTION.FOCUS_LAYER,
        CONST.ACTION.STYLE_LAYER,
        CONST.ACTION.RENAME_LAYER,
        CONST.ACTION.ATTRS_LAYER,
        undefined, // the divider above the destructive entry
        CONST.ACTION.DELETE_LAYER,
      ]);
    });

    it("creates a menu with the focus-layer action", () => {
      const item = findItem(ui, "overlay1");

      ui.openMoreMenu(item);

      const li = item.querySelector(
        ".foliplus-layer-more-menu li[data-action='focus-layer']",
      );
      expect(li).not.toBeNull();
      expect(li?.getAttribute("role")).toBe("menuitem");
      expect(li?.getAttribute("tabindex")).toBe("0");
      expect(li?.getAttribute("title")).toBeDefined();
    });

    it("places the menu inside the layer row element", () => {
      const item = findItem(ui, "overlay1");

      ui.openMoreMenu(item);

      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
    });

    it("sets position:relative on the layer row", () => {
      const item = findItem(ui, "overlay1");

      ui.openMoreMenu(item);

      expect(item.style.position).toBe("relative");
    });

    it("closes the previously open menu before opening a new one", () => {
      const item = findItem(ui, "overlay1");

      ui.openMoreMenu(item);
      ui.openMoreMenu(item);

      // Only one menu at a time — the new one replaced the old.
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
      expect(ui.overlayPanel.activeMenu).not.toBeNull();
    });

    it("closeMoreMenu(setFocus=true) returns focus to the layer row", () => {
      const item = findItem(ui, "overlay1");
      const focusSpy = vi.fn();
      item.focus = focusSpy;

      ui.openMoreMenu(item);
      ui.closeMoreMenu(true);

      expect(focusSpy).toHaveBeenCalled();
    });

    it("closeMoreMenu(setFocus=false) does not focus the layer row", () => {
      const item = findItem(ui, "overlay1");
      const focusSpy = vi.fn();
      item.focus = focusSpy;

      ui.openMoreMenu(item);
      ui.closeMoreMenu(false);

      expect(focusSpy).not.toHaveBeenCalled();
    });

    it("closeMoreMenu() is a no-op when no menu is open", () => {
      expect(() => ui.closeMoreMenu(false)).not.toThrow();
    });

    it("exposes the attributes action", () => {
      const item = findItem(ui, "overlay1");

      ui.openMoreMenu(item);

      const li = item.querySelector(
        `.foliplus-layer-more-menu li[data-action='layer-attributes']`,
      );
      expect(li).not.toBeNull();
      expect(li?.getAttribute("role")).toBe("menuitem");
      expect(li?.getAttribute("tabindex")).toBe("0");
    });

    it("closes when Tab moves focus out of the menu", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      item.querySelector(".foliplus-layer-more-menu")!.dispatchEvent(
        new FocusEvent("focusout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );

      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(0);
      expect(ui.overlayPanel.activeMenu).toBeNull();
    });

    it("closes when focus leaves to a null relatedTarget", () => {
      // Tabbing past the end of the menu in some engines yields no explicit
      // target — treat that as "focus left the menu" and dismiss.
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      item.querySelector(".foliplus-layer-more-menu")!.dispatchEvent(
        new FocusEvent("focusout", {
          bubbles: true,
          relatedTarget: null,
        }),
      );

      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(0);
      expect(ui.overlayPanel.activeMenu).toBeNull();
    });

    it("stays open while focus moves within the menu", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const menu = item.querySelector(".foliplus-layer-more-menu")! as HTMLElement;
      const second = menu.querySelectorAll("li")[1]! as HTMLElement;

      menu.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: second }),
      );

      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
      expect(ui.overlayPanel.activeMenu).not.toBeNull();
    });

    it("opens without crashing when the item has no data-layer-id", () => {
      const item = document.createElement("div");
      item.className = "foliplus-layer-item";
      ui.uiContainer.appendChild(item);
      ui.openMoreMenu(item);
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
    });

    it("enables the Style entry for a layer with styleSetters but no label fields", () => {
      manager.registerLayer({
        id: "delegated1",
        name: "Heatmap",
        group: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
        styleSetters: { labelShow: vi.fn() },
      } as any);
      const item = findItem(ui, "delegated1");
      ui.openMoreMenu(item);
      const styleLi = item.querySelector(
        "li[data-action='style-layer']",
      ) as HTMLElement;
      expect(styleLi.getAttribute("disabled")).toBeNull();
    });
  });

  // ─────────────────── attributes panel ───────────────────

  describe("more button visibility", () => {
    // All layers (data + base) expose the "more" button: data layers can
    // focus + rename, base maps can rename. The ⋮ button is never hidden.
    it("base layer more button is visible (rename is available)", () => {
      const baseItem = findItem(ui, "base1");
      const btn = baseItem.querySelector(`.${CONST.CLASSES.MORE_BTN}`);
      expect(btn).not.toBeNull();
      expect(btn?.getAttribute("hidden")).toBeNull();
    });

    it("overlay layer more button is visible", () => {
      const overlayItem = findItem(ui, "overlay1");
      const btn = overlayItem.querySelector(`.${CONST.CLASSES.MORE_BTN}`);
      expect(btn).not.toBeNull();
      expect(btn?.getAttribute("hidden")).toBeNull();
    });

    it("color layer has more button (rename entry point)", () => {
      const colorItem = ui.uiContainer.querySelector(
        `[${CONST.DATA.LAYER_ID}="${CONST.SOLID_BASEMAP_ID}"]`,
      )!;
      const btn = colorItem.querySelector(`.${CONST.CLASSES.MORE_BTN}`);
      expect(btn).not.toBeNull();
    });
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
        ".foliplus-layer-more-menu li[data-action='focus-layer']",
      ) as HTMLElement | null;
      expect(li).not.toBeNull();
      expect(li?.getAttribute("disabled")).toBe("disabled");
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
        ".foliplus-layer-more-menu li[data-action='focus-layer']",
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
        ".foliplus-layer-more-menu li[data-action='focus-layer']",
      ) as HTMLElement | null;
      expect(li).not.toBeNull();
      expect(li?.getAttribute("disabled")).toBe("disabled");
    });

    it("double-click on a base basemap row does not call focusLayer", () => {
      const item = findItem(ui, "base1");
      const focusSpy = vi.spyOn(ui, "focusLayer");
      ui.handleDblClick({ target: item, bubbles: true } as MouseEvent);
      expect(focusSpy).not.toHaveBeenCalled();
      focusSpy.mockRestore();
    });

    it("menu item is not disabled when layer is visible", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const li = item.querySelector(
        ".foliplus-layer-more-menu li[data-action='focus-layer']",
      ) as HTMLElement | null;
      expect(li?.getAttribute("disabled")).toBeNull();
    });

    it("Enter on a visible menu item triggers focusLayer and closes the menu", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const li = item.querySelector(
        ".foliplus-layer-more-menu li[data-action='focus-layer']",
      ) as HTMLElement;
      li.focus();
      expect(document.activeElement).toBe(li);

      const focusSpy = vi.fn();
      ui.focusLayer = focusSpy;

      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      ui.handleKeyDown(event as unknown as KeyboardEvent);

      expect(focusSpy).toHaveBeenCalledWith("overlay1");
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(0);
    });

    it("Enter on a disabled menu item shows a hint and does not call focusLayer", () => {
      const checkbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      if (checkbox) checkbox.checked = false;

      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const li = item.querySelector(
        ".foliplus-layer-more-menu li[data-action='focus-layer']",
      ) as HTMLElement;
      li.focus();

      const focusSpy = vi.fn();
      ui.focusLayer = focusSpy;

      const hintSpy = vi.fn();
      map.foliplus.showHint = hintSpy;

      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      ui.handleKeyDown(event as unknown as KeyboardEvent);

      expect(focusSpy).not.toHaveBeenCalled();
      expect(hintSpy).toHaveBeenCalledWith(
        "LayerControl",
        "LayerControl.focus_layer_hidden",
        expect.any(Number),
      );
      // Menu stays open — user sees why focus is unavailable.
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
    });

    it("Enter on a disabled menu item with no title shows no hint", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const li = item.querySelector(
        ".foliplus-layer-more-menu li[data-action='focus-layer']",
      ) as HTMLElement;
      li.setAttribute("disabled", "disabled");
      li.removeAttribute("title");
      li.focus();

      const hintSpy = vi.fn();
      map.foliplus.showHint = hintSpy;

      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      ui.handleKeyDown(event as unknown as KeyboardEvent);

      // The title is the reason, and no builder leaves it empty — with none
      // there is nothing to say rather than a message about the wrong entry.
      expect(hintSpy).not.toHaveBeenCalled();
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
    });
  });

  // ─────────────────── delete (armed two-click) ───────────────────

  describe("delete-layer menu item", () => {
    const deleteSpy = vi.fn();

    beforeEach(() => {
      ui.c.deleteLayer = deleteSpy;
    });

    function click(li: HTMLLIElement) {
      // interaction.ts owns the click; synthesize the event it reads.
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "target", { value: li });
      handleMoreMenuClick(ui, event);
    }

    function deleteEntryOf(root: HTMLElement): HTMLLIElement {
      return root.querySelector(
        `li[data-action="${CONST.ACTION.DELETE_LAYER}"]`,
      ) as HTMLLIElement;
    }

    it("renders a divider then delete for a data layer", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const lis = Array.from(item.querySelectorAll(".foliplus-layer-more-menu > li"));
      const divider = lis.find(li => li.classList.contains(CONST.CLASSES.MENU_DIVIDER));
      const deleteLi = lis.find(li => li.dataset.action === CONST.ACTION.DELETE_LAYER);
      expect(divider).toBeDefined();
      expect(deleteLi).toBeDefined();
      expect(lis.indexOf(divider!)).toBe(lis.length - 2);
      expect(deleteLi!.classList.contains(CONST.CLASSES.MENU_DELETE_ARMED)).toBe(false);
    });

    it("renders a delete entry for the colour basemap, not disabled", () => {
      const colorItem = ui.uiContainer.querySelector(
        `[${CONST.DATA.LAYER_ID}="${CONST.SOLID_BASEMAP_ID}"]`,
      )!;
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

      const item = ui.uiContainer.querySelector(
        `[data-layer-id="folium_fg"]`,
      ) as HTMLElement;
      expect(item).not.toBeNull();

      ui.openMoreMenu(item);
      expect(
        item.querySelector(`li[data-action="${CONST.ACTION.DELETE_LAYER}"]`),
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
      const item = ui.uiContainer.querySelector(
        `[data-layer-id="search1"]`,
      ) as HTMLElement;
      expect(item).not.toBeNull();

      ui.openMoreMenu(item);
      expect(
        item.querySelector(`li[data-action="${CONST.ACTION.DELETE_LAYER}"]`),
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

      const item = ui.uiContainer.querySelector(
        `[${CONST.DATA.LAYER_ID}="orphan1"]`,
      ) as HTMLElement;
      expect(item).not.toBeNull();

      ui.openMoreMenu(item);
      expect(
        item.querySelector(`li[data-action="${CONST.ACTION.DELETE_LAYER}"]`),
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
        group: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
        styleSetters: { labelShow: vi.fn() },
      } as never);

      const item = ui.uiContainer.querySelector(
        `[data-layer-id="measure1"]`,
      ) as HTMLElement;
      expect(item).not.toBeNull();

      ui.openMoreMenu(item);

      const deleteLi = deleteEntryOf(item);
      expect(deleteLi).not.toBeNull();
      expect(deleteLi.getAttribute("disabled")).toBeNull();
      expect(deleteLi.dataset.mode).toBe("clear");
      expect(deleteLi.title).toBe("LayerControl.clear_data_tooltip");
    });

    it("arms on the first click and deletes on the second, then closes", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const deleteLi = deleteEntryOf(item);

      click(deleteLi);
      expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_ARMED)).toBe(true);
      expect(deleteLi.querySelector(CONST.SEL.MENU_DELETE_LABEL)!.textContent).toBe(
        "LayerControl.delete_layer_confirm",
      );
      expect(deleteSpy).not.toHaveBeenCalled();
      // Menu stays open so the user sees the arming.
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);

      click(deleteLi);
      expect(deleteSpy).toHaveBeenCalledWith("overlay1");
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(0);
    });

    it("arms on the first click and deletes on the second for the colour basemap", () => {
      const item = ui.uiContainer.querySelector(
        `[${CONST.DATA.LAYER_ID}="${CONST.SOLID_BASEMAP_ID}"]`,
      )!;
      ui.openMoreMenu(item);
      const deleteLi = deleteEntryOf(item);

      click(deleteLi);
      expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_ARMED)).toBe(true);
      expect(deleteLi.querySelector(CONST.SEL.MENU_DELETE_LABEL)!.textContent).toBe(
        "LayerControl.delete_layer_confirm",
      );
      expect(deleteLi.title).toBe("LayerControl.delete_layer_confirm");
      expect(deleteSpy).not.toHaveBeenCalled();

      click(deleteLi);
      expect(deleteSpy).toHaveBeenCalledWith(CONST.SOLID_BASEMAP_ID);
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(0);
    });

    it("arms again rather than firing when the menu is reopened", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      let deleteLi = deleteEntryOf(item);
      click(deleteLi);
      expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_ARMED)).toBe(true);

      ui.closeMoreMenu(true);
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(0);

      // The armed state belongs to the open menu, not to the layer: a fresh
      // menu must start unarmed instead of firing the delete on its first click.
      ui.openMoreMenu(item);
      deleteLi = deleteEntryOf(item);
      expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_ARMED)).toBe(false);
      click(deleteLi);
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it("arms on the first click and deletes on the second for a component layer's clear entry", () => {
      // Component layers (Measure, Heatmap) render the clear branch of
      // armDelete / disarmDelete: isClear=true flows through the confirm
      // label, the tooltip, and the disarm text. Exercising the delete-mode
      // path alone leaves those branches partial.
      manager.registerLayer({
        id: "measure1",
        name: "Measure",
        group: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
        styleSetters: {},
      } as never);
      const item = ui.uiContainer.querySelector(`[${CONST.DATA.LAYER_ID}="measure1"]`)!;
      ui.openMoreMenu(item);
      const deleteLi = deleteEntryOf(item)!;
      expect(deleteLi.dataset.mode).toBe("clear");

      click(deleteLi);
      expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_ARMED)).toBe(true);
      expect(deleteLi.querySelector(CONST.SEL.MENU_DELETE_LABEL)!.textContent).toBe(
        "LayerControl.clear_data_confirm",
      );
      expect(deleteLi.title).toBe("LayerControl.clear_data_confirm");
      expect(deleteSpy).not.toHaveBeenCalled();

      click(deleteLi);
      expect(deleteSpy).toHaveBeenCalledWith("measure1");
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(0);
    });

    it("auto-disarms after the arm timeout", () => {
      vi.useFakeTimers();
      try {
        const item = findItem(ui, "overlay1");
        ui.openMoreMenu(item);
        const deleteLi = deleteEntryOf(item);

        click(deleteLi);
        expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_ARMED)).toBe(true);

        vi.advanceTimersByTime(3000);
        expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_ARMED)).toBe(
          false,
        );
        expect(deleteLi.querySelector(CONST.SEL.MENU_DELETE_LABEL)!.textContent).toBe(
          "LayerControl.delete_layer",
        );
        expect(deleteLi.title).toBe("LayerControl.delete_layer_tooltip");

        // A click after the timeout re-arms rather than firing.
        click(deleteLi);
        expect(deleteSpy).not.toHaveBeenCalled();
        expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_ARMED)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("activateDeleteItem arms on the first call and fires on the second", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const deleteLi = deleteEntryOf(item);

      expect(activateDeleteItem(ui, deleteLi)).toBe(false);
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(activateDeleteItem(ui, deleteLi)).toBe(true);
      expect(deleteSpy).toHaveBeenCalledWith("overlay1");
    });

    it("activateDeleteItem no-ops on an entry it cannot arm", () => {
      // armDelete needs the label span to swap its text. Without one it stops
      // rather than arming a blank entry, and reports false so the caller
      // leaves the menu open.
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const deleteLi = deleteEntryOf(item);
      deleteLi.querySelector(CONST.SEL.MENU_DELETE_LABEL)!.remove();

      expect(activateDeleteItem(ui, deleteLi)).toBe(false);
      expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_ARMED)).toBe(false);
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it("an orphaned armed entry deletes nothing", () => {
      // The confirm path reads the layer id off activeMenu. If the entry is
      // still armed after the menu it belonged to is gone, the id is empty and
      // no layer is touched rather than a wrong one.
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const deleteLi = deleteEntryOf(item);
      click(deleteLi);
      expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_ARMED)).toBe(true);

      ui.overlayPanel.activeMenu = null;

      expect(activateDeleteItem(ui, deleteLi)).toBe(true);
      expect(deleteSpy).toHaveBeenCalledWith("");
    });

    it("keyboard Enter arms then deletes the layer", () => {
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
      const enter = (): KeyboardEvent =>
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        });

      ui.handleKeyDown(enter());
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(deleteLi.classList.contains(CONST.CLASSES.MENU_DELETE_ARMED)).toBe(true);

      ui.handleKeyDown(enter());
      expect(deleteSpy).toHaveBeenCalledWith("overlay1");
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(0);
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
        ".foliplus-layer-more-menu li[data-action='focus-layer']",
      ) as HTMLElement;
      expect(focusLi.getAttribute("disabled")).toBe("disabled");
      expect(focusLi.getAttribute("title")).toBe("LayerControl.focus_layer_no_bounds");

      const styleLi = item.querySelector(
        ".foliplus-layer-more-menu li[data-action='style-layer']",
      ) as HTMLElement;
      expect(styleLi.getAttribute("aria-disabled")).not.toBe("true");
      ui.closeMoreMenu(false);
    });
  });

  // ─────────────────── rename ───────────────────

  describe("more button keyboard shortcut", () => {
    it("Enter on more button opens the menu instead of toggling the checkbox", () => {
      const btn = findItem(ui, "overlay1").querySelector(`.${CONST.CLASSES.MORE_BTN}`)!;
      const item = findItem(ui, "overlay1");

      // Spy on checkbox dispatchEvent to prove toggle wasn't triggered.
      const origDispatchEvent = HTMLInputElement.prototype.dispatchEvent;
      const toggleSpy = vi.fn();
      HTMLInputElement.prototype.dispatchEvent = function (...args: any[]) {
        const ev = args[0] as Event;
        if (ev.type === "change") toggleSpy();
        return origDispatchEvent.apply(this, args);
      };

      // Focus the more button so document.activeElement is inside the
      // uiContainer and the Enter/Space shortcut fires. `handleKeyDown`
      // short-circuits on MORE_BTN without calling toggleFocusedLayer.
      btn.focus();
      expect(document.activeElement).toBe(btn);

      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      ui.handleKeyDown(event as unknown as KeyboardEvent);

      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
      expect(toggleSpy).not.toHaveBeenCalled();

      HTMLInputElement.prototype.dispatchEvent = origDispatchEvent;
    });
  });

  describe("menu edge cases", () => {
    it("opens the menu on an item without a data-layer-id attribute", () => {
      const item = document.createElement("div");
      document.body.appendChild(item);

      ui.openMoreMenu(item);

      const menu = item.querySelector(".foliplus-layer-more-menu");
      expect(menu).not.toBeNull();
      expect(menu!.querySelectorAll("li").length).toBeGreaterThan(0);
      ui.closeMoreMenu(false);
    });

    it("does not disable the style entry when the layer has styleSetters but no label fields", () => {
      // Set styleSetters on the layer info in the registry — layerHasStyleDelegation
      // reads from ui.c.layerRegistry, not window.foliplus.styleDelegation.
      const li = manager.layerRegistry.get("overlay1");
      li!.styleSetters = { color: vi.fn() };

      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const styleLi = item.querySelector(
        ".foliplus-layer-more-menu li[data-action='style-layer']",
      ) as HTMLElement;
      expect(styleLi.getAttribute("disabled")).toBeNull();
      ui.closeMoreMenu(false);
    });

    it("disables the style entry when the layer has no labelable content and no style delegation", () => {
      // A layer whose surface reports opacity/zoomRange as "none" (MarkerCluster)
      // and whose label probe found nothing (capability "none") — no style
      // delegation either — canConfigure is false.
      const li = manager.layerRegistry.get("overlay1");
      li!.styleSetters = undefined;
      // Force the surface to report "none" capabilities
      const surface = ui.c.surfaceFor(li!);
      (surface as unknown as { capabilities: Record<string, string> }).capabilities = {
        opacity: "none",
        zoomRange: "none",
        annotation: "none",
        relocatable: false,
      };

      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const styleLi = item.querySelector(
        ".foliplus-layer-more-menu li[data-action='style-layer']",
      ) as HTMLElement;
      expect(styleLi.getAttribute("aria-disabled")).toBe("true");
      ui.closeMoreMenu(false);
    });
  });

  // ─────────────────── checkbox dblclick / Enter ─────────────────────
});

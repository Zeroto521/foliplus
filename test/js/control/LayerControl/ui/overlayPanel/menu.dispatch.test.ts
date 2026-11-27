// test/js/control/LayerControl/ui/style/menu.dispatch — the action dispatch matrix and the delete-folder entry.
import { attachedPanel, findItem, initFixture } from "../fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nativeConsumesKey } from "#core/interaction/index.js";
import { ensureModes } from "#core/lifecycle/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { seedIntentMap } from "#control/LayerControl/ui/intent.js";
import { rebuildList } from "#control/LayerControl/ui/listPanel/index.js";
import {
  MENU_ACTIONS,
  handleMenuClick,
  runMenuAction,
} from "#control/LayerControl/ui/overlayPanel/menu.js";

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
  // ─────────────────── action dispatch matrix ───────────────────
  // One dispatch table (`MENU_ACTIONS`) serves both inputs. The keyboard path
  // used to know three of the six actions and sent the rest to focus-layer, so
  // Style and Attributes opened nothing and showed a "cannot focus" hint
  // instead. Every action is pinned against both inputs here — exhaustively,
  // over the CONST.ACTION enum.
  describe("action dispatch matrix", () => {
    const spyUi = () => ({
      filter: vi.spyOn(ui, "openFilterPanel").mockImplementation(() => {}),
      style: vi.spyOn(ui, "openStylePanel").mockImplementation(() => {}),
      focus: vi.spyOn(ui, "focusLayer").mockImplementation(() => {}),
      rename: vi.spyOn(ui, "renameLayer").mockImplementation(() => {}),
      attrs: vi.spyOn(ui, "openAttrsPanel").mockImplementation(() => {}),
      del: vi.spyOn(ui.c, "deleteLayer").mockImplementation(() => true),
    });

    const openMenuFor = (item: HTMLElement): HTMLElement => {
      ui.openMoreMenu(item);
      return item.querySelector(".foliplus-layer-more-menu") as HTMLElement;
    };

    const entryFor = (menu: HTMLElement, action: string): HTMLElement => {
      const li = menu.querySelector(`button[data-action="${action}"]`) as HTMLElement;
      expect(li).not.toBeNull();
      expect(li.getAttribute("aria-disabled")).not.toBe("true");
      return li;
    };

    // The menu-local click listener invokes this handler; call it directly so
    // the action table is tested without depending on registry wiring, which
    // has its own menu-local/outside-click coverage above.
    // The handler swallows the press (it must not reach the map), so the fake
    // event carries the one method it calls on the real MouseEvent.
    const clickOn = (li: HTMLElement): void => {
      handleMenuClick(ui, {
        target: li,
        stopPropagation: vi.fn(),
      } as unknown as Event);
    };

    const pressKey = (li: HTMLElement): void => {
      li.focus();
      // A native <button> turns Enter/Space into a click, and the interaction
      // manager stands aside for those keys (nativeConsumesKey -> activate),
      // so the browser fires exactly one click. jsdom does not synthesize the
      // native activation, so the test dispatches the click the browser would
      // deliver — the single dispatch shared by mouse and keyboard.
      li.click();
    };

    const activate = (
      item: HTMLElement,
      action: string,
      how: "click" | "enter" | "space",
    ): void => {
      const li = entryFor(openMenuFor(item), action);
      if (how === "click") {
        clickOn(li);
        return;
      }
      pressKey(li);
    };

    const menuGone = (item: HTMLElement): boolean =>
      item.querySelector(".foliplus-layer-more-menu") === null;

    it("covers every CONST.ACTION value in the table", () => {
      expect(Object.keys(MENU_ACTIONS).sort()).toEqual(
        Object.values(CONST.ACTION).sort(),
      );
      for (const action of Object.values(CONST.ACTION)) {
        expect(typeof MENU_ACTIONS[action]).toBe("function");
      }
    });

    // Kill test for the unknown-action branch in runMenuAction: a data-action
    // the MENU_ACTIONS table does not know must close the menu and return row
    // focus (the old click fallthrough contract). Deleting that branch (letting
    // the lookup hit `undefined`) is caught by the coverage-patch gate on the
    // runMenuAction unknown-action branch.
    it("an unknown data-action closes the menu and returns focus", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const menu = item.querySelector(".foliplus-layer-more-menu") as HTMLElement;
      expect(menu).not.toBeNull();
      const bogus = document.createElement("button");
      bogus.setAttribute("data-action", "bogus-action");
      runMenuAction(ui, bogus);
      expect(item.querySelector(".foliplus-layer-more-menu")).toBeNull();
    });

    // The single-dispatch guarantee: a native <button> consumes Enter/Space
    // (the interaction manager stands aside, so the browser fires exactly one
    // click), while arrows are NOT consumed and still route to the keyboard
    // branch. This pins the "no second dispatch" contract that the native
    // button conversion is built on.
    it("a menu button owns Enter/Space natively but not the arrows", () => {
      const item = findItem(ui, "overlay1");
      const btn = entryFor(openMenuFor(item), CONST.ACTION.STYLE_LAYER);
      expect(btn.tagName.toLowerCase()).toBe("button");
      // Enter/Space are the button’s native activation keys: the manager
      // stands aside, so no manual dispatch competes with the native click.
      expect(nativeConsumesKey(btn, "Enter")).toBe(true);
      expect(nativeConsumesKey(btn, " ")).toBe(true);
      // Arrows are not a button activation key: the manager dispatches them
      // to handleKeyDown, which keeps the menu-item branch for arrows.
      expect(nativeConsumesKey(btn, "ArrowLeft")).toBe(false);
      expect(nativeConsumesKey(btn, "ArrowRight")).toBe(false);
    });

    it("runs style-layer on click and never falls through to focus-layer", () => {
      const spies = spyUi();
      const item = findItem(ui, "overlay1");
      activate(item, CONST.ACTION.STYLE_LAYER, "click");
      expect(spies.style).toHaveBeenCalledWith("overlay1");
      expect(spies.focus).not.toHaveBeenCalled();
      expect(menuGone(item)).toBe(true);
    });

    it("runs style-layer on Enter and never falls through to focus-layer", () => {
      const spies = spyUi();
      const item = findItem(ui, "overlay1");
      activate(item, CONST.ACTION.STYLE_LAYER, "enter");
      expect(spies.style).toHaveBeenCalledWith("overlay1");
      expect(spies.focus).not.toHaveBeenCalled();
      expect(menuGone(item)).toBe(true);
    });

    it("runs layer-attributes on click and never falls through to focus-layer", () => {
      const spies = spyUi();
      const item = findItem(ui, "overlay1");
      activate(item, CONST.ACTION.ATTRS_LAYER, "click");
      expect(spies.attrs).toHaveBeenCalledWith(item);
      expect(spies.focus).not.toHaveBeenCalled();
      expect(menuGone(item)).toBe(true);
    });

    it("runs layer-attributes on Enter and never falls through to focus-layer", () => {
      const spies = spyUi();
      const item = findItem(ui, "overlay1");
      activate(item, CONST.ACTION.ATTRS_LAYER, "enter");
      expect(spies.attrs).toHaveBeenCalledWith(item);
      expect(spies.focus).not.toHaveBeenCalled();
      expect(menuGone(item)).toBe(true);
    });

    // Space shares the activation key group with Enter, so the same fix must
    // hold there — the report listed both keys.
    it("runs style-layer on Space without falling through to focus-layer", () => {
      const spies = spyUi();
      const item = findItem(ui, "overlay1");
      activate(item, CONST.ACTION.STYLE_LAYER, "space");
      expect(spies.style).toHaveBeenCalledWith("overlay1");
      expect(spies.focus).not.toHaveBeenCalled();
      expect(menuGone(item)).toBe(true);
    });

    it("runs layer-attributes on Space without falling through to focus-layer", () => {
      const spies = spyUi();
      const item = findItem(ui, "overlay1");
      activate(item, CONST.ACTION.ATTRS_LAYER, "space");
      expect(spies.attrs).toHaveBeenCalledWith(item);
      expect(spies.focus).not.toHaveBeenCalled();
      expect(menuGone(item)).toBe(true);
    });

    it("runs focus-layer on click and on Enter", () => {
      const spies = spyUi();
      const item = findItem(ui, "overlay1");
      activate(item, CONST.ACTION.FOCUS_LAYER, "click");
      expect(spies.focus).toHaveBeenLastCalledWith("overlay1");
      activate(item, CONST.ACTION.FOCUS_LAYER, "enter");
      expect(spies.focus).toHaveBeenCalledTimes(2);
      expect(spies.focus).toHaveBeenLastCalledWith("overlay1");
    });

    it("runs rename-layer on click and on Enter", () => {
      const spies = spyUi();
      const item = findItem(ui, "overlay1");
      activate(item, CONST.ACTION.RENAME_LAYER, "click");
      expect(spies.rename).toHaveBeenLastCalledWith("overlay1");
      activate(item, CONST.ACTION.RENAME_LAYER, "enter");
      expect(spies.rename).toHaveBeenCalledTimes(2);
      expect(spies.rename).toHaveBeenLastCalledWith("overlay1");
    });

    it("runs the two-step delete on click (confirms, then deletes)", () => {
      const spies = spyUi();
      const item = findItem(ui, "overlay1");
      const menu = openMenuFor(item);
      const li = entryFor(menu, CONST.ACTION.DELETE_LAYER);

      clickOn(li);
      expect(spies.del).not.toHaveBeenCalled();
      expect(li.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(true);
      expect(menuGone(item)).toBe(false);

      clickOn(li);
      expect(spies.del).toHaveBeenCalledWith("overlay1");
      expect(menuGone(item)).toBe(true);
    });

    it("runs the two-step delete on Enter (confirms, then deletes)", () => {
      const spies = spyUi();
      const item = findItem(ui, "overlay1");
      const li = entryFor(openMenuFor(item), CONST.ACTION.DELETE_LAYER);

      pressKey(li);
      expect(spies.del).not.toHaveBeenCalled();
      expect(li.classList.contains(CONST.CLASSES.MENU_DELETE_PENDING)).toBe(true);
      expect(menuGone(item)).toBe(false);

      pressKey(li);
      expect(spies.del).toHaveBeenCalledWith("overlay1");
      expect(menuGone(item)).toBe(true);
    });

    it("runs filter-layer on click and on Enter for a filter-capable row", () => {
      manager.registerLayer({
        id: "filterable1",
        name: "Points",
        role: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
        filterProvider: vi.fn(),
        filterSetter: vi.fn(),
      } as any);
      const spies = spyUi();
      const item = findItem(ui, "filterable1");

      activate(item, CONST.ACTION.FILTER_LAYER, "click");
      expect(spies.filter).toHaveBeenLastCalledWith(item);

      activate(item, CONST.ACTION.FILTER_LAYER, "enter");
      expect(spies.filter).toHaveBeenCalledTimes(2);
      expect(spies.filter).toHaveBeenLastCalledWith(item);
    });

    it("disables the filter entry when a capability row has no filterable field", () => {
      // A capability row whose model carries no numeric/enum fields must not
      // open the empty panel: the menu entry stays visible but disabled, with
      // the empty-state reason as its tooltip.
      manager.registerLayer({
        id: "noFields",
        name: "Points",
        role: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
        filterProvider: () => null,
        filterSetter: () => {},
      } as any);
      const item = findItem(ui, "noFields");

      ui.openMoreMenu(item);

      const btn = item.querySelector<HTMLElement>(
        `.foliplus-layer-more-menu button[data-action="${CONST.ACTION.FILTER_LAYER}"]`,
      );
      expect(btn).not.toBeNull();
      expect(btn?.getAttribute("aria-disabled")).toBe("true");
      expect(btn?.getAttribute("title")).toBe(ui.T("filter_empty"));
    });

    it("enables the filter entry when a capability row has a filterable field", () => {
      manager.registerLayer({
        id: "hasFields",
        name: "Points",
        role: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
        filterProvider: () => ({
          dimensions: [
            { kind: "enum", field: "kind", options: [], multi: true, truncated: false },
          ],
          kept: 1,
          total: 1,
        }),
        filterSetter: () => {},
      } as any);
      const item = findItem(ui, "hasFields");

      ui.openMoreMenu(item);

      const btn = item.querySelector<HTMLElement>(
        `.foliplus-layer-more-menu button[data-action="${CONST.ACTION.FILTER_LAYER}"]`,
      );
      expect(btn).not.toBeNull();
      expect(btn?.getAttribute("aria-disabled")).toBe("false");
      expect(btn?.getAttribute("title")).toBe(ui.T("filter_layer_tooltip"));
    });
  });

  // ─────────────────── checkbox dblclick / Enter ─────────────────────

  describe("delete-folder menu entry rendering", () => {
    const registerLayer = (id: string, name: string, role: string, folder?: string) => {
      manager.registerLayer({
        id,
        name,
        role: role as "overlay" | "base",
        ...(folder ? { folder } : {}),
        layer: { options: {}, eachLayer: vi.fn() },
      } as never);
    };
    const actionsFor = (item: HTMLElement) =>
      Array.from(item.querySelectorAll(".foliplus-layer-more-menu button")).map(
        b => (b as HTMLElement).dataset.action,
      );

    it("keeps the delete-folder entry out of a layer row's menu", () => {
      // Deleting the folder is the folder row's own operation: a layer menu
      // carrying both it and the layer's own delete would show two entries
      // labelled "Delete" (issue 11).
      registerLayer("folder1", "Roads", "overlay", "My Folder");
      const item = findItem(ui, "folder1");
      ui.openMoreMenu(item);
      expect(actionsFor(item)).not.toContain(CONST.ACTION.DELETE_FOLDER);
      expect(actionsFor(item)).toContain(CONST.ACTION.DELETE_LAYER);
    });

    it("renders the delete-folder entry last in the folder row's menu", () => {
      manager.createFolder("overlay", "My Folder");
      registerLayer("folder1", "Roads", "overlay", "My Folder");
      rebuildList(ui);
      const folderRow = attachedPanel(ui).querySelector(
        `.${CONST.CLASSES.FOLDER_ROW}`,
      ) as HTMLElement;
      ui.openMoreMenu(folderRow);
      const actions = actionsFor(folderRow);
      expect(actions).toContain(CONST.ACTION.DELETE_FOLDER);
      // Delete is the last entry of the folder menu.
      expect(actions[actions.length - 1]).toBe(CONST.ACTION.DELETE_FOLDER);
    });

    // ── coverage edges (internal guards, reached via the public surface) ──

    it("a disabled entry with explainDisabled but no title shows no hint", () => {
      // runMenuAction({ explainDisabled: true }) reports the reason via the
      // entry's title; an entry with aria-disabled but no title has nothing to
      // say, so no hint fires and the menu stays open.
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const li = item.querySelector(
        ".foliplus-layer-more-menu button[data-action='focus-layer']",
      ) as HTMLElement;
      li.setAttribute("aria-disabled", "true");
      li.removeAttribute("title");
      const hintSpy = vi.fn();
      map.foliplus.hint.set = hintSpy;
      runMenuAction(ui, li, { explainDisabled: true });
      expect(hintSpy).not.toHaveBeenCalled();
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
    });

    it("a disabled entry with explainDisabled and a title shows that title", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const li = item.querySelector(
        ".foliplus-layer-more-menu button[data-action='focus-layer']",
      ) as HTMLElement;
      li.setAttribute("aria-disabled", "true");
      li.setAttribute("title", "why-not");
      const hintSpy = vi.fn();
      map.foliplus.hint.set = hintSpy;
      runMenuAction(ui, li, { explainDisabled: true });
      expect(hintSpy).toHaveBeenCalledWith("LayerControl", "", "why-not", {
        duration: expect.any(Number),
      });
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
    });

    it("a disabled entry without explainDisabled is a silent no-op", () => {
      // The click path passes no explainDisabled, so a disabled entry is skipped
      // without a hint (the hint is the keyboard path's alone).
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const li = item.querySelector(
        ".foliplus-layer-more-menu button[data-action='focus-layer']",
      ) as HTMLElement;
      li.setAttribute("aria-disabled", "true");
      li.setAttribute("title", "why-not");
      const hintSpy = vi.fn();
      map.foliplus.hint.set = hintSpy;
      runMenuAction(ui, li);
      expect(hintSpy).not.toHaveBeenCalled();
    });

    it("a layer menu focusout to a node outside the row closes it", () => {
      // The focus-out guard returns early only while focus stays inside the
      // owning row; moving to a node that is neither the row nor inside the menu
      // dismisses. This is the guard's outside half for the layer menu.
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const menu = item.querySelector(".foliplus-layer-more-menu") as HTMLElement;
      const elsewhere = document.createElement("div");
      document.body.appendChild(elsewhere);
      menu.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: elsewhere }),
      );
      expect(ui.overlayPanel.activeMenu).toBeNull();
      elsewhere.remove();
    });

    it("a layer menu focusout into the menu keeps it open", () => {
      // Focus moving from the menu onto one of its own entries is not a
      // dismissal: the menu owns the keyboard cursor while it is open.
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const menu = item.querySelector(".foliplus-layer-more-menu") as HTMLElement;
      const entry = menu.querySelector("button") as HTMLElement;
      menu.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: entry }),
      );
      expect(ui.overlayPanel.activeMenu).not.toBeNull();
    });

    it("a layer menu focusout with a null relatedTarget closes it", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const menu = item.querySelector(".foliplus-layer-more-menu") as HTMLElement;
      menu.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
      );
      expect(ui.overlayPanel.activeMenu).toBeNull();
    });
  });
});

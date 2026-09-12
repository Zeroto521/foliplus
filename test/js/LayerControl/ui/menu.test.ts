import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerManager } from "#foliplus/LayerControl/manager.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { ensureModes } from "#foliplus/core/mode.js";
import {
  allFolded,
  attachWithGroup,
  findItem,
  initFixture,
  overlayFoldBtn,
  pressKey,
} from "./fixture.js";

describe("LayerUI menu", () => {
  let manager: LayerManager;
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
        isBase: false,
        layer: { options: {}, eachLayer: vi.fn() },
      });
    }
    ui.foldedGroups = new Set();
    ui.hiddenIds = new Set();
    // Folded-group state is persisted to localStorage, so a fold from one test
    // would be re-read by the next test's LayerUI constructor and present as
    // already-folded.
    window.localStorage.removeItem(CONST.STORAGE.FOLD_KEY);
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
      expect(ui.activeMenu).not.toBeNull();
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
      const colorItem = ui.uiContainer.querySelector(`${CONST.SEL.COLOR_ITEM}`)!;
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

  // ─────────────────── checkbox dblclick / Enter ─────────────────────
});

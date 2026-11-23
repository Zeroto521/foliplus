import { repoPath } from "#test/path.js";
import { attachedPanel, findItem, initFixture } from "../fixture.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { nativeConsumesKey } from "#core/interaction/index.js";
import { normalizeFolderName } from "#core/layer/index.js";
import { ensureModes } from "#core/lifecycle/index.js";
import { OVERLAY_IDS, ensureOverlayRegistry } from "#core/overlay/index.js";
import * as CONST from "#control/LayerControl/const.js";
import type { LayerController } from "#control/LayerControl/controller.js";
import { folderFoldKey } from "#control/LayerControl/declaredFolder.js";
import { handleMoreClick } from "#control/LayerControl/interaction.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import { seedIntentMap } from "#control/LayerControl/ui/intent.js";
import { isFolderFolded } from "#control/LayerControl/ui/listPanel/drag.js";
import { rebuildList } from "#control/LayerControl/ui/listPanel/index.js";
import { activateDeleteItem } from "#control/LayerControl/ui/overlayPanel/index.js";
import {
  MENU_ACTIONS,
  handleMenuClick,
  runMenuAction,
} from "#control/LayerControl/ui/overlayPanel/menu.js";
import { styleCapability } from "#control/LayerControl/ui/style/index.js";

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

  // ─────────────────── focusLayer() ───────────────────

  describe("openMoreMenu() / closeMoreMenu()", () => {
    it("disables Style and Filter for a container row and keeps Focus enabled", () => {
      // A container (FeatureGroup-like) groups sub-layers. Style must be disabled
      // (partial effect is misleading — mixed geometry, Marker has no setStyle),
      // Filter disabled (the container has no own features), Focus stays enabled
      // (union bounds). The tooltip tells the user to expand and act on children.
      const childA = { options: {}, feature: { type: "Feature" } };
      const childB = { options: {} };
      const container: any = {
        options: {},
        clearLayers: vi.fn(),
        getBounds: vi.fn(() => ({ isValid: () => true })),
        addLayer: vi.fn(),
        removeLayer: vi.fn(),
        getLayers: vi.fn(() => [childA, childB]),
        _layers: { a: childA, b: childB },
      };
      container.eachLayer = vi.fn((fn: (c: unknown) => void) => {
        for (const c of [childA, childB]) fn(c);
      });
      manager.registerLayer({
        id: "container1",
        name: "Container",
        role: "overlay",
        layer: container,
      });
      const item = findItem(ui, "container1");
      ui.openMoreMenu(item);

      const styleEntry = item.querySelector(
        `.foliplus-layer-more-menu button[data-action="${CONST.ACTION.STYLE_LAYER}"]`,
      ) as HTMLElement;
      const filterEntry = item.querySelector(
        `.foliplus-layer-more-menu button[data-action="${CONST.ACTION.FILTER_LAYER}"]`,
      ) as HTMLElement;
      const focusEntry = item.querySelector(
        `.foliplus-layer-more-menu button[data-action="focus-layer"]`,
      ) as HTMLElement;

      expect(styleEntry).not.toBeNull();
      expect(styleEntry.getAttribute("aria-disabled")).toBe("true");
      expect(styleEntry.getAttribute("title")).toBe(ui.T("group_no_style_filter"));
      expect(filterEntry).not.toBeNull();
      expect(filterEntry.getAttribute("aria-disabled")).toBe("true");
      expect(filterEntry.getAttribute("title")).toBe(ui.T("group_no_style_filter"));
      expect(focusEntry).not.toBeNull();
      expect(focusEntry.getAttribute("aria-disabled")).toBe("false");
      ui.closeMoreMenu(false);
    });
    it("keeps Style and Filter enabled for a provider-backed group", () => {
      // MeasureControl and HeatmapControl register an L.layerGroup with a
      // featureCountProvider: the group is the layer's representation, not a
      // folder of sub-layers, so its style and filter panels stay available.
      // The container answer must come from the entry, not the Leaflet class.
      const group: any = {
        options: {},
        clearLayers: vi.fn(),
        getBounds: vi.fn(() => ({ isValid: () => true })),
        addLayer: vi.fn(),
        removeLayer: vi.fn(),
        getLayers: vi.fn(() => []),
        _layers: {},
      };
      group.eachLayer = vi.fn();
      manager.registerLayer({
        id: "provider1",
        name: "Provider",
        role: "overlay",
        layer: group,
        featureCountProvider: () => 7,
      });
      const item = findItem(ui, "provider1");
      ui.openMoreMenu(item);

      const styleEntry = item.querySelector(
        `.foliplus-layer-more-menu button[data-action="${CONST.ACTION.STYLE_LAYER}"]`,
      ) as HTMLElement;
      const filterEntry = item.querySelector(
        `.foliplus-layer-more-menu button[data-action="${CONST.ACTION.FILTER_LAYER}"]`,
      ) as HTMLElement;

      expect(styleEntry).not.toBeNull();
      expect(styleEntry.getAttribute("title")).not.toBe(ui.T("group_no_style_filter"));
      expect(filterEntry).not.toBeNull();
      expect(filterEntry.getAttribute("title")).not.toBe(ui.T("group_no_style_filter"));
      ui.closeMoreMenu(false);
    });
    it("outside click closes the open menu through the overlay registry", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      expect(item.querySelector(".foliplus-layer-more-menu")).not.toBeNull();

      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(item.querySelector(".foliplus-layer-more-menu")).toBeNull();
    });

    it("places the menu against its owning row and releases on close", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const menu = item.querySelector<HTMLElement>(`.${CONST.CLASSES.MORE_MENU}`)!;
      // jsdom rects are all zeros, so the engine's below-first branch yields
      // 0 for left/top; the assertion is that the placement pass ran and wrote
      // explicit coordinates rather than leaving the CSS default.
      expect(menu.style.left).toBe("0px");
      expect(menu.style.top).toBe("0px");
      expect(menu.style.maxWidth).not.toBe("");
      // The height cap is applied only when the placement restricts the menu
      // below its natural height. jsdom reports a 0 scrollHeight (no layout),
      // so the small menu gets no cap — the no-scroll guard. A menu that
      // genuinely exceeds the strip is capped (asserted below).
      expect(menu.style.maxHeight).toBe("");
      // The reposition pass is bound while open and released on close.
      expect(ui.overlayPanel.menuReposition).not.toBeNull();
      ui.closeMoreMenu(false);
      expect(ui.overlayPanel.menuReposition).toBeNull();
    });

    it("caps the menu height only when the strip restricts it below the content", async () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const menu = item.querySelector<HTMLElement>(`.${CONST.CLASSES.MORE_MENU}`)!;
      // A content taller than the available strip: the placement cap (0 in
      // jsdom) is below the natural height, so the menu gets the cap and
      // scrolls instead of overflowing the clip box. Re-place through the
      // bound reposition pass (RAF-throttled) so the fresh scrollHeight is
      // read, then flush the frame.
      Object.defineProperty(menu, "scrollHeight", {
        value: 300,
        configurable: true,
      });
      // Re-place through the bound scroll listener (the reposition pass
      // schedules a RAF-throttled placeMoreMenu); flush the frame.
      window.dispatchEvent(new Event("scroll"));
      await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
      expect(menu.style.maxHeight).not.toBe("");
    });

    it("leads with Filter (generic capability), then style, focus, rename, attributes", () => {
      // Deliberate ordering, not append order: the primary configure action
      // leads, then the reversible view action, the one entry that writes to
      // the layer, the display-only attributes entry, and finally the
      // destructive one behind its own separator. A constructor-registered
      // ordinary layer is injected with the generic filter capability, so it
      // leads with Filter (the same gate registerLayer uses).
      const item = findItem(ui, "overlay1");

      ui.openMoreMenu(item);

      const actions = Array.from(
        item.querySelectorAll(".foliplus-layer-more-menu button"),
      ).map(li => (li as HTMLElement).dataset.action);
      expect(actions).toEqual([
        CONST.ACTION.FILTER_LAYER,
        CONST.ACTION.STYLE_LAYER,
        CONST.ACTION.FOCUS_LAYER,
        CONST.ACTION.RENAME_LAYER,
        CONST.ACTION.ATTRS_LAYER,
        CONST.ACTION.DELETE_LAYER,
      ]);
    });
    it("leads with Filter on a capability row, then style, focus, rename, attributes", () => {
      manager.registerLayer({
        id: "filterable",
        name: "Filterable",
        role: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
        filterProvider: () => null,
        filterSetter: () => {},
      });
      const item = findItem(ui, "filterable");

      ui.openMoreMenu(item);

      const actions = Array.from(
        item.querySelectorAll(".foliplus-layer-more-menu button"),
      ).map(li => (li as HTMLElement).dataset.action);
      expect(actions.slice(0, 5)).toEqual([
        CONST.ACTION.FILTER_LAYER,
        CONST.ACTION.STYLE_LAYER,
        CONST.ACTION.FOCUS_LAYER,
        CONST.ACTION.RENAME_LAYER,
        CONST.ACTION.ATTRS_LAYER,
      ]);
    });

    it("keeps the Filter entry enabled when the owner has a filterable field", () => {
      manager.registerLayer({
        id: "has-fields",
        name: "Has Fields",
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
      });
      const item = findItem(ui, "has-fields");

      ui.openMoreMenu(item);

      const entry = item.querySelector(
        `.foliplus-layer-more-menu button[data-action="${CONST.ACTION.FILTER_LAYER}"]`,
      ) as HTMLElement;
      expect(entry).not.toBeNull();
      expect(entry.getAttribute("aria-disabled")).toBe("false");
      expect(entry.getAttribute("title")).toBe(ui.T("filter_layer_tooltip"));
    });

    it("disables the Filter entry with the empty-state reason when the owner reports no field", () => {
      manager.registerLayer({
        id: "no-fields",
        name: "No Fields",
        role: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
        filterProvider: () => null,
        filterSetter: () => {},
      });
      const item = findItem(ui, "no-fields");

      ui.openMoreMenu(item);

      const entry = item.querySelector(
        `.foliplus-layer-more-menu button[data-action="${CONST.ACTION.FILTER_LAYER}"]`,
      ) as HTMLElement;
      expect(entry).not.toBeNull();
      expect(entry.getAttribute("aria-disabled")).toBe("true");
      expect(entry.getAttribute("title")).toBe(ui.T("filter_empty"));
    });

    it("disables the Filter entry when the layer is hidden", () => {
      manager.registerLayer({
        id: "hidden-layer",
        name: "Hidden Layer",
        role: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
        filterProvider: () => ({
          dimensions: [{ kind: "range", field: "mag", range: [0, 10], step: 1 }],
          kept: 0,
          total: 0,
        }),
        filterSetter: () => {},
      });
      const item = findItem(ui, "hidden-layer");
      const checkbox = item.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement | null;
      if (checkbox) checkbox.checked = false;
      ui.openMoreMenu(item);
      const entry = item.querySelector(
        `.foliplus-layer-more-menu button[data-action='${CONST.ACTION.FILTER_LAYER}']`,
      ) as HTMLElement | null;
      expect(entry).not.toBeNull();
      expect(entry?.getAttribute("aria-disabled")).toBe("true");
      expect(entry?.getAttribute("title")).toBe(ui.T("focus_hidden"));
    });

    it("Filter entry stays enabled when layer is visible and has fields", () => {
      manager.registerLayer({
        id: "visible-layer",
        name: "Visible Layer",
        role: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
        filterProvider: () => ({
          dimensions: [{ kind: "range", field: "mag", range: [0, 10], step: 1 }],
          kept: 0,
          total: 0,
        }),
        filterSetter: () => {},
      });
      const item = findItem(ui, "visible-layer");
      const checkbox = item.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement | null;
      if (checkbox) checkbox.checked = true;
      ui.openMoreMenu(item);
      const entry = item.querySelector(
        `.foliplus-layer-more-menu button[data-action='${CONST.ACTION.FILTER_LAYER}']`,
      ) as HTMLElement | null;
      expect(entry).not.toBeNull();
      expect(entry?.getAttribute("aria-disabled")).not.toBe("true");
    });

    it("creates a menu with the focus-layer action", () => {
      // A native <button> is focusable without tabindex — the item is no longer
      // a tabindex="0" li, so the attribute must be absent, not "0".
      const item = findItem(ui, "overlay1");

      ui.openMoreMenu(item);

      const li = item.querySelector(
        ".foliplus-layer-more-menu button[data-action='focus-layer']",
      );
      expect(li).not.toBeNull();
      expect(li?.getAttribute("role")).toBe("menuitem");
      expect(li?.getAttribute("tabindex")).toBeNull();
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

    it("stays open when focus returns to the row that owns the menu", () => {
      // The guard treats the owning row (and anything inside it) as "still
      // inside": focus moving from a menu entry back onto the row itself must
      // not dismiss, or the row's own focus state would close its menu.
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const menu = item.querySelector(".foliplus-layer-more-menu")! as HTMLElement;

      menu.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: item }),
      );

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
        `.foliplus-layer-more-menu button[data-action='layer-attributes']`,
      );
      expect(li).not.toBeNull();
      expect(li?.getAttribute("role")).toBe("menuitem");
      expect(li?.getAttribute("tabindex")).toBeNull();
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
      const second = menu.querySelectorAll("button")[1]! as HTMLElement;

      menu.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: second }),
      );

      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
      expect(ui.overlayPanel.activeMenu).not.toBeNull();
    });

    it("opens without crashing when the item has no data-layer-id", () => {
      const item = document.createElement("div");
      item.className = "foliplus-layer-item";
      attachedPanel(ui).appendChild(item);
      ui.openMoreMenu(item);
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
    });

    it("enables the Style entry for a layer with styleSetters but no label fields", () => {
      manager.registerLayer({
        id: "delegated1",
        name: "Heatmap",
        role: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
        styleSetters: { labelShow: vi.fn() },
      } as any);
      const item = findItem(ui, "delegated1");
      ui.openMoreMenu(item);
      const styleLi = item.querySelector(
        "button[data-action='style-layer']",
      ) as HTMLElement;
      expect(styleLi.getAttribute("aria-disabled")).not.toBe("true");
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
      const colorItem = attachedPanel(ui).querySelector(
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
      map.foliplus.showHint = hintSpy;

      li.click();

      expect(focusSpy).not.toHaveBeenCalled();
      expect(hintSpy).toHaveBeenCalledWith(
        "LayerControl",
        "LayerControl.focus_hidden",
        expect.any(Number),
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
      map.foliplus.showHint = hintSpy;

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

      ui.overlayPanel.activeMenu = null;

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
        (ui.overlayPanel as any).activeMenu = {
          ...((ui.overlayPanel as any).activeMenu ?? {}),
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

  // ─────────────────── rename ───────────────────

  describe("more button keyboard shortcut", () => {
    it("Enter on more button opens the menu instead of toggling the checkbox", () => {
      const btn = findItem(ui, "overlay1").querySelector(
        `.${CONST.CLASSES.MORE_BTN}`,
      ) as HTMLElement;
      const item = findItem(ui, "overlay1");

      // Spy on checkbox dispatchEvent to prove toggle wasn't triggered.
      const origDispatchEvent = HTMLInputElement.prototype.dispatchEvent;
      const toggleSpy = vi.fn();
      HTMLInputElement.prototype.dispatchEvent = function (...args: any[]) {
        const ev = args[0] as Event;
        if (ev.type === "change") toggleSpy();
        return origDispatchEvent.apply(this, args as [Event]);
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
      expect(menu!.querySelectorAll("button").length).toBeGreaterThan(0);
      ui.closeMoreMenu(false);
    });

    it("does not disable the style entry when the layer has styleSetters but no label fields", () => {
      // Set styleSetters on the layer info in the registry — styleDelegation
      // reads from ui.c.layerRegistry, not window.foliplus.styleDelegation.
      const li = manager.layerRegistry.get("overlay1");
      li!.styleSetters = { color: vi.fn() };

      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const styleLi = item.querySelector(
        ".foliplus-layer-more-menu button[data-action='style-layer']",
      ) as HTMLElement;
      expect(styleLi.getAttribute("aria-disabled")).not.toBe("true");
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
        label: "none",
        relocatable: false as any,
      };

      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const styleLi = item.querySelector(
        ".foliplus-layer-more-menu button[data-action='style-layer']",
      ) as HTMLElement;
      expect(styleLi.getAttribute("aria-disabled")).toBe("true");
      ui.closeMoreMenu(false);
    });

    it("stops an item press at the menu so it never becomes a map click", () => {
      // A press inside the control must not also reach the map. Leaflet decides
      // that by walking the event target's live parents for the control's
      // `_leaflet_disable_click` marker (`_isClickDisabled`). An item action can
      // close the menu — and the panel under it — mid-dispatch, which detaches
      // the pressed <li>; the walk then finds no control ancestor and the press
      // lands on the map (with a MeasureControl mode pending it drops a marker).
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const focusSpy = vi.fn();
      ui.focusLayer = focusSpy;
      const bubbled = vi.fn();
      item.addEventListener("click", bubbled);

      const li = item.querySelector(
        ".foliplus-layer-more-menu button[data-action='focus-layer']",
      ) as HTMLElement;
      li.click();

      // The action still ran — the press is swallowed, not ignored.
      expect(focusSpy).toHaveBeenCalledWith("overlay1");
      expect(bubbled).not.toHaveBeenCalled();
    });

    it("its registry entry reports no containment once the menu closes", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const menu = item.querySelector(".foliplus-layer-more-menu") as HTMLElement;
      const entry = ensureOverlayRegistry(map).owningEntry(menu);
      expect(entry?.id).toBe(OVERLAY_IDS.LAYER_MENU);
      expect(entry?.panels()).toEqual([menu]);

      ui.closeMoreMenu(false);

      // A late dispatch after the close asks the same closure, and it reads the
      // live state — containment must be empty, not a detached menu.
      expect(entry?.panels()).toEqual([]);
    });

    it("lets a press on the menu chrome bubble past the menu", () => {
      // Only an item press is swallowed; the guard must not swallow everything
      // the menu happens to contain (the registry still owes its own verdict).
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const bubbled = vi.fn();
      item.addEventListener("click", bubbled);

      const menu = item.querySelector(".foliplus-layer-more-menu") as HTMLElement;
      menu.click();

      expect(bubbled).toHaveBeenCalled();
    });
  });
  it("enables the style entry when exactly one of the nine style dimensions is on", () => {
    // The menu gate is the parity surface for the style projection: a row
    // can render a dimension the panel publishes, but if the menu's
    // `canConfigure` forgets it, the Style entry is disabled on a layer that
    // only supports that dimension. Each case turns exactly one dimension on
    // and asserts the entry stays enabled.
    const dimCase: Record<string, Record<string, string>> = {
      opacity: { opacity: "native" },
      zoomRange: { zoomRange: "native" },
      label: { label: "pane" },
      border: { stroke: "native" },
      size: { size: "native" },
      icon: { icon: "native" },
      fill: { fill: "native" },
      iconColor: { iconColor: "native" },
      markerColor: { markerColor: "native" },
    };
    const li = manager.layerRegistry.get("overlay1")!;
    li.styleSetters = undefined;
    const surface = ui.c.surfaceFor(li);
    const base: Record<string, unknown> = {
      fill: "none",
      stroke: "none",
      size: "none",
      icon: "none",
      iconColor: "none",
      markerColor: "none",
      opacity: "none",
      zoomRange: "none",
      visibility: "none",
      label: "none",
      relocatable: false,
      bounds: false,
    };
    const published = styleCapability(ui, "overlay1").dims;
    for (const dim of Object.keys(dimCase)) {
      (surface as unknown as { capabilities: Record<string, unknown> }).capabilities = {
        ...base,
        ...dimCase[dim],
      };
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const styleLi = item.querySelector(
        ".foliplus-layer-more-menu button[data-action='style-layer']",
      ) as HTMLElement;
      expect(
        styleLi.getAttribute("aria-disabled"),
        `dimension ${dim} alone must keep the Style entry enabled`,
      ).not.toBe("true");
      ui.closeMoreMenu(false);
    }
    // Parity guard: every dimension the projection publishes must have a
    // menu-gate case above, so a new dimension the gate forgets fails here
    // instead of silently producing a disabled entry.
    for (const dim of Object.keys(published)) {
      expect(dimCase, `dimension ${dim} has no menu-gate case`).toHaveProperty(dim);
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
      map.foliplus.showHint = hintSpy;
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
      map.foliplus.showHint = hintSpy;
      runMenuAction(ui, li, { explainDisabled: true });
      expect(hintSpy).toHaveBeenCalledWith(
        "LayerControl",
        "why-not",
        expect.any(Number),
      );
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
      map.foliplus.showHint = hintSpy;
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

const cssDir = repoPath("foliplus/css");
const read = (name: string): string => readFileSync(resolve(cssDir, name), "utf8");

const layerMenuCss = read("control/LayerControl/menu.css");
const sharedMenuCss = read("common/menu.css");

/** The declarations block that follows the first occurrence of `selector`. */
const blockOf = (css: string, selector: string): string => {
  const at = css.indexOf(selector);
  expect(at, `missing selector: ${selector}`).toBeGreaterThan(-1);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
};

describe("more-menu button styles", () => {
  it("resets the native button chrome through :where(), at zero specificity", () => {
    const rest = blockOf(layerMenuCss, ":where(.foliplus-layer-more-menu button) {");
    expect(rest).toContain("background: none");
    expect(rest).toContain("color: inherit");
  });

  it("keeps no plain-class reset that would beat the shared hover", () => {
    // The regression shape: a bare `.foliplus-layer-more-menu button {` block.
    // Its (0,2,1) reset outranks the shared hover and the items stop highlighting.
    expect(layerMenuCss).not.toMatch(/^\s*\.foliplus-layer-more-menu button \{/m);
  });

  it("lets the shared hover wash answer on the native buttons", () => {
    const hover = blockOf(
      sharedMenuCss,
      '.foliplus-layer-more-menu button:not([aria-disabled="true"]):hover {',
    );
    expect(hover).toContain("background: var(--foliplus-menu-row-hover-bg)");
    expect(hover).toContain("color: var(--foliplus-menu-row-hover-ink)");
  });

  it("keeps disabled entries muted on hover", () => {
    const disabled = blockOf(
      layerMenuCss,
      '.foliplus-layer-more-menu button[aria-disabled="true"]:hover {',
    );
    expect(disabled).toContain("background: transparent");
    expect(disabled).toContain("color: var(--foliplus-text-muted)");
  });
});

it("keeps the menu from stealing touch scroll (overscroll + touch-action)", () => {
  const menu = blockOf(sharedMenuCss, ".foliplus-search-result-panel,");
  expect(menu).toContain("overscroll-behavior: contain");
  expect(menu).toContain("touch-action: pan-y");
});

describe("disabled menu entries", () => {
  it("gives a disabled menu item a not-allowed cursor", () => {
    // The more-menu entries are native buttons, so their disabled state is
    // aria-disabled rather than a bare li[disabled].
    expect(sharedMenuCss).toMatch(
      /\.foliplus-layer-more-menu button\[aria-disabled="true"\]\s*\{[^}]*cursor:\s*not-allowed/,
    );
  });

  it("excludes disabled menu items from the shared hover", () => {
    expect(sharedMenuCss).toMatch(
      /\.foliplus-layer-more-menu button:not\(\[aria-disabled="true"\]\):hover/,
    );
  });

  it("rejects the pre-fix hover and disabled shape (negative control)", () => {
    expect(sharedMenuCss).not.toMatch(
      /:is\(\.foliplus-search-result-item, \.foliplus-layer-more-menu button\):hover/,
    );
    expect(sharedMenuCss).not.toMatch(/\.foliplus-layer-more-menu li\[disabled\]/);
  });
});

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
    (ui.overlayPanel as any).activeMenu = {
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
    (ui.overlayPanel as any).activeMenu = {
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
    (ui.overlayPanel as any).activeMenu = {
      item: document.createElement("div"),
      menu: document.createElement("div"),
      role: "",
    };
    for (const action of [CONST.ACTION.EXPAND_ALL, CONST.ACTION.COLLAPSE_ALL]) {
      const mi = document.createElement("button");
      mi.setAttribute("data-action", action);
      expect(() => runMenuAction(ui, mi)).not.toThrow();
    }
    (ui.overlayPanel as any).activeMenu = {
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
    (ui.overlayPanel as any).activeMenu = {
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
      (ui.overlayPanel as any).activeMenu = {
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
    (ui.overlayPanel as any).activeMenu = {
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
    (ui.overlayPanel as any).activeMenu = {
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
    (ui.overlayPanel as any).activeMenu = {
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
    (ui.overlayPanel as any).activeMenu = {
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
    (ui.overlayPanel as any).activeMenu = {
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

  // ─────────────────── container tooltip wording ───────────────────

  describe("container tooltip wording", () => {
    it("guides the user to expand the container before styling or filtering", () => {
      const read = (rel: string) => JSON.parse(readFileSync(repoPath(rel), "utf8"));
      const en = read("foliplus/locale/LayerControl.en.json");
      const zh = read("foliplus/locale/LayerControl.zh.json");
      expect(en["LayerControl.group_no_style_filter"]).toBe(
        "Style and filter are not supported on a layer group. Expand the group to style or filter its child layers.",
      );
      expect(zh["LayerControl.group_no_style_filter"]).toBe(
        "容器图层不支持样式/筛选，请展开后对子图层操作",
      );
    });
  });
});

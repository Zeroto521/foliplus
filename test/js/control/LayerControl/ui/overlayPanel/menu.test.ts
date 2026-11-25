// test/js/control/LayerControl/ui/style/menu — opening and closing the menu, visibility, keyboard and edge cases.
import { attachedPanel, findItem, initFixture } from "../fixture.js";
import { blockOf, layerMenuCss, sharedMenuCss } from "./menu.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureModes } from "#core/lifecycle/index.js";
import { OVERLAY_IDS, ensureOverlayRegistry } from "#core/overlay/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { seedIntentMap } from "#control/LayerControl/ui/intent.js";
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
});

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

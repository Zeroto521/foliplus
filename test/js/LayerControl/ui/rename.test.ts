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

describe("LayerUI rename", () => {
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

  describe("rename menu item / renameLayer()", () => {
    it("openMoreMenu includes a rename-layer menu item for an overlay layer", () => {
      const item = findItem(ui, "overlay1");

      ui.openMoreMenu(item);

      const li = item.querySelector(
        `.foliplus-layer-more-menu li[data-action="${CONST.ACTION.RENAME_LAYER}"]`,
      ) as HTMLElement | null;
      expect(li).not.toBeNull();
      expect(li?.getAttribute("role")).toBe("menuitem");
      expect(li?.getAttribute("disabled")).toBeNull();
    });

    it("openMoreMenu includes a rename-layer item for a base layer too", () => {
      const item = findItem(ui, "base1");

      ui.openMoreMenu(item);

      const li = item.querySelector(
        `.foliplus-layer-more-menu li[data-action="${CONST.ACTION.RENAME_LAYER}"]`,
      );
      expect(li).not.toBeNull();
    });

    it("rename-layer item is not disabled even when the layer is hidden", () => {
      const checkbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      if (checkbox) checkbox.checked = false;

      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const renameLi = item.querySelector(
        `.foliplus-layer-more-menu li[data-action="${CONST.ACTION.RENAME_LAYER}"]`,
      ) as HTMLElement | null;
      expect(renameLi?.getAttribute("disabled")).toBeNull();
      // (focus-layer item in the same menu IS disabled.)
      const focusLi = item.querySelector(
        `.foliplus-layer-more-menu li[data-action="${CONST.ACTION.FOCUS_LAYER}"]`,
      );
      expect(focusLi?.getAttribute("disabled")).toBe("disabled");
    });

    it("clicking rename-layer opens an inline input inside the label", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const li = item.querySelector(
        `.foliplus-layer-more-menu li[data-action="${CONST.ACTION.RENAME_LAYER}"]`,
      ) as HTMLElement;
      li.click();

      expect(ui.activeMenu).toBeNull();
      expect(ui.activeRenameId).toBe("overlay1");
      const label = item.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(input?.classList.contains(CONST.CLASSES.RENAME_INPUT)).toBe(true);
      expect(input?.value).toBe("Polygons");
    });

    it("Enter commits a new name and restores the label text", () => {
      const item = findItem(ui, "overlay1");
      ui.renameLayer("overlay1");
      expect(item.classList.contains(CONST.CLASSES.RENAMING)).toBe(true);

      const label = item.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement;

      input.value = "New Name";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(ui.activeRenameId).toBeNull();
      expect(label.textContent).toBe("New Name");
      expect(ui.renamedNames.overlay1).toBe("New Name");
      expect(item.classList.contains(CONST.CLASSES.RENAMING)).toBe(false);
    });

    it("blur commits the current value", () => {
      const item = findItem(ui, "overlay1");
      ui.renameLayer("overlay1");

      const label = item.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement;

      input.value = "Via Blur";
      input.dispatchEvent(new Event("blur"));

      expect(label.textContent).toBe("Via Blur");
      expect(ui.renamedNames.overlay1).toBe("Via Blur");
    });

    it("Escape cancels and restores the original label text", () => {
      // map.foliplus.showHint may be bound to the real HintManager on init;
      // spy on it to observe calls.
      const showHint = vi.spyOn(map.foliplus!, "showHint");
      const item = findItem(ui, "overlay1");
      ui.renameLayer("overlay1");

      const label = item.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement;

      input.value = "abandon";
      // Escape defers the teardown so the keydown can still bubble to the
      // panel handler that clears the row cursor. Enable fake timers before
      // dispatching so the deferred timer is under test control.
      vi.useFakeTimers();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      vi.runAllTimers();

      expect(ui.activeRenameId).toBeNull();
      expect(label.textContent).toBe("Polygons");
      expect(manager.layerRegistry.get("overlay1")!.name).toBe("Polygons");
      // Escape is an intentional abandon — no empty-name hint.
      expect(showHint).not.toHaveBeenCalled();
      showHint.mockRestore();
    });

    it("blur after the input is torn down does not re-commit", () => {
      const item = findItem(ui, "overlay1");
      ui.renameLayer("overlay1");

      const label = item.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement;

      // Escape tears the input down (finishRename removes it → triggers blur).
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      // Simulate the blur that removing the focused element fires.
      input.dispatchEvent(new Event("blur"));

      expect(ui.activeRenameId).toBeNull();
      expect(label.textContent).toBe("Polygons");
      expect(manager.layerRegistry.get("overlay1")!.name).toBe("Polygons");
    });

    it("committing an empty name is a no-op (label reverts, registry unchanged)", () => {
      const item = findItem(ui, "overlay1");
      ui.renameLayer("overlay1");

      const label = item.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement;

      input.value = "   ";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(label.textContent).toBe("Polygons");
      expect(manager.layerRegistry.get("overlay1")!.name).toBe("Polygons");
    });

    it("committing whitespace-only trims and updates the label", () => {
      const item = findItem(ui, "overlay1");
      ui.renameLayer("overlay1");

      const label = item.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement;

      input.value = "  Trimmed  ";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(label.textContent).toBe("Trimmed");
      expect(ui.renamedNames.overlay1).toBe("Trimmed");
    });

    it("committing an unchanged name does not write to renamedNames", () => {
      const item = findItem(ui, "overlay1");
      ui.renameLayer("overlay1");

      const label = item.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement;

      input.value = "Polygons"; // unchanged
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(ui.renamedNames["overlay1"]).toBeUndefined();
    });

    it("committing a changed name records it in renamedNames", () => {
      const item = findItem(ui, "overlay1");
      ui.renameLayer("overlay1");

      const label = item.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement;

      input.value = "Changed";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(ui.renamedNames["overlay1"]).toBe("Changed");
    });

    it("committing a rename updates the checkbox aria-label, not its tooltip", () => {
      const item = findItem(ui, "overlay1");
      ui.renameLayer("overlay1");

      const label = item.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement;
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      // The tooltip is the Select/Deselect affordance; a rename must not
      // occupy that slot.
      const tooltip = checkbox.title;
      expect(tooltip).not.toBe("");
      expect(tooltip).not.toBe("Renamed");

      input.value = "Renamed";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(checkbox.getAttribute("aria-label")).toBe("Renamed");
      expect(checkbox.title).toBe(tooltip);
    });

    it("renaming the color basemap updates the color input's aria-label too", () => {
      // The color row has no checkbox — its toggle is the type="color" input.
      // Both the label cell and the input must announce the rename, otherwise
      // assistive tech keeps reading the locale default after a rename.
      const item = findItem(ui, CONST.COLOR.MAP_ID);
      const colorInput = item.querySelector(`input[type="color"]`) as HTMLInputElement;
      // Capture the pre-rename value from the source of truth, not the DOM:
      // the aria-label and the label cell are both projections of
      // displayName(), so comparing them against each other would pass either
      // way — vacuously if neither propagated, and without ever observing a
      // rename at all.
      const before = ui.displayName(CONST.COLOR.MAP_ID);

      expect(colorInput.getAttribute("aria-label")).toBe(before);

      ui.renameLayer(CONST.COLOR.MAP_ID);
      const input = (item.querySelector("label") as HTMLLabelElement).querySelector(
        "input",
      ) as HTMLInputElement;
      input.value = "My Colour";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(item.querySelector("label")!.textContent).toBe("My Colour");
      expect(colorInput.getAttribute("aria-label")).toBe("My Colour");
      // The row tooltip is the TYPE label, a different slot from the name —
      // a rename must not move into it.
      const tooltip = item.getAttribute("title");
      expect(tooltip).not.toBe("My Colour");
      expect(tooltip).not.toBe("");
    });

    it("renameLayer(no-op) for an unknown layer id does nothing", () => {
      ui.renameLayer("no-such-layer");

      expect(ui.activeRenameId).toBeNull();
    });

    it("Enter on the rename-layer menu item calls renameLayer (not focusLayer)", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const li = item.querySelector(
        `.foliplus-layer-more-menu li[data-action="${CONST.ACTION.RENAME_LAYER}"]`,
      ) as HTMLElement;
      li.focus();
      expect(document.activeElement).toBe(li);

      const focusSpy = vi.fn();
      const renameSpy = vi.fn();
      ui.focusLayer = focusSpy;
      ui.renameLayer = renameSpy;

      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      ui.handleKeyDown(event as unknown as KeyboardEvent);

      expect(renameSpy).toHaveBeenCalledWith("overlay1");
      expect(focusSpy).not.toHaveBeenCalled();
      // Menu stays open — renameLayer opens an inline input, not a menu close.
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
    });

    it("Enter in the rename input does not bubble to the container handler (no toggle)", () => {
      // Ensure checkbox is checked so toggleFocusedLayer would flip it off.
      const item = findItem(ui, "overlay1");
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);

      ui.renameLayer("overlay1");

      const input = item.querySelector(
        `label input.${CONST.CLASSES.RENAME_INPUT}`,
      ) as HTMLInputElement;
      input.value = "New Name";

      const toggleSpy = vi.fn();
      ui.toggleFocusedLayer = toggleSpy;

      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );

      expect(ui.renamedNames["overlay1"]).toBe("New Name");
      expect(toggleSpy).not.toHaveBeenCalled();
      expect(checkbox.checked).toBe(true);
    });

    // ─────────── color basemap (outside layerRegistry) ───────────

    it("color layer more menu shows a disabled focus-layer item", () => {
      const colorItem = ui.uiContainer.querySelector(`${CONST.SEL.COLOR_ITEM}`)!;
      ui.openMoreMenu(colorItem);

      const focusLi = colorItem.querySelector(
        `.foliplus-layer-more-menu li[data-action="${CONST.ACTION.FOCUS_LAYER}"]`,
      ) as HTMLElement | null;
      const renameLi = colorItem.querySelector(
        `.foliplus-layer-more-menu li[data-action="${CONST.ACTION.RENAME_LAYER}"]`,
      );
      expect(focusLi).not.toBeNull();
      expect(focusLi?.getAttribute("disabled")).toBe("disabled");
      expect(renameLi).not.toBeNull();
    });

    it("renameLayer(COLOR.MAP_ID) opens an inline input seeded with the displayed name", () => {
      const colorItem = ui.uiContainer.querySelector(`${CONST.SEL.COLOR_ITEM}`)!;
      // Capture the label the UI already shows (locale "Solid Color") BEFORE
      // renaming — createInlineEditInput clears the label's text node.
      const displayed = colorItem.querySelector("label")!.textContent;
      ui.renameLayer(CONST.COLOR.MAP_ID);

      expect(ui.activeRenameId).toBe(CONST.COLOR.MAP_ID);
      const label = colorItem.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(input?.classList.contains(CONST.CLASSES.RENAME_INPUT)).toBe(true);
      // Default is the locale label, NOT the color hex (regression guard).
      expect(input?.value).toBe(displayed);
      expect(input?.value).not.toBe(ui.currentColor);
    });

    it("committing a color-layer rename persists to renamedNames (not the registry)", () => {
      const colorItem = ui.uiContainer.querySelector(`${CONST.SEL.COLOR_ITEM}`)!;
      ui.renameLayer(CONST.COLOR.MAP_ID);

      const label = colorItem.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement;
      input.value = "My Base";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(ui.activeRenameId).toBeNull();
      expect(label.textContent).toBe("My Base");
      expect(ui.renamedNames[CONST.COLOR.MAP_ID]).toBe("My Base");
      // The color basemap is not in the registry, so the registry should be
      // untouched.
      expect(manager.layerRegistry.get(CONST.COLOR.MAP_ID)).toBeUndefined();
    });

    it("applying a persisted rename restores the color-layer label text", () => {
      window.localStorage.setItem(
        CONST.STORAGE.NAMES_KEY,
        JSON.stringify({ [CONST.COLOR.MAP_ID]: "Custom Color" }),
      );
      ui.loadPersistedState();
      ui.applyUserState();

      const colorItem = ui.uiContainer.querySelector(`${CONST.SEL.COLOR_ITEM}`)!;
      expect(colorItem.querySelector("label")!.textContent).toBe("Custom Color");
      // The color input's aria-label and tooltip belong to the row builder:
      // the tooltip is the palette type label, and the aria-label stays the
      // color_map_label so the swatch is still announced as the basemap.
      const colorInput = colorItem.querySelector(
        'input[type="color"]',
      ) as HTMLInputElement;
      expect(colorInput.title).not.toBe("Custom Color");
    });

    it("keeps a renamed color basemap through a re-render (fold/reorder)", () => {
      ui.renameLayer(CONST.COLOR.MAP_ID);
      const firstLabel = ui.uiContainer.querySelector(`${CONST.SEL.COLOR_ITEM} label`)!;
      // The rename input lives inside the label; the first bare `input` in the
      // item is the color swatch, so scope to the label.
      const firstInput = firstLabel.querySelector("input") as HTMLInputElement;
      firstInput.value = "My Base";
      firstInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      expect(firstLabel.textContent).toBe("My Base");

      // Fold toggle / reorder rebuild the list via renderInitialList.
      ui.renderInitialList();

      const colorItem = ui.uiContainer.querySelector(`${CONST.SEL.COLOR_ITEM}`)!;
      expect(colorItem.querySelector("label")!.textContent).toBe("My Base");
      // The tooltip is the TYPE label, not the layer name — a rename must not
      // change it, and it survives a re-render.
      const tooltip = colorItem.getAttribute("title");
      expect(tooltip).not.toBe("My Base");
      expect(tooltip).not.toBeNull();
    });
  });

  // ─────────────────── rename persistence ───────────────────

  describe("rename persistence (loadPersistedState / saveNamesState / applyUserState)", () => {
    beforeEach(() => {
      window.localStorage.clear();
    });

    it("loadPersistedState reads renamed names from localStorage", () => {
      window.localStorage.setItem(
        CONST.STORAGE.NAMES_KEY,
        JSON.stringify({ overlay1: "Over1", base1: "Over2" }),
      );

      ui.loadPersistedState();

      expect(ui.renamedNames).toEqual({ overlay1: "Over1", base1: "Over2" });
    });

    it("applyUserState overwrites the registry name and the label text", () => {
      window.localStorage.setItem(
        CONST.STORAGE.NAMES_KEY,
        JSON.stringify({ overlay1: "Persisted Name" }),
      );

      ui.loadPersistedState();
      ui.applyUserState();

      const item = findItem(ui, "overlay1");
      expect(ui.renamedNames.overlay1).toBe("Persisted Name");
      // The sweep pushes the rename into the registry projection as well.
      expect(manager.layerRegistry.get("overlay1")?.name).toBe("Persisted Name");
      expect(item.querySelector("label")!.textContent).toBe("Persisted Name");
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox.getAttribute("aria-label")).toBe("Persisted Name");
      // The tooltip stays the Select/Deselect affordance, not the layer name.
      expect(checkbox.title).not.toBe("Persisted Name");
    });

    it("does not re-write a row that already holds the stored name", () => {
      window.localStorage.setItem(
        CONST.STORAGE.NAMES_KEY,
        JSON.stringify({ overlay1: "Persisted Name" }),
      );
      ui.loadPersistedState();
      ui.applyUserState();

      const item = findItem(ui, "overlay1");
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const setAttr = HTMLInputElement.prototype.setAttribute;
      let attrWrites = 0;
      vi.spyOn(checkbox, "setAttribute").mockImplementation(function (
        this: HTMLInputElement,
        ...args
      ) {
        attrWrites++;
        return setAttr.call(this, ...args);
      });

      try {
        ui.applyUserState();

        // Everything already matches, so nothing is re-written.
        expect(attrWrites).toBe(0);
        expect(manager.layerRegistry.get("overlay1")!.name).toBe("Persisted Name");
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("a targeted apply updates only that layer's registry entry", () => {
      window.localStorage.setItem(
        CONST.STORAGE.NAMES_KEY,
        JSON.stringify({ overlay1: "Renamed", base1: "Also Renamed" }),
      );
      ui.loadPersistedState();

      manager.layerRegistry.get("overlay1")!.name = "Renamed";
      ui.applyUserState("overlay1");

      expect(manager.layerRegistry.get("overlay1")!.name).toBe("Renamed");
      // The other layer was left alone — the targeted call must not sweep the
      // whole panel on every late registration.
      expect(manager.layerRegistry.get("base1")!.name).not.toBe("Also Renamed");
    });

    it("a targeted apply for an un-renamed id leaves the registry untouched", () => {
      // insertLayerItem calls applyUserState(id) for every late registration,
      // including layers the user never renamed. A missing rename must be a
      // no-op, not a write of undefined over the registry's own name.
      ui.renamedNames = {};

      const before = manager.layerRegistry.get("base1")!.name;
      const label = findItem(ui, "base1")!.querySelector("label")!;
      const labelBefore = label.textContent;

      ui.applyUserState("base1");

      expect(manager.layerRegistry.get("base1")!.name).toBe(before);
      expect(label.textContent).toBe(labelBefore);
    });

    it("tolerates corrupt / non-object / empty names storage", () => {
      // Reset the fixture label/registry to the pristine name — sibling tests
      // may have renamed this layer before this case runs.
      const label = findItem(ui, "overlay1").querySelector(
        "label",
      )! as HTMLLabelElement;
      const layerInfo = manager.layerRegistry.get("overlay1")!;
      const checkbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      layerInfo.name = "Polygons";
      label.textContent = "Polygons";
      checkbox.setAttribute("aria-label", "Polygons");
      checkbox.title = "Polygons";
      ui.renamedNames = {};

      window.localStorage.setItem(CONST.STORAGE.NAMES_KEY, "not-json");
      ui.loadPersistedState();
      expect(ui.renamedNames).toEqual({});

      window.localStorage.setItem(CONST.STORAGE.NAMES_KEY, "[]");
      ui.loadPersistedState();
      expect(ui.renamedNames).toEqual({});

      window.localStorage.setItem(CONST.STORAGE.NAMES_KEY, "null");
      ui.loadPersistedState();
      expect(ui.renamedNames).toEqual({});

      // The label must stay at the pristine name — no crash, no empty text.
      expect(label.textContent).toBe("Polygons");
      expect(layerInfo.name).toBe("Polygons");
    });

    it("saveNamesState persists a committed rename into localStorage", () => {
      const label = findItem(ui, "overlay1").querySelector("label") as HTMLLabelElement;
      ui.renameLayer("overlay1");
      const input = label.querySelector("input") as HTMLInputElement;

      vi.useFakeTimers();
      input.value = "Persisted";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      vi.advanceTimersByTime(CONST.SAVE_ORDER_DEBOUNCE_MS + 50);
      vi.useRealTimers();

      const stored = JSON.parse(window.localStorage.getItem(CONST.STORAGE.NAMES_KEY)!);
      expect(stored).toEqual({ overlay1: "Persisted" });
    });

    it("debounces rapid renames into a single localStorage write", () => {
      const originalStorage = window.localStorage;
      const setItem = vi.fn();
      Object.defineProperty(window, "localStorage", {
        value: {
          getItem: () => null,
          setItem,
          removeItem: vi.fn(),
          clear: () => setItem.mockReset(),
        },
        writable: true,
        configurable: true,
      });

      vi.useFakeTimers();
      const label = findItem(ui, "overlay1").querySelector("label") as HTMLLabelElement;

      ui.renameLayer("overlay1");
      let input = label.querySelector("input") as HTMLInputElement;
      input.value = "First";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      ui.renameLayer("overlay1");
      input = label.querySelector("input") as HTMLInputElement;
      input.value = "Second";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      ui.renameLayer("overlay1");
      input = label.querySelector("input") as HTMLInputElement;
      input.value = "Third";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(setItem).not.toHaveBeenCalled();
      vi.advanceTimersByTime(CONST.SAVE_ORDER_DEBOUNCE_MS + 50);

      const namesCall = setItem.mock.calls.find(
        (c: string[]) => c[0] === CONST.STORAGE.NAMES_KEY,
      );
      expect(namesCall).toBeDefined();
      expect(JSON.parse(namesCall![1])).toEqual({ overlay1: "Third" });

      vi.useRealTimers();
      Object.defineProperty(window, "localStorage", {
        value: originalStorage,
        writable: true,
        configurable: true,
      });
    });

    it("does NOT write to localStorage when the committed name is unchanged", () => {
      const originalStorage = window.localStorage;
      const setItem = vi.fn();
      Object.defineProperty(window, "localStorage", {
        value: {
          getItem: () => null,
          setItem,
          removeItem: vi.fn(),
          clear: () => setItem.mockReset(),
        },
        writable: true,
        configurable: true,
      });

      vi.useFakeTimers();
      const label = findItem(ui, "overlay1").querySelector("label") as HTMLLabelElement;

      ui.renameLayer("overlay1");
      const input = label.querySelector("input") as HTMLInputElement;
      input.value = "Polygons"; // unchanged
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      vi.advanceTimersByTime(CONST.SAVE_ORDER_DEBOUNCE_MS + 50);

      const namesCall = setItem.mock.calls.find(
        (c: string[]) => c[0] === CONST.STORAGE.NAMES_KEY,
      );
      expect(namesCall).toBeUndefined();

      vi.useRealTimers();
      Object.defineProperty(window, "localStorage", {
        value: originalStorage,
        writable: true,
        configurable: true,
      });
    });
  });

  // ─────────────────── keyboard on more button ───────────────────
});

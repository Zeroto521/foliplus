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

describe("LayerUI keyboard", () => {
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

  describe("Enter toggles the cursor row", () => {
    const toggleSpy = (ui: LayerUI) => {
      const orig = HTMLInputElement.prototype.dispatchEvent;
      const spy = vi.fn();
      HTMLInputElement.prototype.dispatchEvent = function (...args: any[]) {
        const ev = args[0] as Event;
        if (ev.type === "change") spy();
        return orig.apply(this, args);
      };
      return {
        spy,
        restore: () => {
          HTMLInputElement.prototype.dispatchEvent = orig;
        },
      };
    };

    it("Enter on the row checkbox toggles that layer's visibility", () => {
      const item = findItem(ui, "overlay1");
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const { spy, restore } = toggleSpy(ui);
      const before = checkbox.checked;

      checkbox.focus();
      ui.handleKeyDown(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
        }) as KeyboardEvent,
      );

      expect(spy).toHaveBeenCalledTimes(1);
      expect(checkbox.checked).toBe(!before);
      restore();
    });

    it("Enter on the row div toggles that row without native side effects", () => {
      // Row-level Enter is the keyboard contract: Space toggles a focused
      // checkbox natively, Enter must not double-fire it.
      const item = findItem(ui, "overlay1");
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const { spy, restore } = toggleSpy(ui);
      const before = checkbox.checked;

      item.focus();
      ui.handleKeyDown(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
        }) as KeyboardEvent,
      );

      expect(spy).toHaveBeenCalledTimes(1);
      expect(checkbox.checked).toBe(!before);
      restore();
    });

    it("a checkbox change hides the layer at that row's own index", () => {
      // The handler resolves the layer from `dataset.index`, not from the row,
      // so an unregistered layer's row is simply no longer toggleable here —
      // nothing is lost by the index lookup while the row is live.
      const cb = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      const idx = parseInt(cb.dataset.index ?? "", 10);
      expect(ui.m.layers[idx].id).toBe("overlay1");

      cb.checked = false;
      ui.handleChange({ target: cb } as Event);

      expect(ui.hiddenIds).toContain("overlay1");
      expect(ui.m.layers.length).toBe(3);
    });

    it("Enter on the more button still opens the menu and does not toggle", () => {
      const item = findItem(ui, "overlay1");
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const more = item.querySelector(`.${CONST.CLASSES.MORE_BTN}`)!;
      const { spy, restore } = toggleSpy(ui);
      const before = checkbox.checked;

      more.focus();
      ui.handleKeyDown(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
        }) as KeyboardEvent,
      );

      expect(spy).not.toHaveBeenCalled();
      expect(checkbox.checked).toBe(before);
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
      restore();
    });
  });

  // ─────────────────── Alt+Enter keyboard shortcut ───────────────────

  describe("ListCursor ARIA + roving tabindex", () => {
    it("tags the list and rows with listbox roles", () => {
      expect(ui.uiContainer.getAttribute("role")).toBe("listbox");
      const rows = ui.getNavigableItems();
      expect(rows.length).toBeGreaterThan(0);
      rows.forEach(r => {
        expect(r.getAttribute("role")).toBe("option");
        expect(r.id).toBeTruthy();
      });
    });

    it("exactly one row is a Tab stop", () => {
      // In-row checkbox / more / fold stay Tab-reachable (user-facing).
      // Roving only manages the row elements themselves.
      const rows = ui.getNavigableItems();
      const tabStops = rows.filter(r => r.tabIndex === 0);
      expect(tabStops).toHaveLength(1);
    });

    it("pointer click paints the cursor class and moves the Tab stop", () => {
      const rows = ui.getNavigableItems();
      const target = rows[1];
      const checkbox = target.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(target.tabIndex).toBe(0);
      expect(rows[0].tabIndex).toBe(-1);
      expect(target.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
    });
  });

  // ─────────────────── keyboard focus cursor visual class ───────────────────

  describe("keyboard focus cursor class (.foliplus-layer-focused)", () => {
    // getNavigableItems() enumerates row elements in DOM order: the "Toggle
    // All" row is index 0, then enforceOrder-sorted base/overlay layers. Look
    // up indices dynamically so a re-order doesn't silently break these tests.
    const indexFor = (id: string) => ui.getNavigableItems().indexOf(findItem(ui, id));

    it("setActiveItem adds the FOCUSED class to the target row", () => {
      const overlay = findItem(ui, "overlay1");
      const base = findItem(ui, "base1");

      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      expect(base.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      expect(ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSED}`)).toHaveLength(
        0,
      );

      ui.setActiveItem(indexFor("overlay1"));

      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
      expect(base.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      expect(ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSED}`)).toHaveLength(
        1,
      );
      expect(ui.activeIdx).toBe(indexFor("overlay1"));
    });

    it("moving the cursor removes FOCUSED from the previous row (mutual exclusivity)", () => {
      const overlay = findItem(ui, "overlay1");
      const base = findItem(ui, "base1");

      ui.setActiveItem(indexFor("overlay1"));
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
      expect(base.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);

      ui.setActiveItem(indexFor("base1"));
      expect(base.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      // Only ONE row carries the class at any time.
      expect(ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSED}`)).toHaveLength(
        1,
      );
      expect(ui.activeIdx).toBe(indexFor("base1"));
    });

    it("blurActiveItem removes the FOCUSED class from the current row", () => {
      const overlay = findItem(ui, "overlay1");

      ui.setActiveItem(indexFor("overlay1"));
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);

      ui.blurActiveItem();

      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      expect(ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSED}`)).toHaveLength(
        0,
      );
      // activeIdx is preserved by blurActiveItem — only the marker is lifted.
      expect(ui.activeIdx).toBe(indexFor("overlay1"));
    });

    it("clearActiveItem removes the FOCUSED class and resets activeIdx", () => {
      const overlay = findItem(ui, "overlay1");

      ui.setActiveItem(indexFor("overlay1"));
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
      expect(ui.activeIdx).toBe(indexFor("overlay1"));

      ui.clearActiveItem();

      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      expect(ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSED}`)).toHaveLength(
        0,
      );
      expect(ui.activeIdx).toBeNull();
    });

    it("Escape keydown clears the FOCUSED class", () => {
      const overlay = findItem(ui, "overlay1");

      ui.setActiveItem(indexFor("overlay1"));
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);

      const checkbox = overlay.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      checkbox.focus();

      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      });
      ui.handleKeyDown(event as unknown as KeyboardEvent);

      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      expect(ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSED}`)).toHaveLength(
        0,
      );
      // blur-only: the cursor index is deliberately kept so an ArrowUp/Down can
      // resume from this row instead of re-lighting it from DOM focus.
      expect(ui.activeIdx).toBe(indexFor("overlay1"));
      // DOM focus stays where the user was (Escape never blurs to <body>).
      // The recipe keys only on the JS class + :hover, so lifting the class is
      // enough — no residual selector to suppress.
      expect(document.activeElement).toBe(checkbox);
    });

    it("repeated checkbox clicks keep the row cursor visual on", () => {
      // Click is a cursor arrival: the visual stays until Escape / another
      // row / an outside press. (#278 only removed dblclick→focusLayer.)
      const overlay = findItem(ui, "overlay1");
      const checkbox = overlay.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;

      for (let i = 0; i < 3; i++) {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
      }
      expect(ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSED}`)).toHaveLength(
        1,
      );
      expect(ui.activeIdx).toBe(indexFor("overlay1"));
    });

    it("clicking another row hands the cursor visual over", () => {
      // Arrow-keys light row A. A pointer click on row B must move the class
      // — never leave A glowing while B is the target.
      const a = findItem(ui, "overlay1");
      const b = findItem(ui, "base1");
      const bBox = b.querySelector('input[type="checkbox"]') as HTMLInputElement;

      ui.setActiveItem(indexFor("overlay1"));
      expect(a.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);

      bBox.checked = !bBox.checked;
      bBox.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(a.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      expect(b.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
      expect(ui.activeIdx).toBe(indexFor("base1"));
    });

    it("label click paints the cursor; Escape lifts it", () => {
      const overlay = findItem(ui, "overlay1");

      const label = overlay.querySelector("label") as HTMLElement;
      label.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(ui.activeIdx).toBe(indexFor("overlay1"));
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);

      pressKey(overlay, "Escape");

      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      expect(ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSED}`)).toHaveLength(
        0,
      );
      expect(document.activeElement).toBe(overlay);
    });

    it("mousedown outside the panel drops the cursor through the shared dispatcher", () => {
      const overlay = findItem(ui, "overlay1");

      ui.setActiveItem(indexFor("overlay1"));
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);

      // A real press outside the panel — dispatched at document level so it
      // exercises the InteractionManager registration (observed mousedown),
      // not just the handler.
      const outside = document.createElement("div");
      document.body.appendChild(outside);
      outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      // Unlike Escape this is a full reset: the user has left the panel, so
      // the next ArrowDown re-bootstraps instead of resuming from this row.
      expect(ui.activeIdx).toBeNull();
      outside.remove();
    });

    it("mousedown inside the panel keeps the cursor", () => {
      const overlay = findItem(ui, "overlay1");

      // Production wraps the panel content in a `.foliplus-layer-ctrl` shell
      // (template.ts); the fixture's bare uiContainer lacks it, so mirror the
      // structure here or the outside test would read this press as outside.
      const shell = document.createElement("div");
      shell.className = "foliplus-layer-ctrl";
      ui.uiContainer.parentNode?.insertBefore(shell, ui.uiContainer);
      shell.appendChild(ui.uiContainer);

      ui.setActiveItem(indexFor("overlay1"));
      overlay.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
      expect(ui.activeIdx).toBe(indexFor("overlay1"));
      shell.replaceWith(ui.uiContainer);
    });

    it("Escape cancels an in-flight focusLayer overlay", () => {
      const overlay = findItem(ui, "overlay1");

      ui.focusLayer("overlay1");
      expect(ui.isFocusing()).toBe(true);
      expect(ui.focusMask).not.toBeNull();

      pressKey(overlay, "Escape");

      expect(ui.isFocusing()).toBe(false);
      expect(ui.focusMask).toBeNull();
      expect(
        ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSING}`),
      ).toHaveLength(0);
    });

    it("Escape drops the cursor and the next ArrowDown resumes from that row", () => {
      const overlay = findItem(ui, "overlay1");

      ui.setActiveItem(indexFor("overlay1"));
      pressKey(overlay, "Escape");
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);

      pressKey(overlay, "ArrowDown");

      // Resumed from the cancelled row rather than re-lighting it: the cursor
      // moves to the next row.
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      const focused = ui.uiContainer.querySelector(`.${CONST.CLASSES.FOCUSED}`);
      expect(focused).not.toBeNull();
      expect(focused).not.toBe(overlay);
    });

    it("Escape outside the panel leaves the focus overlay alone", () => {
      const overlay = findItem(ui, "overlay1");

      ui.focusLayer("overlay1");
      ui.setActiveItem(indexFor("overlay1"));
      const idxBefore = ui.activeIdx;

      const outside = document.createElement("button");
      document.body.appendChild(outside);
      // Moving focus off the row drops the visual class (focusout) — the same
      // way :focus-visible stopped matching under the old CSS trigger. The
      // keyboard cursor index is a separate contract and must survive.
      pressKey(outside, "Escape");

      expect(ui.isFocusing()).toBe(true);
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      expect(ui.activeIdx).toBe(idxBefore);
      outside.remove();
    });

    it("Escape closes the overflow menu and clears the cursor", () => {
      const overlay = findItem(ui, "overlay1");
      const menuBtn = overlay.querySelector(
        `.${CONST.CLASSES.MORE_BTN}`,
      ) as HTMLElement;

      ui.setActiveItem(indexFor("overlay1"));
      menuBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(ui.activeMenu).not.toBeNull();

      pressKey(overlay, "Escape");

      expect(ui.activeMenu).toBeNull();
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
    });

    it("Escape finishes an inline rename and clears the cursor", () => {
      // The cursor must be on the row before the rename opens, otherwise
      // finishRename() re-syncs the cursor off the row and Escape has no
      // target to cancel.
      const overlay = findItem(ui, "overlay1");
      pressKey(overlay, "ArrowDown");
      expect(ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSED}`)).toHaveLength(
        1,
      );

      ui.renameLayer("overlay1");
      expect(ui.activeRenameId).toBe("overlay1");

      const input = ui.uiContainer.querySelector(
        `.${CONST.CLASSES.RENAME_INPUT}`,
      ) as HTMLInputElement;
      expect(input).not.toBeNull();
      input.focus();
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Escape",
        }),
      );

      // The keydown bubbles to the panel handler, which clears the cursor and
      // returns focus to the row — so the cursor is already lifted by the time
      // dispatch returns.
      const row = ui.uiContainer.querySelector(
        `[${CONST.DATA.LAYER_ID}="${overlay.dataset.layerId}"]`,
      ) as HTMLElement;
      expect(row.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      expect(document.activeElement).toBe(row);

      // The input teardown is deferred so it cannot steal focus mid-dispatch
      // and hide the cursor. Flush it and confirm the rename is fully done.
      vi.useFakeTimers();
      vi.runAllTimers();
      expect(ui.activeRenameId).toBeNull();
      expect(ui.uiContainer.querySelector(`.${CONST.CLASSES.RENAME_INPUT}`)).toBeNull();
    });

    it("Escape on a checked row clears the cursor and keeps the active class", () => {
      const overlay = findItem(ui, "overlay1");

      // .active is the persistent selected state: it must outlive the Escape,
      // because cancelling the cursor is not a visibility change.
      const checkbox = overlay.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      checkbox.checked = true;
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(overlay.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);

      ui.setActiveItem(indexFor("overlay1"));
      checkbox.focus();
      pressKey(overlay, "Escape");

      expect(overlay.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
    });

    it("FOCUSED class coexists with .active (checkbox-checked) without conflict", () => {
      const overlay = findItem(ui, "overlay1");

      // Check the checkbox (adds .active via the toggle path) then set cursor
      // onto the same row — both classes must be present simultaneously so the
      // visual distinction between "checked" (5% wash) and "cursor-on" (8%
      // wash + accent bar) is preserved.
      const checkbox = overlay.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      checkbox.checked = true;
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(overlay.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);

      ui.setActiveItem(indexFor("overlay1"));

      expect(overlay.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
    });

    // ── focusin maps :focus-visible → the JS row class ──
    // jsdom does not implement :focus-visible (matches() throws), so the
    // production helper treats that as "not keyboard". These tests spy on
    // matches() to drive the mapping either way.

    const stubFocusVisible = (el: Element, value: boolean) => {
      const spy = vi.spyOn(el, "matches");
      spy.mockImplementation((selector: string) => {
        if (selector === ":focus-visible") return value;
        return Element.prototype.matches.call(el, selector);
      });
      return spy;
    };

    it("focusin on a child with :focus-visible lights the owning row", () => {
      const overlay = findItem(ui, "overlay1");
      const checkbox = overlay.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      const spy = stubFocusVisible(checkbox, true);

      checkbox.focus();
      checkbox.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
      spy.mockRestore();
    });

    it("focusin without :focus-visible does not light the row", () => {
      const overlay = findItem(ui, "overlay1");
      const checkbox = overlay.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      const spy = stubFocusVisible(checkbox, false);

      checkbox.focus();
      checkbox.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      spy.mockRestore();
    });

    it("keyboard focus on the more button lights its owning row", () => {
      const overlay = findItem(ui, "overlay1");
      const moreBtn = overlay.querySelector(
        `.${CONST.CLASSES.MORE_BTN}`,
      ) as HTMLElement;
      const spy = stubFocusVisible(moreBtn, true);

      moreBtn.focus();
      moreBtn.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
      spy.mockRestore();
    });

    it("keyboard focus on the fold button lights the toggle-all row", () => {
      const { foldBtn } = attachWithGroup(ui);
      const toggleAll = foldBtn.closest(CONST.SEL.TOGGLE_ALL) as HTMLElement;
      const spy = stubFocusVisible(foldBtn, true);

      foldBtn.focus();
      foldBtn.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

      expect(toggleAll.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
      spy.mockRestore();
    });

    it("Tab from one row to the next hands the cursor class over", () => {
      const from = findItem(ui, "overlay1");
      const to = findItem(ui, "base1");
      const toBox = to.querySelector('input[type="checkbox"]') as HTMLInputElement;

      const spyFrom = stubFocusVisible(
        from.querySelector('input[type="checkbox"]') as Element,
        true,
      );
      const spyTo = stubFocusVisible(toBox, true);

      const fromBox = from.querySelector('input[type="checkbox"]') as HTMLInputElement;
      fromBox.focus();
      fromBox.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      expect(from.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);

      fromBox.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: toBox }),
      );
      toBox.dispatchEvent(
        new FocusEvent("focusin", { bubbles: true, relatedTarget: fromBox }),
      );

      expect(from.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      expect(to.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
      expect(ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSED}`)).toHaveLength(
        1,
      );

      spyFrom.mockRestore();
      spyTo.mockRestore();
    });

    it("focusout off the row drops FOCUSED; moves within the row keep it", () => {
      const overlay = findItem(ui, "overlay1");
      const checkbox = overlay.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      const moreBtn = overlay.querySelector(
        `.${CONST.CLASSES.MORE_BTN}`,
      ) as HTMLElement;

      ui.setActiveItem(indexFor("overlay1"));
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);

      // Checkbox → more button: still inside the row.
      checkbox.focus();
      checkbox.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: moreBtn }),
      );
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);

      // Row → document body: leave entirely.
      checkbox.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }),
      );
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
    });

    it("Escape is complete without any residual suppress class", () => {
      const overlay = findItem(ui, "overlay1");
      const spy = stubFocusVisible(overlay, true);

      overlay.focus();
      overlay.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);

      pressKey(overlay, "Escape");

      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      // The whole FOCUS_SUPPRESSED mechanism is gone: cancel = one class off.
      expect(
        ui.uiContainer.querySelector(".foliplus-layer-focus-suppressed"),
      ).toBeNull();
      expect(document.activeElement).toBe(overlay);
      spy.mockRestore();
    });
  });

  // ─────────────────── fold group via keyboard ───────────────────

  describe("fold group via keyboard (chevron button)", () => {
    // The chevron button lives inside the toggle-all row, so focus on it
    // resolves up to that row. Enter/Space over it must fold the group —
    // not flip the row's select-all checkbox.
    //
    // The group needs two overlay layers so overlay1 isn't collapsed into the
    // single-child "no toggle-all" layout of initFixture(), and hiddenIds must
    // be empty so a visibility collapse can't read as a fold (the outer
    // beforeEach owns both).

    it("Enter on the chevron folds the group and hides its children", () => {
      const { foldBtn, children } = attachWithGroup(ui);
      expect(children()).toHaveLength(2);
      expect(allFolded(children())).toBe(false);

      pressKey(foldBtn, "Enter");

      expect(ui.foldedGroups.has(CONST.GROUP.OVERLAY)).toBe(true);
      expect(allFolded(children())).toBe(true);
    });

    it("fold click re-homes the FOCUSED cursor onto the toggle-all row", () => {
      attachWithGroup(ui);
      const foldBtn = overlayFoldBtn(ui.uiContainer);
      foldBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const lit = ui.uiContainer.querySelector(`.${CONST.CLASSES.FOCUSED}`);
      expect(lit).not.toBeNull();
      expect(lit!.classList.contains(CONST.CLASSES.TOGGLE_ALL)).toBe(true);
    });

    it("Space folds too, and Enter again unfolds", () => {
      const { children } = attachWithGroup(ui);
      // The chevron is a real focusable button, so dispatch the key there.
      pressKey(overlayFoldBtn(ui.uiContainer), " ");
      expect(ui.foldedGroups.has(CONST.GROUP.OVERLAY)).toBe(true);
      expect(allFolded(children())).toBe(true);
      // Fold rebuilds the panel, so re-fetch the button on the rebuilt row.
      pressKey(overlayFoldBtn(ui.uiContainer), "Enter");

      expect(ui.foldedGroups.has(CONST.GROUP.OVERLAY)).toBe(false);
      expect(allFolded(children())).toBe(false);
    });

    it("Enter on the chevron does NOT flip the select-all checkbox", () => {
      const { foldBtn, children } = attachWithGroup(ui);
      const childBoxes = () =>
        children()
          .map(el => el.querySelector('input[type="checkbox"]'))
          .filter(Boolean) as HTMLInputElement[];

      const allChecked = () => childBoxes().every(cb => cb.checked);
      expect(allChecked()).toBe(true);

      pressKey(foldBtn, "Enter");
      expect(allFolded(children())).toBe(true);

      // Unfold again and confirm nothing was deselected.
      pressKey(overlayFoldBtn(ui.uiContainer), "Enter");
      expect(children()).toHaveLength(2);
      expect(allChecked()).toBe(true);
    });

    it("Enter on the toggle-all row itself still selects/deselects the group", () => {
      const { row, children } = attachWithGroup(ui);
      const childBoxes = () =>
        children()
          .map(el => el.querySelector('input[type="checkbox"]'))
          .filter(Boolean) as HTMLInputElement[];

      pressKey(row, "Enter");

      // Enter on the row itself toggles visibility, not the fold.
      expect(row.classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(false);
      expect(allFolded(children())).toBe(false);
      expect(children()).toHaveLength(2);
      expect(childBoxes().some(cb => !cb.checked)).toBe(true);
    });

    it("getNavigableItems lists rows by class, so a checkbox-less row is reachable", () => {
      const colorRow = ui.uiContainer.querySelector(
        `.${CONST.CLASSES.COLOR_ITEM}`,
      ) as HTMLElement | null;

      const items = ui.getNavigableItems();
      // The color row is a picker, not a layer, so it stays out of the list.
      if (colorRow) expect(items).not.toContain(colorRow);
      // Rows are enumerated by class, never filtered by checkbox presence.
      const isRow = (el: HTMLElement) =>
        el.classList.contains(CONST.CLASSES.LAYER_ITEM) ||
        el.classList.contains(CONST.CLASSES.TOGGLE_ALL);
      expect(items.every(isRow)).toBe(true);
      expect(items.filter(isRow)).toHaveLength(items.length);

      // Simulate the divergence that made Tab and arrow keys disagree: a row
      // the old checkbox-first enumeration silently dropped.
      const bareRow = document.createElement("div");
      bareRow.className = CONST.CLASSES.LAYER_ITEM;
      bareRow.setAttribute(CONST.DATA.LAYER_ID, "no-checkbox");
      ui.uiContainer.appendChild(bareRow);

      expect(ui.getNavigableItems()).toContain(bareRow);
    });
  });

  // ─────────────────── auto-cancel on map move/zoom ───────────────────
});

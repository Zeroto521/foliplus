import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HINT_DURATION } from "#core/hint.js";
import { GROUP } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerController } from "#foliplus/LayerControl/controller.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { getIntent, seedIntentMap } from "#foliplus/LayerControl/ui/intent.js";
import {
  cursorRef,
  findVisibleNeighbor,
  getActiveLayerItem,
  moveActiveMarker,
  resolveActiveIdx,
  restoreCursor,
  syncActiveItem,
  syncListCursor,
} from "#foliplus/LayerControl/ui/listPanel/keyboard.js";
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

  describe("Enter toggles the cursor row", () => {
    const toggleSpy = () => {
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
      const { spy, restore } = toggleSpy();
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
      const { spy, restore } = toggleSpy();
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

    it("a checkbox change hides the layer its row owns", () => {
      // The handler resolves the layer by the row's data-layer-id, so a
      // late registration can sit anywhere in the DOM without changing which
      // layer the click toggles.
      const cb = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;

      cb.checked = false;
      ui.handleChange({ target: cb } as Event);

      expect(getIntent(ui, "overlay1", "visible")).toBe(false);
      // 3 seeded layers + the colour basemap registered by initTypesAndVisibility.
      expect(ui.c.layers.length).toBe(4);
    });

    it("Enter on the more button still opens the menu and does not toggle", () => {
      const item = findItem(ui, "overlay1");
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const more = item.querySelector(`.${CONST.CLASSES.MORE_BTN}`)!;
      const { spy, restore } = toggleSpy();
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

  describe("keyboard focus cursor class (.foliplus-is-focused-row)", () => {
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
      expect(ui.listPanel.activeIdx).toBe(indexFor("overlay1"));
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
      expect(ui.listPanel.activeIdx).toBe(indexFor("base1"));
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
      expect(ui.listPanel.activeIdx).toBe(indexFor("overlay1"));
    });

    it("clearActiveItem removes the FOCUSED class and resets activeIdx", () => {
      const overlay = findItem(ui, "overlay1");

      ui.setActiveItem(indexFor("overlay1"));
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
      expect(ui.listPanel.activeIdx).toBe(indexFor("overlay1"));

      ui.clearActiveItem();

      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      expect(ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSED}`)).toHaveLength(
        0,
      );
      expect(ui.listPanel.activeIdx).toBeNull();
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
      expect(ui.listPanel.activeIdx).toBe(indexFor("overlay1"));
      // DOM focus stays where the user was (Escape never blurs to <body>).
      // The recipe keys only on the JS class + :hover, so lifting the class is
      // enough — no residual selector to suppress.
      expect(document.activeElement).toBe(checkbox);
    });

    it("repeated checkbox clicks keep the row cursor visual on", () => {
      // Click is a cursor arrival: the visual stays until Escape / another
      // row / an outside press. (#278 only removed dblclick → focusLayer.)
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
      expect(ui.listPanel.activeIdx).toBe(indexFor("overlay1"));
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
      expect(ui.listPanel.activeIdx).toBe(indexFor("base1"));
    });

    it("label click paints the cursor; Escape lifts it", () => {
      const overlay = findItem(ui, "overlay1");

      const label = overlay.querySelector("label") as HTMLElement;
      label.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(ui.listPanel.activeIdx).toBe(indexFor("overlay1"));
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
      expect(ui.listPanel.activeIdx).toBeNull();
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
      expect(ui.listPanel.activeIdx).toBe(indexFor("overlay1"));
      shell.replaceWith(ui.uiContainer);
    });

    it("Escape cancels an in-flight focusLayer overlay", () => {
      const overlay = findItem(ui, "overlay1");

      ui.focusLayer("overlay1");
      expect(ui.isFocusing()).toBe(true);
      expect(ui.focusController.focusMask).not.toBeNull();

      pressKey(overlay, "Escape");

      expect(ui.isFocusing()).toBe(false);
      expect(ui.focusController.focusMask).toBeNull();
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
      const idxBefore = ui.listPanel.activeIdx;

      const outside = document.createElement("button");
      document.body.appendChild(outside);
      // Moving focus off the row drops the visual class (focusout) — the same
      // way :focus-visible stopped matching under the old CSS trigger. The
      // keyboard cursor index is a separate contract and must survive.
      pressKey(outside, "Escape");

      expect(ui.isFocusing()).toBe(true);
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      expect(ui.listPanel.activeIdx).toBe(idxBefore);
      outside.remove();
    });

    it("Escape closes the overflow menu and clears the cursor", () => {
      const overlay = findItem(ui, "overlay1");
      const menuBtn = overlay.querySelector(
        `.${CONST.CLASSES.MORE_BTN}`,
      ) as HTMLElement;

      ui.setActiveItem(indexFor("overlay1"));
      menuBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(ui.overlayPanel.activeMenu).not.toBeNull();

      pressKey(overlay, "Escape");

      expect(ui.overlayPanel.activeMenu).toBeNull();
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
      expect(ui.overlayPanel.activeRenameId).toBe("overlay1");

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
      expect(ui.overlayPanel.activeRenameId).toBeNull();
      expect(ui.uiContainer.querySelector(`.${CONST.CLASSES.RENAME_INPUT}`)).toBeNull();
    });

    it("Escape on a checked row clears the cursor and keeps the active class", () => {
      const overlay = findItem(ui, "overlay1");

      // .foliplus-active is the persistent selected state: it must outlive the Escape,
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

    it("FOCUSED class coexists with .foliplus-active (checkbox-checked) without conflict", () => {
      const overlay = findItem(ui, "overlay1");

      // Check the checkbox (adds .foliplus-active via the toggle path) then set cursor
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

    it("focusin on a non-row target inside the container is a no-op", () => {
      // owningRow() is null for chrome that sits beside the rows (panel
      // padding, group headings). The early return must not throw or paint.
      const stray = document.createElement("div");
      ui.uiContainer.appendChild(stray);

      stray.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

      expect(ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSED}`)).toHaveLength(
        0,
      );
      stray.remove();
    });

    it("focusout into a floating panel keeps the row cursor", () => {
      // The PR's onFocusOut guard: a relatedTarget inside a style/attrs panel
      // is a detail task on the same row, not an abandon — even when the panel
      // element is not a DOM descendant of the row that lost focus.
      const overlay = findItem(ui, "overlay1");
      const checkbox = overlay.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      ui.setActiveItem(indexFor("overlay1"));
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);

      const detachedPanel = document.createElement("div");
      detachedPanel.className = CONST.CLASSES.STYLE_PANEL;
      const panelControl = document.createElement("button");
      detachedPanel.appendChild(panelControl);
      document.body.appendChild(detachedPanel);

      checkbox.dispatchEvent(
        new FocusEvent("focusout", {
          bubbles: true,
          relatedTarget: panelControl,
        }),
      );

      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);

      detachedPanel.remove();
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
    // single-child "no toggle-all" layout of initFixture(), and intents.visible must
    // be empty so a visibility collapse can't read as a fold (the outer
    // beforeEach owns both).

    it("Enter on the chevron folds the group and hides its children", () => {
      const { foldBtn, children } = attachWithGroup(ui);
      expect(children()).toHaveLength(2);
      expect(allFolded(children())).toBe(false);

      pressKey(foldBtn, "Enter");

      expect(ui.listPanel.foldedGroups.has(GROUP.OVERLAY)).toBe(true);
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
      expect(ui.listPanel.foldedGroups.has(GROUP.OVERLAY)).toBe(true);
      expect(allFolded(children())).toBe(true);
      // Fold rebuilds the panel, so re-fetch the button on the rebuilt row.
      pressKey(overlayFoldBtn(ui.uiContainer), "Enter");

      expect(ui.listPanel.foldedGroups.has(GROUP.OVERLAY)).toBe(false);
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
        `[${CONST.DATA.LAYER_ID}="${CONST.SOLID_BASEMAP_ID}"]`,
      ) as HTMLElement | null;

      const items = ui.getNavigableItems();
      // The color row is a regular layer row now — it is navigable.
      if (colorRow) expect(items).toContain(colorRow);
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

  describe("Ctrl+Arrow reorder boundary hints", () => {
    const ctrlArrow = (el: HTMLElement, key: "ArrowUp" | "ArrowDown") =>
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );

    it("hints when the top overlay layer cannot move up", () => {
      // ensureEvents() wipes map.foliplus.showHint; re-attach a spy.
      const hintSpy = vi.fn();
      map.foliplus.showHint = hintSpy;
      const overlay = findItem(ui, "overlay1");
      pressKey(overlay, "ArrowDown"); // establish the keyboard cursor
      ctrlArrow(overlay, "ArrowUp");

      expect(hintSpy).toHaveBeenCalledWith(
        "LayerControl",
        expect.stringContaining("reorder_top"),
        HINT_DURATION.SHORT,
      );
    });

    it("hints when the last overlay layer cannot move down", () => {
      const hintSpy = vi.fn();
      map.foliplus.showHint = hintSpy;
      const overlay = findItem(ui, "overlay2");
      pressKey(overlay, "ArrowDown");
      ctrlArrow(overlay, "ArrowDown");

      expect(hintSpy).toHaveBeenCalledWith(
        "LayerControl",
        expect.stringContaining("reorder_bottom"),
        HINT_DURATION.SHORT,
      );
    });
  });

  describe("onItemKeydown guard branches", () => {
    const keyEvent = (
      key: string,
      opts: {
        ctrlKey?: boolean;
        shiftKey?: boolean;
        metaKey?: boolean;
        altKey?: boolean;
      } = {},
    ) =>
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...opts,
      }) as KeyboardEvent;

    it("Escape lifts the cursor marker but preserves the index for arrow resume", () => {
      const item = findItem(ui, "overlay1");
      ui.setActiveItem(ui.getNavigableItems().indexOf(item));
      const idx = ui.listPanel.activeIdx;
      expect(item.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);

      ui.handleKeyDown(keyEvent("Escape"));

      expect(ui.listPanel.activeIdx).toBe(idx);
      expect(item.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
    });

    it("Enter on a checkbox inside an active row toggles visibility and keeps the cursor", () => {
      const item = findItem(ui, "overlay1");
      ui.setActiveItem(ui.getNavigableItems().indexOf(item));
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const before = checkbox.checked;

      checkbox.focus();
      ui.handleKeyDown(keyEvent("Enter"));

      expect(checkbox.checked).toBe(!before);
      expect(ui.listPanel.activeIdx).toBe(ui.getNavigableItems().indexOf(item));
    });

    it("Enter on a focused layer row toggles visibility through the row branch", () => {
      const item = findItem(ui, "overlay1");
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const before = checkbox.checked;

      item.focus();
      ui.handleKeyDown(keyEvent("Enter"));

      expect(checkbox.checked).toBe(!before);
    });

    it("Enter/Escape on the more button open and close the menu instead of the row path", () => {
      const item = findItem(ui, "overlay1");
      const more = item.querySelector(`.${CONST.CLASSES.MORE_BTN}`)!;

      more.focus();
      ui.handleKeyDown(keyEvent("Enter"));
      expect(ui.overlayPanel.activeMenu).not.toBeNull();
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);

      ui.handleKeyDown(keyEvent("Escape"));
      expect(ui.overlayPanel.activeMenu).toBeNull();
    });
  });

  describe("form controls inside floating panels", () => {
    // Arrow keys on a range slider inside the style panel must not move the
    // row keyboard cursor. The native slider behavior is more useful than
    // jumping to the next layer row.

    beforeEach(() => {
      // Seed the field cache so the style panel builds (same recipe as style.test.ts).
      ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
    });

    it("ArrowDown on a range slider does not move the cursor or preventDefault", () => {
      const item = findItem(ui, "overlay1");
      ui.openStylePanel("overlay1");
      const panel = item.querySelector(`.${CONST.CLASSES.STYLE_PANEL}`)!;
      const slider = panel.querySelector(
        `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MIN}`,
      ) as HTMLInputElement;

      slider.focus();
      const event = new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      });
      slider.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(ui.listPanel.activeIdx).toBeNull();
    });

    it("ArrowUp on a range slider does not move the cursor or preventDefault", () => {
      const item = findItem(ui, "overlay1");
      ui.openStylePanel("overlay1");
      const panel = item.querySelector(`.${CONST.CLASSES.STYLE_PANEL}`)!;
      const slider = panel.querySelector(
        `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MAX}`,
      ) as HTMLInputElement;

      slider.focus();
      const event = new KeyboardEvent("keydown", {
        key: "ArrowUp",
        bubbles: true,
        cancelable: true,
      });
      slider.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(ui.listPanel.activeIdx).toBeNull();
    });

    it("ArrowDown on a range slider does not move the cursor after a row was clicked first", () => {
      // "Click row → focus style-panel slider → press ArrowDown" must not
      // fall through to any list-cursor path, whether via the central
      // dispatcher or a direct keydown listener on the panel. This is the
      // combined scenario the standalone ListCursor guard protects against.
      const indexFor = (id: string) => ui.getNavigableItems().indexOf(findItem(ui, id));
      const item = findItem(ui, "overlay1");
      ui.setActiveItem(indexFor("overlay1"));
      const rowIdx = ui.listPanel.activeIdx;
      expect(ui.listPanel.listCursor?.index).toBe(rowIdx);
      expect(rowIdx).not.toBeNull();

      ui.openStylePanel("overlay1");
      const panel = item.querySelector(`.${CONST.CLASSES.STYLE_PANEL}`)!;
      const slider = panel.querySelector(
        `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MIN}`,
      ) as HTMLInputElement;

      slider.focus();
      const event = new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      });
      slider.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(ui.listPanel.activeIdx).toBe(rowIdx);
      expect(ui.listPanel.listCursor?.index).toBe(rowIdx);
    });

    it("Escape on a range slider still closes the style panel", () => {
      const item = findItem(ui, "overlay1");
      ui.openStylePanel("overlay1");
      expect(ui.overlayPanel.stylePanelLayerId).toBe("overlay1");

      const panel = item.querySelector(`.${CONST.CLASSES.STYLE_PANEL}`)!;
      const slider = panel.querySelector(
        `.${CONST.CLASSES.STYLE_ZOOM_RANGE_MIN}`,
      ) as HTMLInputElement;

      slider.focus();
      slider.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );

      expect(ui.overlayPanel.stylePanelLayerId).toBeNull();
    });

    it("Escape on a checkbox inside a focused row lifts the cursor marker", () => {
      const item = findItem(ui, "overlay1");
      ui.setActiveItem(ui.getNavigableItems().indexOf(item));
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const idx = ui.listPanel.activeIdx;

      checkbox.focus();
      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });
      ui.handleKeyDown(event as unknown as KeyboardEvent);

      expect(ui.listPanel.activeIdx).toBe(idx);
      expect(item.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
    });

    it("Enter on a checkbox inside a focused row toggles visibility instead of toggling", () => {
      const item = findItem(ui, "overlay1");
      ui.setActiveItem(ui.getNavigableItems().indexOf(item));
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const before = checkbox.checked;

      checkbox.focus();
      checkbox.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );

      expect(checkbox.checked).toBe(!before);
      expect(ui.listPanel.activeIdx).toBe(ui.getNavigableItems().indexOf(item));
    });

    it("Enter on a focused layer row toggles visibility", () => {
      const item = findItem(ui, "overlay1");
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const before = checkbox.checked;

      item.focus();
      item.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );

      expect(checkbox.checked).toBe(!before);
    });
  });

  describe("defensive branches", () => {
    const indexFor = (id: string) => ui.getNavigableItems().indexOf(findItem(ui, id));
    const keyEvent = (
      key: string,
      opts: {
        ctrlKey?: boolean;
        shiftKey?: boolean;
        metaKey?: boolean;
        altKey?: boolean;
      } = {},
    ) =>
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...opts,
      });

    it("setActiveItem with an out-of-range index clears the cursor", () => {
      ui.setActiveItem(-1);
      expect(ui.listPanel.activeIdx).toBeNull();
      expect(ui.uiContainer.querySelector(`.${CONST.CLASSES.FOCUSED}`)).toBeNull();
    });

    it("ArrowUp moves the cursor to the previous visible row", () => {
      const overlay = findItem(ui, "overlay1");
      ui.setActiveItem(indexFor("overlay1"));
      const before = ui.listPanel.activeIdx;
      pressKey(overlay, "ArrowUp");
      expect(ui.listPanel.activeIdx).toBe((before as number) - 1);
    });

    it("folded rows are skipped when finding a visible neighbour", () => {
      // Fold the overlay group; every overlay row is hidden, so an ArrowUp
      // from below cannot land on one and the neighbour search returns the
      // toggle-all header instead.
      ui.listPanel.foldedGroups = new Set([GROUP.OVERLAY]);
      const base = findItem(ui, "base1");
      ui.setActiveItem(indexFor("base1"));
      pressKey(base, "ArrowUp");
      const focused = ui.uiContainer.querySelector(`.${CONST.CLASSES.FOCUSED}`);
      expect(focused).not.toBeNull();
    });

    it("neighbour search returns -1 past the first and last navigable row", () => {
      const items = ui.getNavigableItems();
      expect(items.length).toBeGreaterThanOrEqual(2);
      expect(findVisibleNeighbor(items, items.length - 1, 1)).toBe(-1);
      expect(findVisibleNeighbor(items, 0, -1)).toBe(-1);
    });

    it("restoreCursor re-homes a folded group row onto its toggle-all row", () => {
      attachWithGroup(ui);
      ui.listPanel.foldedGroups = new Set([GROUP.OVERLAY]);
      ui.uiContainer
        .querySelectorAll<HTMLElement>(
          `${CONST.SEL.LAYER_ITEM}[data-layer-type="${GROUP.OVERLAY}"]`,
        )
        .forEach(el => el.classList.add(CONST.CLASSES.GROUP_FOLDED));

      restoreCursor(ui, "overlay1");

      const lit = ui.uiContainer.querySelector(`.${CONST.CLASSES.FOCUSED}`);
      expect(lit?.classList.contains(CONST.CLASSES.TOGGLE_ALL)).toBe(true);
      expect(ui.listPanel.activeIdx).toBe(
        ui.getNavigableItems().indexOf(lit as HTMLElement),
      );
    });

    it("restoreCursor clears the cursor when the ref matches no row", () => {
      ui.setActiveItem(0);
      restoreCursor(ui, "ghost-layer");
      expect(ui.listPanel.activeIdx).toBeNull();
      expect(ui.uiContainer.querySelector(`.${CONST.CLASSES.FOCUSED}`)).toBeNull();
    });

    it("resolveActiveIdx falls back to the stored cursor when no row holds focus", () => {
      ui.setActiveItem(1);
      (document.activeElement as HTMLElement | null)?.blur?.();
      expect(resolveActiveIdx(ui, ui.getNavigableItems())).toBe(1);
    });

    it("resolveActiveIdx ignores a focused row that is not navigable", () => {
      const before = ui.listPanel.activeIdx;
      const detached = document.createElement("div");
      detached.className = CONST.CLASSES.LAYER_ITEM;
      document.body.appendChild(detached);
      detached.focus();
      // owningRow() resolves the detached row, but getNavigableItems() only
      // enumerates rows inside uiContainer — the index is -1 and the stored
      // cursor must survive.
      expect(resolveActiveIdx(ui, ui.getNavigableItems())).toBe(before);
      document.body.removeChild(detached);
    });

    it("syncListCursor reuses an existing cursor instance", () => {
      syncListCursor(ui);
      const cursor = ui.listPanel.listCursor;
      expect(cursor).not.toBeNull();
      syncListCursor(ui);
      expect(ui.listPanel.listCursor).toBe(cursor);
    });

    it("moveActiveMarker clears the cursor when given no item", () => {
      ui.setActiveItem(1);
      moveActiveMarker(ui, null, ui.getNavigableItems());
      expect(ui.listPanel.activeIdx).toBeNull();
    });

    it("getActiveLayerItem resolves the row at the cursor index", () => {
      ui.setActiveItem(0);
      const item = getActiveLayerItem(ui);
      expect(item).toBe(ui.getNavigableItems()[0]);
    });

    it("getActiveLayerItem returns null without a cursor", () => {
      expect(ui.listPanel.activeIdx).toBeNull();
      expect(getActiveLayerItem(ui)).toBeNull();
    });

    it("cursorRef normalizes an out-of-range cursor to null", () => {
      ui.listPanel.activeIdx = 999;
      expect(cursorRef(ui)).toBeNull();
    });

    it("getActiveLayerItem returns null for a stale out-of-range cursor", () => {
      // setActiveItem guards its own index, but a fold can shrink the list
      // under a stored cursor — the accessor must degrade to null.
      ui.listPanel.activeIdx = 999;
      expect(getActiveLayerItem(ui)).toBeNull();
    });

    it("neighbour search exhausts when every row is folded", () => {
      const items = ui.getNavigableItems();
      items.forEach(el => el.classList.add(CONST.CLASSES.GROUP_FOLDED));
      expect(findVisibleNeighbor(items, 0, 1)).toBe(-1);
      expect(findVisibleNeighbor(items, items.length - 1, -1)).toBe(-1);
    });

    it("syncActiveItem no-ops when no row holds focus and no cursor is stored", () => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      expect(() => syncActiveItem(ui)).not.toThrow();
      expect(ui.listPanel.activeIdx).toBeNull();
    });

    it("moveActiveMarker normalizes an out-of-list item to a cleared cursor", () => {
      const detached = document.createElement("div");
      detached.className = CONST.CLASSES.LAYER_ITEM;
      moveActiveMarker(ui, detached, ui.getNavigableItems());
      expect(ui.listPanel.activeIdx).toBeNull();
      expect(ui.uiContainer.querySelector(`.${CONST.CLASSES.FOCUSED}`)).toBeNull();
    });

    it("handleKeyDown no-ops when the list has no navigable rows", () => {
      ui.uiContainer.innerHTML = "";
      expect(() => ui.handleKeyDown(keyEvent("ArrowDown"))).not.toThrow();
    });

    it("handleKeyDown no-ops when no row holds focus and no cursor is stored", () => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      expect(() => ui.handleKeyDown(keyEvent("ArrowDown"))).not.toThrow();
      expect(ui.listPanel.activeIdx).toBeNull();
    });

    it("Ctrl+ArrowUp over the top row shows the reorder hint", () => {
      const item = findItem(ui, "base1");
      ui.setActiveItem(ui.getNavigableItems().indexOf(item));
      const showHint = vi.fn();
      (ui.c.map as any).foliplus = { showHint };
      ui.handleKeyDown(keyEvent("ArrowUp", { ctrlKey: true }));
      expect(showHint).toHaveBeenCalled();
    });

    it("Ctrl+ArrowDown off the bottom shows the reorder hint", () => {
      const items = ui.getNavigableItems();
      ui.setActiveItem(items.length - 1);
      const showHint = vi.fn();
      (ui.c.map as any).foliplus = { showHint };
      ui.handleKeyDown(keyEvent("ArrowDown", { ctrlKey: true }));
      expect(showHint).toHaveBeenCalled();
    });

    it("Ctrl+ArrowDown moves the row when a neighbour exists", () => {
      ui.setActiveItem(0);
      const moveLayerDown = vi.spyOn(ui.c, "moveLayerDown").mockReturnValue(true);
      expect(() =>
        ui.handleKeyDown(keyEvent("ArrowDown", { ctrlKey: true })),
      ).not.toThrow();
      expect(moveLayerDown).toHaveBeenCalled();
    });

    it("Ctrl+an unhandled key is a no-op", () => {
      ui.setActiveItem(0);
      expect(() =>
        ui.handleKeyDown(keyEvent("Enter", { ctrlKey: true })),
      ).not.toThrow();
    });

    it("Alt+Enter on a row without a layer id falls through", () => {
      const bare = document.createElement("div");
      bare.className = CONST.CLASSES.LAYER_ITEM;
      ui.uiContainer.appendChild(bare);
      ui.listPanel.activeIdx = ui.getNavigableItems().indexOf(bare);
      expect(() => ui.handleKeyDown(keyEvent("Enter", { altKey: true }))).not.toThrow();
    });

    it("Enter on an open menu item runs the action", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);
      const li = ui.uiContainer.querySelector(
        ".foliplus-layer-more-menu li[data-action='focus-layer']",
      ) as HTMLElement;
      expect(li).not.toBeNull();
      const focusLayer = vi.spyOn(ui, "focusLayer").mockImplementation(() => {});
      li.focus();
      ui.handleKeyDown(keyEvent("Enter"));
      expect(focusLayer).toHaveBeenCalled();
    });

    it("resolveActiveIdx walks a detached row that is focused via DOM override", () => {
      const before = ui.listPanel.activeIdx;
      const detached = document.createElement("div");
      detached.className = CONST.CLASSES.LAYER_ITEM;
      const desc = Object.getOwnPropertyDescriptor(document, "activeElement");
      Object.defineProperty(document, "activeElement", {
        configurable: true,
        get: () => detached,
      });
      expect(resolveActiveIdx(ui, ui.getNavigableItems())).toBe(before);
      if (desc?.configurable) {
        Object.defineProperty(document, "activeElement", desc);
      }
    });

    it("Alt+Enter focuses the navigated layer row", () => {
      const items = ui.getNavigableItems();
      const item = findItem(ui, "overlay1");
      ui.setActiveItem(items.indexOf(item));
      const focusLayer = vi.spyOn(ui, "focusLayer").mockImplementation(() => {});
      ui.handleKeyDown(keyEvent("Enter", { altKey: true }));
      expect(focusLayer).toHaveBeenCalledWith("overlay1");
    });

    it("Alt+Enter with a stale cursor index falls through to the key case", () => {
      ui.listPanel.activeIdx = 999;
      expect(() => ui.handleKeyDown(keyEvent("Enter", { altKey: true }))).not.toThrow();
    });

    it("ArrowUp at the top keeps the cursor parked", () => {
      const items = ui.getNavigableItems();
      const first = items[0];
      ui.setActiveItem(0);
      ui.handleKeyDown(keyEvent("ArrowUp"));
      expect(ui.listPanel.activeIdx).toBe(0);
      expect(ui.uiContainer.querySelector(`.${CONST.CLASSES.FOCUSED}`)).toBe(first);
    });

    it("ArrowDown at the bottom keeps the cursor parked", () => {
      const items = ui.getNavigableItems();
      const last = items[items.length - 1];
      ui.setActiveItem(items.length - 1);
      ui.handleKeyDown(keyEvent("ArrowDown"));
      expect(ui.listPanel.activeIdx).toBe(items.length - 1);
      expect(ui.uiContainer.querySelector(`.${CONST.CLASSES.FOCUSED}`)).toBe(last);
    });

    it("ArrowLeft and ArrowRight reach the toggle case", () => {
      ui.setActiveItem(1);
      expect(() =>
        ui.handleKeyDown(keyEvent("ArrowLeft", { bubbles: true })),
      ).not.toThrow();
      expect(() =>
        ui.handleKeyDown(keyEvent("ArrowRight", { bubbles: true })),
      ).not.toThrow();
    });

    it("Enter with a focused more-button outside any row is a no-op", () => {
      ui.setActiveItem(0);
      const orphan = document.createElement("button");
      orphan.className = CONST.CLASSES.MORE_BTN;
      document.body.appendChild(orphan);
      orphan.focus();
      expect(() => ui.handleKeyDown(keyEvent("Enter"))).not.toThrow();
      document.body.removeChild(orphan);
    });

    it("Space with a focused fold-button outside any row is a no-op", () => {
      ui.setActiveItem(0);
      const orphan = document.createElement("button");
      orphan.className = CONST.CLASSES.FOLD_BTN;
      document.body.appendChild(orphan);
      orphan.focus();
      expect(() => ui.handleKeyDown(keyEvent(" "))).not.toThrow();
      document.body.removeChild(orphan);
    });

    it("Enter on a menu item with no open menu falls through", () => {
      const item = findItem(ui, "overlay1");
      const menu = document.createElement("ul");
      menu.className = "foliplus-layer-more-menu";
      const li = document.createElement("li");
      li.setAttribute("data-action", "layer-focus");
      menu.appendChild(li);
      item.appendChild(menu);
      li.focus();
      expect(() => ui.handleKeyDown(keyEvent("Enter"))).not.toThrow();
    });
  });

  // ─────────────────── auto-cancel on map move/zoom ───────────────────
});

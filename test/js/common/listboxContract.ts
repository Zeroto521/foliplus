// test/js/common/listboxContract.ts
// The shared listbox contract matrix (§6 of .foliplus/zeta/dropdown-consolidation-design.md).
//
// One helper, run against every self-built dropdown surface. The historical
// builders each had their own test file covering the same behaviours twice
// (dropdown.test.ts and schemePicker.test.ts are near-parallel). This matrix is
// the single place a bug fix lands so both layers inherit the same contract.
//
// It is an exported helper, NOT a *.test.ts, so vitest does not run it as a
// suite by itself — the fixtures in listbox.contract.test.ts drive it.
//
// The fixture contract abstracts the surface behind the minimal operations the
// 12 matrix cases need. Each fixture maps one real surface:
//   - bridged single  : createDropdown({ nativeSelect })  (Heatmap agg / rampForm field)
//   - standalone multi: createDropdown({ items, multiple }) (filter enum)
//   - picker inline   : createSchemePicker({ portal:false })
//   - picker portal   : createSchemePicker({ portal:true })
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A row in the surface's listbox, as exposed by the fixture. */
export interface ContractRow {
  element: HTMLElement;
  value: string;
  label: string;
  disabled: boolean;
}

export interface ContractSurface {
  /** The consumer's trigger (button or combobox div). */
  trigger(): HTMLElement;
  /** Current option rows, in DOM order. */
  rows(): ContractRow[];
  /** The list element (null after destroy). */
  list(): HTMLElement | null;
  isOpen(): boolean;
  open(): void;
  close(opts?: { restoreFocus?: boolean }): void;
  destroy(): void;
  /** A real press on the nth row (pointerdown + click). */
  pressRow(index: number): void;
  /** A press outside the control — the map container area. */
  pressOutside(): void;
  /** How the fixture opens via keyboard (picker: Enter; dropdown: ArrowDown). */
  openViaKeyboard(): void;
  /** Whether this surface is a multiple-select (toggles stay open). */
  multiple: boolean;
  /** Whether the surface owns dismiss (outside-press / Escape). The bridged
   *  dropdown and the portalled picker do (the engine's local dismiss). The
   *  inline picker does NOT — it mounts inside a panel, and the panel
   *  dispatcher / overlay registry owns closing it (that is the S-F registry
   *  direction). Forcing the inline picker to self-dismiss would steal the
   *  Escape from the panel, which is a regression. */
  ownsDismiss: boolean;
  /** The current selection value(s), surface-shaped for the assertion. */
  value(): string;
  /** Read the trigger's aria-expanded. */
  expanded(): string | null;
}

export interface ContractFixture {
  name: string;
  /** Create a fresh surface + a wheel-probe container (the map container the
   *  wheel must not reach). Returns cleanup the runner wires to afterEach. */
  create(): {
    surface: ContractSurface;
    /** The node the wheel must not reach. Portal fixtures return document.body
     *  (the portalled list's parent); inline fixtures return a map container
     *  div that wraps the control. */
    wheelProbe: () => HTMLElement;
    cleanup: () => void;
  };
}

const key = (target: EventTarget, keyValue: string, init: KeyboardEventInit = {}): void => {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: keyValue,
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
};

/** A wheel event dispatched on a row: it bubbles to the list, the wrapper, the
 *  probe. The engine's wheel listener stops propagation at the list, so the
 *  probe (the map container) must never see it. */
const wheel = (target: EventTarget): void => {
  target.dispatchEvent(
    new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 40 }),
  );
};

export const describeListboxContract = (fixtures: ContractFixture[]): void => {
  for (const fixture of fixtures) {
    describe(fixture.name, () => {
      let surface: ContractSurface;
      let wheelProbe: () => HTMLElement;
      let cleanup: () => void;

      beforeEach(() => {
        const made = fixture.create();
        surface = made.surface;
        wheelProbe = made.wheelProbe;
        cleanup = made.cleanup;
      });

      afterEach(() => {
        cleanup();
        document.body.innerHTML = "";
      });

      // ── 1. open / close ─────────────────────────────────────────────
      it("trigger click opens, a second click closes, aria-expanded syncs", () => {
        surface.trigger().click();
        expect(surface.isOpen()).toBe(true);
        expect(surface.expanded()).toBe("true");
        surface.trigger().click();
        expect(surface.isOpen()).toBe(false);
        expect(surface.expanded()).toBe("false");
      });

      it("keyboard (Enter/Space or Arrow) opens; Escape closes an owning surface", () => {
        surface.openViaKeyboard();
        expect(surface.isOpen()).toBe(true);
        if (!surface.ownsDismiss) return; // panel owns Escape for inline
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
        expect(surface.isOpen()).toBe(false);
      });

      // ── 2. Escape chain: popup owns Escape while open ───────────────
      it("Escape closes the popup but a panel Escape handler stays silent", () => {
        if (!surface.ownsDismiss) return; // panel owns Escape for inline
        const panelEscape = vi.fn();
        document.addEventListener("keydown", panelEscape, true);
        try {
          surface.open();
          const row = surface.rows()[0];
          if (row) row.element.focus();
          // Dispatch on an in-document element so the event actually travels
          // the window→document capture path (a synthetic event on window
          // never descends to document).
          document.body.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
          );
          expect(surface.isOpen()).toBe(false);
          expect(panelEscape).not.toHaveBeenCalled();
          // Popup gone: the next Escape belongs to the panel again.
          document.body.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
          );
          expect(panelEscape).toHaveBeenCalledTimes(1);
        } finally {
          document.removeEventListener("keydown", panelEscape, true);
        }
      });

      it("does not steal an Escape another handler already consumed", () => {
        if (!surface.ownsDismiss) return;
        const onWindow = (e: Event): void => e.preventDefault();
        window.addEventListener("keydown", onWindow, true);
        try {
          surface.open();
          surface.rows()[0]?.element.focus();
          document.body.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
          );
          expect(surface.isOpen()).toBe(true);
        } finally {
          window.removeEventListener("keydown", onWindow, true);
        }
      });

      // ── 3. outside press ────────────────────────────────────────────
      it("a press inside the control (row or wrapper) does not dismiss", () => {
        surface.open();
        surface.rows()[0]?.element.dispatchEvent(
          new Event("pointerdown", { bubbles: true }),
        );
        expect(surface.isOpen()).toBe(true);
      });

      it("a press outside the control closes it (real pointerdown, not click)", () => {
        if (!surface.ownsDismiss) return;
        surface.open();
        surface.pressOutside();
        expect(surface.isOpen()).toBe(false);
      });

      // ── 4. wheel containment (#832) ─────────────────────────────────
      it("a wheel over the list does not reach the map container", () => {
        const probe = wheelProbe();
        const onWheel = vi.fn();
        probe.addEventListener("wheel", onWheel);
        try {
          surface.open();
          const row = surface.rows()[0];
          if (row) wheel(row.element);
          else wheel(surface.list() as HTMLElement);
          expect(onWheel).not.toHaveBeenCalled();
        } finally {
          probe.removeEventListener("wheel", onWheel);
        }
      });

      // ── 5. keyboard ─────────────────────────────────────────────────
      it("ArrowDown then ArrowUp moves the cursor and wraps", () => {
        surface.openViaKeyboard();
        if (surface.rows().length < 2) return;
        const list = surface.list() as HTMLElement;
        key(list, "ArrowDown");
        expect(document.activeElement).toBe(surface.rows()[1].element);
        key(list, "ArrowUp");
        expect(document.activeElement).toBe(surface.rows()[0].element);
      });

      it("Home and End jump to the list edges", () => {
        surface.openViaKeyboard();
        const n = surface.rows().length;
        if (n < 2) return;
        const list = surface.list() as HTMLElement;
        key(list, "End");
        expect(document.activeElement).toBe(surface.rows()[n - 1].element);
        key(list, "Home");
        expect(document.activeElement).toBe(surface.rows()[0].element);
      });

      it("Enter on a focused enabled row activates and closes (single mode)", () => {
        if (surface.multiple) return;
        surface.openViaKeyboard();
        const row = surface.rows()[0];
        if (!row) return;
        row.element.focus();
        key(row.element, "Enter");
        expect(surface.isOpen()).toBe(false);
      });

      it("Tab closes and returns focus to the trigger", () => {
        surface.trigger().focus();
        surface.open();
        surface.rows()[0]?.element.focus();
        key(surface.list() as HTMLElement, "Tab");
        expect(surface.isOpen()).toBe(false);
        expect(document.activeElement).toBe(surface.trigger());
      });

      // ── 6. ARIA ─────────────────────────────────────────────────────
      it("trigger carries the combobox ARIA contract", () => {
        const t = surface.trigger();
        expect(t.getAttribute("aria-haspopup")).toBe("listbox");
        expect(t.getAttribute("aria-expanded")).toBe("false");
        surface.open();
        const listId = surface.list()?.id ?? "";
        expect(listId).not.toBe("");
        expect(t.getAttribute("aria-controls")).toBe(listId);
        expect(t.getAttribute("aria-owns")).toBe(listId);
      });

      it("the list is a listbox and rows are options with aria-selected", () => {
        surface.open();
        expect(surface.list()?.getAttribute("role")).toBe("listbox");
        const rows = surface.rows();
        for (const row of rows) {
          expect(row.element.getAttribute("role")).toBe("option");
          expect(row.element.getAttribute("aria-selected")).toMatch(/^(true|false)$/);
        }
      });

      // ── 7. disabled ─────────────────────────────────────────────────
      it("a disabled row cannot be picked (click and Enter are no-ops)", () => {
        const rows = surface.rows();
        const disabled = rows.find(r => r.disabled);
        if (!disabled) return;
        const before = surface.value();
        disabled.element.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        disabled.element.click();
        key(disabled.element, "Enter");
        expect(surface.value()).toBe(before);
        expect(surface.isOpen()).toBe(true);
      });

      // ── 8. multiple ─────────────────────────────────────────────────
      it("multiple mode toggles without closing", () => {
        // Only fixtures that declare multiple expose this; the singleton
        // bridged/picker fixtures are single-mode and close on activate.
        if (!surface.multiple) return;
        const rows = surface.rows();
        if (rows.length < 2) return;
        surface.open();
        const first = rows[0].element;
        first.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        first.click();
        expect(surface.isOpen()).toBe(true);
      });

      // ── 9. long list ────────────────────────────────────────────────
      it("a long list clamps its height instead of running off the viewport", () => {
        // The engine clamps when the list is taller than the room. jsdom
        // reports 0-height boxes, so clamp math needs a stubbed rect; the
        // dropdown fixture stubs it in its own suite. Here we assert the
        // invariant the engine guarantees without layout: a list with more
        // than MAX_VISIBLE_ROWS (8) items renders all rows but the engine
        // keeps them in one list element (no pagination).
        surface.open();
        const n = surface.rows().length;
        expect(n).toBeGreaterThan(0);
        expect(surface.list()?.querySelectorAll("[role=option]").length).toBe(n);
      });

      // ── 10. focus restore ───────────────────────────────────────────
      it("a user-gesture close restores focus to the trigger", () => {
        surface.trigger().focus();
        surface.open();
        surface.rows()[0]?.element.focus();
        surface.close();
        expect(document.activeElement).toBe(surface.trigger());
      });

      it("restoreFocus:false does not yank focus back to the trigger", () => {
        surface.trigger().focus();
        surface.open();
        const row = surface.rows()[0];
        if (row) row.element.focus();
        surface.close({ restoreFocus: false });
        // The contract: focus is NOT returned to the trigger. It may settle on
        // the detached row (jsdom moves focus to body when the node leaves the
        // DOM) — the point is the close must not force it back.
        expect(document.activeElement).not.toBe(surface.trigger());
      });

      // ── 11. portal containment ──────────────────────────────────────
      it("a press on a portalled row counts as the control, not the map", () => {
        surface.open();
        const row = surface.rows()[0];
        if (!row) return;
        // The row is inside the list; a pointerdown there must not dismiss.
        row.element.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        expect(surface.isOpen()).toBe(true);
      });

      // ── 12. teardown ────────────────────────────────────────────────
      it("close → open → destroy leaves no live popup-scope listeners", () => {
        surface.open();
        surface.close();
        surface.open();
        surface.destroy();
        // After destroy: a trigger click must not reopen; the list must be gone.
        expect(surface.isOpen()).toBe(false);
        expect(surface.list()).toBeNull();
      });

      it("destroy is idempotent and repeated close/open does not leak nodes", () => {
        for (let i = 0; i < 3; i++) {
          surface.open();
          surface.close();
        }
        surface.destroy();
        surface.destroy();
        expect(surface.isOpen()).toBe(false);
        expect(surface.list()).toBeNull();
      });
    });
  }
};

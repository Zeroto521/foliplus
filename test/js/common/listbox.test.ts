// Engine-contract tests for the shared listbox engine (common/listbox.ts).
//
// These exercise the engine directly with a picker-shaped listbox (rowTag=div,
// data-scheme-name, foliplus-is-active, aria-disabled, activedescendant=trigger)
// so the picker-shape branches are covered by a public-behaviour assertion rather
// than left to schemePicker's own tests. The dropdown shape is covered by
// dropdown.test.ts (75 tests, unmodified).
import { afterEach, describe, expect, it, vi } from "vitest";
import { type DropdownSurface, createListbox } from "#common/listbox.js";

const cleanup: (() => void)[] = [];

afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.();
  document.body.innerHTML = "";
});

// A trigger whose wrapper is a simple cell (the engine mounts the closed list
// inside it and portals it out while open).
const makePicker = (
  items: readonly {
    value: string;
    label: string;
    disabled?: boolean;
    disabledHint?: string;
  }[],
  selected: readonly string[] = [],
) => {
  const cell = document.createElement("div");
  cell.className = "picker-cell";
  const trigger = document.createElement("div");
  trigger.className = "picker-trigger";
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-label", "Color scheme");
  cell.appendChild(trigger);
  document.body.appendChild(cell);

  const activated: number[] = [];
  const onSurfaceChange = vi.fn<() => () => void>(() => () => {});
  const surface: DropdownSurface = { onSurfaceChange: onSurfaceChange as never };

  const listbox = createListbox({
    trigger,
    items: () => items,
    selected: () => selected,
    shape: {
      rowTag: "div",
      dataKey: "data-scheme-name",
      selectedClass: "foliplus-is-active",
      disabledAttr: "aria-disabled",
      activedescendant: "trigger",
      renderRow: (item, ctx) => {
        const bar = document.createElement("div");
        bar.className = "picker-bar";
        bar.textContent = item.label;
        // Row ids are assigned by the engine (activedescendant=trigger shape);
        // the bar is just the colour content.
        if (ctx.selected) bar.setAttribute("data-selected", "true");
        return bar;
      },
    },
    classes: {
      list: "picker-list",
      row: "picker-row",
      portal: "is-portalled",
      up: "is-up",
      open: "is-open",
    },
    surface,
    dismiss: { kind: "local" },
    onRowActivate: index => {
      activated.push(index);
    },
  });
  cleanup.push(() => listbox.destroy());
  return { cell, trigger, listbox, activated, onSurfaceChange };
};

const rows = (listbox: ReturnType<typeof createListbox>) =>
  Array.from(listbox.getList()?.querySelectorAll<HTMLElement>(".picker-row") ?? []);

describe("listbox engine: picker shape", () => {
  it("builds div rows with data-scheme-name and a colour bar", () => {
    const { listbox } = makePicker([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ]);
    listbox.open();
    const els = rows(listbox);
    expect(els).toHaveLength(2);
    expect(els[0].tagName).toBe("DIV");
    expect(els[0].getAttribute("data-scheme-name")).toBe("a");
    expect(els[0].querySelector(".picker-bar")?.textContent).toBe("Alpha");
    expect(els[0].getAttribute("role")).toBe("option");
  });

  it("marks the active row with foliplus-is-active and aria-selected", () => {
    const { listbox } = makePicker(
      [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
      ],
      ["b"],
    );
    listbox.open();
    const els = rows(listbox);
    expect(els[1].classList.contains("foliplus-is-active")).toBe(true);
    expect(els[1].getAttribute("aria-selected")).toBe("true");
    expect(els[0].classList.contains("foliplus-is-active")).toBe(false);
  });

  it("sets aria-disabled on a disabled row and keeps it focusable", () => {
    const { listbox } = makePicker([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta", disabled: true },
    ]);
    listbox.open();
    const els = rows(listbox);
    // aria-disabled (not native disabled): the row is still in the tab order.
    expect(els[1].getAttribute("aria-disabled")).toBe("true");
    expect(els[1].hasAttribute("disabled")).toBe(false);
    expect(els[1].getAttribute("tabindex")).toBe("-1");
  });

  it("tracks the focused row on the trigger via aria-activedescendant", () => {
    const { trigger, listbox } = makePicker([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ]);
    listbox.open();
    const els = rows(listbox);
    // focusOption (via ArrowDown) sets the trigger's aria-activedescendant to the focused row id.
    els[0].focus();
    listbox.getList()?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(els[1]);
    expect(trigger.getAttribute("aria-activedescendant")).toBe(els[1].id);
  });

  it("skips a disabled row on ArrowDown and lands on the next enabled one", () => {
    const { trigger, listbox } = makePicker([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta", disabled: true },
      { value: "c", label: "Gamma" },
    ]);
    trigger.focus();
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    // Open + focus first enabled row (a). ArrowDown from a skips b.
    const els = rows(listbox);
    expect(document.activeElement).toBe(els[0]);
    els[0].dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(els[2]);
  });

  it("Home lands on the first enabled row and End on the last", () => {
    const { listbox } = makePicker([
      { value: "a", label: "Alpha", disabled: true },
      { value: "b", label: "Beta" },
      { value: "c", label: "Gamma" },
      { value: "d", label: "Delta", disabled: true },
    ]);
    listbox.open();
    const els = rows(listbox);
    els[1].focus();
    els[1].dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Home",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(els[1]);
    els[1].dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "End",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(els[2]);
  });

  it("activating a row fires onRowActivate and closes (single mode)", () => {
    const { trigger, listbox, activated } = makePicker([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ]);
    listbox.open();
    const els = rows(listbox);
    els[0].click();
    expect(activated).toEqual([0]);
    expect(listbox.isOpen()).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("calling open() again is idempotent (no duplicate rows)", () => {
    const { listbox } = makePicker([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ]);
    listbox.open();
    listbox.open();
    expect(rows(listbox)).toHaveLength(2);
  });

  it("toggle() opens then closes", () => {
    const { trigger, listbox } = makePicker([{ value: "a", label: "Alpha" }]);
    listbox.toggle();
    expect(listbox.isOpen()).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    listbox.toggle();
    expect(listbox.isOpen()).toBe(false);
  });

  it("does not activate a disabled row on click (aria-disabled guard)", () => {
    const { listbox, activated } = makePicker([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta", disabled: true },
    ]);
    listbox.open();
    const els = rows(listbox);
    els[1].click();
    expect(activated).toEqual([]);
    // The list stays open (nothing was picked).
    expect(listbox.isOpen()).toBe(true);
  });

  it("Enter on a disabled focused row does not activate", () => {
    const { listbox, activated } = makePicker([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta", disabled: true },
    ]);
    listbox.open();
    const els = rows(listbox);
    els[1].focus();
    listbox.getList()?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(activated).toEqual([]);
    expect(listbox.isOpen()).toBe(true);
  });

  it("is a no-op after destroy() (all methods safe)", () => {
    const { trigger, listbox } = makePicker([{ value: "a", label: "Alpha" }]);
    listbox.open();
    listbox.destroy();
    // After destroy, the public methods must not throw or re-open.
    expect(() => {
      listbox.open();
      listbox.close();
      listbox.toggle();
      listbox.refresh();
    }).not.toThrow();
    expect(listbox.isOpen()).toBe(false);
    expect(listbox.getList()).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // The trigger is inert after destroy: a click must not re-open anything.
    trigger.click();
    expect(listbox.isOpen()).toBe(false);
  });

  it("Home/End on the trigger while open moves focus to the edge rows", () => {
    const { trigger, listbox } = makePicker([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
      { value: "c", label: "Gamma" },
    ]);
    listbox.open();
    const els = rows(listbox);
    els[1].focus();
    // Home on the trigger jumps to the first row.
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(els[0]);
    // End on the trigger jumps to the last row.
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(els[2]);
  });
});

// Engine-contract tests for the shared listbox engine (common/listbox.ts).
//
// These exercise the engine directly with a picker-shaped listbox (rowTag=div,
// data-scheme-name, foliplus-is-active, aria-disabled, activedescendant=trigger)
// so the picker-shape branches are covered by a public-behaviour assertion rather
// than left to schemePicker's own tests. The dropdown shape is covered by
// dropdown.test.ts (75 tests, unmodified).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDropdown } from "#common/dropdown.js";
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

describe("listbox engine: bare shape and edge states", () => {
  // A minimal engine with a bare shape (button rows, no rowLabel class, no renderRow).
  const makeBare = (
    items: readonly {
      value: string;
      label: string;
      disabled?: boolean;
      title?: string;
    }[],
    opts: {
      multiple?: boolean;
      selected?: readonly string[];
      triggerParent?: "attached" | "detached";
    } = {},
  ) => {
    const trigger = document.createElement("button");
    trigger.className = "bare-trigger";
    trigger.type = "button";
    let cell: HTMLElement | null = null;
    if (opts.triggerParent !== "detached") {
      cell = document.createElement("div");
      cell.className = "bare-cell";
      cell.appendChild(trigger);
      document.body.appendChild(cell);
    }
    const activated: number[] = [];
    const surfaceCbs: (() => void)[] = [];
    const listbox = createListbox({
      trigger,
      items: () => items,
      selected: () => opts.selected ?? [],
      multiple: opts.multiple ?? false,
      shape: {
        rowTag: "button",
        dataKey: "data-value",
        selectedClass: "bare-is-selected",
        disabledAttr: "disabled",
        activedescendant: "none",
      },
      classes: {
        list: "bare-list",
        row: "bare-row",
        portal: "bare-portal",
        up: "bare-up",
        open: "bare-open",
      },
      surface: {
        onSurfaceChange: cb => {
          surfaceCbs.push(cb);
          return () => {};
        },
      },
      dismiss: { kind: "local" },
      onRowActivate: index => {
        activated.push(index);
      },
    });
    cleanup.push(() => listbox.destroy());
    return { trigger, cell, listbox, activated, surfaceCbs };
  };

  it("renders a default span label without a rowLabel class", () => {
    const { listbox } = makeBare([{ value: "a", label: "Alpha" }]);
    listbox.open();
    const row = listbox.getList()?.querySelector(".bare-row") as HTMLElement;
    const span = row.querySelector("span");
    expect(span).not.toBeNull();
    expect(span?.textContent).toBe("Alpha");
    expect(span?.className).toBe("");
  });

  it("open() on a detached trigger still mounts on body without crashing", () => {
    const { listbox } = makeBare([{ value: "a", label: "Alpha" }], {
      triggerParent: "detached",
    });
    expect(() => listbox.open()).not.toThrow();
    expect(listbox.isOpen()).toBe(true);
    // The list is portalled out to body (the only host available).
    expect(listbox.getList()?.parentElement).toBe(document.body);
  });

  it("trigger ArrowDown with empty items opens but focuses nothing", () => {
    const { trigger, listbox } = makeBare([]);
    trigger.focus();
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(listbox.isOpen()).toBe(true);
    expect(listbox.getList()?.querySelectorAll(".bare-row").length).toBe(0);
  });

  it("trigger Home/End while closed is a no-op", () => {
    const { trigger, listbox } = makeBare([{ value: "a", label: "Alpha" }]);
    expect(listbox.isOpen()).toBe(false);
    trigger.focus();
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }),
    );
    expect(listbox.isOpen()).toBe(false);
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }),
    );
    expect(listbox.isOpen()).toBe(false);
  });

  it("refresh() while closed does not render or re-pin", () => {
    const { listbox } = makeBare([{ value: "a", label: "Alpha" }]);
    expect(() => listbox.refresh()).not.toThrow();
    expect(listbox.getList()?.querySelectorAll(".bare-row").length).toBe(0);
  });

  it("trigger click toggles open and closed", () => {
    const { trigger, listbox } = makeBare([{ value: "a", label: "Alpha" }]);
    trigger.click();
    expect(listbox.isOpen()).toBe(true);
    trigger.click();
    expect(listbox.isOpen()).toBe(false);
  });

  it("Enter on the list with focus on the trigger activates nothing", () => {
    const { trigger, listbox, activated } = makeBare([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ]);
    listbox.open();
    trigger.focus();
    listbox
      .getList()
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    expect(activated).toEqual([]);
    expect(listbox.isOpen()).toBe(true);
  });

  it("multiple mode toggles aria-selected off when re-activating a selected row", () => {
    // The engine does not own the value model: the consumer's onRowActivate toggles
    // it. A mutable selected set lets us model that toggle precisely.
    const selected = new Set(["a"]);
    const items = [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ];
    const trigger = document.createElement("button");
    trigger.type = "button";
    const cell = document.createElement("div");
    cell.appendChild(trigger);
    document.body.appendChild(cell);
    const listbox = createListbox({
      trigger,
      items: () => items,
      selected: () => Array.from(selected),
      multiple: true,
      shape: {
        rowTag: "button",
        dataKey: "data-value",
        selectedClass: "bare-is-selected",
        disabledAttr: "disabled",
        activedescendant: "none",
      },
      classes: {
        list: "bare-list",
        row: "bare-row",
        portal: "bare-portal",
        up: "bare-up",
        open: "bare-open",
      },
      surface: { onSurfaceChange: () => () => {} },
      dismiss: { kind: "local" },
      onRowActivate: index => {
        const value = items[index].value;
        if (selected.has(value)) selected.delete(value);
        else selected.add(value);
      },
    });
    cleanup.push(() => listbox.destroy());
    listbox.open();
    const rows = Array.from(
      listbox.getList()?.querySelectorAll<HTMLElement>(".bare-row") ?? [],
    );
    expect(rows[0].getAttribute("aria-selected")).toBe("true");
    // Activate the already-selected first row: the value model toggles it off,
    // and the engine re-reads selected() and repaints the row as unselected.
    rows[0].click();
    expect(selected.has("a")).toBe(false);
    expect(rows[0].getAttribute("aria-selected")).toBe("false");
    expect(rows[0].classList.contains("bare-is-selected")).toBe(false);
  });

  it("opening a second listbox closes the first (once-at-a-time)", () => {
    const { listbox: first } = makeBare([{ value: "a", label: "Alpha" }]);
    const { listbox: second } = makeBare([{ value: "b", label: "Beta" }]);
    first.open();
    expect(first.isOpen()).toBe(true);
    second.open();
    expect(second.isOpen()).toBe(true);
    expect(first.isOpen()).toBe(false);
  });

  it("scroll on the list itself does not crash reposition", () => {
    const { listbox } = makeBare([{ value: "a", label: "Alpha" }]);
    listbox.open();
    expect(() => {
      listbox.getList()?.dispatchEvent(new Event("scroll", { bubbles: true }));
    }).not.toThrow();
  });

  it("surface change while closed does not re-seat (reseat no-op)", () => {
    const { listbox, surfaceCbs } = makeBare([{ value: "a", label: "Alpha" }]);
    listbox.open();
    expect(surfaceCbs.length).toBe(1);
    listbox.close();
    expect(listbox.isOpen()).toBe(false);
    // Firing the surface callback after close must be a no-op.
    expect(() => surfaceCbs[0]()).not.toThrow();
  });

  it("End after the items array grew hits the stale-row guard without crashing", () => {
    const items: { value: string; label: string }[] = [{ value: "a", label: "Alpha" }];
    const { listbox } = makeBare(items);
    listbox.open();
    const rows = Array.from(
      listbox.getList()?.querySelectorAll<HTMLElement>(".bare-row") ?? [],
    );
    expect(rows).toHaveLength(1);
    rows[0].focus();
    // Grow the items array without refreshing: rowEls is now stale (1 row, 2 items).
    items.push({ value: "b", label: "Beta" });
    expect(() => {
      listbox
        .getList()
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }),
        );
    }).not.toThrow();
  });

  it("outside press with a null target is ignored (defensive guard)", () => {
    const { listbox } = makeBare([{ value: "a", label: "Alpha" }]);
    listbox.open();
    expect(listbox.isOpen()).toBe(true);
    // A pointerdown whose target is null (synthetic edge case) must not close or throw.
    const evt = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(evt, "target", { value: null });
    expect(() => document.dispatchEvent(evt)).not.toThrow();
    expect(listbox.isOpen()).toBe(true);
  });
  it("scroll on a sibling node repositions the open list", () => {
    const { listbox } = makeBare([{ value: "a", label: "Alpha" }]);
    listbox.open();
    // A scroll event whose target is NOT the list must re-pin (not crash, not close).
    const sibling = document.createElement("div");
    sibling.className = "sibling";
    document.body.appendChild(sibling);
    expect(() => {
      sibling.dispatchEvent(new Event("scroll", { bubbles: true }));
    }).not.toThrow();
    expect(listbox.isOpen()).toBe(true);
  });
  it("keyboard Enter in multiple mode toggles a selected row off", () => {
    const selected = new Set(["a"]);
    const items = [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ];
    const trigger = document.createElement("button");
    trigger.type = "button";
    const cell = document.createElement("div");
    cell.appendChild(trigger);
    document.body.appendChild(cell);
    const listbox = createListbox({
      trigger,
      items: () => items,
      selected: () => Array.from(selected),
      multiple: true,
      shape: {
        rowTag: "button",
        dataKey: "data-value",
        selectedClass: "bare-is-selected",
        disabledAttr: "disabled",
        activedescendant: "none",
      },
      classes: {
        list: "bare-list",
        row: "bare-row",
        portal: "bare-portal",
        up: "bare-up",
        open: "bare-open",
      },
      surface: { onSurfaceChange: () => () => {} },
      dismiss: { kind: "local" },
      onRowActivate: index => {
        const value = items[index].value;
        if (selected.has(value)) selected.delete(value);
        else selected.add(value);
      },
    });
    cleanup.push(() => listbox.destroy());
    listbox.open();
    const rows = Array.from(
      listbox.getList()?.querySelectorAll<HTMLElement>(".bare-row") ?? [],
    );
    rows[0].focus();
    // Enter on the focused (selected) row toggles it off via the key handler.
    listbox
      .getList()
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    expect(selected.has("a")).toBe(false);
    expect(rows[0].getAttribute("aria-selected")).toBe("false");
  });
});

describe("dropdown adapter via engine (partial-branch coverage)", () => {
  it("carries a native option title onto the row", () => {
    const select = document.createElement("select");
    const opt = document.createElement("option");
    opt.value = "a";
    opt.textContent = "Alpha";
    opt.title = "Alpha tooltip";
    select.appendChild(opt);
    const host = document.createElement("div");
    host.appendChild(select);
    document.body.appendChild(host);

    const dropdown = createDropdown({ nativeSelect: select });
    cleanup.push(() => dropdown.destroy());
    dropdown.open();
    const row = dropdown.getList()?.querySelector(".foliplus-dropdown-option");
    expect(row?.getAttribute("title")).toBe("Alpha tooltip");
  });

  it("wraps a detached native select without crashing", () => {
    const select = document.createElement("select");
    const opt = document.createElement("option");
    opt.value = "a";
    opt.textContent = "Alpha";
    select.appendChild(opt);
    // Detached: select has no parentNode, so insertBefore is skipped.
    const dropdown = createDropdown({ nativeSelect: select });
    cleanup.push(() => dropdown.destroy());
    expect(dropdown.element.querySelector("select")).not.toBeNull();
  });

  it("setValue on a standalone dropdown has no native select to write", () => {
    const dropdown = createDropdown({
      items: [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
      ],
    });
    cleanup.push(() => dropdown.destroy());
    expect(() => dropdown.setValue("b")).not.toThrow();
    expect(dropdown.getValue()).toBe("b");
  });

  it('commits an empty value through the bridged select (?? "" fallback)', () => {
    // A bridged select with an empty-value option: activating it writes native.value
    // to "", so valuesOf() returns [] and commit()'s `values[0] ?? ""` fallback runs.
    const select = document.createElement("select");
    const placeholderOpt = document.createElement("option");
    placeholderOpt.value = "";
    placeholderOpt.textContent = "Choose…";
    select.appendChild(placeholderOpt);
    const realOpt = document.createElement("option");
    realOpt.value = "a";
    realOpt.textContent = "Alpha";
    select.appendChild(realOpt);
    const host = document.createElement("div");
    host.appendChild(select);
    document.body.appendChild(host);

    const onChange = vi.fn();
    const dropdown = createDropdown({ nativeSelect: select, onChange });
    cleanup.push(() => dropdown.destroy());
    dropdown.open();
    const rows = Array.from(
      dropdown.getList()?.querySelectorAll<HTMLElement>(".foliplus-dropdown-option") ??
        [],
    );
    // rows[0] is the empty-value option.
    rows[0].click();
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[0][0]).toBe("");
    expect(select.value).toBe("");
  });
});

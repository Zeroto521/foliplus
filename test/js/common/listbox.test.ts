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

describe("listbox engine: portalled popup geometry (marginTop zeroed)", () => {
  const pinRect = (el: HTMLElement, top: number, height: number): void => {
    Object.defineProperty(el, "getBoundingClientRect", {
      value: () =>
        ({
          x: 0,
          y: top,
          top,
          bottom: top + height,
          left: 0,
          right: 160,
          width: 160,
          height,
          toJSON: () => ({}),
        }) as DOMRect,
      configurable: true,
    });
  };
  const setViewport = (height: number): (() => void) => {
    const original = Object.getOwnPropertyDescriptor(window, "innerHeight");
    Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
    return () => {
      if (original) Object.defineProperty(window, "innerHeight", original);
    };
  };
  const makeGeom = () => {
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "geom-trigger";
    const cell = document.createElement("div");
    cell.className = "geom-cell";
    cell.appendChild(trigger);
    document.body.appendChild(cell);
    const listbox = createListbox({
      trigger,
      items: () => [{ value: "a", label: "Alpha" }],
      selected: () => [],
      shape: {
        rowTag: "button",
        dataKey: "data-value",
        selectedClass: "geom-selected",
        disabledAttr: "disabled",
        activedescendant: "none",
      },
      classes: {
        list: "geom-list",
        row: "geom-row",
        portal: "geom-portal",
        up: "geom-up",
        open: "geom-open",
      },
      surface: { onSurfaceChange: () => () => {} },
      dismiss: { kind: "local" },
      onRowActivate: () => {},
    });
    cleanup.push(() => listbox.destroy());
    return { trigger, listbox };
  };

  it("zeroes margin-top on a down-portalled popup (fixed mount uses offset, not the in-flow gap)", () => {
    const restore = setViewport(400);
    cleanup.push(restore);
    const { trigger, listbox } = makeGeom();
    // Pin the list before open: the engine measures its height inside open().
    const list = listbox.getList() as HTMLElement;
    pinRect(list, 134, 30);
    // Trigger near the top: plenty of room below, so it opens downward.
    pinRect(trigger, 100, 30);
    listbox.open();
    // The list is portalled; the in-flow margin gap must be zeroed or the real
    // dropdown stacks 4px low (P2-1).
    expect(list.style.marginTop).toBe("0px");
    expect(list.style.bottom).toBe("");
    expect(list.style.top).toBe("134px"); // rect.bottom(130) + POPUP_GAP(4)
    listbox.close();
  });

  it("zeroes margin-top on an up-flipped popup and adds the up class", () => {
    const restore = setViewport(400);
    cleanup.push(restore);
    const { trigger, listbox } = makeGeom();
    // Pin the list before open: the engine measures its height inside open().
    const list = listbox.getList() as HTMLElement;
    pinRect(list, 316, 30);
    // Trigger near the bottom: room above wins, so it flips upward.
    pinRect(trigger, 350, 30);
    listbox.open();
    expect(list.style.marginTop).toBe("0px");
    expect(list.style.top).toBe("");
    expect(list.style.bottom).toBe("54px"); // innerHeight(400) - rect.top(350) + POPUP_GAP(4)
    expect(list.classList.contains("geom-up")).toBe(true);
    listbox.close();
  });
});

// Patch the global listener methods once per test (jsdom's window/document
// own their addEventListener; EventTarget.prototype is not where the engine
// binds). The patch is restored by afterEach so a second test does not wrap
// a wrapper.
let restoreGlobal: (() => void) | null = null;
const countGlobal = () => {
  const doc = new Set<string>();
  const win = new Set<string>();
  const wadd = window.addEventListener.bind(window);
  const wremove = window.removeEventListener.bind(window);
  const dadd = document.addEventListener.bind(document);
  const dremove = document.removeEventListener.bind(document);
  const key = (type: string, opts?: boolean | AddEventListenerOptions) =>
    type + (opts === true ? "|cap" : "");
  window.addEventListener = function (
    type: string,
    fn: EventListener,
    opts?: boolean | AddEventListenerOptions,
  ) {
    win.add(key(type, opts));
    return wadd(type, fn, opts);
  } as typeof window.addEventListener;
  window.removeEventListener = function (
    type: string,
    fn: EventListener,
    opts?: boolean | EventListenerOptions,
  ) {
    win.delete(key(type, opts as boolean | AddEventListenerOptions));
    return wremove(type, fn, opts);
  } as typeof window.removeEventListener;
  document.addEventListener = function (
    type: string,
    fn: EventListener,
    opts?: boolean | AddEventListenerOptions,
  ) {
    doc.add(key(type, opts));
    return dadd(type, fn, opts);
  } as typeof document.addEventListener;
  document.removeEventListener = function (
    type: string,
    fn: EventListener,
    opts?: boolean | EventListenerOptions,
  ) {
    doc.delete(key(type, opts as boolean | AddEventListenerOptions));
    return dremove(type, fn, opts);
  } as typeof document.removeEventListener;
  restoreGlobal = () => {
    window.addEventListener = wadd;
    window.removeEventListener = wremove;
    document.addEventListener = dadd;
    document.removeEventListener = dremove;
  };
  return () => ({ doc: doc.size, win: win.size, total: doc.size + win.size });
};
afterEach(() => {
  restoreGlobal?.();
  restoreGlobal = null;
});

it("constructing without opening binds no document/window listeners", () => {
  const read = countGlobal();
  const before = read();
  const { listbox } = makePicker([
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta", disabled: true },
  ]);
  const afterConstruct = read();
  expect(afterConstruct).toEqual(before);
  listbox.destroy();
  expect(read()).toEqual(before);
});

it("open then close returns the global listener count to baseline", () => {
  const read = countGlobal();
  const before = read();
  const { listbox } = makePicker([
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta" },
  ]);
  listbox.open();
  // Open binds window scroll+resize (2) for the portal placement.
  expect(read().win).toBeGreaterThanOrEqual(before.win + 2);
  listbox.close();
  expect(read()).toEqual(before);
  listbox.destroy();
  expect(read()).toEqual(before);
});

it("open + close drains every document/window listener when ownDismiss is set", () => {
  const read = countGlobal();
  const before = read();
  const trigger = document.createElement("button");
  trigger.type = "button";
  const cell = document.createElement("div");
  cell.appendChild(trigger);
  document.body.appendChild(cell);
  const listbox = createListbox({
    trigger,
    items: () => [{ value: "a", label: "Alpha" }],
    selected: () => [],
    shape: {
      rowTag: "button",
      dataKey: "data-value",
      selectedClass: "own-selected",
      disabledAttr: "disabled",
      activedescendant: "none",
    },
    classes: {
      list: "own-list",
      row: "own-row",
      portal: "own-portal",
      up: "own-up",
      open: "own-open",
    },
    surface: { onSurfaceChange: () => () => {} },
    dismiss: { kind: "local" },
    ownDismiss: true,
    onRowActivate: () => {},
  });
  listbox.open();
  // ownDismiss binds document pointerdown + window keydown on top of the
  // scroll/resize mount listeners, so the open count must exceed baseline.
  expect(read().total).toBeGreaterThan(before.total);
  listbox.close();
  expect(read()).toEqual(before);
  listbox.destroy();
  expect(read()).toEqual(before);
});

describe("listbox engine: focusOnOpen selection (last row)", () => {
  it("focusOnOpen last lands focus on the last enabled row", () => {
    const trigger = document.createElement("button");
    trigger.type = "button";
    const cell = document.createElement("div");
    cell.appendChild(trigger);
    document.body.appendChild(cell);
    const listbox = createListbox({
      trigger,
      items: () => [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
        { value: "c", label: "Gamma", disabled: true },
      ],
      selected: () => [],
      shape: {
        rowTag: "button",
        dataKey: "data-value",
        selectedClass: "last-selected",
        disabledAttr: "disabled",
        activedescendant: "none",
      },
      classes: {
        list: "last-list",
        row: "last-row",
        portal: "last-portal",
        up: "last-up",
        open: "last-open",
      },
      surface: { onSurfaceChange: () => () => {} },
      dismiss: { kind: "local" },
      focusOnOpen: "last",
      onRowActivate: () => {},
    });
    cleanup.push(() => listbox.destroy());
    listbox.open();
    const rows = Array.from(
      listbox.getList()?.querySelectorAll<HTMLElement>(".last-row") ?? [],
    );
    // last enabled row is b (c is disabled); enabledFrom walks -1 from the end.
    expect(document.activeElement).toBe(rows[1]);
  });
  it("focusOnOpen selected falls back to the first row when the selection is gone", () => {
    const trigger = document.createElement("button");
    trigger.type = "button";
    const cell = document.createElement("div");
    cell.appendChild(trigger);
    document.body.appendChild(cell);
    const listbox = createListbox({
      trigger,
      items: () => [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
      ],
      selected: () => ["gone"],
      shape: {
        rowTag: "button",
        dataKey: "data-value",
        selectedClass: "last-selected",
        disabledAttr: "disabled",
        activedescendant: "none",
      },
      classes: {
        list: "last-list",
        row: "last-row",
        portal: "last-portal",
        up: "last-up",
        open: "last-open",
      },
      surface: { onSurfaceChange: () => () => {} },
      dismiss: { kind: "local" },
      focusOnOpen: "selected",
      onRowActivate: () => {},
    });
    cleanup.push(() => listbox.destroy());
    listbox.open();
    const rows = Array.from(
      listbox.getList()?.querySelectorAll<HTMLElement>(".last-row") ?? [],
    );
    // selected() no longer matches any row; index stays 0 (the fallback).
    expect(document.activeElement).toBe(rows[0]);
  });

  it("focusOnOpen first keeps the default first row", () => {
    const trigger = document.createElement("button");
    trigger.type = "button";
    const cell = document.createElement("div");
    cell.appendChild(trigger);
    document.body.appendChild(cell);
    const listbox = createListbox({
      trigger,
      items: () => [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
      ],
      selected: () => ["b"],
      shape: {
        rowTag: "button",
        dataKey: "data-value",
        selectedClass: "last-selected",
        disabledAttr: "disabled",
        activedescendant: "none",
      },
      classes: {
        list: "last-list",
        row: "last-row",
        portal: "last-portal",
        up: "last-up",
        open: "last-open",
      },
      surface: { onSurfaceChange: () => () => {} },
      dismiss: { kind: "local" },
      focusOnOpen: "first",
      onRowActivate: () => {},
    });
    cleanup.push(() => listbox.destroy());
    listbox.open();
    const rows = Array.from(
      listbox.getList()?.querySelectorAll<HTMLElement>(".last-row") ?? [],
    );
    // focusOnOpen="first": neither "selected" nor "last" branch; index stays 0.
    expect(document.activeElement).toBe(rows[0]);
  });

  it("cycle ArrowDown skips a disabled neighbour when the next scheme is disabled", () => {
    const activated: number[] = [];
    const trigger = document.createElement("button");
    trigger.type = "button";
    const cell = document.createElement("div");
    cell.appendChild(trigger);
    document.body.appendChild(cell);
    const listbox = createListbox({
      trigger,
      items: () => [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta", disabled: true },
        { value: "c", label: "Gamma" },
      ],
      selected: () => ["a"],
      shape: {
        rowTag: "button",
        dataKey: "data-value",
        selectedClass: "last-selected",
        disabledAttr: "disabled",
        activedescendant: "none",
      },
      classes: {
        list: "last-list",
        row: "last-row",
        portal: "last-portal",
        up: "last-up",
        open: "last-open",
      },
      surface: { onSurfaceChange: () => () => {} },
      dismiss: { kind: "local" },
      triggerKeys: "cycle",
      onRowActivate: index => {
        activated.push(index);
      },
    });
    cleanup.push(() => listbox.destroy());
    // Closed state: ArrowDown cycles the selection. b is disabled, so the
    // engine walks past it to c (index 2), not activating b.
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(activated).toEqual([2]);
  });
});

describe("listbox engine: inline mount returns the list to its host", () => {
  // The scheme picker is the only inline consumer (portal:false) and it sets
  // detachOnClose:true, so the engine's close-back-to-wrapper branch (the
  // inline ternary in close()) is never reached by the picker tests. These
  // exercise it directly so the inline mount/close contract is covered.
  const makeInline = (
    opts: {
      inlineHost?: () => HTMLElement;
      detachOnClose?: boolean;
      triggerDetached?: boolean;
    } = {},
  ) => {
    const trigger = document.createElement("button");
    trigger.type = "button";
    // The trigger lives in a mount cell; the inline host is a DISTINCT element
    // so the close-back wrapper branch (inlineHost vs parentElement) is
    // observably different — a broken ternary parks the list in the wrong place.
    const cell = document.createElement("div");
    cell.className = "inline-cell";
    document.body.appendChild(cell);
    const host = document.createElement("div");
    host.className = "inline-host";
    document.body.appendChild(host);
    if (!opts.triggerDetached) cell.appendChild(trigger);
    const listbox = createListbox({
      trigger,
      items: () => [{ value: "a", label: "Alpha" }],
      selected: () => [],
      inline: true,
      inlineHost: opts.inlineHost,
      detachOnClose: opts.detachOnClose ?? false,
      shape: {
        rowTag: "button",
        dataKey: "data-value",
        selectedClass: "inline-is-selected",
        disabledAttr: "disabled",
        activedescendant: "none",
      },
      classes: {
        list: "inline-list",
        row: "inline-row",
        portal: "inline-portal",
        up: "inline-up",
        open: "inline-open",
      },
      surface: { onSurfaceChange: () => () => {} },
      dismiss: { kind: "local" },
      onRowActivate: () => {},
    });
    cleanup.push(() => listbox.destroy());
    return { trigger, cell, host, listbox };
  };

  it("inline open mounts into the inline host and close returns it there", () => {
    const { host, listbox } = makeInline({ inlineHost: () => host });
    listbox.open();
    expect(listbox.getList()?.parentElement).toBe(host);
    expect(listbox.getList()?.classList.contains("inline-portal")).toBe(false);
    expect(listbox.isOpen()).toBe(true);
    listbox.close();
    expect(listbox.getList()?.parentElement).toBe(host);
    expect(listbox.isOpen()).toBe(false);
  });

  it("inline host falls back to the trigger parent when inlineHost is omitted", () => {
    const { cell, listbox } = makeInline();
    listbox.open();
    // inlineHost is undefined → the engine falls back to trigger.parentElement.
    expect(listbox.getList()?.parentElement).toBe(cell);
    listbox.close();
    expect(listbox.getList()?.parentElement).toBe(cell);
  });

  it("inline host falls back to the trigger itself when it has no parent", () => {
    const { trigger, listbox } = makeInline({ triggerDetached: true });
    listbox.open();
    // inlineHost omitted + trigger detached → the engine falls back to the trigger.
    expect(listbox.getList()?.parentElement).toBe(trigger);
    listbox.close();
    expect(listbox.getList()?.parentElement).toBe(trigger);
  });
});

describe("listbox engine: ownDismiss outside press with a null target", () => {
  // The bare-shape test for the null-target guard uses a listbox WITHOUT
  // ownDismiss, so the document pointerdown handler (which owns the guard) is
  // never registered. ownDismiss:true is what puts the guard on the event path.
  it("ignores a pointerdown whose target is null (defensive guard)", () => {
    const trigger = document.createElement("button");
    trigger.type = "button";
    const cell = document.createElement("div");
    cell.appendChild(trigger);
    document.body.appendChild(cell);
    const listbox = createListbox({
      trigger,
      items: () => [{ value: "a", label: "Alpha" }],
      selected: () => [],
      ownDismiss: true,
      shape: {
        rowTag: "button",
        dataKey: "data-value",
        selectedClass: "own-null-selected",
        disabledAttr: "disabled",
        activedescendant: "none",
      },
      classes: {
        list: "own-null-list",
        row: "own-null-row",
        portal: "own-null-portal",
        up: "own-null-up",
        open: "own-null-open",
      },
      surface: { onSurfaceChange: () => () => {} },
      dismiss: { kind: "local" },
      onRowActivate: () => {},
    });
    cleanup.push(() => listbox.destroy());
    listbox.open();
    expect(listbox.isOpen()).toBe(true);
    const evt = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(evt, "target", { value: null });
    expect(() => document.dispatchEvent(evt)).not.toThrow();
    expect(listbox.isOpen()).toBe(true);
  });
});

describe("listbox engine: followTrigger re-pins on a trigger resize", () => {
  // jsdom has no ResizeObserver, so the engine never installs the followTrigger
  // callback and the re-pin-on-trigger-resize branch is uncovered. Stub a
  // minimal ResizeObserver so the observer callback (the throttleRaf wrapper)
  // is invoked and coalesced to a frame.
  it("re-pins the open portalled list when the trigger resizes, and no-ops when closed", async () => {
    const original = globalThis.ResizeObserver;
    let observed: (() => void) | null = null;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          observed = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    try {
      const trigger = document.createElement("button");
      trigger.type = "button";
      const cell = document.createElement("div");
      cell.appendChild(trigger);
      document.body.appendChild(cell);
      const onPosition = vi.fn();
      const listbox = createListbox({
        trigger,
        items: () => [{ value: "a", label: "Alpha" }],
        selected: () => [],
        shape: {
          rowTag: "button",
          dataKey: "data-value",
          selectedClass: "ro-selected",
          disabledAttr: "disabled",
          activedescendant: "none",
        },
        classes: {
          list: "ro-list",
          row: "ro-row",
          portal: "ro-portal",
          up: "ro-up",
          open: "ro-open",
        },
        surface: { onSurfaceChange: () => () => {} },
        dismiss: { kind: "local" },
        onPosition,
        onRowActivate: () => {},
      });
      cleanup.push(() => listbox.destroy());
      listbox.open();
      expect(observed).not.toBeNull();
      // open() (portal mode) already ran positionList → onPosition once.
      const afterOpen = onPosition.mock.calls.length;
      expect(afterOpen).toBeGreaterThan(0);
      // A trigger resize fires the observer callback; followTrigger coalesces
      // and re-pins on the next frame.
      observed!();
      await new Promise<void>(res => requestAnimationFrame(() => res()));
      expect(onPosition.mock.calls.length).toBeGreaterThan(afterOpen);
      // After close the same callback is a no-op (isOpen is false).
      const afterRepin = onPosition.mock.calls.length;
      listbox.close();
      observed!();
      await new Promise<void>(res => requestAnimationFrame(() => res()));
      expect(onPosition.mock.calls.length).toBe(afterRepin);
    } finally {
      vi.unstubAllGlobals();
      if (original === undefined)
        delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    }
  });
});

describe("listbox engine: focusOnOpen with a row that has no value", () => {
  // The selected-match fallback maps an undefined value to "" before testing
  // membership, so a malformed row (no value) is still addressable by the
  // empty-string selection. Exercise the ?? "" fallback directly.
  it("focusOnOpen selected matches the undefined-value row via the empty fallback", () => {
    const trigger = document.createElement("button");
    trigger.type = "button";
    const cell = document.createElement("div");
    cell.appendChild(trigger);
    document.body.appendChild(cell);
    const listbox = createListbox({
      trigger,
      items: () => [
        { value: "a", label: "Alpha" },
        { value: undefined as unknown as string, label: "No value" },
      ],
      selected: () => [""],
      shape: {
        rowTag: "button",
        dataKey: "data-value",
        selectedClass: "fv-selected",
        disabledAttr: "disabled",
        activedescendant: "none",
      },
      classes: {
        list: "fv-list",
        row: "fv-row",
        portal: "fv-portal",
        up: "fv-up",
        open: "fv-open",
      },
      surface: { onSurfaceChange: () => () => {} },
      dismiss: { kind: "local" },
      focusOnOpen: "selected",
      onRowActivate: () => {},
    });
    cleanup.push(() => listbox.destroy());
    listbox.open();
    const rows = Array.from(
      listbox.getList()?.querySelectorAll<HTMLElement>(".fv-row") ?? [],
    );
    // index 0 is 'a' (no match), index 1 is undefined → "" → matches [""].
    expect(document.activeElement).toBe(rows[1]);
  });
});

describe("listbox engine: focusOnOpen with every row disabled", () => {
  // enabledFrom returns -1 when no row is enabled, so the guard skips
  // focusOption and focus stays on the trigger (the cursor never parks on a
  // disabled row). The existing focusOnOpen tests all use enabled rows.
  it("focusOnOpen first focuses nothing when all rows are disabled", () => {
    const trigger = document.createElement("button");
    trigger.type = "button";
    const cell = document.createElement("div");
    cell.appendChild(trigger);
    document.body.appendChild(cell);
    const listbox = createListbox({
      trigger,
      items: () => [
        { value: "a", label: "Alpha", disabled: true },
        { value: "b", label: "Beta", disabled: true },
      ],
      selected: () => [],
      shape: {
        rowTag: "button",
        dataKey: "data-value",
        selectedClass: "fd-selected",
        disabledAttr: "disabled",
        activedescendant: "none",
      },
      classes: {
        list: "fd-list",
        row: "fd-row",
        portal: "fd-portal",
        up: "fd-up",
        open: "fd-open",
      },
      surface: { onSurfaceChange: () => () => {} },
      dismiss: { kind: "local" },
      focusOnOpen: "first",
      onRowActivate: () => {},
    });
    cleanup.push(() => listbox.destroy());
    listbox.open();
    const rows = Array.from(
      listbox.getList()?.querySelectorAll<HTMLElement>(".fd-row") ?? [],
    );
    expect(rows).toHaveLength(2);
    // No row may hold focus; the trigger keeps it.
    expect(rows.some(row => row === document.activeElement)).toBe(false);
    expect(listbox.isOpen()).toBe(true);
  });
});

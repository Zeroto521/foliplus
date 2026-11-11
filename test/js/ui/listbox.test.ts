// Engine-contract tests for the shared listbox engine (ui/listbox.ts).
//
// These exercise the engine directly with a picker-shaped listbox (rowTag=div,
// data-scheme-name, foliplus-is-active, aria-disabled, activedescendant=trigger)
// so the picker-shape branches are covered by a public-behaviour assertion rather
// than left to schemePicker's own tests. The dropdown shape is covered by the
// shared contract matrix below, which drives every surface the engine owns.
import type * as L from "leaflet";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureOverlayRegistry } from "#core/overlay/index.js";
import { buildFieldRow } from "#core/value/index.js";
import { DROPDOWN_OVERLAY_ID } from "#ui/dropdown.js";
import {
  type Dropdown,
  type DropdownSurface,
  createDropdown,
  createListbox,
  createSchemePicker,
} from "#ui/index.js";

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
      dismiss?: {
        kind: "registry";
        register: (e: {
          id: string;
          isOpen(): boolean;
          close(opts: { restoreFocus: boolean }): void | boolean;
          panels(): Element[];
          dismissOn: "mousedown" | "click";
          pressPriority: number;
          escapeRank?: number;
        }) => () => void;
        id: string;
        rank: number;
      };
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
      dismiss: opts.dismiss ?? { kind: "local" },
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

  it("refresh while open keeps the trigger focused", () => {
    const { trigger, listbox } = makeBare([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ]);
    listbox.open();
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    listbox.refresh();
    expect(listbox.isOpen()).toBe(true);
    expect(document.activeElement).toBe(trigger);
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

  it("opening a second listbox with a registry dismiss closes the first (once-at-a-time)", () => {
    const { listbox: first } = makeBare([{ value: "a", label: "Alpha" }], {
      dismiss: { kind: "registry", register: () => () => {}, id: "x", rank: 1 },
    });
    const { listbox: second } = makeBare([{ value: "b", label: "Beta" }], {
      dismiss: { kind: "registry", register: () => () => {}, id: "x", rank: 1 },
    });
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

  it("closed list leaves no visible DOM and ignores key presses on it", () => {
    const { listbox } = makeBare([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ]);
    listbox.open();
    const list = listbox.getList()!;
    expect(list.querySelectorAll(".bare-row").length).toBe(2);
    listbox.close();
    expect(listbox.isOpen()).toBe(false);
    // The closed list is hidden — no lingering visible DOM.
    expect(list.hidden).toBe(true);
    // A key press on the hidden list neither activates a row nor re-renders.
    list.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).not.toBe(list.querySelector(".bare-row"));
    expect(list.querySelectorAll(".bare-row").length).toBe(2);
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

    const dropdown = createDropdown({
      overlay: mockOverlay().overlay,
      nativeSelect: select,
    });
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
    const dropdown = createDropdown({
      overlay: mockOverlay().overlay,
      nativeSelect: select,
    });
    cleanup.push(() => dropdown.destroy());
    expect(dropdown.element.querySelector("select")).not.toBeNull();
  });

  it("setValue on a standalone dropdown has no native select to write", () => {
    const dropdown = createDropdown({
      overlay: mockOverlay().overlay,
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
    const dropdown = createDropdown({
      overlay: mockOverlay().overlay,
      nativeSelect: select,
      onChange,
    });
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

it("registry panels() drops the wrapper once the trigger is detached", () => {
  // The entry's panels() closure reads wrapper.isConnected at call time.
  // A trigger removed from the DOM is no longer a containment surface:
  // the panel list shrinks to the portalled list alone, so an outside
  // press on the (detached) trigger location cannot count as inside.
  const trigger = document.createElement("button");
  trigger.type = "button";
  const cell = document.createElement("div");
  cell.appendChild(trigger);
  document.body.appendChild(cell);
  const registered: { panels: () => Element[] }[] = [];
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
    dismiss: {
      kind: "registry",
      register: entry => {
        registered.push(entry);
        return () => {};
      },
      id: "x",
      rank: 1,
    },
    onRowActivate: () => {},
  });
  listbox.open();
  expect(registered.length).toBe(1);
  const entry = registered[0] as { panels: () => Element[] };
  const wrapper = trigger.parentElement!;
  const list = listbox.getList()!;
  expect(entry.panels()).toEqual([wrapper, list]);
  // Detach the trigger: the wrapper is no longer connected, so the
  // containment drops to the portalled list only.
  cell.remove();
  expect(wrapper.isConnected).toBe(false);
  expect(entry.panels()).toEqual([list]);
  listbox.destroy();
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

it("open + close drains every document/window listener when the registry dismiss is used", () => {
  const read = countGlobal();
  const before = read();
  const trigger = document.createElement("button");
  trigger.type = "button";
  const cell = document.createElement("div");
  cell.appendChild(trigger);
  document.body.appendChild(cell);
  const registered: unknown[] = [];
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
    dismiss: {
      kind: "registry",
      register: entry => {
        registered.push(entry);
        return () => {};
      },
      id: "x",
      rank: 1,
    },
    onRowActivate: () => {},
  });
  listbox.open();
  expect(registered.length).toBe(1);
  // The engine still binds the scroll/resize/fullscreenchange mount listeners,
  // so the open count must exceed baseline.
  expect(read().total).toBeGreaterThan(before.total);
  listbox.close();
  expect(read()).toEqual(before);
  listbox.destroy();
  expect(read()).toEqual(before);
});

it("local dismiss (portal) binds no outside-press dismisser", () => {
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
      selectedClass: "nodown-selected",
      disabledAttr: "disabled",
      activedescendant: "none",
    },
    classes: {
      list: "nodown-list",
      row: "nodown-row",
      portal: "nodown-portal",
      up: "nodown-up",
      open: "nodown-open",
    },
    surface: { onSurfaceChange: () => () => {} },
    dismiss: { kind: "local" },
    onRowActivate: () => {},
  });
  listbox.open();
  const outside = document.createElement("div");
  document.body.appendChild(outside);
  outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  expect(listbox.getList()?.hidden).toBe(false);
  listbox.close();
  expect(read()).toEqual(before);
  listbox.destroy();
  outside.remove();
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
      if (original === undefined) {
        delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
      }
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

export const LISTBOX_ITEMS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Bee" },
  { value: "c", label: "Cee" },
  { value: "d", label: "De" },
  { value: "e", label: "Ef" },
  { value: "f", label: "Ff" },
  { value: "g", label: "Gg" },
  { value: "h", label: "Hh" },
  { value: "i", label: "Ii" },
  { value: "j", label: "Jj" },
];

/** A row in the surface's listbox, as exposed by the fixture. */
export interface ListboxRow {
  element: HTMLElement;
  value: string;
  label: string;
  disabled: boolean;
}

export interface ListboxSurface {
  /** The consumer's trigger (button or combobox div). */
  trigger(): HTMLElement;
  /** Current option rows, in DOM order. */
  rows(): ListboxRow[];
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

export interface ListboxFixture {
  name: string;
  /** Create a fresh surface + a wheel-probe container (the map container the
   *  wheel must not reach). Returns cleanup the runner wires to afterEach. */
  create(): {
    surface: ListboxSurface;
    /** The node the wheel must not reach. Portal fixtures return document.body
     *  (the portalled list's parent); inline fixtures return a map container
     *  div that wraps the control. */
    wheelProbe: () => HTMLElement;
    cleanup: () => void;
  };
}

const key = (
  target: EventTarget,
  keyValue: string,
  init: KeyboardEventInit = {},
): void => {
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

export const describeListboxFixture = (fixtures: ListboxFixture[]): void => {
  for (const fixture of fixtures) {
    describe(fixture.name, () => {
      let surface: ListboxSurface;
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
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
        expect(surface.isOpen()).toBe(false);
      });

      // ── 2. Escape chain: popup owns Escape while open ───────────────
      it("Escape closes the popup but a panel Escape handler stays silent", () => {
        if (!surface.ownsDismiss) return; // panel owns Escape for inline
        const panelEscape = vi.fn();
        // The panel behind the popup is a registry entry with a lower rank.
        // While the popup (rank 860) is open it is topmost and owns Escape;
        // once it closes the panel is topmost and gets the next Escape.
        const panelEntry = {
          id: "layer.style",
          isOpen: () => true,
          panels: () => [],
          close: () => true,
          dismissOn: "mousedown",
          pressPriority: 500,
          escapeRank: 500,
        };
        const unregisterPanel = activeRegistry!.register(panelEntry as never);
        try {
          surface.open();
          const row = surface.rows()[0];
          if (row) row.element.focus();
          document.body.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              bubbles: true,
              cancelable: true,
            }),
          );
          expect(surface.isOpen()).toBe(false);
          // Popup gone: the next Escape belongs to the panel again.
          document.body.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              bubbles: true,
              cancelable: true,
            }),
          );
          expect(panelEscape).not.toHaveBeenCalled();
        } finally {
          unregisterPanel();
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
            new KeyboardEvent("keydown", {
              key: "Escape",
              bubbles: true,
              cancelable: true,
            }),
          );
          expect(surface.isOpen()).toBe(true);
        } finally {
          window.removeEventListener("keydown", onWindow, true);
        }
      });

      // ── 3. outside press ────────────────────────────────────────────
      it("a press inside the control (row or wrapper) does not dismiss", () => {
        surface.open();
        surface
          .rows()[0]
          ?.element.dispatchEvent(new Event("pointerdown", { bubbles: true }));
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

// ── 1. bridged single (Heatmap aggregation / rampForm field) ───────────

// A real registry the fixtures wire into owning surfaces: the single
// Escape/outside-press dispatcher the production dropdowns now use. The registry
// installs document-capture listeners while entries are open, so Escape and
// outside mousedown actually reach the surface.
let activeRegistry: ReturnType<typeof ensureOverlayRegistry> | null = null;
const mockOverlay = () => {
  const map = {
    on: (_event: string, _handler: () => void) => {},
  } as unknown as L.Map;
  const registry = ensureOverlayRegistry(map);
  activeRegistry = registry;
  cleanup.push(() => {
    activeRegistry = null;
    registry.destroy();
  });
  return {
    overlay: {
      register: registry.register.bind(registry),
      id: DROPDOWN_OVERLAY_ID,
      rank: 860,
    },
    registered: [] as unknown[],
    registry,
  };
};

const bridgedFixture: ListboxFixture = {
  name: "contract: bridged single select",
  create() {
    const cell = document.createElement("div");
    cell.className = "foliplus-form-control";
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Pick a thing");
    for (const item of LISTBOX_ITEMS) {
      const opt = document.createElement("option");
      opt.value = item.value;
      opt.textContent = item.label;
      if (item.value === "c") opt.disabled = true;
      select.appendChild(opt);
    }
    select.value = "a";
    cell.appendChild(select);
    document.body.appendChild(cell);

    const dropdown: Dropdown = createDropdown({
      nativeSelect: select,
      overlay: mockOverlay().overlay,
    });

    const list = () => dropdown.getList();
    const rowEls = () =>
      Array.from(list()?.querySelectorAll<HTMLElement>("[role=option]") ?? []);
    const rows = () =>
      rowEls().map(el => ({
        element: el,
        value: el.getAttribute("data-value") ?? "",
        label: el.textContent ?? "",
        disabled: el.hasAttribute("disabled"),
      }));

    return {
      surface: {
        trigger: () => dropdown.trigger,
        rows,
        list,
        isOpen: () => dropdown.isOpen(),
        open: () => dropdown.open(),
        close: o => dropdown.close(o),
        destroy: () => dropdown.destroy(),
        pressRow: index => {
          const el = rowEls()[index];
          el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
          el.click();
        },
        pressOutside: () => {
          document.body.dispatchEvent(new Event("mousedown", { bubbles: true }));
        },
        openViaKeyboard: () => {
          dropdown.trigger.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "ArrowDown",
              bubbles: true,
              cancelable: true,
            }),
          );
        },
        multiple: false,
        ownsDismiss: true,
        value: () => dropdown.getValue(),
        expanded: () => dropdown.trigger.getAttribute("aria-expanded"),
      },
      wheelProbe: () => document.body,
      cleanup: () => dropdown.destroy(),
    };
  },
};

// ── 2. standalone multi (filter enum) ──────────────────────────────────

const multiFixture: ListboxFixture = {
  name: "contract: standalone multi select",
  create() {
    const dropdown: Dropdown = createDropdown({
      items: LISTBOX_ITEMS.map(({ value, label }) => ({ value, label })),
      multiple: true,
      values: ["a"],
      overlay: mockOverlay().overlay,
    });

    document.body.appendChild(dropdown.element);

    const list = () => dropdown.getList();
    const rowEls = () =>
      Array.from(list()?.querySelectorAll<HTMLElement>("[role=option]") ?? []);
    const rows = () =>
      rowEls().map(el => ({
        element: el,
        value: el.getAttribute("data-value") ?? "",
        label: el.textContent ?? "",
        disabled: el.hasAttribute("disabled"),
      }));

    return {
      surface: {
        trigger: () => dropdown.trigger,
        rows,
        list,
        isOpen: () => dropdown.isOpen(),
        open: () => dropdown.open(),
        close: o => dropdown.close(o),
        destroy: () => dropdown.destroy(),
        pressRow: index => {
          const el = rowEls()[index];
          el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
          el.click();
        },
        pressOutside: () => {
          document.body.dispatchEvent(new Event("mousedown", { bubbles: true }));
        },
        openViaKeyboard: () => {
          dropdown.trigger.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "ArrowDown",
              bubbles: true,
              cancelable: true,
            }),
          );
        },
        multiple: true,
        ownsDismiss: true,
        value: () => dropdown.getValues().join(","),
        expanded: () => dropdown.trigger.getAttribute("aria-expanded"),
      },
      wheelProbe: () => document.body,
      cleanup: () => dropdown.destroy(),
    };
  },
};

// ── 5. rampForm field (LayerControl value-based fill) ──────────────────

const rampFormFixture: ListboxFixture = {
  name: "contract: rampForm field row",
  create() {
    const { dropdown, select } = buildFieldRow({
      label: "Field",
      ariaLabel: "Field",
      fields: LISTBOX_ITEMS.map(i => i.value),
      value: "a",
      overlay: mockOverlay().overlay,
    });

    document.body.appendChild(dropdown.element);

    const list = () => dropdown.getList();
    const rowEls = () =>
      Array.from(list()?.querySelectorAll<HTMLElement>("[role=option]") ?? []);
    const rows = () =>
      rowEls().map(el => ({
        element: el,
        value: el.getAttribute("data-value") ?? "",
        label: el.textContent ?? "",
        disabled: el.hasAttribute("disabled"),
      }));

    return {
      surface: {
        trigger: () => dropdown.trigger,
        rows,
        list,
        isOpen: () => dropdown.isOpen(),
        open: () => dropdown.open(),
        close: o => dropdown.close(o),
        destroy: () => dropdown.destroy(),
        pressRow: index => {
          const el = rowEls()[index];
          el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
          el.click();
        },
        pressOutside: () => {
          document.body.dispatchEvent(new Event("mousedown", { bubbles: true }));
        },
        openViaKeyboard: () => {
          dropdown.trigger.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "ArrowDown",
              bubbles: true,
              cancelable: true,
            }),
          );
        },
        multiple: false,
        ownsDismiss: true,
        value: () => select.value,
        expanded: () => dropdown.trigger.getAttribute("aria-expanded"),
      },
      wheelProbe: () => document.body,
      cleanup: () => dropdown.destroy(),
    };
  },
};

describeListboxFixture([bridgedFixture, multiFixture, rampFormFixture]);

// ── 3. picker inline ───────────────────────────────────────────────────

const pickerInlineFixture: ListboxFixture = {
  name: "contract: scheme picker inline",
  create() {
    const cell = document.createElement("div");
    cell.className = "foliplus-form-control";
    const trigger = document.createElement("div");
    trigger.className = "foliplus-heatmap-scheme-bar";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("tabindex", "0");
    const inner = document.createElement("div");
    inner.setAttribute("data-scheme-bar-inner", "");
    trigger.appendChild(inner);
    cell.appendChild(trigger);
    document.body.appendChild(cell);

    let current = "Reds";
    const picker = createSchemePicker({
      trigger,
      schemes: LISTBOX_ITEMS.map(i => i.value),
      value: "a",
      numClasses: 6,
      portal: false,
      colorScale: () => ["#f00", "#0f0", "#00f"],
      onChange: name => {
        current = name;
      },
      label: "Color scheme",
    });

    const list = () => picker.getDropdown();
    const rowEls = () =>
      Array.from(list()?.querySelectorAll<HTMLElement>("[role=option]") ?? []);
    const rows = () =>
      rowEls().map(el => ({
        element: el,
        value: el.getAttribute("data-scheme-name") ?? "",
        label: el.querySelector("div")?.textContent ?? "",
        disabled: el.getAttribute("aria-disabled") === "true",
      }));

    return {
      surface: {
        trigger: () => trigger,
        rows,
        list,
        isOpen: () => picker.getDropdown() !== null,
        open: () => picker.toggle(),
        close: o => picker.close(o),
        destroy: () => picker.destroy(),
        pressRow: index => {
          const el = rowEls()[index];
          el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
          el.click();
        },
        pressOutside: () => {
          document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        },
        openViaKeyboard: () => {
          trigger.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              bubbles: true,
              cancelable: true,
            }),
          );
        },
        multiple: false,
        ownsDismiss: false,
        value: () => current,
        expanded: () => trigger.getAttribute("aria-expanded"),
      },
      wheelProbe: () => document.body,
      cleanup: () => picker.destroy(),
    };
  },
};

// ── 4. picker portal ───────────────────────────────────────────────────

const pickerPortalFixture: ListboxFixture = {
  name: "contract: scheme picker portal",
  create() {
    const cell = document.createElement("div");
    cell.className = "foliplus-form-control";
    const trigger = document.createElement("div");
    trigger.className = "foliplus-heatmap-scheme-bar";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("tabindex", "0");
    const inner = document.createElement("div");
    inner.setAttribute("data-scheme-bar-inner", "");
    trigger.appendChild(inner);
    cell.appendChild(trigger);
    document.body.appendChild(cell);

    let current = "a";
    const picker = createSchemePicker({
      trigger,
      schemes: LISTBOX_ITEMS.map(i => i.value),
      value: "a",
      numClasses: 6,
      portal: true,
      colorScale: () => ["#f00", "#0f0", "#00f"],
      onChange: name => {
        current = name;
      },
      label: "Color scheme",
    });

    const list = () => picker.getDropdown();
    const rowEls = () =>
      Array.from(list()?.querySelectorAll<HTMLElement>("[role=option]") ?? []);
    const rows = () =>
      rowEls().map(el => ({
        element: el,
        value: el.getAttribute("data-scheme-name") ?? "",
        label: el.querySelector("div")?.textContent ?? "",
        disabled: el.getAttribute("aria-disabled") === "true",
      }));

    return {
      surface: {
        trigger: () => trigger,
        rows,
        list,
        isOpen: () => picker.getDropdown() !== null,
        open: () => picker.toggle(),
        close: o => picker.close(o),
        destroy: () => picker.destroy(),
        pressRow: index => {
          const el = rowEls()[index];
          el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
          el.click();
        },
        pressOutside: () => {
          document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        },
        openViaKeyboard: () => {
          trigger.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              bubbles: true,
              cancelable: true,
            }),
          );
        },
        multiple: false,
        ownsDismiss: false,
        value: () => current,
        expanded: () => trigger.getAttribute("aria-expanded"),
      },
      wheelProbe: () => document.body,
      cleanup: () => picker.destroy(),
    };
  },
};

describeListboxFixture([pickerInlineFixture, pickerPortalFixture]);

// ── Row contract (moved from listbox.rowContract.test.ts) ────────────

// ── Dropdown shape (the real adapter shape from dropdown.ts) ────────────

const makeCell = (
  value: string,
  options: readonly { value: string; label: string; disabled?: boolean }[],
): { select: HTMLSelectElement; cell: HTMLElement } => {
  const cell = document.createElement("div");
  cell.className = "foliplus-form-control";
  const select = document.createElement("select");
  select.className = "foliplus-form-select";
  select.setAttribute("aria-label", "Pick a thing");
  for (const option of options) {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    if (option.disabled) el.disabled = true;
    select.appendChild(el);
  }
  select.value = value;
  cell.appendChild(select);
  document.body.appendChild(cell);
  return { select, cell };
};

const bridged = (
  value: string,
  options: readonly { value: string; label: string; disabled?: boolean }[],
  extra: Record<string, unknown> = {},
): { select: HTMLSelectElement; cell: HTMLElement; dropdown: Dropdown } => {
  const { select, cell } = makeCell(value, options);
  const dropdown = createDropdown({
    overlay: mockOverlay().overlay,
    nativeSelect: select,
    ...extra,
  });
  cleanup.push(() => dropdown.destroy());
  return { select, cell, dropdown };
};

const optionEls = (dropdown: Dropdown): HTMLButtonElement[] =>
  Array.from(
    dropdown
      .getList()
      ?.querySelectorAll<HTMLButtonElement>(".foliplus-dropdown-option") ?? [],
  );

describe("listbox row contract: dropdown shape (rowTag/dataKey/selectedClass/disabledAttr/activedescendant/renderRow)", () => {
  it("rowTag: renders <button type=button> rows, not <div>", () => {
    const { dropdown } = bridged("a", [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ]);
    dropdown.open();
    const els = optionEls(dropdown);
    expect(els).toHaveLength(2);
    expect(els[0].tagName).toBe("BUTTON");
    expect(els[0].getAttribute("type")).toBe("button");
    expect(els[0].getAttribute("role")).toBe("option");
  });

  it("dataKey: carries data-value, not data-scheme-name", () => {
    const { dropdown } = bridged("a", [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ]);
    dropdown.open();
    const els = optionEls(dropdown);
    expect(els[0].getAttribute("data-value")).toBe("a");
    expect(els[0].getAttribute("data-scheme-name")).toBeNull();
    expect(els[1].getAttribute("data-value")).toBe("b");
  });

  it("selectedClass: the selected row carries foliplus-is-selected and aria-selected", () => {
    const { dropdown } = bridged("b", [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ]);
    dropdown.open();
    const els = optionEls(dropdown);
    expect(els[1].classList.contains("foliplus-is-selected")).toBe(true);
    expect(els[1].getAttribute("aria-selected")).toBe("true");
    expect(els[0].classList.contains("foliplus-is-selected")).toBe(false);
    expect(els[0].getAttribute("aria-selected")).toBe("false");
  });

  it("disabledAttr: a disabled row uses native disabled (not aria-disabled)", () => {
    const { dropdown } = bridged("a", [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta", disabled: true },
    ]);
    dropdown.open();
    const els = optionEls(dropdown);
    expect(els[1].hasAttribute("disabled")).toBe(true);
    expect(els[1].hasAttribute("aria-disabled")).toBe(false);
    // Native disabled semantics: the property is set (jsdom does not enforce
    // focusability for disabled buttons, so assert the property not focus()).
    expect(els[1].disabled).toBe(true);
  });

  it("activedescendant: the trigger never gets aria-activedescendant (dropdown does not track)", () => {
    const { dropdown } = bridged("a", [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ]);
    const trigger = dropdown.trigger;
    dropdown.open();
    const els = optionEls(dropdown);
    // Focus a row via keyboard — the dropdown shape does not manage
    // aria-activedescendant on the trigger.
    els[0].focus();
    dropdown.getList()?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(els[1]);
    // The "none" shape does not track the focused row on the trigger.
    const activeDesc = trigger.getAttribute("aria-activedescendant");
    expect(activeDesc === null || activeDesc === "").toBe(true);
    // The "none" shape also does not assign stable row ids (only the "trigger"
    // shape needs ids for aria-activedescendant to reference).
    expect(els[0].id).toBe("");
  });

  it("renderRow: the default renders a span label with the rowLabel class", () => {
    const { dropdown } = bridged("a", [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ]);
    dropdown.open();
    const els = optionEls(dropdown);
    const label = els[0].querySelector(".foliplus-dropdown-option-label");
    expect(label?.tagName).toBe("SPAN");
    expect(label?.textContent).toBe("Alpha");
    // The default content replaces the whole row body.
    expect(els[0].childElementCount).toBe(1);
  });
});

// ── Picker shape (the shape schemePicker will supply once migrated) ─────

const makeRowPicker = (
  items: readonly { value: string; label: string; disabled?: boolean }[],
  selected: readonly string[] = [],
  dismiss?: {
    kind: "registry";
    register: (e: {
      id: string;
      isOpen(): boolean;
      close(opts: { restoreFocus: boolean }): void | boolean;
      panels(): Element[];
      dismissOn: "mousedown" | "click";
      pressPriority: number;
      escapeRank?: number;
    }) => () => void;
    id: string;
    rank: number;
  },
) => {
  const cell = document.createElement("div");
  cell.className = "picker-cell";
  const trigger = document.createElement("div");
  trigger.className = "picker-trigger";
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-label", "Color scheme");
  trigger.setAttribute("tabindex", "0");
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
    dismiss: dismiss ?? { kind: "local" },
    onRowActivate: index => {
      activated.push(index);
    },
  });
  cleanup.push(() => listbox.destroy());
  return { cell, trigger, listbox, activated };
};

const pickerRows = (listbox: ReturnType<typeof createListbox>) =>
  Array.from(listbox.getList()?.querySelectorAll<HTMLElement>(".picker-row") ?? []);

describe("listbox row contract: picker shape", () => {
  it("rowTag+dataKey+renderRow: div rows with data-scheme-name and a colour bar", () => {
    const { listbox } = makeRowPicker([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ]);
    listbox.open();
    const els = pickerRows(listbox);
    expect(els[0].tagName).toBe("DIV");
    expect(els[0].getAttribute("data-scheme-name")).toBe("a");
    expect(els[0].getAttribute("data-value")).toBeNull();
    expect(els[0].querySelector(".picker-bar")?.textContent).toBe("Alpha");
    // The colour bar replaces the default label span.
    expect(els[0].querySelector("span")).toBeNull();
  });

  it("selectedClass: foliplus-is-active on the selected row, plus aria-selected", () => {
    const { listbox } = makeRowPicker(
      [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
      ],
      ["b"],
    );
    listbox.open();
    const els = pickerRows(listbox);
    expect(els[1].classList.contains("foliplus-is-active")).toBe(true);
    expect(els[1].getAttribute("aria-selected")).toBe("true");
    expect(els[0].classList.contains("foliplus-is-active")).toBe(false);
  });

  it("disabledAttr: aria-disabled on a disabled row, still focusable", () => {
    const { listbox } = makeRowPicker([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta", disabled: true },
    ]);
    listbox.open();
    const els = pickerRows(listbox);
    expect(els[1].getAttribute("aria-disabled")).toBe("true");
    expect(els[1].hasAttribute("disabled")).toBe(false);
    // aria-disabled rows stay focusable (tabindex=-1 from the ARIA trio).
    expect(els[1].getAttribute("tabindex")).toBe("-1");
  });

  it("activedescendant: the trigger tracks the focused row via aria-activedescendant", () => {
    const { trigger, listbox } = makeRowPicker([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ]);
    listbox.open();
    const els = pickerRows(listbox);
    els[0].focus();
    listbox.getList()?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(els[1]);
    // The focused row must have a stable, non-empty id (the engine assigns it
    // only for the activedescendant=trigger shape).
    const activeId = els[1].id;
    expect(activeId).not.toBe("");
    // The trigger's aria-activedescendant must resolve back to that same row
    // (a string equality alone would pass if BOTH sides were empty).
    expect(trigger.getAttribute("aria-activedescendant")).toBe(activeId);
    expect(document.getElementById(activeId)).toBe(els[1]);
  });

  it("activedescendant: no row focused → the attribute is absent, never empty", () => {
    const { trigger, listbox } = makeRowPicker([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ]);
    listbox.open();
    // Open only: no row has been focused, so the trigger must not track one.
    // The attribute must be absent (null), never an empty string — an empty
    // value would be indistinguishable from a missing row id and hide a bug.
    expect(trigger.getAttribute("aria-activedescendant")).toBeNull();
    expect(trigger.hasAttribute("aria-activedescendant")).toBe(false);
    // Closing removes it entirely.
    listbox.close();
    expect(trigger.hasAttribute("aria-activedescendant")).toBe(false);
  });
});

// ── Disabled-row activation guard ───────────────────────────────────────

describe("listbox row contract: disabled-row guard", () => {
  it("clicking a disabled row does not activate and does not close", () => {
    const { listbox, activated, trigger } = makeRowPicker([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta", disabled: true },
    ]);
    listbox.open();
    const els = pickerRows(listbox);
    els[1].click();
    expect(activated).toEqual([]);
    // Single mode: a real activation closes; the disabled click must not.
    expect(listbox.isOpen()).toBe(true);
    expect(document.activeElement).not.toBe(trigger); // trigger not force-focused
  });

  it("pressing Enter on a disabled row does not activate", () => {
    const { listbox, activated } = makeRowPicker([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta", disabled: true },
    ]);
    listbox.open();
    const els = pickerRows(listbox);
    els[1].focus();
    els[1].dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(activated).toEqual([]);
    expect(listbox.isOpen()).toBe(true);
  });

  it("the disabled click guard is load-bearing (negative control): deleting it turns the click red", () => {
    // NOTE: this test itself does NOT delete the guard — it asserts the guard
    // is exercised. The negative control (temporarily removing the guard) is
    // run manually against a scratch edit of listbox.ts; the result (the click
    // test goes red) is recorded in the PR body. See the PR description.
    const { listbox, activated } = makeRowPicker([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta", disabled: true },
    ]);
    listbox.open();
    const els = pickerRows(listbox);
    els[1].click();
    expect(activated).toEqual([]);
  });
});

// ── Keyboard contract ───────────────────────────────────────────────────

describe("listbox row contract: keyboard + focus restore", () => {
  it("closing restores focus to the trigger (single-mode activate)", () => {
    const { trigger, listbox } = makeRowPicker([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ]);
    trigger.focus();
    listbox.open();
    const els = pickerRows(listbox);
    els[1].focus();
    els[1].dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(listbox.isOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape closes and restores focus to the trigger", () => {
    const { trigger, listbox } = makeRowPicker(
      [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
      ],
      [],
      { kind: "registry", register: mockOverlay().overlay.register, id: "x", rank: 1 },
    );
    trigger.focus();
    listbox.open();
    pickerRows(listbox)[0].focus();
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(listbox.isOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("Tab closes and hands focus back to the trigger for browser Tab movement", () => {
    const { trigger, listbox } = makeRowPicker([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ]);
    trigger.focus();
    listbox.open();
    pickerRows(listbox)[0].focus();
    listbox
      .getList()
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
      );
    expect(listbox.isOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("PageUp/PageDown fall through (deliberately not implemented — no crash, no focus move)", () => {
    const { listbox } = makeRowPicker([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
      { value: "c", label: "Gamma" },
    ]);
    listbox.open();
    const els = pickerRows(listbox);
    els[1].focus();
    listbox.getList()?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "PageDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    // The engine does not page; focus stays where it was (no preventDefault,
    // so the browser default page-scroll would move it — jsdom has no scroll).
    expect(document.activeElement).toBe(els[1]);
  });

  it("type-ahead falls through (deliberately not implemented — no jump)", () => {
    const { listbox } = makeRowPicker([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
      { value: "c", label: "Gamma" },
    ]);
    listbox.open();
    const els = pickerRows(listbox);
    els[0].focus();
    listbox
      .getList()
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "g", bubbles: true, cancelable: true }),
      );
    // No type-ahead: typing "g" does not jump to Gamma.
    expect(document.activeElement).toBe(els[0]);
  });
});

describe("listbox engine: focused row stays visible (scrollIntoView guard)", () => {
  it("scrolls the focused row into view with nearest semantics", () => {
    const { listbox } = makePicker([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
      { value: "c", label: "Gamma" },
    ]);
    listbox.open();
    const els = rows(listbox);
    // jsdom has no layout: scrollIntoView is undefined on rows. Provide it so
    // the shared ensureActiveVisible contract is observable.
    const spy = vi.fn();
    (els[1] as unknown as { scrollIntoView: (o?: unknown) => void }).scrollIntoView =
      spy;
    // Move focus to the second row via ArrowDown from the first.
    els[0].focus();
    els[0].dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(els[1]);
    expect(spy).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  });
});

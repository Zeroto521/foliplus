// Tests for the shared select replacement (common/dropdown.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Dropdown, createDropdown, dropdownOf } from "#common/dropdown.js";

// The class names are the module's DOM contract (its table stays private), so
// the tests pin them by literal name, exactly like the stylesheet does.
const CLS = {
  label: "foliplus-dropdown-label",
  list: "foliplus-dropdown-list",
  option: "foliplus-dropdown-option",
  check: "foliplus-dropdown-check",
  placeholder: "foliplus-dropdown-placeholder",
} as const;

// ── Fixtures ───────────────────────────────────────────────────────────

const cleanup: (() => void)[] = [];

afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.();
  document.body.innerHTML = "";
});

/** A panel-shaped form cell with the native select the panels render. */
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
): { select: HTMLSelectElement; cell: HTMLElement; dropdown: Dropdown } => {
  const { select, cell } = makeCell(value, options);
  const dropdown = createDropdown({ nativeSelect: select });
  cleanup.push(() => dropdown.destroy());
  return { select, cell, dropdown };
};

const labelOf = (dropdown: Dropdown): string =>
  dropdown.element.querySelector("." + CLS.label)?.textContent ?? "";

// The popup is portalled out of the wrapper while it is open (a short panel
// must not clip it), so the rows are read off the list, not the wrapper.
const optionEls = (dropdown: Dropdown): HTMLButtonElement[] =>
  Array.from(
    dropdown.getList()?.querySelectorAll<HTMLButtonElement>("." + CLS.option) ?? [],
  );

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

// ── Bridged (native select) mode ──────────────────────────────────────

describe("dropdown: bridged single select", () => {
  it("moves the select out of the tab order and shows its current label", () => {
    const { select, dropdown } = bridged("b", [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Bee" },
    ]);
    expect(labelOf(dropdown)).toBe("Bee");
    expect(select.hidden).toBe(true);
    expect(select.tabIndex).toBe(-1);
    expect(select.getAttribute("aria-hidden")).toBe("true");
    expect(dropdown.trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(dropdown.trigger.getAttribute("aria-expanded")).toBe("false");
    expect(dropdown.trigger.getAttribute("aria-label")).toBe("Pick a thing");
  });

  it("opens a listbox listing every option, then closes on a second click", () => {
    const { dropdown } = bridged("a", [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Bee" },
    ]);
    dropdown.trigger.click();
    expect(dropdown.isOpen()).toBe(true);
    expect(dropdown.getList()?.hidden).toBe(false);
    expect(optionEls(dropdown).map(el => el.textContent)).toEqual(["Alpha", "Bee"]);
    expect(dropdown.getList()?.getAttribute("role")).toBe("listbox");
    dropdown.trigger.click();
    expect(dropdown.isOpen()).toBe(false);
  });

  it("picking an option writes the select, fires a bubbling change and closes", () => {
    const { select, dropdown } = bridged("a", [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Bee" },
    ]);
    const selectHandler = vi.fn();
    const cellHandler = vi.fn();
    select.onchange = selectHandler;
    // A panel delegates change on its root: the dispatched event must bubble.
    dropdown.element.parentElement?.addEventListener("change", cellHandler);
    dropdown.trigger.click();
    optionEls(dropdown)[1].click();
    expect(select.value).toBe("b");
    expect(selectHandler).toHaveBeenCalledTimes(1);
    expect(cellHandler).toHaveBeenCalledTimes(1);
    expect(labelOf(dropdown)).toBe("Bee");
    expect(dropdown.isOpen()).toBe(false);
    expect(document.activeElement).toBe(dropdown.trigger);
  });

  it("ArrowDown on the closed trigger opens on the first option", () => {
    const { dropdown } = bridged("a", [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Bee" },
    ]);
    key(dropdown.trigger, "ArrowDown");
    expect(dropdown.isOpen()).toBe(true);
    expect(document.activeElement).toBe(optionEls(dropdown)[0]);
    key(optionEls(dropdown)[0], "ArrowDown");
    expect(document.activeElement).toBe(optionEls(dropdown)[1]);
    key(optionEls(dropdown)[1], "ArrowUp");
    expect(document.activeElement).toBe(optionEls(dropdown)[0]);
  });

  it("Enter on a focused option picks it, and the keyboard path skips disabled rows", () => {
    const { select, dropdown } = bridged("a", [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Bee", disabled: true },
      { value: "c", label: "Cee" },
    ]);
    key(dropdown.trigger, "ArrowDown");
    key(optionEls(dropdown)[0], "ArrowDown");
    expect(document.activeElement).toBe(optionEls(dropdown)[2]);
    key(optionEls(dropdown)[2], "Enter");
    expect(select.value).toBe("c");
    expect(dropdown.isOpen()).toBe(false);
  });

  it("Escape closes the list and keeps the key from the panel behind it", () => {
    const { dropdown } = bridged("a", [{ value: "a", label: "Alpha" }]);
    const panelHandler = vi.fn();
    document.addEventListener("keydown", panelHandler);
    cleanup.push(() => document.removeEventListener("keydown", panelHandler));
    key(dropdown.trigger, "ArrowDown");
    optionEls(dropdown)[0].dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(dropdown.isOpen()).toBe(false);
    expect(panelHandler).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(dropdown.trigger);
  });

  it("closes on an outside press", () => {
    const { dropdown } = bridged("a", [{ value: "a", label: "Alpha" }]);
    dropdown.trigger.click();
    expect(dropdown.isOpen()).toBe(true);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(dropdown.isOpen()).toBe(false);
  });

  it("Tab closes the list and hands focus to the next control", () => {
    const { dropdown } = bridged("a", [{ value: "a", label: "Alpha" }]);
    // A control after the dropdown, the way a form cell has one.
    const after = document.createElement("button");
    document.body.appendChild(after);
    key(dropdown.trigger, "ArrowDown");
    key(optionEls(dropdown)[0], "Tab");
    expect(dropdown.isOpen()).toBe(false);
    // Without the hand-off the focused row is hidden with the popup and focus
    // falls to <body>, which makes the next Tab restart from the top of the
    // page (measured on the heatmap panel).
    expect(document.activeElement).toBe(after);
  });

  it("Shift+Tab hands focus to the control before the dropdown", () => {
    const before = document.createElement("button");
    document.body.appendChild(before);
    const { dropdown } = bridged("a", [{ value: "a", label: "Alpha" }]);
    key(dropdown.trigger, "ArrowDown");
    key(optionEls(dropdown)[0], "Tab", { shiftKey: true });
    expect(dropdown.isOpen()).toBe(false);
    expect(document.activeElement).toBe(before);
  });

  it("refresh re-reads a rewritten option list and a programmatic value", () => {
    const { select, dropdown } = bridged("a", [{ value: "a", label: "Alpha" }]);
    select.innerHTML = "";
    for (const [value, label] of [
      ["x", "Ex"],
      ["y", "Why"],
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    }
    select.value = "y";
    dropdown.refresh();
    expect(labelOf(dropdown)).toBe("Why");
    dropdown.open();
    expect(optionEls(dropdown).map(el => el.textContent)).toEqual(["Ex", "Why"]);
  });

  it("a change dispatched by someone else keeps the closed trigger in step", () => {
    const { select, dropdown } = bridged("a", [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Bee" },
    ]);
    select.value = "b";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(labelOf(dropdown)).toBe("Bee");
  });

  it("shows a disabled empty-value prompt row as the closed placeholder", () => {
    const { dropdown } = bridged("", [
      { value: "", label: "Choose a layer", disabled: true },
      { value: "a", label: "Alpha" },
    ]);
    expect(labelOf(dropdown)).toBe("Choose a layer");
    expect(dropdown.trigger.classList.contains(CLS.placeholder)).toBe(true);
  });

  it("exposes the dropdown by select so consumer writes can refresh it", () => {
    const { select, dropdown } = bridged("a", [{ value: "a", label: "Alpha" }]);
    expect(dropdownOf(select)).toBe(dropdown);
    dropdown.destroy();
    expect(dropdownOf(select)).toBeNull();
  });

  it("a consumer hint wins over the label summary in the tooltip", () => {
    const { dropdown } = bridged("a", [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Bee" },
    ]);
    expect(dropdown.trigger.title).toBe("Alpha");
    dropdown.setHint("Needs a numeric field");
    expect(dropdown.trigger.title).toBe("Needs a numeric field");
    dropdown.setHint("");
    expect(dropdown.trigger.title).toBe("Alpha");
  });

  it("refuses a second dropdown on the same select", () => {
    const { select } = bridged("a", [{ value: "a", label: "Alpha" }]);
    expect(() => createDropdown({ nativeSelect: select })).toThrow(
      /already has a dropdown/,
    );
  });
});

// ── Standalone / multiple mode ────────────────────────────────────────

describe("dropdown: multiple selections", () => {
  const items = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Bee" },
    { value: "c", label: "Cee" },
  ];

  it("toggles options without closing and reports every value", () => {
    const changes: string[][] = [];
    const dropdown = createDropdown({
      items,
      multiple: true,
      placeholder: "Any value",
      selectedLabel: labels => labels.length + " picked",
      onChange: (_value, values) => changes.push([...values]),
    });
    cleanup.push(() => dropdown.destroy());
    document.body.appendChild(dropdown.element);

    expect(labelOf(dropdown)).toBe("Any value");
    expect(dropdown.getList()?.getAttribute("aria-multiselectable")).toBe("true");

    dropdown.trigger.click();
    optionEls(dropdown)[0].click();
    expect(dropdown.isOpen()).toBe(true);
    expect(labelOf(dropdown)).toBe("Alpha");
    expect(optionEls(dropdown)[0].getAttribute("aria-selected")).toBe("true");

    optionEls(dropdown)[2].click();
    expect(dropdown.isOpen()).toBe(true);
    expect(labelOf(dropdown)).toBe("2 picked");
    expect(dropdown.getValues()).toEqual(["a", "c"]);
    expect(changes).toEqual([["a"], ["a", "c"]]);

    // Toggling the same row off again restores the earlier text.
    optionEls(dropdown)[2].click();
    expect(labelOf(dropdown)).toBe("Alpha");
    expect(dropdown.getValues()).toEqual(["a"]);
  });

  it("keeps focus in the list after a toggle", () => {
    const dropdown = createDropdown({ items, multiple: true });
    cleanup.push(() => dropdown.destroy());
    document.body.appendChild(dropdown.element);
    key(dropdown.trigger, "ArrowDown");
    key(optionEls(dropdown)[0], " ");
    expect(dropdown.getValues()).toEqual(["a"]);
    expect(dropdown.isOpen()).toBe(true);
  });

  it("applies initial values and setValues", () => {
    const dropdown = createDropdown({
      items,
      multiple: true,
      values: ["b"],
      selectedLabel: labels => labels.join(" + "),
    });
    cleanup.push(() => dropdown.destroy());
    document.body.appendChild(dropdown.element);
    expect(labelOf(dropdown)).toBe("Bee");
    dropdown.setValues(["a", "b"]);
    expect(labelOf(dropdown)).toBe("Alpha + Bee");
    expect(dropdown.getValues()).toEqual(["a", "b"]);
  });

  it("renders no check slot in single mode", () => {
    const dropdown = createDropdown({ items, value: "a" });
    cleanup.push(() => dropdown.destroy());
    document.body.appendChild(dropdown.element);
    dropdown.trigger.click();
    expect(dropdown.getList()?.querySelector("." + CLS.check)).toBeNull();
    expect(dropdown.getList()?.hasAttribute("aria-multiselectable")).toBe(false);
  });

  it("refuses a native select backing a multiple dropdown", () => {
    const { select } = makeCell("a", [{ value: "a", label: "Alpha" }]);
    expect(() => createDropdown({ nativeSelect: select, multiple: true })).toThrow(
      /cannot back a multiple dropdown/,
    );
  });

  it("closes the single-value standalone control on pick", () => {
    const picks: string[] = [];
    const dropdown = createDropdown({
      items,
      value: "a",
      onChange: value => picks.push(value),
    });
    cleanup.push(() => dropdown.destroy());
    document.body.appendChild(dropdown.element);
    expect(labelOf(dropdown)).toBe("Alpha");
    dropdown.trigger.click();
    optionEls(dropdown)[1].click();
    expect(dropdown.isOpen()).toBe(false);
    expect(dropdown.getValue()).toBe("b");
    expect(labelOf(dropdown)).toBe("Bee");
    expect(picks).toEqual(["b"]);
  });
});

// ── Lifecycle ─────────────────────────────────────────────────────────

describe("dropdown: lifecycle", () => {
  it("destroy removes the popup and its listeners", () => {
    const { dropdown } = bridged("a", [{ value: "a", label: "Alpha" }]);
    expect(dropdown.getList()).not.toBeNull();
    dropdown.destroy();
    expect(dropdown.getList()).toBeNull();
    // A destroyed control is inert: open() must not resurrect the list.
    dropdown.open();
    expect(dropdown.isOpen()).toBe(false);
  });

  it("reports open/close through onToggle", () => {
    const states: boolean[] = [];
    const { select } = makeCell("a", [{ value: "a", label: "Alpha" }]);
    const toggling = createDropdown({
      nativeSelect: select,
      onToggle: open => states.push(open),
    });
    cleanup.push(() => toggling.destroy());
    toggling.open();
    toggling.close();
    expect(states).toEqual([true, false]);
  });
});
// ── Popup geometry: portalled out of the panel ────────────────────────
//
// The panel around a select is often shorter than the popup (the heatmap's
// layer row is 44px tall until a layer is picked, LayerControl's content
// scrolls). A popup clamped to that clip box collapsed to a single row — the
// "completely unusable" regression — so the open popup is mounted on <body>
// with fixed coordinates and re-pinned on scroll.

describe("dropdown: popup geometry", () => {
  const rect = (top: number, height: number): (() => DOMRect) => {
    return () => {
      const width = 160;
      return {
        x: 120,
        y: top,
        top,
        bottom: top + height,
        left: 120,
        right: 120 + width,
        width,
        height,
        toJSON: () => ({}),
      } as DOMRect;
    };
  };

  const pin = (el: HTMLElement, top: number, height: number): void => {
    Object.defineProperty(el, "getBoundingClientRect", {
      value: rect(top, height),
      configurable: true,
    });
  };

  const setViewport = (height: number): (() => void) => {
    const original = Object.getOwnPropertyDescriptor(window, "innerHeight");
    Object.defineProperty(window, "innerHeight", {
      value: height,
      configurable: true,
    });
    return () => {
      if (original) Object.defineProperty(window, "innerHeight", original);
    };
  };

  it("mounts the popup on the document body while it is open", () => {
    const { dropdown } = bridged("a", [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Bee" },
    ]);
    dropdown.open();
    const list = dropdown.getList() as HTMLElement;
    expect(list.parentElement).toBe(document.body);
    expect(list.classList.contains("foliplus-dropdown-portal")).toBe(true);
    dropdown.close();
    // Closed: back in the wrapper, so the DOM shape the panel owns is intact.
    expect(list.parentElement).toBe(dropdown.element);
  });

  it("pins the popup below the trigger in viewport coordinates", () => {
    const { dropdown } = bridged("a", [{ value: "a", label: "Alpha" }]);
    const restore = setViewport(900);
    pin(dropdown.trigger, 100, 30);
    dropdown.open();
    const list = dropdown.getList() as HTMLElement;
    expect(list.style.position).toBe("fixed");
    expect(list.style.top).toBe("138px");
    expect(list.style.left).toBe("120px");
    expect(list.style.width).toBe("160px");
    expect(list.classList.contains("foliplus-dropdown-up")).toBe(false);
    dropdown.close();
    restore();
  });

  it("flips above the trigger when the viewport leaves no room below", () => {
    const { dropdown } = bridged("a", [{ value: "a", label: "Alpha" }]);
    const restore = setViewport(320);
    // Trigger sits 30px above the viewport bottom: one row, not two.
    pin(dropdown.trigger, 280, 30);
    pin(dropdown.getList() as HTMLElement, 310, 106);
    dropdown.open();
    const list = dropdown.getList() as HTMLElement;
    expect(list.classList.contains("foliplus-dropdown-up")).toBe(true);
    expect(list.style.top).toBe("");
    expect(list.style.bottom).toBe("48px");
    dropdown.close();
    restore();
  });

  it("re-pins on scroll and on resize instead of dismissing the popup", () => {
    const { dropdown } = bridged("a", [{ value: "a", label: "Alpha" }]);
    const restore = setViewport(900);
    pin(dropdown.trigger, 100, 30);
    dropdown.open();
    expect(dropdown.isOpen()).toBe(true);
    // The panel scrolls under the pinned popup: it must follow the trigger,
    // not vanish (a long option list is scrolled inside, and focusOption's
    // scrollIntoView fires the same event).
    pin(dropdown.trigger, 60, 30);
    window.dispatchEvent(new Event("scroll"));
    expect(dropdown.isOpen()).toBe(true);
    expect((dropdown.getList() as HTMLElement).style.top).toBe("98px");
    window.dispatchEvent(new Event("resize"));
    expect(dropdown.isOpen()).toBe(true);
    dropdown.close();
    restore();
  });

  it("keeps the popup's own scroll from moving the anchor", () => {
    const { dropdown } = bridged("a", [{ value: "a", label: "Alpha" }]);
    const restore = setViewport(900);
    pin(dropdown.trigger, 100, 30);
    dropdown.open();
    const list = dropdown.getList() as HTMLElement;
    list.dispatchEvent(new Event("scroll", { bubbles: true }));
    expect(dropdown.isOpen()).toBe(true);
    expect(list.style.top).toBe("138px");
    dropdown.close();
    restore();
  });
});

// ── Escape ownership ─────────────────────────────────────────────────
//
// #783's panel dispatcher listens on document *capture*: a bubble-phase
// stopPropagation on the list could never keep the key away from it. While the
// popup is open it claims Escape on window capture, which runs first.

describe("dropdown: Escape ownership", () => {
  it("closes only the popup while a capture-phase panel dispatcher is live", () => {
    const { dropdown } = bridged("a", [{ value: "a", label: "Alpha" }]);
    const panelEscape = vi.fn();
    document.addEventListener("keydown", panelEscape, true);
    cleanup.push(() => document.removeEventListener("keydown", panelEscape, true));
    dropdown.open();
    const option = optionEls(dropdown)[0];
    option.focus();

    key(option, "Escape");

    expect(dropdown.isOpen()).toBe(false);
    expect(panelEscape).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(dropdown.trigger);

    // The popup is gone, so the next Escape belongs to the panel again.
    key(document.body, "Escape");
    expect(panelEscape).toHaveBeenCalledTimes(1);
  });

  it("does not steal an Escape another handler already consumed", () => {
    const { dropdown } = bridged("a", [{ value: "a", label: "Alpha" }]);
    // Registered before the popup opens, so it runs first on window capture.
    const onWindow = (event: Event): void => event.preventDefault();
    window.addEventListener("keydown", onWindow, true);
    cleanup.push(() => window.removeEventListener("keydown", onWindow, true));
    dropdown.open();
    key(optionEls(dropdown)[0], "Escape");
    // defaultPrevented by an earlier window-capture handler (registration
    // order): this control must not close a second surface on one key.
    expect(dropdown.isOpen()).toBe(true);
  });
});

// ── One popup at a time + portal lifetime ────────────────────────────

describe("dropdown: portal lifetime", () => {
  it("opening a second dropdown closes the first", () => {
    const first = bridged("a", [{ value: "a", label: "Alpha" }]);
    const second = bridged("a", [{ value: "a", label: "Alpha" }]);
    first.dropdown.open();
    second.dropdown.open();
    expect(first.dropdown.isOpen()).toBe(false);
    // One *portalled* list in the document, not a stack of them (a closed
    // list lives back inside its wrapper).
    expect(document.body.querySelectorAll(".foliplus-dropdown-portal").length).toBe(1);
    expect((second.dropdown.getList() as HTMLElement).parentElement).toBe(
      document.body,
    );
  });

  it("destroy takes the portalled popup out of the document", () => {
    const { dropdown } = bridged("a", [{ value: "a", label: "Alpha" }]);
    dropdown.open();
    expect(document.body.querySelectorAll("." + CLS.list).length).toBe(1);
    dropdown.destroy();
    expect(document.body.querySelectorAll("." + CLS.list).length).toBe(0);
  });

  it("re-seats the popup when the page enters and leaves fullscreen", () => {
    const { dropdown } = bridged("a", [{ value: "a", label: "Alpha" }]);
    dropdown.open();
    const surface = document.createElement("div");
    document.body.appendChild(surface);
    const setFullscreen = (el: Element | null): void => {
      Object.defineProperty(document, "fullscreenElement", {
        value: el,
        configurable: true,
      });
      document.dispatchEvent(new Event("fullscreenchange"));
    };
    setFullscreen(surface);
    expect((dropdown.getList() as HTMLElement).parentElement).toBe(surface);
    setFullscreen(null);
    expect((dropdown.getList() as HTMLElement).parentElement).toBe(document.body);
    cleanup.push(() =>
      Object.defineProperty(document, "fullscreenElement", {
        value: null,
        configurable: true,
      }),
    );
  });

  it("links the portalled listbox to the trigger for assistive tech", () => {
    const { select, dropdown } = bridged("a", [{ value: "a", label: "Alpha" }]);
    const listId = dropdown.getList()?.id ?? "";
    expect(listId).not.toBe("");
    // aria-controls says what the trigger operates; aria-owns keeps the
    // portalled listbox inside the trigger's own accessibility subtree.
    expect(select.getAttribute("aria-controls")).toBeNull();
    expect(dropdown.trigger.getAttribute("aria-controls")).toBe(listId);
    expect(dropdown.trigger.getAttribute("aria-owns")).toBe(listId);
  });
});

// ── Keyboard and edge behaviour ──────────────────────────────────────

describe("dropdown: keyboard and edge cases", () => {
  const three = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Bee" },
    { value: "c", label: "Cee" },
  ];

  const standalone = (
    items: readonly {
      value: string;
      label: string;
      disabled?: boolean;
      title?: string;
    }[],
    extra: Record<string, unknown> = {},
  ): Dropdown => {
    const dropdown = createDropdown({ items, ...extra });
    cleanup.push(() => dropdown.destroy());
    document.body.appendChild(dropdown.element);
    return dropdown;
  };

  it("ArrowUp opens the closed list on the last row, ArrowDown on the first", () => {
    const up = standalone(three);
    key(up.trigger, "ArrowUp");
    expect(up.isOpen()).toBe(true);
    expect(document.activeElement).toBe(optionEls(up)[2]);
    up.destroy();

    const down = standalone(three);
    key(down.trigger, "ArrowDown");
    expect(document.activeElement).toBe(optionEls(down)[0]);
  });

  it("steps by one and wraps around the ends", () => {
    const dropdown = standalone(three);
    key(dropdown.trigger, "ArrowDown");
    key(dropdown.getList() as HTMLElement, "ArrowDown");
    expect(document.activeElement).toBe(optionEls(dropdown)[1]);
    key(dropdown.getList() as HTMLElement, "ArrowDown");
    key(dropdown.getList() as HTMLElement, "ArrowDown");
    // Past the last row: wraps to the first instead of parking off-list.
    expect(document.activeElement).toBe(optionEls(dropdown)[0]);
  });

  it("skips a disabled row while stepping", () => {
    const dropdown = standalone([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Bee", disabled: true },
      { value: "c", label: "Cee" },
    ]);
    key(dropdown.trigger, "ArrowDown");
    key(dropdown.getList() as HTMLElement, "ArrowDown");
    expect(document.activeElement).toBe(optionEls(dropdown)[2]);
  });

  it("Home and End jump to the ends of the list", () => {
    const dropdown = standalone(three);
    key(dropdown.trigger, "ArrowDown");
    key(dropdown.getList() as HTMLElement, "End");
    expect(document.activeElement).toBe(optionEls(dropdown)[2]);
    key(dropdown.getList() as HTMLElement, "Home");
    expect(document.activeElement).toBe(optionEls(dropdown)[0]);
  });

  it("Home and End skip disabled rows", () => {
    // A native select never parks the Home/End cursor on a disabled option.
    const dropdown = standalone([
      { value: "a", label: "Alpha", disabled: true },
      { value: "b", label: "Bee" },
      { value: "c", label: "Cee", disabled: true },
    ]);
    key(dropdown.trigger, "ArrowDown");
    key(dropdown.getList() as HTMLElement, "Home");
    expect(document.activeElement).toBe(optionEls(dropdown)[1]);
    key(dropdown.getList() as HTMLElement, "End");
    expect(document.activeElement).toBe(optionEls(dropdown)[1]);
  });

  it("ignores the arrow keys on an empty list", () => {
    const dropdown = standalone([]);
    dropdown.trigger.click();
    expect(dropdown.isOpen()).toBe(true);
    key(dropdown.trigger, "ArrowDown");
    expect(dropdown.isOpen()).toBe(true);
    expect(optionEls(dropdown)).toEqual([]);
  });

  it("a disabled row cannot be picked", () => {
    const dropdown = standalone(
      [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Bee", disabled: true },
      ],
      { value: "a" },
    );
    dropdown.trigger.click();
    const disabled = optionEls(dropdown)[1];
    expect(disabled.disabled).toBe(true);
    disabled.click();
    expect(dropdown.getValue()).toBe("a");
    expect(dropdown.isOpen()).toBe(true);
  });

  it("mirrors an option title onto its row", () => {
    const dropdown = standalone([{ value: "a", label: "Alpha", title: "Proj CRS" }]);
    dropdown.trigger.click();
    expect(optionEls(dropdown)[0].title).toBe("Proj CRS");
  });

  it("a bridged option with no label shows its value instead of an empty row", () => {
    // A label-less <option> is a real pattern in hand-built markup; the
    // native select showed the value there, and so must the popup.
    const { dropdown } = bridged("x", [{ value: "x", label: "" }]);
    dropdown.trigger.click();
    expect(optionEls(dropdown)[0].textContent).toBe("x");
  });

  it("refresh in standalone mode repaints the label and adds no native write", () => {
    const dropdown = standalone(three, { value: "b" });
    expect(labelOf(dropdown)).toBe("Bee");
    dropdown.refresh();
    expect(labelOf(dropdown)).toBe("Bee");
    expect(dropdown.getValue()).toBe("b");
  });

  it("refresh while open re-reads a rewritten option list", () => {
    const { select, dropdown } = bridged("a", [{ value: "a", label: "Alpha" }]);
    dropdown.open();
    select.innerHTML = "";
    for (const [value, label] of [
      ["x", "Ex"],
      ["y", "Why"],
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    }
    select.value = "x";
    dropdown.refresh();
    expect(dropdown.isOpen()).toBe(true);
    expect(optionEls(dropdown).map(el => el.textContent)).toEqual(["Ex", "Why"]);
    expect(labelOf(dropdown)).toBe("Ex");
  });

  it("setValue writes through the bridged select", () => {
    const { select, dropdown } = bridged(
      "a",
      three.map(({ value, label }) => ({ value, label })),
    );
    dropdown.setValue("c");
    expect(select.value).toBe("c");
    expect(dropdown.getValue()).toBe("c");
    expect(labelOf(dropdown)).toBe("Cee");
  });

  it("setValues does nothing on a single-value dropdown", () => {
    const dropdown = standalone(three, { value: "a" });
    dropdown.setValues(["b"]);
    expect(dropdown.getValue()).toBe("a");
    expect(dropdown.getValues()).toEqual(["a"]);
  });

  it("setValues while open repaints the selected rows", () => {
    const dropdown = standalone(three, { multiple: true, values: ["a"] });
    dropdown.trigger.click();
    dropdown.setValues(["b", "c"]);
    expect(optionEls(dropdown).map(el => el.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "true",
    ]);
    expect(labelOf(dropdown)).toBe("2 selected");
  });

  it("the default multiple summary counts the selection", () => {
    const dropdown = standalone(three, { multiple: true, values: ["a", "b"] });
    expect(labelOf(dropdown)).toBe("2 selected");
  });

  it("carries consumer trigger attributes onto the trigger", () => {
    const dropdown = standalone(three, {
      triggerAttributes: { "data-probe": "1", "aria-label": "Pick a field" },
    });
    expect(dropdown.trigger.getAttribute("data-probe")).toBe("1");
    expect(dropdown.trigger.getAttribute("aria-label")).toBe("Pick a field");
  });

  it("stays inert after destroy", () => {
    const { dropdown } = bridged("a", [{ value: "a", label: "Alpha" }]);
    dropdown.open();
    dropdown.destroy();
    expect(() => {
      dropdown.refresh();
      dropdown.setValue("b");
      dropdown.setValues(["b"]);
      dropdown.setHint("gone");
      dropdown.close();
      dropdown.toggle();
      dropdown.open();
      dropdown.trigger.click();
      dropdown.destroy();
    }).not.toThrow();
    expect(dropdown.isOpen()).toBe(false);
    expect(document.body.querySelectorAll("." + CLS.list).length).toBe(0);
  });
});
describe("dropdown: remaining contracts", () => {
  const three = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Bee" },
    { value: "c", label: "Cee" },
  ];
  const dropdownOfItems = (
    items: readonly { value: string; label: string }[],
    extra: Record<string, unknown> = {},
  ): Dropdown => {
    const dropdown = createDropdown({ items, ...extra });
    cleanup.push(() => dropdown.destroy());
    document.body.appendChild(dropdown.element);
    return dropdown;
  };

  it("clamps a long list to the room the viewport leaves", () => {
    const dropdown = dropdownOfItems(three);
    const original = Object.getOwnPropertyDescriptor(window, "innerHeight");
    Object.defineProperty(window, "innerHeight", { value: 400, configurable: true });
    cleanup.push(() => {
      if (original) Object.defineProperty(window, "innerHeight", original);
    });
    const rect = (top: number, height: number) => () =>
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
      }) as DOMRect;
    Object.defineProperty(dropdown.trigger, "getBoundingClientRect", {
      value: rect(100, 30),
      configurable: true,
    });
    // A list taller than the room below the trigger: it becomes scrollable at
    // the measured height instead of running off the viewport.
    Object.defineProperty(dropdown.getList() as HTMLElement, "getBoundingClientRect", {
      value: rect(138, 500),
      configurable: true,
    });
    dropdown.open();
    const list = dropdown.getList() as HTMLElement;
    expect(list.style.maxHeight).not.toBe("");
    expect(Number.parseInt(list.style.maxHeight, 10)).toBeLessThan(500);
    dropdown.close();
  });

  it("Home and End on the trigger move the list cursor", () => {
    const dropdown = dropdownOfItems(three);
    key(dropdown.trigger, "ArrowDown");
    key(dropdown.trigger, "End");
    expect(document.activeElement).toBe(optionEls(dropdown)[2]);
    key(dropdown.trigger, "Home");
    expect(document.activeElement).toBe(optionEls(dropdown)[0]);
  });

  it("Home on an empty list does nothing", () => {
    const dropdown = dropdownOfItems([]);
    dropdown.open();
    key(dropdown.trigger, "Home");
    key(dropdown.getList() as HTMLElement, "End");
    expect(dropdown.isOpen()).toBe(true);
    expect(optionEls(dropdown)).toEqual([]);
  });

  it("a press inside the portalled list does not dismiss it", () => {
    const dropdown = dropdownOfItems(three);
    dropdown.open();
    optionEls(dropdown)[1].dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(dropdown.isOpen()).toBe(true);
    // A press outside does (the list is its own hit area now).
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(dropdown.isOpen()).toBe(false);
  });

  it("opening twice keeps one popup and toggle() opens then closes", () => {
    const dropdown = dropdownOfItems(three);
    dropdown.open();
    dropdown.open();
    expect(dropdown.isOpen()).toBe(true);
    expect(document.body.querySelectorAll(".foliplus-dropdown-portal").length).toBe(1);
    dropdown.toggle();
    expect(dropdown.isOpen()).toBe(false);
    dropdown.toggle();
    expect(dropdown.isOpen()).toBe(true);
    dropdown.close();
  });
});
describe("dropdown: remaining branches", () => {
  const three = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Bee" },
    { value: "c", label: "Cee" },
  ];
  const make = (
    items: readonly { value: string; label: string; disabled?: boolean }[],
    extra: Record<string, unknown> = {},
  ): Dropdown => {
    const dropdown = createDropdown({ items, ...extra });
    cleanup.push(() => dropdown.destroy());
    document.body.appendChild(dropdown.element);
    return dropdown;
  };

  it("ArrowUp on the list steps backwards from the trigger", () => {
    const dropdown = make(three);
    // Open with the keyboard so focus starts on a row, then walk back past the
    // first row: the cursor wraps upward instead of sticking.
    key(dropdown.trigger, "ArrowDown");
    key(dropdown.getList() as HTMLElement, "ArrowUp");
    expect(document.activeElement).toBe(optionEls(dropdown)[2]);
  });

  it("ArrowUp on an open trigger steps the cursor backwards", () => {
    const dropdown = make(three);
    key(dropdown.trigger, "ArrowDown");
    key(dropdown.trigger, "ArrowUp");
    expect(document.activeElement).toBe(optionEls(dropdown)[2]);
  });

  it("ArrowUp on a trigger whose last row is disabled opens on the first", () => {
    const dropdown = make([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Bee", disabled: true },
    ]);
    key(dropdown.trigger, "ArrowUp");
    expect(dropdown.isOpen()).toBe(true);
    expect(document.activeElement).toBe(optionEls(dropdown)[0]);
  });

  it("a scroll started by a row inside the list does not move the anchor", () => {
    const dropdown = make(three);
    dropdown.open();
    const list = dropdown.getList() as HTMLElement;
    const before = list.style.top;
    // The row is the scroll event's target when the browser keeps the focused
    // option in view; the popup must ignore it, not re-pin from a stale rect.
    optionEls(dropdown)[2].dispatchEvent(new Event("scroll", { bubbles: true }));
    expect(list.style.top).toBe(before);
    expect(dropdown.isOpen()).toBe(true);
  });

  it("reports an empty value for a standalone dropdown with nothing selected", () => {
    const dropdown = make(three);
    expect(dropdown.getValue()).toBe("");
    expect(dropdown.getValues()).toEqual([]);
  });

  it("setValue('') clears a bridged select back to its placeholder", () => {
    const { select, dropdown } = bridged("a", [
      { value: "", label: "Choose a layer", disabled: true },
      { value: "a", label: "Alpha" },
    ]);
    expect(labelOf(dropdown)).toBe("Alpha");
    dropdown.setValue("");
    expect(select.value).toBe("");
    expect(labelOf(dropdown)).toBe("Choose a layer");
    expect(dropdown.trigger.classList.contains(CLS.placeholder)).toBe(true);
  });
});

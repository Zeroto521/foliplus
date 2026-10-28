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

const optionEls = (dropdown: Dropdown): HTMLButtonElement[] =>
  Array.from(dropdown.element.querySelectorAll<HTMLButtonElement>("." + CLS.option));

const key = (target: EventTarget, keyValue: string): void => {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: keyValue,
      bubbles: true,
      cancelable: true,
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

  it("Tab closes the list and lets focus leave", () => {
    const { dropdown } = bridged("a", [{ value: "a", label: "Alpha" }]);
    key(dropdown.trigger, "ArrowDown");
    key(optionEls(dropdown)[0], "Tab");
    expect(dropdown.isOpen()).toBe(false);
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
    expect(dropdown.element.querySelector("." + CLS.list)).not.toBeNull();
    dropdown.destroy();
    expect(dropdown.element.querySelector("." + CLS.list)).toBeNull();
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

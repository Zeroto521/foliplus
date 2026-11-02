// Row-contract tests for the shared listbox engine (common/listbox.ts).
//
// The engine is one implementation behind six explicit shape slots. Each slot
// is a point where the two historical builders deliberately diverged; folding
// them into engine config keeps S-A/S-B behaviour-equivalent. These tests pin
// BOTH shapes (dropdown and picker) so a change to one slot cannot silently
// flip the other layer's DOM contract.
//
// Contract notes (deliberate absences, not oversights):
// - PageUp/PageDown are NOT implemented in the engine. Neither the historical
//   dropdown nor schemePicker implemented them, so a listbox does not page
//   through rows on those keys (they fall through to the browser). A native
//   <select> pages by a visible block, but the engine intentionally does not
//   replicate that — adding it would be a feature, not a contract fix.
// - Type-ahead (typing a character jumps to the first matching row) is NOT
//   implemented either, for the same reason. If a future consumer needs it,
//   it belongs in a follow-up, not here.
// - These are recorded so the row contract is explicit: what the engine DOES
//   guarantee is below; what it deliberately does NOT is noted here.
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Dropdown, createDropdown } from "#common/dropdown.js";
import { type DropdownSurface, createListbox } from "#common/listbox.js";

// P2 record — flip/clamp divergence (NOT changed in this PR; tracked by task-73 step 4).
// The engine's positionList flips above the trigger when the room below is less than
// MIN_ROWS_BELOW (2) rows (listbox.ts:337: fitsBelow = space.below >= min(desired,
// rowHeight * MIN_ROWS_BELOW)). The historical schemePicker (its own pre-engine
// implementation on main) flipped using the whole dropdown height instead, so the
// two layers can disagree about when a popup flips. This PR records the divergence
// and does NOT unify it — unification is task-73 migration step 4 (the schemePicker
// engine migration), which is where the single flip policy is decided.

const cleanup: (() => void)[] = [];

afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.();
  document.body.innerHTML = "";
});

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
  const dropdown = createDropdown({ nativeSelect: select, ...extra });
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

const makePicker = (
  items: readonly { value: string; label: string; disabled?: boolean }[],
  selected: readonly string[] = [],
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
    ownDismiss: true,
    dismiss: { kind: "local" },
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
    const { listbox } = makePicker([
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
    const { listbox } = makePicker(
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
    const { listbox } = makePicker([
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
    const { trigger, listbox } = makePicker([
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
    const { trigger, listbox } = makePicker([
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
    const { listbox, activated, trigger } = makePicker([
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
    const { listbox, activated } = makePicker([
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
    const { listbox, activated } = makePicker([
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
    const { trigger, listbox } = makePicker([
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
    const { trigger, listbox } = makePicker([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ]);
    trigger.focus();
    listbox.open();
    pickerRows(listbox)[0].focus();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(listbox.isOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("Tab closes and hands focus back to the trigger for browser Tab movement", () => {
    const { trigger, listbox } = makePicker([
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
    const { listbox } = makePicker([
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
    const { listbox } = makePicker([
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

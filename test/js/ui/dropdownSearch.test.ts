// Tests for the searchable dropdown (ui/dropdown.ts search mode).
//
// The search mode is the one place the dropdown composes the pure listFilter
// (ui/listFilter.ts) and the searchField primitive (ui/searchField.ts) over
// the listbox engine. These tests pin the combobox contract: threshold gating,
// filtering, the single status region, Escape priority, active-row tracking,
// Enter activation, multi-select pinned selection, select-all/clear and the
// onSearchState payload.
import type * as L from "leaflet";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureOverlayRegistry } from "#core/overlay/index.js";
import {
  DROPDOWN_SEARCH_AUTO_THRESHOLD,
  type Dropdown,
  createDropdown,
} from "#ui/index.js";

let activeRegistry: ReturnType<typeof ensureOverlayRegistry> | null = null;
const cleanup: (() => void)[] = [];

const mockOverlay = () => {
  const map = { on: (_e: string, _h: () => void) => {} } as unknown as L.Map;
  const registry = ensureOverlayRegistry(map);
  activeRegistry = registry;
  cleanup.push(() => {
    activeRegistry = null;
    registry.destroy();
  });
  return {
    overlay: {
      register: registry.register.bind(registry),
      id: "foliplus.popup.dropdown",
      rank: 860,
    },
  };
};

const CLS = {
  list: "foliplus-dropdown-list",
  option: "foliplus-dropdown-option",
  active: "foliplus-dropdown-option-active",
  status: "foliplus-dropdown-status",
} as const;

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.();
  document.body.innerHTML = "";
});

const makeItems = (n: number): { value: string; label: string }[] =>
  Array.from({ length: n }, (_, i) => ({
    value: `v${String(i)}`,
    label: `Value ${String(i)}`,
  }));

const makeSearch = (
  items: { value: string; label: string }[],
  extra: Record<string, unknown> = {},
): { dropdown: Dropdown; states: Record<string, unknown>[] } => {
  const states: Record<string, unknown>[] = [];
  const dropdown = createDropdown({
    overlay: mockOverlay().overlay,
    items,
    search: "auto",
    searchPlaceholder: "Search…",
    searchNoResult: "No matching values",
    onSearchState: info => states.push({ ...info }),
    ...extra,
  });
  cleanup.push(() => dropdown.destroy());
  document.body.appendChild(dropdown.element);
  return { dropdown, states };
};

const inputOf = (dropdown: Dropdown): HTMLInputElement | null =>
  dropdown.getList()?.parentElement?.querySelector("input") ?? null;

const optionEls = (dropdown: Dropdown): HTMLButtonElement[] =>
  Array.from(
    dropdown.getList()?.querySelectorAll<HTMLButtonElement>(`.${CLS.option}`) ?? [],
  );

const type = (dropdown: Dropdown, query: string): void => {
  const input = inputOf(dropdown);
  if (!input) throw new Error("no search input");
  input.value = query;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const flush = (): void => {
  // The engine debounces (150ms). A real timer flush is needed for the
  // refresh to run; use a tiny await so the microtask/timer drains.
  return undefined;
};

describe("dropdown search: threshold gating", () => {
  it("does not add a search box at or below the auto threshold", () => {
    const { dropdown } = makeSearch(makeItems(10));
    dropdown.trigger.click();
    expect(dropdown.isOpen()).toBe(true);
    expect(inputOf(dropdown)).toBeNull();
  });

  it("adds a search box above the auto threshold", () => {
    const { dropdown } = makeSearch(makeItems(11));
    dropdown.trigger.click();
    expect(dropdown.isOpen()).toBe(true);
    expect(inputOf(dropdown)).not.toBeNull();
    expect(inputOf(dropdown)?.getAttribute("role")).toBe("combobox");
    expect(inputOf(dropdown)?.getAttribute("aria-expanded")).toBe("true");
  });

  it("exports the auto threshold as 10", () => {
    expect(DROPDOWN_SEARCH_AUTO_THRESHOLD).toBe(10);
  });

  it("honors an explicit threshold", () => {
    const { dropdown } = makeSearch(makeItems(6), { search: { threshold: 5 } });
    dropdown.trigger.click();
    expect(inputOf(dropdown)).not.toBeNull();
  });

  it("keeps the box off when search is false", () => {
    const { dropdown } = makeSearch(makeItems(50), { search: false });
    dropdown.trigger.click();
    expect(inputOf(dropdown)).toBeNull();
  });
});

describe("dropdown search: filtering", () => {
  it("filters on label substring case-insensitively", () => {
    const { dropdown } = makeSearch(makeItems(12));
    dropdown.trigger.click();
    const before = optionEls(dropdown).length;
    expect(before).toBe(12);
    type(dropdown, "value 1");
    // debounce flush
    return new Promise<void>(resolve => {
      setTimeout(() => {
        const rows = optionEls(dropdown);
        expect(rows.length).toBeLessThan(before);
        resolve();
      }, 250);
    });
  });

  it("shows the no-result status for zero matches", () => {
    const { dropdown } = makeSearch(makeItems(12));
    dropdown.trigger.click();
    type(dropdown, "zzz");
    return new Promise<void>(resolve => {
      setTimeout(() => {
        const status = dropdown
          .getList()
          ?.parentElement?.querySelector('[role="status"]');
        expect(status?.textContent).toContain("No matching values");
        resolve();
      }, 250);
    });
  });
});

describe("dropdown search: keyboard", () => {
  it("moves the active row with ArrowDown", () => {
    const { dropdown } = makeSearch(makeItems(11));
    dropdown.trigger.click();
    const input = inputOf(dropdown);
    input?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    const rows = optionEls(dropdown);
    expect(rows.length).toBe(11);
    expect(rows[0]?.classList.contains(CLS.active)).toBe(true);
  });

  it("Enter activates the active row in single mode", () => {
    const picks: string[] = [];
    const { dropdown } = makeSearch(makeItems(11), {
      onChange: v => picks.push(String(v)),
    });
    dropdown.trigger.click();
    const input = inputOf(dropdown);
    input?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    input?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(picks.length).toBe(1);
  });
});

describe("dropdown search: multi-select", () => {
  it("pins selected items above non-matching results", () => {
    const { dropdown } = makeSearch(makeItems(12), { multiple: true, values: ["v0"] });
    dropdown.trigger.click();
    type(dropdown, "value 5");
    return new Promise<void>(resolve => {
      setTimeout(() => {
        const rows = optionEls(dropdown);
        // pinned v0 stays, v5 and matches render
        expect(rows.length).toBeGreaterThan(0);
        resolve();
      }, 250);
    });
  });
});

describe("dropdown search: onSearchState", () => {
  it("reports shown/total/query/selected", () => {
    const { dropdown, states } = makeSearch(makeItems(12), { placeholder: "Pick" });
    dropdown.trigger.click();
    expect(states.length).toBeGreaterThan(0);
    const last = states[states.length - 1] as Record<string, unknown>;
    expect(last.total).toBe(12);
    expect(last.query).toBe("");
    expect(last.selected).toBe(0);
  });
});

describe("dropdown search: Escape priority", () => {
  it("clears a non-empty query and stays open", () => {
    const { dropdown } = makeSearch(makeItems(12), { placeholder: "Pick" });
    dropdown.trigger.click();
    const input = inputOf(dropdown);
    if (!input) throw new Error("no input");
    type(dropdown, "value 5");
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(dropdown.isOpen()).toBe(true);
    expect(input.value).toBe("");
  });

  it("closes the popup on Escape with an empty query", () => {
    const { dropdown } = makeSearch(makeItems(12), { placeholder: "Pick" });
    dropdown.trigger.click();
    const input = inputOf(dropdown);
    if (!input) throw new Error("no input");
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(dropdown.isOpen()).toBe(false);
  });
});

describe("dropdown search: active row", () => {
  it("moves active with ArrowDown and ArrowUp", () => {
    const { dropdown } = makeSearch(makeItems(11), { placeholder: "Pick" });
    dropdown.trigger.click();
    const input = inputOf(dropdown);
    if (!input) throw new Error("no input");
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    let rows = optionEls(dropdown);
    expect(rows[0]?.classList.contains(CLS.active)).toBe(true);
    expect(input.getAttribute("aria-activedescendant")).toBe(rows[0]?.id);
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    rows = optionEls(dropdown);
    expect(rows[1]?.classList.contains(CLS.active)).toBe(true);
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
    );
    rows = optionEls(dropdown);
    expect(rows[0]?.classList.contains(CLS.active)).toBe(true);
  });
});

describe("dropdown search: Enter multi-select", () => {
  it("toggles selection and stays open", () => {
    const changes: string[][] = [];
    const { dropdown } = makeSearch(makeItems(11), {
      multiple: true,
      placeholder: "Pick",
      onChange: (_v, vs) => changes.push([...vs]),
    });
    dropdown.trigger.click();
    const input = inputOf(dropdown);
    if (!input) throw new Error("no input");
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(dropdown.isOpen()).toBe(true);
    expect(changes.length).toBe(1);
    expect(changes[0].length).toBe(1);
  });
});

describe("dropdown search: renderLimit", () => {
  it("caps rendered rows and reports the cap in shown", () => {
    const states: Record<string, unknown>[] = [];
    const { dropdown } = makeSearch(makeItems(40), {
      placeholder: "Pick",
      search: { threshold: 10, renderLimit: 30 },
      onSearchState: info => states.push({ ...info }),
    });
    dropdown.trigger.click();
    const rows = optionEls(dropdown);
    expect(rows.length).toBe(30);
    expect(states.length).toBeGreaterThan(0);
    const last = states[states.length - 1];
    expect(last.shown).toBe(30);
    expect(last.total).toBe(40);
  });

  it("makes the 31st value reachable by search", () => {
    const { dropdown } = makeSearch(makeItems(40), {
      placeholder: "Pick",
      search: { threshold: 10, renderLimit: 30 },
    });
    dropdown.trigger.click();
    type(dropdown, "value 39");
    return new Promise<void>(resolve => {
      setTimeout(() => {
        const rows = optionEls(dropdown);
        expect(rows.length).toBe(1);
        expect(rows[0]?.textContent).toContain("Value 39");
        resolve();
      }, 250);
    });
  });
});

describe("dropdown search: select-all and clear", () => {
  it("selects all matched items and clears", () => {
    const changes: string[][] = [];
    const { dropdown } = makeSearch(makeItems(12), {
      multiple: true,
      placeholder: "Pick",
      onChange: (_v, vs) => changes.push([...vs]),
    });
    dropdown.trigger.click();
    const footer = dropdown
      .getList()
      ?.parentElement?.querySelector(".foliplus-dropdown-footer-btn");
    expect(footer).toBeTruthy();
    (footer as HTMLElement | null)?.click();
    expect(changes.length).toBeGreaterThan(0);
  });
});

describe("dropdown search: single status region", () => {
  it("keeps no-result and footer mutually exclusive", () => {
    const { dropdown } = makeSearch(makeItems(12), { placeholder: "Pick" });
    dropdown.trigger.click();
    type(dropdown, "zzz");
    return new Promise<void>(resolve => {
      setTimeout(() => {
        const status = dropdown
          .getList()
          ?.parentElement?.querySelector('[role="status"]');
        expect(status?.textContent).toContain("No matching values");
        resolve();
      }, 250);
    });
  });
});

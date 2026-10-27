// Tests for the shared scheme picker (common/schemePicker.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SCHEME_PICKER_PORTAL_SELECTOR,
  type SchemePicker,
  createSchemePicker,
} from "#common/schemePicker.js";

// ── Colour-scale helper ────────────────────────────────────────────────

const colorScale = vi.fn((name: string, n: number) => {
  if (typeof chroma === "undefined") {
    return Array(n).fill("#999");
  }
  // Simulate chroma.scale().mode().colors() returning distinct colours.
  return Array.from({ length: n }, (_, i) => {
    const hue = Math.round((i / n) * 360);
    return "hsl(" + hue + ", 70%, 50%)";
  });
});

// ── Fixture ────────────────────────────────────────────────────────────

function makePicker(overrides: Record<string, unknown> = {}): {
  picker: SchemePicker;
  trigger: HTMLElement;
  hiddenSelect: HTMLSelectElement;
} {
  const trigger = document.createElement("div");
  trigger.className = "foliplus-heatmap-scheme-bar";
  trigger.setAttribute("tabindex", "0");
  trigger.setAttribute("role", "combobox");
  const inner = document.createElement("div");
  inner.setAttribute("data-scheme-bar-inner", "");
  trigger.appendChild(inner);

  const hiddenSelect = document.createElement("select");
  document.body.append(trigger, hiddenSelect);

  const schemes = ["Reds", "Blues", "Greens"];
  const picker = createSchemePicker({
    trigger,
    hiddenSelect,
    schemes,
    value: "Reds",
    numClasses: 6,
    portal: false,
    onChange: vi.fn(),
    colorScale,
    classes: {
      open: "foliplus-heatmap-scheme-bar-open",
      dropdown: "foliplus-heatmap-scheme-dropdown",
      item: "foliplus-heatmap-scheme-dropdown-item",
      bar: "foliplus-heatmap-scheme-dropdown-bar",
      block: "foliplus-heatmap-scheme-bar-block",
    },
    ...overrides,
  });

  return { picker, trigger, hiddenSelect };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ── Trigger click ──────────────────────────────────────────────────────

describe("trigger click", () => {
  it("opens the dropdown on first click", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(trigger.classList.contains("foliplus-heatmap-scheme-bar-open")).toBe(true);
    expect(picker.getDropdown()).not.toBeNull();
    picker.destroy();
  });

  it("closes the dropdown on second click", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(trigger.classList.contains("foliplus-heatmap-scheme-bar-open")).toBe(false);
    expect(picker.getDropdown()).toBeNull();
    picker.destroy();
  });

  it("stops propagation on trigger click", () => {
    const { picker, trigger } = makePicker();
    const spy = vi.fn();
    document.addEventListener("click", spy);
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(spy).not.toHaveBeenCalled();
    document.removeEventListener("click", spy);
    picker.destroy();
  });
});

// ── Listbox keyboard ───────────────────────────────────────────────────

describe("listbox keyboard navigation", () => {
  it("ArrowDown in dropdown focuses next item", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const items = picker
      .getDropdown()!
      .querySelectorAll("[role=option]") as NodeListOf<HTMLElement>;
    expect(items.length).toBe(3);

    items[0].focus();
    picker
      .getDropdown()!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(items[1]);
    picker.destroy();
  });

  it("ArrowUp in dropdown focuses prev item", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const items = picker
      .getDropdown()!
      .querySelectorAll("[role=option]") as NodeListOf<HTMLElement>;
    items[2].focus();
    picker
      .getDropdown()!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(document.activeElement).toBe(items[1]);
    picker.destroy();
  });

  it("Home focuses first item", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const items = picker
      .getDropdown()!
      .querySelectorAll("[role=option]") as NodeListOf<HTMLElement>;
    items[2].focus();
    picker
      .getDropdown()!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(document.activeElement).toBe(items[0]);
    picker.destroy();
  });

  it("End focuses last item", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const items = picker
      .getDropdown()!
      .querySelectorAll("[role=option]") as NodeListOf<HTMLElement>;
    items[0].focus();
    picker
      .getDropdown()!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement).toBe(items[2]);
    picker.destroy();
  });

  it("Enter selects the focused item and closes dropdown", () => {
    const onChange = vi.fn();
    const { picker, trigger } = makePicker({ onChange });
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const items = picker
      .getDropdown()!
      .querySelectorAll("[role=option]") as NodeListOf<HTMLElement>;
    items[1].focus();
    picker
      .getDropdown()!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onChange).toHaveBeenCalledWith("Blues");
    expect(picker.getDropdown()).toBeNull();
    picker.destroy();
  });

  it("Escape closes dropdown and returns focus to trigger", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    picker
      .getDropdown()!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(picker.getDropdown()).toBeNull();
    expect(trigger.classList.contains("foliplus-heatmap-scheme-bar-open")).toBe(false);
    expect(document.activeElement).toBe(trigger);
    picker.destroy();
  });

  it("wraps around on ArrowDown at last item", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const items = picker
      .getDropdown()!
      .querySelectorAll("[role=option]") as NodeListOf<HTMLElement>;
    items[2].focus();
    picker
      .getDropdown()!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(items[0]);
    picker.destroy();
  });

  it("wraps around on ArrowUp at first item", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const items = picker
      .getDropdown()!
      .querySelectorAll("[role=option]") as NodeListOf<HTMLElement>;
    items[0].focus();
    picker
      .getDropdown()!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(document.activeElement).toBe(items[2]);
    picker.destroy();
  });
});

// ── Trigger keyboard (cycle without opening) ───────────────────────────

describe("trigger keyboard (no dropdown open)", () => {
  it("ArrowDown cycles to next scheme", () => {
    const onChange = vi.fn();
    const { picker, trigger, hiddenSelect } = makePicker({ onChange });
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(onChange).toHaveBeenCalledWith("Blues");
    expect(hiddenSelect.value).toBe("Blues");
    picker.destroy();
  });

  it("ArrowUp cycles to prev scheme", () => {
    const onChange = vi.fn();
    const { picker, trigger } = makePicker({ onChange });
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    // value is "Reds" (index 0), ArrowUp at first does nothing
    expect(onChange).not.toHaveBeenCalled();
    picker.destroy();
  });

  it("Enter opens the dropdown", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(picker.getDropdown()).not.toBeNull();
    picker.destroy();
  });

  it("Space opens the dropdown", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(picker.getDropdown()).not.toBeNull();
    picker.destroy();
  });
});

// ── Outside click ──────────────────────────────────────────────────────

describe("outside click", () => {
  it("closes the dropdown on outside click", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(picker.getDropdown()).toBeNull();
    picker.destroy();
  });

  it("does not close on click inside the dropdown", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const dropdown = picker.getDropdown()!;
    dropdown.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(picker.getDropdown()).not.toBeNull();
    picker.destroy();
  });

  it("does not close on click on the trigger", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // The trigger's own click handler toggles, but the outside-click
    // handler should not fire for the trigger.
    expect(picker.getDropdown()).not.toBeNull();
    picker.destroy();
  });
});

// ── Focus return ───────────────────────────────────────────────────────

describe("focus return", () => {
  it("returns focus to trigger on Escape", () => {
    const { picker, trigger } = makePicker();
    trigger.focus();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    picker
      .getDropdown()!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.activeElement).toBe(trigger);
    picker.destroy();
  });

  it("returns focus to trigger after selecting an item", () => {
    const { picker, trigger } = makePicker();
    trigger.focus();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const items = picker
      .getDropdown()!
      .querySelectorAll("[role=option]") as NodeListOf<HTMLElement>;
    items[0].focus();
    items[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.activeElement).toBe(trigger);
    picker.destroy();
  });
});

// ── restoreFocus option ────────────────────────────────────────────────

describe("restoreFocus option", () => {
  it("close() with restoreFocus: false does not steal focus when open", () => {
    const { picker, trigger } = makePicker();
    trigger.focus();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // Focus is on an item after open (set by mountDropdown)
    const otherInput = document.createElement("input");
    document.body.appendChild(otherInput);
    otherInput.focus();
    // Close with restoreFocus: false — should NOT steal focus back to trigger
    picker.close({ restoreFocus: false });
    expect(document.activeElement).toBe(otherInput);
    expect(picker.getDropdown()).toBeNull();
    picker.destroy();
  });

  it("close() on an already-closed picker does not steal focus", () => {
    const { picker } = makePicker();
    const otherInput = document.createElement("input");
    document.body.appendChild(otherInput);
    otherInput.focus();
    // Picker is closed — close() should be a no-op for focus
    picker.close({ restoreFocus: true });
    expect(document.activeElement).toBe(otherInput);
    picker.destroy();
  });

  it("close() with default options restores focus to trigger when open", () => {
    const { picker, trigger } = makePicker();
    trigger.focus();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // Focus is on an item after open
    const items = picker
      .getDropdown()!
      .querySelectorAll("[role=option]") as NodeListOf<HTMLElement>;
    items[0].focus();
    // Close with default options — should restore focus to trigger
    picker.close();
    expect(document.activeElement).toBe(trigger);
    expect(picker.getDropdown()).toBeNull();
    picker.destroy();
  });
});

// ── ARIA attributes ────────────────────────────────────────────────────

describe("ARIA attributes", () => {
  it("sets aria-expanded=true when open", () => {
    const { picker, trigger } = makePicker();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    picker.destroy();
  });

  it("sets aria-expanded=false when closed", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    picker
      .getDropdown()!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    picker.destroy();
  });

  it("sets aria-controls when open", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const controlsId = trigger.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();
    const dropdown = picker.getDropdown()!;
    expect(dropdown.id).toBe(controlsId);
    picker.destroy();
  });

  it("sets aria-activedescendant to focused item", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const items = picker
      .getDropdown()!
      .querySelectorAll("[role=option]") as NodeListOf<HTMLElement>;
    items[1].focus();
    const descId = trigger.getAttribute("aria-activedescendant");
    expect(descId).toBe(items[1].id);
    picker.destroy();
  });

  it("uses the injected label as the trigger's accessible name", () => {
    const { trigger } = makePicker({ label: "色带" });
    expect(trigger.getAttribute("aria-label")).toBe("色带");
  });

  it("falls back to the default label when the consumer injects none", () => {
    const { trigger } = makePicker();
    expect(trigger.getAttribute("aria-label")).toBe("Color scheme");
  });

  it("does not overwrite an aria-label the consumer already set", () => {
    const trigger = document.createElement("div");
    trigger.setAttribute("aria-label", "Existing label");
    const inner = document.createElement("div");
    inner.setAttribute("data-scheme-bar-inner", "");
    trigger.appendChild(inner);
    document.body.append(trigger);
    const picker = createSchemePicker({
      trigger,
      schemes: ["Reds"],
      value: "Reds",
      numClasses: 4,
      portal: false,
      label: "Injected label",
      onChange: vi.fn(),
      colorScale,
    });
    expect(trigger.getAttribute("aria-label")).toBe("Existing label");
    picker.destroy();
  });

  it("removes aria-activedescendant when closed", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    picker
      .getDropdown()!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(trigger.hasAttribute("aria-activedescendant")).toBe(false);
    picker.destroy();
  });
});

// ── Hidden select sync ─────────────────────────────────────────────────

describe("hidden select sync", () => {
  it("populates options from schemes", () => {
    const { hiddenSelect } = makePicker();
    expect(hiddenSelect.options.length).toBe(3);
    expect(hiddenSelect.options[0].value).toBe("Reds");
    expect(hiddenSelect.options[1].value).toBe("Blues");
    expect(hiddenSelect.options[2].value).toBe("Greens");
  });

  it("sets initial value from options.value", () => {
    const { hiddenSelect } = makePicker();
    expect(hiddenSelect.value).toBe("Reds");
  });

  it("syncs on scheme selection", () => {
    const onChange = vi.fn();
    const { picker, trigger, hiddenSelect } = makePicker({ onChange });
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const items = picker
      .getDropdown()!
      .querySelectorAll("[role=option]") as NodeListOf<HTMLElement>;
    items[1].focus();
    items[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(hiddenSelect.value).toBe("Blues");
    picker.destroy();
  });

  it("syncs on ArrowDown trigger keyboard", () => {
    const { trigger, hiddenSelect } = makePicker();
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(hiddenSelect.value).toBe("Blues");
  });
});

// ── Colour blocks ──────────────────────────────────────────────────────

describe("colour blocks", () => {
  it("renders numClasses blocks in the trigger bar", () => {
    const { trigger } = makePicker({ numClasses: 4 });
    const inner = trigger.querySelector("[data-scheme-bar-inner]")!;
    expect(inner.children.length).toBe(4);
  });

  it("renders colour blocks in each dropdown item", () => {
    const { picker, trigger } = makePicker({ numClasses: 3 });
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const items = picker
      .getDropdown()!
      .querySelectorAll("[role=option]") as NodeListOf<HTMLElement>;
    items.forEach(item => {
      const bar = item.querySelector(".foliplus-scheme-picker-bar")!;
      expect(bar.children.length).toBe(3);
    });
    picker.destroy();
  });

  it("throws a namespaced RangeError for an invalid scheme name", () => {
    let error: unknown;
    try {
      makePicker({ value: "NoSuchScheme" });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(RangeError);
    expect((error as RangeError).message).toBe(
      '[schemePicker] value "NoSuchScheme" is not in schemes — add it to schemes or use a value from the list',
    );
  });
});

// ── setValue ───────────────────────────────────────────────────────────

describe("setValue", () => {
  it("updates the trigger title", () => {
    const { picker, trigger } = makePicker();
    picker.setValue("Blues");
    expect(trigger.title).toBe("Blues");
    picker.destroy();
  });

  it("does not trigger onChange", () => {
    const onChange = vi.fn();
    const { picker } = makePicker({ onChange });
    picker.setValue("Blues");
    expect(onChange).not.toHaveBeenCalled();
    picker.destroy();
  });

  it("updates hidden select", () => {
    const { picker, hiddenSelect } = makePicker();
    picker.setValue("Blues");
    expect(hiddenSelect.value).toBe("Blues");
    picker.destroy();
  });
});

// ── selectScheme ──────────────────────────────────────────────────────

describe("selectScheme", () => {
  it("triggers onChange", () => {
    const onChange = vi.fn();
    const { picker } = makePicker({ onChange });
    picker.selectScheme("Blues");
    expect(onChange).toHaveBeenCalledWith("Blues");
    picker.destroy();
  });

  it("closes the dropdown if open", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    picker.selectScheme("Blues");
    expect(picker.getDropdown()).toBeNull();
    picker.destroy();
  });
});

// ── setNumClasses ─────────────────────────────────────────────────────

describe("setNumClasses", () => {
  it("redraws the trigger bar with new count", () => {
    const { picker, trigger } = makePicker({ numClasses: 6 });
    picker.setNumClasses(4);
    const inner = trigger.querySelector("[data-scheme-bar-inner]")!;
    expect(inner.children.length).toBe(4);
    picker.destroy();
  });

  it("redraws dropdown items if open", () => {
    const { picker, trigger } = makePicker({ numClasses: 6 });
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    picker.setNumClasses(3);
    const items = picker
      .getDropdown()!
      .querySelectorAll("[role=option]") as NodeListOf<HTMLElement>;
    items.forEach(item => {
      const bar = item.querySelector(".foliplus-scheme-picker-bar")!;
      expect(bar.children.length).toBe(3);
    });
    picker.destroy();
  });
});

// ── Empty schemes ─────────────────────────────────────────────────────

describe("empty schemes", () => {
  it("opens an empty dropdown without error", () => {
    const { picker, trigger } = makePicker({ schemes: [] });
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(picker.getDropdown()).not.toBeNull();
    expect(picker.getDropdown()!.children.length).toBe(0);
    picker.destroy();
  });

  it("ArrowDown with no schemes does nothing", () => {
    const onChange = vi.fn();
    const { trigger } = makePicker({ schemes: [], onChange });
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ── Portal mode ────────────────────────────────────────────────────────

describe("portal mode", () => {
  it("mounts dropdown on document.body when no fullscreen element", () => {
    const { picker, trigger } = makePicker({ portal: true });
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const dropdown = picker.getDropdown()!;
    expect(document.body.contains(dropdown)).toBe(true);
    picker.destroy();
  });

  it("publishes a selector that matches the mounted portalled dropdown", () => {
    // The panel dismiss predicate classifies the portalled list through this
    // selector, so it has to match the node the picker actually mounts — a
    // renamed class would otherwise silently stop counting the list as part of
    // the overlay.
    const { picker, trigger } = makePicker({ portal: true });
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(picker.getDropdown()!.matches(SCHEME_PICKER_PORTAL_SELECTOR)).toBe(true);
    picker.destroy();
  });

  it("mounts dropdown on fullscreenElement when present", () => {
    const fsEl = document.createElement("div");
    fsEl.id = "fs";
    document.body.appendChild(fsEl);
    // Mock fullscreenElement
    Object.defineProperty(document, "fullscreenElement", {
      value: fsEl,
      writable: true,
      configurable: true,
    });

    const { picker, trigger } = makePicker({ portal: true });
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const dropdown = picker.getDropdown()!;
    expect(fsEl.contains(dropdown)).toBe(true);
    picker.destroy();

    Object.defineProperty(document, "fullscreenElement", {
      value: null,
      writable: true,
      configurable: true,
    });
    document.body.removeChild(fsEl);
  });

  it("uses fixed positioning in portal mode", () => {
    const { picker, trigger } = makePicker({ portal: true });
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const dropdown = picker.getDropdown()!;
    expect(dropdown.style.position).toBe("fixed");
    picker.destroy();
  });

  it("uses inline positioning in non-portal mode", () => {
    const { picker, trigger } = makePicker({ portal: false });
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const dropdown = picker.getDropdown()!;
    expect(dropdown.style.position).not.toBe("fixed");
    picker.destroy();
  });
});

// ── onToggle callback ──────────────────────────────────────────────────

describe("onToggle callback", () => {
  it("calls onToggle(true, dropdown) when opening", () => {
    const onToggle = vi.fn();
    const { picker, trigger } = makePicker({ onToggle });
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onToggle).toHaveBeenCalledWith(true, picker.getDropdown());
    picker.destroy();
  });

  it("calls onToggle(false, null) when closing", () => {
    const onToggle = vi.fn();
    const { picker, trigger } = makePicker({ onToggle });
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    picker
      .getDropdown()!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onToggle).toHaveBeenCalledWith(false, null);
    picker.destroy();
  });
});

// ── destroy ────────────────────────────────────────────────────────────

describe("destroy", () => {
  it("closes the dropdown if open", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    picker.destroy();
    expect(picker.getDropdown()).toBeNull();
  });

  it("removes the open class from trigger", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    picker.destroy();
    expect(trigger.classList.contains("foliplus-heatmap-scheme-bar-open")).toBe(false);
  });

  it("cleans up document click listener", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    picker.destroy();
    // After destroy, clicking outside should not close (no dropdown)
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(picker.getDropdown()).toBeNull();
  });

  it("cleans up aria attributes", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    picker.destroy();
    expect(trigger.hasAttribute("aria-expanded")).toBe(false);
    expect(trigger.hasAttribute("aria-controls")).toBe(false);
  });
});

// ── Multiple pickers on the same trigger ───────────────────────────────

describe("multiple pickers", () => {
  it("throws when a second picker is created on an already-bound trigger", () => {
    const trigger = document.createElement("div");
    trigger.className = "foliplus-heatmap-scheme-bar";
    trigger.setAttribute("tabindex", "0");
    const inner = document.createElement("div");
    inner.setAttribute("data-scheme-bar-inner", "");
    trigger.appendChild(inner);
    document.body.appendChild(trigger);

    const p1 = createSchemePicker({
      trigger,
      schemes: ["Reds"],
      value: "Reds",
      numClasses: 4,
      portal: false,
      onChange: vi.fn(),
      colorScale,
    });

    // Second picker on the same trigger must throw a namespaced Error.
    let error: unknown;
    try {
      createSchemePicker({
        trigger,
        schemes: ["Blues"],
        value: "Blues",
        numClasses: 4,
        portal: false,
        onChange: vi.fn(),
        colorScale,
      });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "[schemePicker] this trigger already has an active picker — call destroy() first",
    );

    p1.destroy();
  });

  it("allows a new picker after the old one is destroyed", () => {
    const trigger = document.createElement("div");
    trigger.className = "foliplus-heatmap-scheme-bar";
    trigger.setAttribute("tabindex", "0");
    const inner = document.createElement("div");
    inner.setAttribute("data-scheme-bar-inner", "");
    trigger.appendChild(inner);
    document.body.appendChild(trigger);

    const p1 = createSchemePicker({
      trigger,
      schemes: ["Reds"],
      value: "Reds",
      numClasses: 4,
      portal: false,
      onChange: vi.fn(),
      colorScale,
    });
    p1.destroy();

    // New picker on the same trigger should succeed
    const p2 = createSchemePicker({
      trigger,
      schemes: ["Blues"],
      value: "Blues",
      numClasses: 4,
      portal: false,
      onChange: vi.fn(),
      colorScale,
    });
    expect(p2).toBeDefined();
    p2.destroy();
  });
});
// ── Failure paths and portal geometry ──────────────────────────────────

describe("colour-scale fallback", () => {
  it("renders neutral blocks when the injected colour scale throws", () => {
    const throwingScale = vi.fn(() => {
      throw new Error("scale boom");
    });
    const { trigger } = makePicker({ colorScale: throwingScale });

    const inner = trigger.querySelector("[data-scheme-bar-inner]")!;
    expect(throwingScale).toHaveBeenCalled();
    expect(inner.children.length).toBe(6);
    // The fallback is the shared neutral swatch (#999), not an empty bar.
    for (const block of Array.from(inner.children)) {
      expect((block as HTMLElement).style.background).toContain("rgb(153, 153, 153)");
    }
  });
});

describe("trigger keyboard — cycling both directions", () => {
  it("ArrowUp returns to the previous scheme after ArrowDown moved it", () => {
    const onChange = vi.fn();
    const { picker, trigger } = makePicker({ onChange });

    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(onChange).toHaveBeenLastCalledWith("Blues");
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(onChange).toHaveBeenLastCalledWith("Reds");

    picker.destroy();
  });
});

describe("setValue — validation and open-dropdown sync", () => {
  it("rejects a name that is not in schemes with a namespaced RangeError", () => {
    const { picker } = makePicker();
    let error: unknown;
    try {
      picker.setValue("Nope");
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(RangeError);
    expect((error as RangeError).message).toBe(
      '[schemePicker] value "Nope" is not in schemes — add it to schemes or use a value from the list',
    );
    picker.destroy();
  });

  it("updates the selected item of an open dropdown", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    picker.setValue("Blues");

    const items = picker
      .getDropdown()!
      .querySelectorAll("[role=option]") as NodeListOf<HTMLElement>;
    expect(items[1].classList.contains("foliplus-is-active")).toBe(true);
    expect(items[1].getAttribute("aria-selected")).toBe("true");
    expect(items[0].getAttribute("aria-selected")).toBe("false");
    picker.destroy();
  });
});

describe("selectScheme — current value", () => {
  it("closes the open dropdown without firing onChange", () => {
    const onChange = vi.fn();
    const { picker, trigger } = makePicker({ onChange });
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    picker.selectScheme("Reds");

    expect(picker.getDropdown()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger.classList.contains("foliplus-heatmap-scheme-bar-open")).toBe(false);
    picker.destroy();
  });
});

describe("refresh", () => {
  it("redraws an open dropdown and no-ops after destroy", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    picker.setNumClasses(3);

    picker.refresh();

    const bars = picker.getDropdown()!.querySelectorAll(".foliplus-scheme-picker-bar");
    expect(bars.length).toBe(3);
    picker.destroy();
    expect(() => picker.refresh()).not.toThrow();
  });
});

describe("portal fullscreen host", () => {
  const setFullscreen = (el: Element | null) => {
    Object.defineProperty(document, "fullscreenElement", {
      value: el,
      writable: true,
      configurable: true,
    });
  };
  afterEach(() => setFullscreen(null));

  it("re-parents the open dropdown when the fullscreen element changes", () => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    document.body.append(first, second);
    setFullscreen(first);

    const { picker, trigger } = makePicker({ portal: true });
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const dropdown = picker.getDropdown()!;
    expect(first.contains(dropdown)).toBe(true);

    setFullscreen(second);
    document.dispatchEvent(new Event("fullscreenchange"));

    expect(second.contains(dropdown)).toBe(true);
    picker.destroy();
  });
});

describe("portal position clamps", () => {
  const rect = (values: Partial<DOMRect>): DOMRect =>
    ({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
      ...values,
    }) as DOMRect;

  it("keeps the dropdown inside the viewport on scroll and resize", () => {
    const { picker, trigger } = makePicker({ portal: true });
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const dropdown = picker.getDropdown()!;

    // Trigger near the bottom-right corner, dropdown taller/wider than the
    // room left: the pass must clamp right, flip above and floor at 8px.
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(
      rect({ top: 10, bottom: 40, left: 700, right: 800, width: 100, height: 30 }),
    );
    vi.spyOn(dropdown, "getBoundingClientRect").mockReturnValue(
      rect({ width: 400, height: 300 }),
    );
    const innerWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
    const innerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 100, configurable: true });
    try {
      window.dispatchEvent(new Event("scroll"));
      expect(dropdown.style.left).toBe("392px");
      expect(dropdown.style.top).toBe("8px");

      window.dispatchEvent(new Event("resize"));
      expect(dropdown.style.top).toBe("8px");

      // Flip above with room to spare: the computed top wins over the floor.
      vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(
        rect({ top: 400, bottom: 430, left: 700, right: 800, width: 100, height: 30 }),
      );
      Object.defineProperty(window, "innerHeight", { value: 500, configurable: true });
      window.dispatchEvent(new Event("scroll"));
      expect(dropdown.style.top).toBe("96px");
    } finally {
      if (innerWidth) Object.defineProperty(window, "innerWidth", innerWidth);
      if (innerHeight) Object.defineProperty(window, "innerHeight", innerHeight);
    }
    picker.destroy();
  });
});
// ── Defensive branches: minimal trigger, listbox guards, teardown ──────

const bareTrigger = (): HTMLElement => {
  const trigger = document.createElement("div");
  trigger.setAttribute("tabindex", "0");
  document.body.appendChild(trigger);
  return trigger;
};

describe("bare trigger (no inner bar, no hidden select)", () => {
  it("creates, selects, sets a value and redraws without an inner element", () => {
    const trigger = bareTrigger();
    const picker = createSchemePicker({
      trigger,
      schemes: ["Reds", "Blues"],
      value: "Reds",
      numClasses: 6,
      portal: false,
      onChange: vi.fn(),
      colorScale,
    });

    expect(trigger.hasAttribute("aria-haspopup")).toBe(true);
    // No inner bar to draw into: every redraw path must skip rather than
    // dereference it (selectScheme / setValue / setNumClasses all go through
    // getInner). The fractional count also exercises the `|| 1` floor.
    expect(() => picker.selectScheme("Blues")).not.toThrow();
    expect(() => picker.setValue("Reds")).not.toThrow();
    expect(() => picker.setNumClasses(3)).not.toThrow();
    expect(() => picker.setNumClasses(0.4)).not.toThrow();
    expect(trigger.title).toBe("Reds");
    picker.destroy();
  });

  it("clamps a zero or fractional class count to one block", () => {
    for (const numClasses of [0, 0.4]) {
      document.body.innerHTML = "";
      const { trigger } = makePicker({ numClasses });
      const inner = trigger.querySelector("[data-scheme-bar-inner]")!;
      expect(inner.children.length).toBe(1);
    }
  });
});

describe("listbox keyboard guards", () => {
  it("ignores navigation in an empty dropdown", () => {
    const { picker, trigger } = makePicker({ schemes: [] });
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const dropdown = picker.getDropdown()!;

    for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Enter"]) {
      expect(() =>
        dropdown.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })),
      ).not.toThrow();
    }
    expect(picker.getDropdown()).not.toBeNull();
    picker.destroy();
  });

  it("Enter does nothing when focus is not on an option", () => {
    const onChange = vi.fn();
    const { picker, trigger } = makePicker({ onChange });
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    (document.activeElement as HTMLElement | null)?.blur?.();

    picker
      .getDropdown()!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onChange).not.toHaveBeenCalled();
    expect(picker.getDropdown()).not.toBeNull();
    picker.destroy();
  });

  it("Enter skips an option that carries no scheme name", () => {
    const onChange = vi.fn();
    const { picker, trigger } = makePicker({ onChange });
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const items = picker
      .getDropdown()!
      .querySelectorAll("[role=option]") as NodeListOf<HTMLElement>;
    items[0].removeAttribute("data-scheme-name");
    items[0].focus();

    picker
      .getDropdown()!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onChange).not.toHaveBeenCalled();
    picker.destroy();
  });

  it("ignores a key the listbox does not handle", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(() =>
      picker
        .getDropdown()!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true })),
    ).not.toThrow();
    expect(picker.getDropdown()).not.toBeNull();
    picker.destroy();
  });
});

describe("trigger keyboard guards", () => {
  it("ignores keys while the dropdown is open", () => {
    const onChange = vi.fn();
    const { picker, trigger } = makePicker({ onChange });
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );

    expect(onChange).not.toHaveBeenCalled();
    expect(picker.getDropdown()).not.toBeNull();
    picker.destroy();
  });

  it("ignores a key the trigger does not handle", () => {
    const { picker, trigger } = makePicker();

    expect(() =>
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true })),
    ).not.toThrow();
    expect(picker.getDropdown()).toBeNull();
    picker.destroy();
  });
});

describe("portal same-host fullscreen event", () => {
  afterEach(() =>
    Object.defineProperty(document, "fullscreenElement", {
      value: null,
      writable: true,
      configurable: true,
    }),
  );

  it("keeps the dropdown where it is when the host did not change", () => {
    const { picker, trigger } = makePicker({ portal: true });
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const dropdown = picker.getDropdown()!;
    expect(dropdown.parentElement).toBe(document.body);

    document.dispatchEvent(new Event("fullscreenchange"));

    expect(dropdown.parentElement).toBe(document.body);
    expect(picker.getDropdown()).toBe(dropdown);
    picker.destroy();
  });
});

describe("inline mount without a parent", () => {
  it("falls back to the trigger itself as the dropdown parent", () => {
    const trigger = bareTrigger();
    trigger.remove(); // detached: no form-control ancestor, no parentElement
    const picker = createSchemePicker({
      trigger,
      schemes: ["Reds", "Blues"],
      value: "Reds",
      numClasses: 6,
      portal: false,
      onChange: vi.fn(),
      colorScale,
    });

    picker.toggle();

    expect(picker.getDropdown()!.parentElement).toBe(trigger);
    picker.destroy();
  });
});

describe("aria-activedescendant guard", () => {
  it("does not write the attribute when focus already left the items", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const item = picker.getDropdown()!.querySelector("[role=option]") as HTMLElement;
    const before = trigger.getAttribute("aria-activedescendant");

    // Focus moved away before the queued focus handler ran: the item is no
    // longer document.activeElement, so the guard must not claim it is.
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
    item.dispatchEvent(new FocusEvent("focus"));

    expect(trigger.getAttribute("aria-activedescendant")).toBe(before);
    document.body.removeAttribute("tabindex");
    picker.destroy();
  });
});

describe("refresh skips malformed entries", () => {
  it("ignores an option without a scheme name or a bar child", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const items = picker
      .getDropdown()!
      .querySelectorAll("[role=option]") as NodeListOf<HTMLElement>;
    items[0].removeAttribute("data-scheme-name");
    items[1].querySelector(".foliplus-scheme-picker-bar")!.remove();

    expect(() => picker.refresh()).not.toThrow();
    expect(picker.getDropdown()).not.toBeNull();
    picker.destroy();
  });
});

describe("setNumClasses — unchanged count", () => {
  it("is a no-op when the clamped count equals the current one", () => {
    const { picker, trigger } = makePicker({ numClasses: 6 });
    const inner = trigger.querySelector("[data-scheme-bar-inner]")!;

    picker.setNumClasses(6);

    expect(inner.children.length).toBe(6);
    picker.destroy();
  });
});

describe("public methods after destroy", () => {
  it("are no-ops and getDropdown stays null", () => {
    const { picker, trigger } = makePicker();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    picker.destroy();

    expect(() => picker.setValue("Blues")).not.toThrow();
    expect(() => picker.selectScheme("Blues")).not.toThrow();
    expect(() => picker.setNumClasses(3)).not.toThrow();
    expect(() => picker.refresh()).not.toThrow();
    expect(() => picker.toggle()).not.toThrow();
    expect(() => picker.close()).not.toThrow();
    expect(picker.getDropdown()).toBeNull();
    // A second destroy is idempotent (the guard returns before teardown).
    expect(() => picker.destroy()).not.toThrow();
  });
});

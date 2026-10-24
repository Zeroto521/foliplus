// Tests for the shared scheme picker (common/schemePicker.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { type SchemePicker, createSchemePicker } from "#common/schemePicker.js";

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

// ── ARIA attributes ────────────────────────────────────────────────────

describe("ARIA attributes", () => {
  it("sets aria-expanded=true when open", () => {
    const { picker, trigger } = makePicker();
    expect(trigger.getAttribute("aria-expanded")).toBeNull();
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
      const bar = item.querySelector(".foliplus-heatmap-scheme-dropdown-bar")!;
      expect(bar.children.length).toBe(3);
    });
    picker.destroy();
  });

  it("does not throw for an invalid scheme name", () => {
    const { trigger } = makePicker({ value: "NoSuchScheme" });
    // No error thrown
    expect(trigger).toBeTruthy();
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
      const bar = item.querySelector(".foliplus-heatmap-scheme-dropdown-bar")!;
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

    // Second picker on the same trigger must throw
    expect(() =>
      createSchemePicker({
        trigger,
        schemes: ["Blues"],
        value: "Blues",
        numClasses: 4,
        portal: false,
        onChange: vi.fn(),
        colorScale,
      }),
    ).toThrow("already has an active picker");

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

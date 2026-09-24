import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_KEYS, nativeClass, nativeConsumesKey } from "#core/inputOwnership.js";
import { ensureInteraction } from "#core/interaction.js";

// ─────────────────────────────────────────────────────────────────────────
// The input-ownership gate table.
//
// One table answers "does the focused control consume this key, so foliplus
// must neither act nor preventDefault?" and every call site asks it instead
// of re-deriving the answer. Each row is pinned twice:
//   1. the predicate itself — so editing the table turns the test red;
//   2. real event routing through the document-level dispatcher — so a
//      production change that reclaims a native key fails the gate.
// Events are dispatched on `document`, letting the browser's own routing
// hand the key to the focused control rather than a synthetic target.
// ─────────────────────────────────────────────────────────────────────────

const makeMap = (): any => ({
  foliplus: {},
  on: vi.fn(),
  off: vi.fn(),
  getContainer: vi.fn(() => document.createElement("div")),
});

/** Keys each control family consumes natively. */
const ARROWS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const;
const EDIT_KEYS = [...ARROWS, "Home", "End", "Enter"] as const;
const STEP_KEYS = [...ARROWS, "Home", "End", "PageUp", "PageDown"] as const;
const SELECT_KEYS = [...ARROWS, "Enter", " "] as const;
const EDITABLE_KEYS = [...ARROWS, "Home", "End", "Enter", "Backspace"] as const;

type RowClass = "edit" | "step" | "toggle" | "select" | "editable";

const KEYS_OF: Record<RowClass, readonly string[]> = {
  edit: EDIT_KEYS,
  step: STEP_KEYS,
  toggle: [" "],
  select: SELECT_KEYS,
  editable: EDITABLE_KEYS,
};

const input = (type: string): HTMLInputElement => {
  const el = document.createElement("input");
  el.type = type;
  return el;
};

const ROWS: { label: string; cls: RowClass; make: () => HTMLElement }[] = [
  ...["text", "search", "email", "url", "tel", "number", "password"].map(type => ({
    label: `input[type=${type}]`,
    cls: "edit" as const,
    make: () => input(type),
  })),
  { label: "textarea", cls: "edit", make: () => document.createElement("textarea") },
  ...["range", "color", "date", "time"].map(type => ({
    label: `input[type=${type}]`,
    cls: "step" as const,
    make: () => input(type),
  })),
  ...["checkbox", "radio"].map(type => ({
    label: `input[type=${type}]`,
    cls: "toggle" as const,
    make: () => input(type),
  })),
  {
    label: "select",
    cls: "select",
    make: () => {
      const el = document.createElement("select");
      el.appendChild(document.createElement("option"));
      return el;
    },
  },
  {
    label: "[contenteditable]",
    cls: "editable",
    make: () => {
      const el = document.createElement("div");
      el.setAttribute("contenteditable", "true");
      el.tabIndex = 0;
      return el;
    },
  },
];

/** Keys each family does NOT own — foliplus keeps these. */
const NOT_OWNED: Record<RowClass, string[]> = {
  edit: ["PageUp", "PageDown", "Backspace"],
  step: ["Enter", "Backspace"],
  toggle: [...ARROWS, "Home", "End", "Enter"],
  select: ["PageUp", "PageDown", "Backspace"],
  editable: [],
};

describe("nativeClass", () => {
  it.each(ROWS)("$label is the %cls family", row => {
    expect(nativeClass(row.make())).toBe(row.cls);
  });

  it("classifies a hidden input as owning nothing", () => {
    expect(nativeClass(input("hidden"))).toBe("none");
  });

  it("an input type outside the owning-nothing set never owns nothing", () => {
    // Table completeness: a new native control type may not silently become a
    // key foliplus claims. Only the known inert types may classify as none.
    for (const type of [
      "text",
      "search",
      "number",
      "range",
      "color",
      "date",
      "time",
      "datetime-local",
      "week",
      "month",
      "checkbox",
      "radio",
      "hidden",
      "xyz",
    ]) {
      const cls = nativeClass(input(type));
      if (type === "hidden") expect(cls, type).toBe("none");
      else expect(cls, type).not.toBe("none");
    }
  });

  it("classifies a plain element as owning nothing", () => {
    expect(nativeClass(document.createElement("div"))).toBe("none");
  });
});

describe("nativeConsumesKey — the one table", () => {
  it.each(ROWS)("$label consumes every key in its row", row => {
    const el = row.make();
    for (const key of KEYS_OF[row.cls]) {
      expect(nativeConsumesKey(el, key), `${row.label} / ${key}`).toBe(true);
    }
  });

  it.each(ROWS)("$label does not consume the keys it does not own", row => {
    const el = row.make();
    for (const key of NOT_OWNED[row.cls]) {
      expect(nativeConsumesKey(el, key), `${row.label} / ${key}`).toBe(false);
    }
  });

  it("returns false for a non-control target no matter the key", () => {
    const row = document.createElement("div");
    row.className = "foliplus-layer-item";
    for (const key of ["ArrowDown", " ", "Enter", "a"]) {
      expect(nativeConsumesKey(row, key)).toBe(false);
    }
  });

  it("a contenteditable consumes every key but the owner keys", () => {
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "true");
    for (const key of ["ArrowUp", "Home", "Enter", "Backspace", "a", "z", "Delete"]) {
      expect(nativeConsumesKey(el, key), key).toBe(true);
    }
    expect(nativeConsumesKey(el, "Escape")).toBe(false);
  });

  it("returns false for a null target", () => {
    expect(nativeConsumesKey(null, "ArrowDown")).toBe(false);
  });
});

describe("the Escape whitelist lives in one place", () => {
  it("declares Escape a foliplus-owned key", () => {
    expect(OWNER_KEYS.has("Escape")).toBe(true);
  });

  it("Escape is never handed to a native control, in any row", () => {
    for (const row of ROWS) {
      const el = row.make();
      if (row.cls !== "editable") {
        expect(nativeConsumesKey(el, "Escape"), row.label).toBe(false);
        continue;
      }
      // A contenteditable consumes every key except the owner keys.
      expect(nativeConsumesKey(el, "Escape")).toBe(false);
    }
  });

  it("Escape is the only owner key", () => {
    expect([...OWNER_KEYS]).toEqual(["Escape"]);
  });
});

describe("real-event gates — document-level dispatch", () => {
  let map: any;
  let panel: HTMLElement;
  let handled: ReturnType<typeof vi.fn>;
  let cleanup: () => void;

  /** Every key any row can own — deduped, so each key maps to one shortcut. */
  const KEYS = [
    ...new Set([
      ...EDIT_KEYS,
      ...STEP_KEYS,
      ...SELECT_KEYS,
      " ",
      "Backspace",
      "Escape",
    ]),
  ];

  beforeEach(() => {
    map = makeMap();
    panel = document.createElement("div");
    panel.className = "foliplus-panel";
    document.body.appendChild(panel);
    handled = vi.fn();
    const defs = KEYS.map(key => ({
      key,
      container: panel,
      handler: handled as (event: Event) => void,
    }));
    cleanup = ensureInteraction(map).register("PanelKeys", defs);
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  /** Focus the control, then let the browser route the key from document. */
  const press = (el: HTMLElement, key: string): KeyboardEvent => {
    el.focus();
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
    return event;
  };

  it.each(ROWS)("$label owns its keys — foliplus neither acts nor prevents", row => {
    const control = row.make();
    panel.appendChild(control);
    for (const key of KEYS_OF[row.cls]) {
      const event = press(control, key);
      // The native control keeps the key: no cancel, no foliplus handler.
      expect(event.defaultPrevented, `${row.label} / ${key}`).toBe(false);
      expect(handled, `${row.label} / ${key}`).not.toHaveBeenCalled();
    }
  });

  it.each(ROWS)("$label leaves the keys it does not own to foliplus", row => {
    const control = row.make();
    panel.appendChild(control);
    for (const key of NOT_OWNED[row.cls]) {
      const event = press(control, key);
      expect(event.defaultPrevented, `${row.label} / ${key}`).toBe(true);
      expect(handled, `${row.label} / ${key}`).toHaveBeenCalledTimes(1);
      handled.mockClear();
    }
  });

  it("Escape reaches foliplus from every control family and may be cancelled", () => {
    for (const row of ROWS) {
      const control = row.make();
      panel.appendChild(control);
      const event = press(control, "Escape");
      expect(event.defaultPrevented, row.label).toBe(true);
      expect(handled, row.label).toHaveBeenCalledTimes(1);
      handled.mockClear();
    }
  });
});

describe("real-event gates — the element-bound path is gated too", () => {
  let map: any;

  beforeEach(() => {
    map = makeMap();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("a binding on a container defers to a native control it now holds", () => {
    // The binding sits on a panel div, not on the slider — the slider moved
    // in later, so the container binding must not swallow its arrow keys.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const slider = input("range");
    host.appendChild(slider);

    const handler = vi.fn();
    const cleanup = ensureInteraction(map).register("Bypass", [
      { key: "ArrowDown", element: host, handler },
    ]);
    slider.focus();
    const event = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    slider.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    cleanup();
  });

  it("a binding on a checkbox-less row div keeps Space when a row is focused", () => {
    // Same bypass, control that does NOT own the key: the claim still fires.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const row = document.createElement("div");
    row.className = "foliplus-layer-item";
    host.appendChild(row);

    const handler = vi.fn();
    const cleanup = ensureInteraction(map).register("BypassRow", [
      { key: " ", element: host, handler },
    ]);
    row.focus({ preventScroll: true } as FocusOptions);
    const event = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    row.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("a binding on the focused control itself is an explicit claim", () => {
    // The caller bound to this exact element, which is what `element:` means:
    // an opt-in that overrides the native consumer. Combobox navigation
    // (arrows move the selection, not the caret) rides on this.
    const slider = input("range");
    document.body.appendChild(slider);

    const handler = vi.fn();
    const cleanup = ensureInteraction(map).register("Claim", [
      { key: "ArrowDown", element: slider, handler },
    ]);
    slider.focus();
    const event = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    slider.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("Escape still reaches an element-bound claim from a text input", () => {
    const field = input("text");
    document.body.appendChild(field);
    const handler = vi.fn();
    const cleanup = ensureInteraction(map).register("ClaimEsc", [
      { key: "Escape", element: field, handler },
    ]);
    field.focus();
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    field.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    cleanup();
  });
});

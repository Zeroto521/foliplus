// Tests for the shared option-row ARIA contract (ui/optionRow.ts).
import { describe, expect, it } from "vitest";
import { applyOptionRowA11y, nextOptionId } from "#ui/optionRow.js";

describe("applyOptionRowA11y — the shared option-row ARIA contract", () => {
  it("paints role, tabindex and aria-selected on the row", () => {
    const el = document.createElement("div");
    applyOptionRowA11y({ el, selected: true });
    expect(el.getAttribute("role")).toBe("option");
    expect(el.getAttribute("tabindex")).toBe("-1");
    expect(el.getAttribute("aria-selected")).toBe("true");
  });

  it("reflects an unselected row as aria-selected=false", () => {
    const el = document.createElement("div");
    applyOptionRowA11y({ el, selected: false });
    expect(el.getAttribute("aria-selected")).toBe("false");
  });

  it("accepts an explicit role", () => {
    const el = document.createElement("li");
    applyOptionRowA11y({ el, selected: true, role: "menuitem" });
    expect(el.getAttribute("role")).toBe("menuitem");
  });

  it("sets the id only when the caller passes one", () => {
    const withId = document.createElement("div");
    applyOptionRowA11y({ el: withId, selected: true, id: "opt-1" });
    expect(withId.getAttribute("id")).toBe("opt-1");
    const withoutId = document.createElement("div");
    applyOptionRowA11y({ el: withoutId, selected: true });
    expect(withoutId.hasAttribute("id")).toBe(false);
  });

  it("leaves data-*, disabled and the selected class to the caller", () => {
    const el = document.createElement("button");
    applyOptionRowA11y({ el, selected: true });
    expect(el.hasAttribute("data-value")).toBe(false);
    expect(el.hasAttribute("data-scheme-name")).toBe(false);
    expect(el.hasAttribute("disabled")).toBe(false);
    expect(el.hasAttribute("aria-disabled")).toBe(false);
    expect(el.className).toBe("");
  });
});

describe("nextOptionId — the single option-row id source", () => {
  it("mints distinct ids under the caller's prefix", () => {
    const a = nextOptionId("listbox-row");
    const b = nextOptionId("listbox-row");
    const c = nextOptionId("search-result");
    expect(a).toMatch(/^foliplus-listbox-row-\d+$/);
    expect(b).toMatch(/^foliplus-listbox-row-\d+$/);
    expect(a).not.toBe(b);
    expect(c).toMatch(/^foliplus-search-result-\d+$/);
  });
});

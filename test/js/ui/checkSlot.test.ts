// Tests for the shared leading-cell builder (ui/checkSlot.ts).
import { describe, expect, it } from "vitest";
import { buildCheckboxSlot, buildLeadSlot } from "#ui/checkSlot.js";
import { CHECK_SLOT_CLASS } from "#ui/checkSlotClassName.js";

describe("buildCheckboxSlot — multiple-mode tri-state cell", () => {
  it("paints an empty list as unchecked, never indeterminate", () => {
    const { box } = buildCheckboxSlot(0, 0);
    expect(box.checked).toBe(false);
    expect(box.indeterminate).toBe(false);
    expect(box.getAttribute("aria-checked")).toBe("false");
  });

  it("paints every item selected as checked", () => {
    const { box } = buildCheckboxSlot(3, 3);
    expect(box.checked).toBe(true);
    expect(box.indeterminate).toBe(false);
    expect(box.getAttribute("aria-checked")).toBe("true");
  });

  it("paints a partial selection as indeterminate", () => {
    const { box } = buildCheckboxSlot(3, 1);
    expect(box.checked).toBe(false);
    expect(box.indeterminate).toBe(true);
    expect(box.getAttribute("aria-checked")).toBe("mixed");
  });

  it("mounts the box in the shared slot cell", () => {
    const { slot, box } = buildCheckboxSlot(2, 0);
    expect(slot.classList.contains(CHECK_SLOT_CLASS.SLOT)).toBe(true);
    expect(slot.firstElementChild).toBe(box);
    expect(box.classList.contains(CHECK_SLOT_CLASS.BOX)).toBe(true);
    expect(box.getAttribute("aria-hidden")).toBe("false");
  });
});

describe("buildLeadSlot — single-mode glyph cell", () => {
  it("stays out of the accessibility tree", () => {
    const { slot } = buildLeadSlot("foliplus-scheme-picker__glyph");
    expect(slot.getAttribute("aria-hidden")).toBe("true");
    expect(slot.classList.contains(CHECK_SLOT_CLASS.SLOT)).toBe(true);
    expect(slot.classList.contains(CHECK_SLOT_CLASS.LEAD)).toBe(true);
  });

  it("paints the check glyph only while selected", () => {
    const { slot, paint } = buildLeadSlot("x");
    expect(slot.textContent).toBe("");
    paint(true);
    expect(slot.textContent).toBe("\u2713");
    paint(false);
    expect(slot.textContent).toBe("");
  });
});

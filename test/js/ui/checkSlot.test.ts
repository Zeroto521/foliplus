// Tests for the shared check-slot builders (ui/checkSlot.ts).
import { describe, expect, it } from "vitest";
import { buildCheckboxSlot, buildLeadSlot } from "#ui/checkSlot.js";
import { CHECK_SLOT_CLASS } from "#ui/checkSlotClassName.js";

describe("buildCheckboxSlot — the multiple-mode checkbox cell", () => {
  it("paints an unchecked box when nothing is selected", () => {
    const { slot, box } = buildCheckboxSlot(4, 0);
    expect(slot.classList.contains(CHECK_SLOT_CLASS.SLOT)).toBe(true);
    expect(box.classList.contains(CHECK_SLOT_CLASS.BOX)).toBe(true);
    expect(box.checked).toBe(false);
    expect(box.indeterminate).toBe(false);
  });

  it("paints a half-full box for a partial selection", () => {
    const { box } = buildCheckboxSlot(4, 2);
    expect(box.checked).toBe(false);
    expect(box.indeterminate).toBe(true);
  });

  it("paints a checked box when every item is selected", () => {
    const { box } = buildCheckboxSlot(4, 4);
    expect(box.checked).toBe(true);
    expect(box.indeterminate).toBe(false);
  });

  it("keeps an empty list unchecked rather than half-full", () => {
    // 0 === 0 would read as "all selected"; the shared verdict says none.
    const { box } = buildCheckboxSlot(0, 0);
    expect(box.checked).toBe(false);
    expect(box.indeterminate).toBe(false);
  });

  it("nests the box inside the slot so the row keeps one leading cell", () => {
    const { slot, box } = buildCheckboxSlot(2, 1);
    expect(slot.firstElementChild).toBe(box);
  });
});

describe("buildLeadSlot — the single-mode ✓ lead", () => {
  it("builds a hidden lead carrying the caller's glyph class", () => {
    const { slot } = buildLeadSlot("foliplus-glyph-x");
    expect(slot.classList.contains(CHECK_SLOT_CLASS.SLOT)).toBe(true);
    expect(slot.classList.contains(CHECK_SLOT_CLASS.LEAD)).toBe(true);
    expect(slot.classList.contains("foliplus-glyph-x")).toBe(true);
    expect(slot.getAttribute("aria-hidden")).toBe("true");
  });

  it("paints the ✓ only while the entry is selected", () => {
    const { slot, paint } = buildLeadSlot("foliplus-glyph-x");
    paint(true);
    expect(slot.textContent).toBe("\u2713");
    paint(false);
    expect(slot.textContent).toBe("");
  });
});

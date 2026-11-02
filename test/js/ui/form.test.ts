import { describe, expect, it } from "vitest";
import { dom } from "#common/dom.js";
import { readOnlyValue } from "#ui/form.js";

// ui/form read-only primitive: the shared read-only value box for panel
// readouts. The class-name contract with the Python render-string tests is
// that the shared semantic class and the caller's frame class land on the
// same box in the same order, and aria-disabled is always true — so a
// readout can never be mistaken for something editable.
describe("ui/form read-only value", () => {
  it("emits the shared READONLY class and the caller frame class", () => {
    const box = readOnlyValue(
      { className: "foliplus-style-fill-readonly" },
      dom.el("span", {}, "score"),
    );
    expect(box.tagName).toBe("DIV");
    expect(box.classList.contains("foliplus-readonly")).toBe(true);
    expect(box.classList.contains("foliplus-style-fill-readonly")).toBe(true);
    // The two classes are joined in order (semantic first, frame second).
    expect(box.outerHTML).toBe(
      '<div class="foliplus-readonly foliplus-style-fill-readonly" aria-disabled="true"><span>score</span></div>',
    );
  });

  it("always marks the box aria-disabled (it cannot be edited)", () => {
    const box = readOnlyValue({}, "3");
    expect(box.getAttribute("aria-disabled")).toBe("true");
  });

  it("accepts ariaDisabled false for a genuinely inert container", () => {
    const box = readOnlyValue({ ariaDisabled: false }, "x");
    expect(box.getAttribute("aria-disabled")).toBe("false");
  });

  it("accepts a plain string value and renders it as text", () => {
    const box = readOnlyValue({}, "—");
    expect(box.textContent).toBe("—");
    expect(box.querySelector("span")).toBeNull();
  });

  it("applies a caller-supplied role for a stable accessible name", () => {
    const box = readOnlyValue(
      { className: "foliplus-style-fill-readonly", role: "group" },
      dom.el("span", {}, "3"),
    );
    expect(box.getAttribute("role")).toBe("group");
  });
});

// test/js/ui/checkbox.test.ts — the shared tri-state checkbox primitive.
import { describe, expect, it, vi } from "vitest";
import { CHECKBOX_CLASS, type TriState, createCheckbox } from "#ui/checkbox.js";

const stateOf = (input: HTMLInputElement): TriState =>
  input.indeterminate ? "indeterminate" : input.checked ? "checked" : "unchecked";

describe("CHECKBOX_CLASS", () => {
  it("is the single-source wrapper vocabulary", () => {
    expect(CHECKBOX_CLASS.WRAPPER).toBe("foliplus-checkbox");
    expect(CHECKBOX_CLASS.INPUT).toBe("foliplus-checkbox-input");
  });
});

describe("createCheckbox", () => {
  it("builds a wrapper div carrying the wrapper class and an inner input", () => {
    const { host, input } = createCheckbox({ checked: true });
    expect(host.tagName).toBe("DIV");
    expect(host.classList.contains(CHECKBOX_CLASS.WRAPPER)).toBe(true);
    expect(host.contains(input)).toBe(true);
    expect(input.type).toBe("checkbox");
  });

  it("paints binary checked / unchecked", () => {
    expect(stateOf(createCheckbox({ checked: true }).input)).toBe("checked");
    expect(stateOf(createCheckbox({ checked: false }).input)).toBe("unchecked");
  });

  it("paints indeterminate from the tri-state aggregate", () => {
    // The role/folder aggregate { total, on } maps to tri-state at the call
    // site; the primitive paints whichever state it is handed.
    const { input } = createCheckbox({ triState: "indeterminate" });
    expect(stateOf(input)).toBe("indeterminate");
  });

  it("sets aria-checked true / false / mixed to match the painted state", () => {
    expect(createCheckbox({ checked: true }).input.getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(createCheckbox({ checked: false }).input.getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(
      createCheckbox({ triState: "indeterminate" }).input.getAttribute("aria-checked"),
    ).toBe("mixed");
  });

  it("carries an accessible name when given", () => {
    const { input } = createCheckbox({ checked: false, ariaLabel: "全选" });
    expect(input.getAttribute("aria-label")).toBe("全选");
  });

  it("omits aria-label when not given (consumer supplies its own label)", () => {
    const { input } = createCheckbox({ checked: false });
    expect(input.hasAttribute("aria-label")).toBe(false);
  });

  it("applies extra attributes (data-role, title) to the input", () => {
    const { input } = createCheckbox({
      checked: true,
      attributes: { "data-role": "toggle-all", title: "deselect" },
    });
    expect(input.dataset.role).toBe("toggle-all");
    expect(input.title).toBe("deselect");
  });

  it("fires onChange with the pre-click tri-state on user toggle", () => {
    // The browser clears indeterminate before the change event, so the
    // primitive must hand back the state it painted, not the post-reset one.
    // (jsdom's .click() does not synthesize a change on a checkbox, so we
    // dispatch it the way a real user agent does.)
    const onChange = vi.fn();
    const { input } = createCheckbox({ triState: "indeterminate", onChange });
    input.click();
    input.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("indeterminate");
  });

  it("reports checked / unchecked pre-click state on user toggle", () => {
    const onChange = vi.fn();
    const { input } = createCheckbox({ checked: false, onChange });
    input.click();
    input.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenCalledWith("unchecked");

    const onChange2 = vi.fn();
    const { input: input2 } = createCheckbox({ checked: true, onChange: onChange2 });
    input2.click();
    input2.dispatchEvent(new Event("change"));
    expect(onChange2).toHaveBeenCalledWith("checked");
  });

  it("does not fire onChange on a programmatic update()", () => {
    const onChange = vi.fn();
    const { input, update } = createCheckbox({ checked: false, onChange });
    update({ checked: true });
    expect(onChange).not.toHaveBeenCalled();
    expect(stateOf(input)).toBe("checked");
  });

  it("update() repaints tri-state and aria-checked together", () => {
    const { input, update } = createCheckbox({ checked: false });
    update({ triState: "indeterminate" });
    expect(stateOf(input)).toBe("indeterminate");
    expect(input.getAttribute("aria-checked")).toBe("mixed");
    update({ checked: true });
    expect(stateOf(input)).toBe("checked");
    expect(input.getAttribute("aria-checked")).toBe("true");
  });

  it("update() can change the accessible name", () => {
    const { input, update } = createCheckbox({ checked: false, ariaLabel: "a" });
    update({ ariaLabel: "b" });
    expect(input.getAttribute("aria-label")).toBe("b");
    update({ ariaLabel: null });
    expect(input.hasAttribute("aria-label")).toBe(false);
  });
});

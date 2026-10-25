// core/rampForm — the Field / Classes / Scheme rows shared by LayerControl's
// value-based fill and HeatmapControl's classification panel.
import { describe, expect, it, vi } from "vitest";
import { buildClassesRow, buildFieldRow, buildSchemeRow } from "#core/rampForm.js";

describe("buildFieldRow", () => {
  it("renders a labelled native field select with the current value", () => {
    const { row, select } = buildFieldRow({
      label: "Field",
      ariaLabel: "Field",
      fields: ["count", "score"],
      value: "score",
    });

    expect(row.classList.contains("foliplus-form-row")).toBe(true);
    expect(row.querySelector(".foliplus-form-label")!.textContent).toBe("Field");
    expect(select.getAttribute("aria-label")).toBe("Field");
    expect(Array.from(select.options).map(o => o.value)).toEqual(["count", "score"]);
    expect(select.value).toBe("score");
  });

  it("falls back to the first field when the stored value is gone", () => {
    const { select } = buildFieldRow({
      label: "Field",
      ariaLabel: "Field",
      fields: ["count", "score"],
      value: "removed",
    });

    expect(select.value).toBe("count");
  });

  it("renders an empty select when the field list is gone", () => {
    // A layer can lose its last numeric property while the panel is open; the
    // row must still build (the panel replaces it on the next rebuild) instead
    // of throwing on an undefined first field.
    const { row, select } = buildFieldRow({
      label: "Field",
      ariaLabel: "Field",
      fields: [],
      value: "value",
    });

    expect(select.options.length).toBe(0);
    expect(select.value).toBe("");
    expect(row.querySelector(".foliplus-form-label")!.textContent).toBe("Field");
  });

  it("applies consumer classes/attributes and wires onChange", () => {
    const onChange = vi.fn();
    const { row, select } = buildFieldRow({
      label: "Field",
      ariaLabel: "Field",
      fields: ["count", "score"],
      value: "count",
      rowClass: "extra-row",
      selectClass: "extra-select",
      rowAttributes: { "data-row": "" },
      selectAttributes: { "data-select": "" },
      onChange,
    });

    expect(row.classList.contains("extra-row")).toBe(true);
    expect(row.getAttribute("data-row")).toBe("");
    expect(select.classList.contains("extra-select")).toBe(true);
    expect(select.getAttribute("data-select")).toBe("");

    select.value = "score";
    select.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenCalledWith("score");
  });
});

describe("buildClassesRow", () => {
  const methodLabel = (method: string) => {
    const map: Record<string, string> = {
      jenks: "Natural Breaks",
      quantile: "Quantile",
      equal: "Equal Interval",
      heads: "Equal Count",
    };
    return map[method] ?? method;
  };

  const build = (overrides: Record<string, unknown> = {}) =>
    buildClassesRow({
      label: "Classes",
      methodAriaLabel: "Classes",
      classesAriaLabel: "Classes",
      methodValue: "quantile",
      classesValue: 5,
      methodLabel,
      ...overrides,
    });

  it("renders the shared method order and class counts", () => {
    const { row, methodSelect, classesSelect } = build();

    expect(row.querySelector(".foliplus-form-label")!.textContent).toBe("Classes");
    expect(Array.from(methodSelect.options).map(o => o.value)).toEqual([
      "jenks",
      "quantile",
      "equal",
      "heads",
    ]);
    expect(Array.from(methodSelect.options).map(o => o.textContent)).toEqual([
      "Natural Breaks",
      "Quantile",
      "Equal Interval",
      "Equal Count",
    ]);
    expect(methodSelect.value).toBe("quantile");
    expect(Array.from(classesSelect.options).map(o => o.value)).toEqual([
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
    ]);
    expect(classesSelect.value).toBe("5");
  });

  it("wires both selects through one onChange and applies attributes", () => {
    const onChange = vi.fn();
    const { row, methodSelect, classesSelect } = build({
      methodClass: "extra-method",
      classesClass: "extra-classes",
      rowAttributes: { "data-row": "" },
      methodAttributes: { "data-method": "" },
      classesAttributes: { "data-count": "" },
      onChange,
    });

    expect(row.getAttribute("data-row")).toBe("");
    expect(methodSelect.classList.contains("extra-method")).toBe(true);
    expect(methodSelect.getAttribute("data-method")).toBe("");
    expect(classesSelect.classList.contains("extra-classes")).toBe(true);
    expect(classesSelect.getAttribute("data-count")).toBe("");

    methodSelect.value = "equal";
    methodSelect.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenLastCalledWith({ method: "equal" });

    classesSelect.value = "7";
    classesSelect.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenLastCalledWith({ classes: 7 });
  });

  it("ignores a change that carries no class count", () => {
    // Every option is a number, so this is a guard against a malformed DOM
    // (a rebuild or a script clearing the select) rather than a user path: a
    // NaN class count must never reach the ramp config.
    const onChange = vi.fn();
    const { classesSelect } = build({ onChange });

    classesSelect.value = "";
    classesSelect.dispatchEvent(new Event("change"));

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("buildSchemeRow", () => {
  it("builds the picker trigger (strip only) and the hidden select", () => {
    const { row, trigger, bar, hiddenSelect } = buildSchemeRow({
      label: "Scheme",
      triggerClass: "scheme-trigger",
      barClass: "scheme-bar",
    });

    expect(row.querySelector(".foliplus-form-label")!.textContent).toBe("Scheme");
    expect(trigger.classList.contains("scheme-trigger")).toBe(true);
    expect(trigger.getAttribute("role")).toBe("combobox");
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("tabindex")).toBe("0");
    expect(bar.classList.contains("scheme-bar")).toBe(true);
    expect(bar.classList.contains("foliplus-scheme-picker-bar")).toBe(true);
    expect(bar.getAttribute("data-scheme-bar-inner")).toBe("");
    expect(hiddenSelect.classList.contains("foliplus-scheme-picker-hidden")).toBe(true);
    expect(hiddenSelect.getAttribute("aria-hidden")).toBe("true");
    // No scheme name in the trigger: the strip is the label.
    expect(trigger.textContent).toBe("");
  });

  it("applies consumer classes, attributes and a custom hidden-select class", () => {
    const { row, trigger, bar, hiddenSelect } = buildSchemeRow({
      label: "Scheme",
      triggerClass: "scheme-trigger",
      barClass: "scheme-bar",
      barInnerClass: "scheme-inner",
      hiddenClass: "custom-hidden",
      rowClass: "extra-row",
      rowAttributes: { "data-row": "" },
      triggerAttributes: { "data-trigger": "" },
      barAttributes: { "data-bar": "" },
      hiddenAttributes: { "data-hidden": "" },
    });

    expect(row.classList.contains("extra-row")).toBe(true);
    expect(row.getAttribute("data-row")).toBe("");
    expect(trigger.getAttribute("data-trigger")).toBe("");
    expect(bar.classList.contains("scheme-inner")).toBe(true);
    expect(bar.getAttribute("data-bar")).toBe("");
    expect(hiddenSelect.classList.contains("custom-hidden")).toBe(true);
    expect(hiddenSelect.classList.contains("foliplus-scheme-picker-hidden")).toBe(
      false,
    );
    expect(hiddenSelect.getAttribute("data-hidden")).toBe("");
  });
});

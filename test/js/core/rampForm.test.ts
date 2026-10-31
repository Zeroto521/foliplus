// core/rampForm — the Field / Method + Classes / Scheme rows shared by
// LayerControl's value-based fill and HeatmapControl's classification panel.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildClassesRow, buildFieldRow, buildSchemeRow } from "#core/rampForm.js";

describe("buildFieldRow", () => {
  it("renders a labelled field dropdown over the current value", () => {
    const { row, select, dropdown } = buildFieldRow({
      label: "Field",
      ariaLabel: "Field",
      fields: ["count", "score"],
      value: "score",
    });

    expect(row.classList.contains("foliplus-form-row")).toBe(true);
    expect(row.querySelector(".foliplus-form-label")!.textContent).toBe("Field");
    // The visible control carries the accessible name; the select behind it is
    // the hidden value/change bridge the consumers and the markup still read.
    expect(dropdown.trigger.getAttribute("aria-label")).toBe("Field");
    expect(dropdown.trigger.textContent).toBe("score");
    expect(select.hidden).toBe(true);
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
      label: "Method",
      methodAriaLabel: "Method",
      classesAriaLabel: "Classes",
      methodValue: "quantile",
      classesValue: 5,
      methodLabel,
      ...overrides,
    });

  it("labels the row by method and names both controls distinctly", () => {
    // One visible label for two controls: it reads by the primary control, and
    // each dropdown keeps its own accessible name so a screen reader announces
    // "Method" and "Classes" once each instead of the row label twice.
    const { row, methodDropdown, classesDropdown } = build();

    expect(row.querySelector(".foliplus-form-label")!.textContent).toBe("Method");
    expect(methodDropdown.trigger.getAttribute("aria-label")).toBe("Method");
    expect(classesDropdown.trigger.getAttribute("aria-label")).toBe("Classes");
    expect(methodDropdown.trigger.getAttribute("aria-label")).not.toBe(
      classesDropdown.trigger.getAttribute("aria-label"),
    );
  });

  it("renders the shared method order and class counts", () => {
    const { methodSelect, classesSelect } = build();
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
    // The shared compact-count class rides along with the consumer hook: it is
    // the width contract both panels read, so no consumer can forget it.
    expect(classesSelect.classList.contains("foliplus-classes-select")).toBe(true);
    expect(classesSelect.getAttribute("data-count")).toBe("");

    methodSelect.value = "equal";
    methodSelect.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenLastCalledWith({ method: "equal" });

    classesSelect.value = "7";
    classesSelect.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenLastCalledWith({ classes: 7 });
  });

  it("always carries the shared compact-count width class", () => {
    const { classesSelect } = build();

    expect(classesSelect.classList.contains("foliplus-form-select")).toBe(true);
    expect(classesSelect.classList.contains("foliplus-classes-select")).toBe(true);
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
    // The shared trigger recipe lives in common/scheme-picker.css; both
    // consumers get it from this builder, so neither can drift from the other.
    expect(trigger.classList.contains("foliplus-scheme-picker-trigger")).toBe(true);
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

// ── Shared row geometry (stylesheet contract) ──
//
// The heatmap panel and LayerControl's value-based fill both build their
// Field / Method+Classes / Scheme rows from this module. The two panels share
// those controls' geometry only while the builder keeps applying the shared
// classes and the consumers keep their own stylesheets geometry-free. These
// assertions pin the token relationships, not pixel values.

const ROOT = resolve(__dirname, "../../..");

/** Read a stylesheet with normalized line endings.
 *
 * The checkout is CRLF on Windows (`core.autocrlf=true`) and LF on the Linux
 * runner, so a multi-line selector literal would match on one platform and
 * miss on the other. Normalizing here keeps every assertion below
 * platform-independent. */
const css = (rel: string): string =>
  readFileSync(resolve(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");

/** The declaration block that starts at `selector` (first match), found by
 *  brace matching so a block that contains nested rules (`&:hover`,
 *  `&::-webkit-…`) is returned whole instead of stopping at the first inner
 *  closing brace. */
const blockOf = (source: string, selector: string): string => {
  const start = source.indexOf(selector);
  expect(start, `${selector} is missing`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", start);
  expect(open, `${selector} has no opening brace`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`${selector} block never closes`);
};

const rampFormSource = readFileSync(
  resolve(ROOT, "foliplus/js/core/rampForm.ts"),
  "utf-8",
);

describe("compact class-count select (stylesheet contract)", () => {
  it("applies the shared classes-select class from the builder", () => {
    // Both consumers get the class here; neither passes it by hand, so the
    // two panels cannot end up with different class-count widths again.
    expect(rampFormSource).toContain("foliplus-classes-select");
  });

  it("resolves that class to the inline-secondary width token", () => {
    const classesSelect = blockOf(
      css("foliplus/css/common/form.css"),
      ".foliplus-classes-select {",
    );
    expect(classesSelect).toContain("var(--foliplus-form-secondary-width");
    expect(classesSelect).toContain("flex-shrink: 0");
  });
});

describe("shared scheme-picker trigger (stylesheet contract)", () => {
  const scheme = css("foliplus/css/common/scheme-picker.css");

  it("applies the shared trigger class from the builder", () => {
    expect(rampFormSource).toContain("foliplus-scheme-picker-trigger");
  });

  it("owns the trigger box for every consumer", () => {
    const trigger = blockOf(scheme, ".foliplus-scheme-picker-trigger {");
    expect(trigger).toContain("height: var(--foliplus-ctrl-size)");
    expect(trigger).toContain("padding: 0 var(--foliplus-scheme-picker-bar-inset-x)");
    expect(trigger).toContain("border: var(--foliplus-border-thin) solid");
    expect(trigger).toContain("border-radius: var(--foliplus-radius-sm)");
    // Fills the control cell, so its width follows the shared control column.
    expect(trigger).toContain("flex: 1");
  });

  it("insets the dropdown strip by the same token as the trigger", () => {
    // The two bars line up only while both use one inset token: the trigger
    // pads by it, the item pads by it minus its reserved selection border and
    // the measured scrollbar lane (a layout scrollbar steals real width).
    const item = blockOf(scheme, ".foliplus-scheme-picker-item {");
    expect(item).toContain("var(--foliplus-scheme-picker-bar-inset-x)");
    expect(item).toContain("var(--foliplus-scheme-picker-scrollbar-width)");
    expect(item).not.toContain("border-left");
    // The selected row draws the same 3px bar as the shared dropdown row.
    const active = blockOf(scheme, ".foliplus-scheme-picker-item.foliplus-is-active {");
    expect(active).toContain("var(--foliplus-menu-row-bar-width) 0 0");
  });

  it("reserves the scrollbar lane in both list states", () => {
    // A stable gutter keeps the lane constant so crossing the max-height does
    // not re-inset every strip; the item subtracts that same lane.
    const dropdown = blockOf(scheme, ".foliplus-scheme-picker-dropdown {");
    expect(dropdown).toContain("overflow-y: auto");
    expect(dropdown).toContain("scrollbar-gutter: stable");
  });

  it("defines the strip inset and scrollbar lane tokens in the token file", () => {
    // Style rule: every --foliplus-* custom property is *defined* in token.css;
    // the picker stylesheet only reads it.
    const tokens = css("foliplus/css/common/token.css");
    expect(tokens).toContain("--foliplus-scheme-picker-bar-inset-x:");
    expect(tokens).toContain("--foliplus-scheme-picker-scrollbar-width:");
  });

  it("paints one chevron for both panels", () => {
    const chevron = blockOf(scheme, ".foliplus-scheme-picker-trigger::after {");
    expect(chevron).toContain("right: var(--foliplus-space-sm)");
    expect(chevron).toContain(
      "border-top: var(--foliplus-size-4) solid var(--foliplus-text-muted)",
    );
  });

  it("leaves no consumer-local trigger geometry", () => {
    const layerStyle = css("foliplus/css/LayerControl/style.css");
    expect(layerStyle).not.toContain(".foliplus-style-scheme-trigger {");
    expect(layerStyle).not.toContain(".foliplus-style-scheme-trigger::after");

    const heatmap = css("foliplus/css/HeatmapControl.css");
    expect(heatmap).not.toMatch(/\.foliplus-heatmap-scheme-bar\s*\{/);
    expect(heatmap).not.toMatch(/\.foliplus-heatmap-scheme-bar::after/);
  });
});

describe("field row (stylesheet contract)", () => {
  it("keeps the field select on the shared form-select chrome", () => {
    // The Field row reuses the plain select; the builder must not grow its own
    // width for it, or the row would stop matching the heatmap panel.
    const fieldSelect = blockOf(
      css("foliplus/css/common/form.css"),
      ".foliplus-form-select {",
    );
    expect(fieldSelect).toContain("width: 100%");
  });
});

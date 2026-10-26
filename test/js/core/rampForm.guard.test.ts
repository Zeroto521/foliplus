// Guard: what core/rampForm produces — the shared compact-count select and the
// shared scheme-picker trigger — and the CSS recipes they resolve to.
//
// The heatmap panel and LayerControl's value-based fill both build their
// Field / Method+Classes / Scheme rows from this module. The two panels share
// those controls' geometry only while the builder keeps applying the shared
// classes and the consumers keep their own stylesheets geometry-free.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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
  expect(start, selector + " is missing").toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", start);
  expect(open, selector + " has no opening brace").toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(selector + " block never closes");
};

const rampFormSource = readFileSync(
  resolve(ROOT, "foliplus/js/core/rampForm.ts"),
  "utf-8",
);

describe("compact class-count select", () => {
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

describe("shared scheme-picker trigger", () => {
  const scheme = css("foliplus/css/common/scheme-picker.css");

  it("applies the shared trigger class from the builder", () => {
    expect(rampFormSource).toContain("foliplus-scheme-picker-trigger");
  });

  it("owns the trigger box for every consumer", () => {
    const trigger = blockOf(scheme, ".foliplus-scheme-picker-trigger {");
    expect(trigger).toContain("height: var(--foliplus-ctrl-size)");
    expect(trigger).toContain("padding: 0 var(--foliplus-icon-size-md)");
    expect(trigger).toContain("border: var(--foliplus-border-thin) solid");
    expect(trigger).toContain("border-radius: var(--foliplus-radius-sm)");
    // Fills the control cell, so its width follows the shared control column.
    expect(trigger).toContain("flex: 1");
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

describe("field row", () => {
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

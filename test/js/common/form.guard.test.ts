// Guard: the shared form geometry in common CSS, and the chrome classes
// common/form.ts emits.
//
// The heatmap panel and LayerControl's style drawer both build their rows from
// these primitives, so their columns are the same only while these rules keep
// resolving from one token instead of a per-panel width. These assertions pin
// the *relationships* between the stylesheet sources — which token feeds which
// rule — rather than pixel values, which the browser probe records.
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

describe("form width tokens", () => {
  const tokens = css("foliplus/css/common/token.css");
  const form = css("foliplus/css/common/form.css");

  it("defines the inline-secondary width as the number-field width", () => {
    // One token, not two numerically-equal constants: the class-count select
    // and the compact number field are the same role, so they cannot drift.
    expect(tokens).toMatch(
      /--foliplus-form-secondary-width:\s*var\(--foliplus-form-number-width\);/,
    );
  });

  it("feeds the number input and the classes select from that token", () => {
    const numberInput = blockOf(form, ".foliplus-form-number-input {");
    expect(numberInput).toContain("var(--foliplus-form-secondary-width");

    const classesSelect = blockOf(form, ".foliplus-classes-select {");
    expect(classesSelect).toContain("var(--foliplus-form-secondary-width");
    expect(classesSelect).toContain("flex-shrink: 0");
  });

  it("has no heatmap-local inline-width token or class override left", () => {
    // The heatmap namespaced both the token and the width rule; the shared
    // class replaced them, and a re-introduced override would split the two
    // panels' method/class-count rows again.
    expect(tokens).not.toContain("--foliplus-heatmap-inline-width");
    const heatmap = css("foliplus/css/HeatmapControl.css");
    expect(heatmap).not.toContain(".foliplus-heatmap-class-select");
    expect(heatmap).not.toContain(".foliplus-classes-select");
  });
});

describe("control column", () => {
  const tokens = css("foliplus/css/common/token.css");
  const form = css("foliplus/css/common/form.css");
  const panel = css("foliplus/css/common/panel.css");

  it("derives the control width from the panel shell and the row inset", () => {
    const width = tokens.match(/--foliplus-form-control-width:([\s\S]*?);/);
    expect(width).not.toBeNull();
    for (const term of [
      "var(--foliplus-panel-width)",
      "var(--foliplus-panel-inset-x)",
      "var(--foliplus-form-label-width)",
      "var(--foliplus-space-md)",
    ]) {
      expect(width![1]).toContain(term);
    }
  });

  it("lets the shared form row own the horizontal inset", () => {
    const row = blockOf(form, ".foliplus-form-row {");
    expect(row).toContain("padding: 0 var(--foliplus-panel-inset-x)");
    // The row panel used to add its own inset on top; that second owner is
    // what shifted the style panel's columns one pixel off the heatmap's.
    expect(panel).not.toContain(".foliplus-form-row");
  });

  it("resolves the control cell through the control-width token", () => {
    const control = blockOf(form, ".foliplus-form-control {");
    expect(control).toContain("var(--foliplus-form-control-width)");
  });

  it("paints the row-panel hairline as an inset outline, not a border", () => {
    // A border consumes content width, so a row panel's content box would be
    // 2px narrower than a fold panel's and the columns would not line up.
    const rowPanel = blockOf(
      css("foliplus/css/common/menu.css"),
      ".foliplus-row-panel {",
    );
    expect(rowPanel).toContain("outline: var(--foliplus-border-thin) solid");
    expect(rowPanel).toContain("outline-offset:");
    expect(rowPanel).not.toMatch(/(^|\n)\s*border:/);
  });
});

describe("footer inset", () => {
  it("insets the footer action row and its divider with the shared token", () => {
    const button = css("foliplus/css/common/button.css");
    const rows = blockOf(button, ":is(.foliplus-btn-row, .foliplus-heatmap-btn-row) {");
    expect(rows).toContain("var(--foliplus-panel-inset-x)");

    const divider = blockOf(
      css("foliplus/css/common/panel.css"),
      ".foliplus-section-divider {",
    );
    expect(divider).toContain("var(--foliplus-panel-inset-x)");
  });
});

describe("clickable-box family", () => {
  it("reads one height, radius and type-scale token per family", () => {
    const button = css("foliplus/css/common/button.css");
    const panelBtn = blockOf(button, ".foliplus-panel-btn {");
    expect(panelBtn).toContain("height: var(--foliplus-ctrl-size)");
    expect(panelBtn).toContain("border-radius: var(--foliplus-radius-sm)");
    expect(panelBtn).toContain("font-size: var(--foliplus-font-size-sm)");

    const toggles = blockOf(
      button,
      ".foliplus-toggle-btn,\n.foliplus-tool-btn,\n.foliplus-search-mode-btn {",
    );
    expect(toggles).toContain("height: var(--foliplus-ctrl-size)");
    expect(toggles).toContain("font-size: var(--foliplus-font-size-sm)");

    const close = blockOf(css("foliplus/css/common/menu.css"), ".foliplus-close-btn {");
    expect(close).toContain("font-size: var(--foliplus-font-size-sm)");
  });
});

describe("common/form.ts emits the shared chrome classes", () => {
  const source = readFileSync(resolve(ROOT, "foliplus/js/common/form.ts"), "utf-8");
  const form = css("foliplus/css/common/form.css");

  it("names the row, label and control classes the CSS styles", () => {
    // The builder and the stylesheet are one contract: a renamed class in
    // either file would silently drop the shared geometry.
    for (const cls of [
      "foliplus-form-row",
      "foliplus-form-label",
      "foliplus-form-control",
      "foliplus-form-inline",
    ]) {
      expect(source).toContain(cls);
      expect(form).toContain("." + cls);
    }
  });

  it("names the input chrome classes the CSS styles", () => {
    for (const cls of [
      "foliplus-form-select",
      "foliplus-form-number-input",
      "foliplus-form-color-input",
    ]) {
      expect(source).toContain(cls);
      expect(form).toContain("." + cls);
    }
  });
});

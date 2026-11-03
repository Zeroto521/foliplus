import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ── Method + Classes row geometry (stylesheet contract) ──
//
// The HeatmapControl panel's Method + Classes row is built by the shared
// core/rampForm buildClassesRow; the two controls sit in one .foliplus-form-inline
// cell. The user-reported defect: the Method dropdown was squeezed narrow and
// the class-count dropdown took the wide share — the opposite of LayerControl's
// by-value row, where the method fills the control column and the count takes
// the compact secondary width. These assertions pin the *relationships* in the
// stylesheet sources (which rule carries which property), not pixel values,
// which the browser probe records. The heatmap's own hooks are used so the fix
// stays inside the heatmap stylesheet and LayerControl's rules are untouched.

const ROOT = resolve(__dirname, "../../../../");

/** Read a stylesheet with normalized line endings (CRLF checkout / LF runner). */
const css = (rel: string): string =>
  readFileSync(resolve(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");

/** The declaration block that starts at `selector` (first match), found by
 *  brace matching so a block containing nested rules is returned whole. */
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

const heatmap = css("foliplus/css/control/HeatmapControl.css");

describe("method/classes row geometry (stylesheet contract)", () => {
  it("gives the method select the flexing role (fills the control column)", () => {
    const method = blockOf(heatmap, ".foliplus-dropdown.foliplus-heatmap-method {");
    expect(method).toContain("flex: 1");
    expect(method).toContain("min-width: 0");
    expect(method).not.toContain("var(--foliplus-form-secondary-width)");
    expect(method).not.toContain("flex-shrink: 0");
  });

  it("gives the class-count select the compact secondary width", () => {
    const classes = blockOf(
      heatmap,
      ".foliplus-dropdown.foliplus-heatmap-classes-count {",
    );
    expect(classes).toContain("var(--foliplus-form-secondary-width)");
    expect(classes).toContain("flex-shrink: 0");
  });

  it("does not restyle the LayerControl by-value row", () => {
    const layer = css("foliplus/css/control/LayerControl/style.css");
    expect(layer).not.toContain("foliplus-heatmap-method");
    expect(layer).not.toContain("foliplus-heatmap-classes-count");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ── Original-colors readout geometry (stylesheet contract) ──
//
// The method and class count share one row (the by-value rampForm classes
// row's shape): the method readout fills the control column the way the
// by-value method select does, and the count readout takes the compact
// secondary width (the number-field role). These assertions pin the
// *relationships* in the stylesheet sources (which rule carries which
// property) rather than pixel values, which the browser probe records. The
// method must stay free of the number-field geometry (no compact width, no
// shrink, no right-hug of its own) or it would be mistaken for a number
// field again.

const ROOT = resolve(__dirname, "../../../../..");

/** Read a stylesheet with normalized line endings. */
const css = (rel: string): string =>
  readFileSync(resolve(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");

/** The declaration block that starts at `selector` (first match), found by
 *  brace matching so a block that contains nested rules is returned whole. */
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

describe("original-colors readout geometry (stylesheet contract)", () => {
  const layer = css("foliplus/css/LayerControl/style.css");

  it("gives the count readout the compact width and the right edge", () => {
    // The count is the number-field role: same secondary width token as the
    // by-value class-count select, pinned to the column's right edge.
    const count = blockOf(layer, ".foliplus-style-fill-original-count {");
    expect(count).toContain("var(--foliplus-form-secondary-width)");
    expect(count).toContain("flex-shrink: 0");
    // The value inside the box is horizontally centered, matching the count
    // select's own value.
    // The value span must fill the box (flex:1, min-width:0) for the
    // text-align to actually center the text: a flex child only as wide as its
    // content would ignore text-align.
    const value = blockOf(
      layer,
      ".foliplus-style-fill-original-count .foliplus-style-fill-original-value {",
    );
    expect(value).toContain("flex: 1");
    expect(value).toContain("min-width: 0");
    expect(value).toContain("text-align: center");
  });

  it("fills the control column for the method readout", () => {
    // The method is not a number field: no compact width, no shrink and no
    // right-hug of its own. It shares the row with the count, so it flexes to
    // absorb the control column the way the by-value method select does.
    const method = blockOf(layer, ".foliplus-style-fill-original-method {");
    expect(method).toContain("flex: 1");
    expect(method).toContain("min-width: 0");
    expect(method).not.toContain("var(--foliplus-form-secondary-width)");
    expect(method).not.toContain("flex-shrink");
    expect(method).not.toContain("margin-left");
    // No comma-joined selector merges the two — that would hide a shared
    // compact width behind the method's name.
    expect(layer.indexOf(".foliplus-style-fill-original-count,")).toBe(-1);
    // The method value is centered like the count value (a readout states a
    // value, not a spanning label).
    // Same centering contract as the count value: the span fills the box so
    // text-align:center is real, not a no-op on a content-width flex child.
    const value = blockOf(
      layer,
      ".foliplus-style-fill-original-method .foliplus-style-fill-original-value {",
    );
    expect(value).toContain("flex: 1");
    expect(value).toContain("min-width: 0");
    expect(value).toContain("text-align: center");
  });
});

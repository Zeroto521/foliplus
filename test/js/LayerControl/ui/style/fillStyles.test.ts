import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ── Original-colors readout geometry (stylesheet contract) ──
//
// The count readout hugs the control column's right edge at the compact
// secondary width (the number-field role), while the method readout spans
// the whole control column exactly as the by-value arm's method select does
// (it is not a number field). These assertions pin the *relationships* in the
// stylesheet sources (which rule carries which property) rather than pixel
// values, which the browser probe records. The count and method must stay
// split: a merged (.count, .method) rule would make the method's negative
// assertion impossible and would let the method be mistaken for a number
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
    expect(count).toContain("margin-left: auto");
    // The value inside the box is horizontally centered, matching the count
    // select's own value.
    const value = blockOf(
      layer,
      ".foliplus-style-fill-original-count .foliplus-style-fill-original-value {",
    );
    expect(value).toContain("text-align: center");
  });

  it("keeps the method readout free of the number-field geometry", () => {
    // The method is not a number field: no compact width, no shrink and no
    // right-hug of its own, so it spans the control column the way the by-value
    // method select does. A dedicated rule carrying any of these would be a
    // regression back to the old 52px box.
    expect(layer.indexOf(".foliplus-style-fill-original-method {")).toBe(-1);
    // No comma-joined selector merges the two — that would hide a shared
    // compact width behind the method's name.
    expect(layer.indexOf(".foliplus-style-fill-original-count,")).toBe(-1);
    // No method-value rule either: the value keeps the generic read-only value
    // (left-aligned, clipped), not the count's centered number.
    expect(
      layer.indexOf(
        ".foliplus-style-fill-original-method .foliplus-style-fill-original-value {",
      ),
    ).toBe(-1);
  });
});

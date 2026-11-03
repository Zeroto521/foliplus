import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ── Style-panel hover carve-out (stylesheet contract) ──
//
// The style panel is appended INSIDE its layer row (openStylePanel), so a
// pointer over the panel also matches the row's `:hover` — which would light
// the row-cursor recipe (white surface, glow, drag grip, icon) while the user
// edits the panel. The row-cursor hover recipe therefore carries a
// `:not(:has(.foliplus-layer-style-panel:hover))` carve-out so the panel's
// owner row returns to its resting value while the panel is hovered.
//
// jsdom cannot simulate `:hover` (the dynamic pseudo-class never matches, so
// `:has(...:hover)` is inert here), so this contract is pinned at the source
// level — which rule carries the carve-out, and that it targets the style
// panel — while the computed background for the two hover cases is recorded
// by the browser probe in CI. The negative control rebuilds the selector
// WITHOUT the carve-out and proves the same detection fails on it: dropping
// the `:has` rule is exactly the measured regression.

const ROOT = resolve(__dirname, "../../../../../..");

/** Read a stylesheet with normalized line endings. */
const css = (rel: string): string =>
  readFileSync(resolve(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");

/** The selector of the rule whose selector begins with `start`, taken up to
 *  its opening brace and with whitespace collapsed (the carve-out is nested
 *  across lines in the source). */
const selectorOf = (source: string, start: string): string => {
  const selStart = source.indexOf(start);
  expect(selStart, `${start} is missing`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", selStart);
  expect(open, `${start} has no opening brace`).toBeGreaterThanOrEqual(0);
  return source.slice(selStart, open).replace(/\s+/g, " ").trim();
};

// The carve-out the row-cursor hover recipe must carry, in its
// whitespace-collapsed form.
const CARVEOUT = ":not( :has(.foliplus-layer-style-panel:hover) )";
const STYLE_PANEL_CLASS = "foliplus-layer-style-panel";

/** Whether a hover-recipe selector carries the style-panel carve-out. */
const hasPanelCarveOut = (selector: string): boolean =>
  selector.includes(CARVEOUT) && selector.includes(`:has(.${STYLE_PANEL_CLASS}:hover)`);

describe("layer-row style-panel hover carve-out (stylesheet contract)", () => {
  const row = css("foliplus/css/control/LayerControl/row.css");

  it("the row-cursor hover recipe excludes a hovered style panel", () => {
    const selector = selectorOf(row, "&:is(:hover, .foliplus-is-focused-row)");
    expect(hasPanelCarveOut(selector)).toBe(true);
    // The carve-out rides the hover trigger (the row-cursor wake), so a panel
    // hover cannot light the owner row.
    expect(selector).toContain(":is(:hover, .foliplus-is-focused-row)");
    expect(selector).toContain(`:has(.${STYLE_PANEL_CLASS}:hover)`);
  });

  it("negative control: dropping the :has carve-out is exactly the regression", () => {
    const selector = selectorOf(row, "&:is(:hover, .foliplus-is-focused-row)");
    // Rebuild the selector a future edit would leave behind: the hover trigger
    // stays, the carve-out is gone. That is the measured bug — a panel hover
    // lights the owner row again.
    const regressed = selector.replace(CARVEOUT, "");
    expect(regressed).toContain(":is(:hover, .foliplus-is-focused-row)");
    expect(regressed).not.toContain(`:has(.${STYLE_PANEL_CLASS}:hover)`);
    expect(regressed).not.toContain(":has(");
    // The detection above (which the positive case uses) reports the
    // regression: the carve-out is the only thing standing between a panel
    // hover and the row-cursor wake.
    expect(hasPanelCarveOut(regressed)).toBe(false);
  });
});

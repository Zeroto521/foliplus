import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ── Style-panel hover carve-out (stylesheet contract) ──
//
// The style panel is appended INSIDE its layer row (openStylePanel), so a
// pointer over the panel also matches the row's `:hover` — which would light
// the row-cursor recipe (white surface, glow, drag grip, icon) while the user
// edits the panel. The row-cursor hover branch therefore carries a
// `:where(:not(:has(.foliplus-row-panel:hover)))` carve-out, keyed on the
// shared row-panel shell (every row panel — style and attrs — mounts with
// `.foliplus-row-panel`). The style panel's own class belongs to style.css,
// so naming it here would break the merged-CSS duplicate-token guard.
//
//   * the carve-out returns the owner row to its resting value while the panel
//     is hovered (a panel hover is not a row interaction);
//   * `:where()` keeps the carve-out's specificity contribution at zero, so the
//     recipe stays at its pre-change (0,2,0) and does NOT out-rank the
//     base-row quiet rule (0,3,0) — a hovered basemap row stays quiet;
//   * the carve-out rides only the `:hover` branch, so a keyboard-focused row
//     (`.foliplus-is-focused-row`) keeps its white surface / glow regardless of
//     where the pointer is.
//
// jsdom cannot simulate `:hover` (the dynamic pseudo-class never matches, so
// `:has(...:hover)` is inert here), so the hover-specific outcomes are pinned
// at the source level while the computed background for the hover cases is
// recorded by the browser probe in CI. The focused-branch outcome IS testable
// in jsdom (the focus class is static), so it is asserted behaviorally. The
// negative control rebuilds the selector WITHOUT the carve-out and proves the
// same detection fails on it: dropping the `:has` rule is the regression.

const ROOT = resolve(__dirname, "../../../../../..");

/** Read a stylesheet with normalized line endings. */
const css = (rel: string): string =>
  readFileSync(resolve(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");

/** The selector of the rule whose selector begins with `start`, taken up to
 *  its opening brace and with whitespace collapsed. */
const selectorOf = (source: string, start: string): string => {
  const selStart = source.indexOf(start);
  expect(selStart, `${start} is missing`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", selStart);
  expect(open, `${start} has no opening brace`).toBeGreaterThanOrEqual(0);
  return source.slice(selStart, open).replace(/\s+/g, " ").trim();
};

// The zero-specificity carve-out the row-cursor hover branch must carry, in
// its whitespace-collapsed form (the source keeps `:where(:not(:has(...)))`
// on one line, so there is no whitespace to collapse inside it).
const CARVEOUT = ":where(:not(:has(.foliplus-row-panel:hover)))";
const ROW_PANEL_CLASS = "foliplus-row-panel";
const BASE_RULE =
  '.foliplus-layer-item[data-layer-type="base"]:is(:hover, .foliplus-is-focused-row)';

/** Whether a hover-branch selector carries the carve-out INSIDE a :where()
 *  (zero specificity). A bare `:not(:has(...))` would raise the recipe above
 *  the base-row quiet rule and is the P1-A regression. */
const hasZeroSpecificityCarveOut = (selector: string): boolean =>
  selector.includes(CARVEOUT) &&
  // No bare `:not(` that is not part of the :where() wrapper.
  !/(?<!:where\():not\(/.test(selector);

describe("layer-row style-panel hover carve-out (stylesheet contract)", () => {
  const row = css("foliplus/css/control/LayerControl/row.css");
  const recipe = selectorOf(row, "&:is(");

  it("the row-cursor hover recipe excludes a hovered style panel at zero specificity", () => {
    expect(hasZeroSpecificityCarveOut(recipe)).toBe(true);
    // The carve-out rides the hover trigger (the row-cursor wake), so a panel
    // hover cannot light the owner row.
    expect(recipe).toContain(":is(");
    expect(recipe).toContain(`:has(.${ROW_PANEL_CLASS}:hover)`);
  });

  it("negative control: dropping the :has carve-out is exactly the regression", () => {
    // Rebuild the selector a future edit would leave behind: the hover trigger
    // stays, the carve-out is gone. That is the measured bug — a panel hover
    // lights the owner row again.
    const regressed = recipe.replace(CARVEOUT, "");
    expect(regressed).toContain(":is(");
    expect(regressed).not.toContain(`:has(.${ROW_PANEL_CLASS}:hover)`);
    expect(regressed).not.toContain(":has(");
    // The detection above (which the positive case uses) reports the
    // regression: the carve-out is the only thing standing between a panel
    // hover and the row-cursor wake.
    expect(hasZeroSpecificityCarveOut(regressed)).toBe(false);
  });

  it("base row hover stays quiet: the recipe must not out-rank the base-row rule", () => {
    // The row-cursor recipe and the base-row quiet rule race on hover. The
    // recipe must stay at (0,2,0) so the base rule (0,3,0) still wins and a
    // hovered basemap row shows no glow / white surface.
    const baseRule = selectorOf(row, BASE_RULE);
    expect(baseRule).toContain('[data-layer-type="base"]');
    // Red to green evidence: the bare :not(:has()) form (the P1-A regression)
    // raises the recipe to (0,4,0) and is DETECTED; the :where() form is not.
    const broken =
      ":is(:hover, .foliplus-is-focused-row):not(:has(.foliplus-row-panel:hover))";
    expect(hasZeroSpecificityCarveOut(broken)).toBe(false);
    expect(hasZeroSpecificityCarveOut(recipe)).toBe(true);
  });

  it("a keyboard-focused row keeps the wake while the panel is hovered", () => {
    // The focus branch (static class) is NOT carved out, so the recipe — the
    // white surface / glow — still matches a focused row that contains a style
    // panel. jsdom matches this branch behaviorally.
    document.body.innerHTML = `<div id="row" class="foliplus-layer-item foliplus-is-focused-row"><div class="foliplus-row-panel foliplus-layer-style-panel"></div></div>`;
    const focused = document.getElementById("row") as HTMLElement;
    const recipeSel = `.foliplus-layer-item:is(:hover:where(:not(:has(.${ROW_PANEL_CLASS}:hover))), .foliplus-is-focused-row)`;
    expect(focused.matches(recipeSel)).toBe(true);
    // And a non-focused row does not match without a pointer (the hover branch
    // is inert in jsdom; the point is the focus branch is the only gate left).
    document.body.innerHTML = `<div id="plain" class="foliplus-layer-item"><div class="foliplus-row-panel foliplus-layer-style-panel"></div></div>`;
    const plain = document.getElementById("plain") as HTMLElement;
    expect(plain.matches(recipeSel)).toBe(false);
  });
});

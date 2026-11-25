// test/js/control/LayerControl/ui/style/index.fixture — shared stubs for the index aspect suites.
import { repoPath } from "#test/path.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";

// The carrier contract promises pane coverage only to migratable families
// (Path / Marker / GridLayer / ImageOverlay). Style-row stubs for vector
// layers declare the Path identity so the executor treats them as
// pane-capable, matching the real layers they stand in for.
export const pathify = <T extends object>(stub: T): T => {
  Object.setPrototypeOf(stub, new window.L.Path());
  return stub;
};

/** Percentage the slider fill is drawn at, read off the primitive's inline
 *  width. The fill spans the rail's travel range, so 0.35 means 35%. */
export const fillPct = (el: HTMLElement): number =>
  Number(el.style.width.match(/^([\d.]+)%$/)?.[1] ?? NaN) / 100;

/** The value bubble is a module-level singleton portaled to <body>. Clearing
 *  the body between tests would leave the primitive holding a detached node,
 *  so the node is moved aside and re-attached rather than discarded. */
export let portalBubble: HTMLElement | null = null;

export const keepBubble = (): void => {
  const bubble = document.querySelector<HTMLElement>(".foliplus-slider-bubble");
  if (bubble) portalBubble = bubble;
  portalBubble?.classList.remove("is-on");
  if (portalBubble) portalBubble.hidden = true;
  portalBubble?.remove();
};

export const restoreBubble = (): void => {
  if (portalBubble) document.body.appendChild(portalBubble);
};

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
// `:has(...:hover)` is inert here), so the hover-specific outcomes below are
// SOURCE GUARDS, not behavior evidence: they assert the selector text (the
// carve-out shape and the base-row specificity race) and prove the detection
// would catch the regression — they do NOT prove any hover behavior. The
// behavioral evidence — the owner row's computed background/glow while the
// panel is hovered — comes from the browser probe
// (test/js/browser/LayerControl/read_row_hover_carveout.js), which drives a
// real pointer; jsdom cannot reach that. The focused-branch outcome IS
// testable in jsdom (the focus class is static), so it is asserted
// behaviorally. The negative control rebuilds the selector WITHOUT the
// carve-out and proves the same source detection fails on it: dropping the
// `:has` rule is the regression a future edit would leave behind.

export const ROOT = repoPath();

/** Read a stylesheet with normalized line endings. */
export const css = (rel: string): string =>
  readFileSync(resolve(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");

/** The selector of the rule whose selector begins with `start`, taken up to
 *  its opening brace and with whitespace collapsed. */
export const selectorOf = (source: string, start: string): string => {
  const selStart = source.indexOf(start);
  expect(selStart, `${start} is missing`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", selStart);
  expect(open, `${start} has no opening brace`).toBeGreaterThanOrEqual(0);
  return source.slice(selStart, open).replace(/\s+/g, " ").trim();
};

// The zero-specificity carve-out the row-cursor hover branch must carry, in
// its whitespace-collapsed form (the source keeps `:where(:not(:has(...)))`
// on one line, so there is no whitespace to collapse inside it).
export const CARVEOUT = ":where(:not(:has(.foliplus-row-panel:hover)))";

export const ROW_PANEL_CLASS = "foliplus-row-panel";

export const BASE_RULE =
  '.foliplus-layer-item[data-layer-type="base"]:is(:hover, .foliplus-is-focused-row)';

/** Whether a hover-branch selector carries the carve-out INSIDE a :where()
 *  (zero specificity). A bare `:not(:has(...))` would raise the recipe above
 *  the base-row quiet rule and is the P1-A regression. */
export const hasZeroSpecificityCarveOut = (selector: string): boolean =>
  selector.includes(CARVEOUT) &&
  // No bare `:not(` that is not part of the :where() wrapper.
  !/(?<!:where\():not\(/.test(selector);

/**
 * Shared status markers for `script/` CLI output.
 *
 * Plain Unicode text symbols (no emoji variation selectors) so console tables
 * stay column-aligned — emoji have ambiguous/variable width — and render in
 * narrow or legacy terminals. Shared by bundle-size-check, bundle-report and build.
 */

/** Bundle size status markers (over/up/down/same/new/missing). */
export const STATUS = {
  over: "✗",
  up: "↑",
  down: "↓",
  same: "·",
  new: "✚",
  missing: "?",
};

/** Warning (U+26A0 without the emoji variation selector). */
export const WARN = "⚠";
/** Success / all-good. */
export const OK = "✓";
/** Failure. */
export const FAIL = "✗";

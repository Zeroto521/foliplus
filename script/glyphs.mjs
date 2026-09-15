/**
 * Shared status markers for `script/` CLI output.
 *
 * Plain Unicode text symbols (no emoji variation selectors) so console tables
 * stay column-aligned — emoji have ambiguous/variable width — and render in
 * narrow or legacy terminals. Shared by bundle-size-check and build.
 */

/** Bundle size status markers (over/low/up/down/same/new/missing). */
const STATUS = {
  over: "✗",
  low: "⚠",
  up: "↑",
  down: "↓",
  same: "·",
  new: "✚",
  missing: "?",
};

/** Warning (U+26A0 without the emoji variation selector). */
const WARN = "⚠";
/** Success / all-good. */
const OK = "✓";
/** Failure. */
const FAIL = "✗";

export { FAIL, OK, STATUS, WARN };

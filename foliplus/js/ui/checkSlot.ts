// ui/checkSlot — the ONE check-slot builder: a real tri-state checkbox.
//
// Every row that lets a user pick something shows an indicator in the same
// leading cell — the multiple-mode dropdown's select-all row, its option
// rows, and the scheme picker. Each used to draw its own mark (a CSS glyph,
// a tick column, a native box), so the same idea read three ways. This
// module builds the one <input type="checkbox"> they all share; the caller
// attaches the click/keydown wiring and the value model stays theirs.
//
// The tri-state comes from ui/selectAllState (selectAllStateOf) so the box
// and the label that describe it cannot disagree about the same counts.
import { CHECK_SLOT_CLASS } from "./checkSlotClassName.js";
import { type SelectAllState, selectAllStateOf } from "./selectAllState.js";
import { dom } from "#platform/dom.js";

/** The indicator a row paints for one pickable item. */
type CheckSlot = {
  /** The slot cell to append at the front of the row. */
  slot: HTMLElement;
  /** The checkbox the slot paints; read its checked/indeterminate. */
  box: HTMLInputElement;
};

/** Build the shared check slot and paint its tri-state from item counts.
 *
 *  The caller owns the click / keyboard wiring and the value model; this
 *  helper only builds the DOM and sets the state, so one builder answers
 *  every surface. `total` may be 0 — an empty list paints an unchecked
 *  box, never a half-full one (see selectAllStateOf).
 */
const buildCheckSlot = (total: number, selected: number): CheckSlot => {
  const box = dom.el("input", {
    type: "checkbox",
    class: CHECK_SLOT_CLASS.BOX,
    // A real control: aria-selected and aria-checked are redundant on an
    // input, so the row must not stamp its own on top of it.
    "aria-hidden": "false",
  }) as HTMLInputElement;
  const verdict = selectAllStateOf(total, selected);
  paintCheckSlot(box, verdict.state);
  const slot = dom.el("span", { class: CHECK_SLOT_CLASS.SLOT }, box);
  return { slot, box };
};

/** Set an existing box to a tri-state without rebuilding it. Used by rows
 *  that stay in the DOM across a selection change (a select-all row that is
 *  re-read on every render).
 */
const paintCheckSlot = (box: HTMLInputElement, state: SelectAllState): void => {
  box.checked = state === "all";
  box.indeterminate = state === "indeterminate";
};

export { buildCheckSlot };

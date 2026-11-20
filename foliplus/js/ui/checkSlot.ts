// ui/checkSlot — the ONE leading-cell builder for a pickable row.
//
// Every row that lets a user pick something shows an indicator in the same
// leading cell. There are two shapes by selection mode:
//   • multiple — a real <input type="checkbox"> with tri-state (ui/selectAllState),
//     used by the select-all row and every multiple-mode dropdown option.
//   • single   — a ✓ glyph lead (aria-hidden, non-interactive), used by the
//     single-mode dropdown option and the scheme picker's selected entry.
// The caller owns the click / keyboard wiring and the value model; these
// helpers only build the DOM and set the state, so one answer per mode.
import { CHECK_SLOT_CLASS } from "./checkSlotClassName.js";
import { type SelectAllState, selectAllStateOf } from "./selectAllState.js";
import { dom } from "#platform/dom.js";

/** The ✓ a single-select row paints on its selected entry. */
const LEAD_GLYPH = "\u2713";

/** The multiple-mode slot: a checkbox cell. */
type CheckboxSlot = {
  /** The slot cell to append at the front of the row. */
  slot: HTMLElement;
  /** The checkbox the slot paints; read its checked/indeterminate. */
  box: HTMLInputElement;
};

/** Build the multiple-mode check slot and paint its tri-state from item
 *  counts. The caller owns the click / keyboard wiring and the value model;
 *  this helper only builds the DOM and sets the state. `total` may be 0 — an
 *  empty list paints an unchecked box, never a half-full one (selectAllStateOf).
 */
const buildCheckboxSlot = (total: number, selected: number): CheckboxSlot => {
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

/** Set an existing box to a tri-state without rebuilding it. */
const paintCheckSlot = (box: HTMLInputElement, state: SelectAllState): void => {
  box.checked = state === "all";
  box.indeterminate = state === "indeterminate";
};

/** The single-mode lead: a glyph cell the caller paints ✓/empty. The caller
 *  names the surface class so the lead is styled by the shared row chrome,
 *  not a per-surface copy.
 */
type LeadSlot = {
  /** The slot cell to append at the front of the row. */
  slot: HTMLElement;
  /** Paint the ✓ mark for the row's selected state without rebuilding. */
  paint: (selected: boolean) => void;
};

/** Build the single-mode ✓ lead. */
const buildLeadSlot = (glyphClass: string): LeadSlot => {
  const slot = dom.el("span", {
    class: CHECK_SLOT_CLASS.SLOT + " " + CHECK_SLOT_CLASS.LEAD + " " + glyphClass,
    "aria-hidden": "true",
  });
  const paint = (selected: boolean): void => {
    slot.textContent = selected ? LEAD_GLYPH : "";
  };
  return { slot, paint };
};

export { buildCheckboxSlot, buildLeadSlot, paintCheckSlot };

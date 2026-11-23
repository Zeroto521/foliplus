// control/LayerControl/ui/listPanel/checkbox — shared tri-state checkbox rule.
//
// The layer row's checkbox is the same control everywhere: a layer row, a
// group row, a folder header, the role header and a group child row all
// follow the same three-state rule. This module owns the RULE and the DOM
// cell construction; the row-visual WRITE (the `input.checked =` land) stays
// in rowView.ts, which is the single writer the rowView guard enforces.
//
// Two functions:
//   buildCheckboxCell(inputAttrs) — the DOM cell (div.CHECKBOX > input)
//   triState(total, on)          — the pure {checked, indeterminate} answer
//
// The tri-state rule is the one rule every consumer must obey: the box is
// checked when every member is on (total > 0 && on === total), indeterminate
// when some are on, and unchecked when none are. aria-checked carries the same
// three states so assistive tech reads the same truth the visual box paints.
import * as CONST from "#control/LayerControl/const.js";

/** Extra attributes for the inner input (aria-label, name, id, …). */
type CheckboxAttrs = Record<string, string | undefined>;

/** Build the checkbox cell: div.CHECKBOX wrapping an <input type=checkbox>.
 *  The cell wrapper is the row's hit target and carries the visual box; the
 *  input is the native state carrier. */
const buildCheckboxCell = (
  attrs: CheckboxAttrs,
): { cell: HTMLElement; input: HTMLInputElement } => {
  const input = document.createElement("input");
  input.type = "checkbox";
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) input.setAttribute(key, value);
  }
  const cell = document.createElement("div");
  cell.className = CONST.CLASSES.CHECKBOX;
  cell.appendChild(input);
  return { cell, input };
};

/** The pure three-state answer. `total` is the member count, `on` the number
 *  currently visible. Writing the rule in one place means a group row and
 *  its children can never disagree about what "some" means.
 *
 *  @param {number} total - Total members.
 *  @param {number} on - Members currently on. */
const triState = (total: number, on: number): { checked: boolean; indeterminate: boolean } => ({
  checked: total > 0 && on === total,
  indeterminate: on > 0 && on < total,
});

export { buildCheckboxCell, triState };

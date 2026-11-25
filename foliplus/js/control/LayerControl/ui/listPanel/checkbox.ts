// control/LayerControl/ui/listPanel/checkbox — shared tri-state checkbox rule.
//
// The layer row's checkbox is the same control everywhere: a layer row, a
// group row, a folder header, the role header and a group child row all
// follow the same three-state rule. This module owns the RULE and the DOM
// cell construction; the row-visual WRITE (the `input.checked =` land) stays
// in rowView.ts, which is the single writer the rowView guard enforces.
//
// One function: buildCheckboxCell(inputAttrs) — the DOM cell (div.CHECKBOX >
// input). The three-state RULE itself lives in the shared ui/checkbox
// primitive (triStateOf / setCheckboxState), so a LayerControl header and any
// other consumer paint the same checked / indeterminate / aria-checked truth.
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

export { buildCheckboxCell };

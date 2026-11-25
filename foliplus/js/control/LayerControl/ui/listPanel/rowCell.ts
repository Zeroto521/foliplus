// LayerControl/ui/listPanel/rowCell — shared row cell construction.
//
// The leaf row, the folder row, the role (toggle-all) row and the group child
// row each render the same column vocabulary: rail, checkbox, count, type
// icon and ⋮ (more) button. This module owns the DOM construction of the cells
// that are truly identical across those rows, so a row builder parameterises
// only its differences (rail children, count attrs, type-icon svg, checkbox
// attrs, more-button title) instead of copying the cell markup — the "not
// copied declarations" rule for row chrome.
//
// The rail is deliberately NOT shared as a single element: a leaf row's rail
// carries a drag handle, a folder row's a fold button, a group row's a chevron
// and a child row's a tree line. Only the wrapper (span.RAIL_CELL) and the
// drag tooltip are common; see buildRailCell.
import { buildCheckboxCell } from "./checkbox.js";
import { dom } from "#platform/dom.js";
import * as CONST from "#control/LayerControl/const.js";
import * as SVGs from "#control/LayerControl/icon.js";

/** Build the rail wrapper (span.RAIL_CELL) with the row's rail children. */
const buildRailCell = (children: HTMLElement[], title: string): HTMLElement =>
  dom.el("span", { class: CONST.CLASSES.RAIL_CELL, title }, ...children);

/** Build the checkbox cell (div.CHECKBOX > input); the input is returned for
 *  tri-state writers. Same control everywhere — see checkbox.ts. */
const buildCheckbox = (
  attrs: Record<string, string | undefined>,
): { cell: HTMLElement; input: HTMLInputElement } => buildCheckboxCell(attrs);

/** Build the count column (span.COUNT_COL) with optional leading text. */
const buildCountCol = (
  attrs: Record<string, string | undefined>,
  text = "",
): HTMLElement =>
  text
    ? dom.el("span", { class: CONST.CLASSES.COUNT_COL, ...attrs }, text)
    : dom.el("span", { class: CONST.CLASSES.COUNT_COL, ...attrs });

/** Build the type icon column (div.TYPE_ICON_COL) with the given svg. */
const buildTypeIconCol = (title: string, svg: string): HTMLElement => {
  const el = dom.el("div", { class: CONST.CLASSES.TYPE_ICON_COL });
  el.innerHTML = svg;
  if (title) el.title = title;
  return el;
};

/** Build the ⋮ (more) button, shared chrome across every row. */
const buildMoreBtn = (title: string): HTMLElement =>
  dom.el(
    "button",
    {
      class: CONST.CLASSES.MORE_BTN,
      type: "button",
      title,
      "aria-label": title,
    },
    { html: SVGs.ICON_MORE },
  );

export { buildRailCell, buildCheckbox, buildCountCol, buildTypeIconCol, buildMoreBtn };

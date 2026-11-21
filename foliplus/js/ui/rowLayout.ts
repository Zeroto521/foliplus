// ui/rowLayout — the shared pickable-row primitive.
//
// Row shape: `[leading][content][trailing]`. The leading cell is a fixed-width
// box (checkbox / ✓ / icon) so the indicator starts at the same x in every row
// surface; content flexes and ellipsizes; trailing is optional (count / type /
// more). The geometry (flex, min-height, padding, gap) lives in
// css/common/row-layout.css; this module only builds the DOM shape and owns the
// class vocabulary via rowLayoutClassName.ts.
//
// Use buildRow() when you need the DOM shape; when the row markup is already in
// the template, just apply ROW_CLASS.ROW + the cell classes and read the tokens.
import { ROW_CLASS } from "./rowLayoutClassName.js";
import { dom } from "#platform/dom.js";

type RowChild = HTMLElement | string | number | null | undefined;

type RowParts = {
  /** The leading cell (checkbox / ✓ / icon). Centred in a fixed-width box. */
  leading?: RowChild;
  /** The content cell (label, or a column stack for two-line content). */
  content: RowChild;
  /** Optional trailing cell (count / type / more). */
  trailing?: RowChild;
};

/** Build a `[leading][content][trailing]` row element. */
const buildRow = (parts: RowParts): HTMLElement => {
  const row = dom.el("div", { class: ROW_CLASS.ROW });
  if (parts.leading != null) {
    const cell = dom.el("div", { class: ROW_CLASS.LEADING });
    cell.append(parts.leading as string | Node);
    row.append(cell);
  }
  const content = dom.el("div", { class: ROW_CLASS.CONTENT });
  content.append(parts.content as string | Node);
  row.append(content);
  if (parts.trailing != null) {
    const cell = dom.el("div", { class: ROW_CLASS.TRAILING });
    cell.append(parts.trailing as string | Node);
    row.append(cell);
  }
  return row;
};

export { buildRow };

// Original-colors mode — the read-only presentation of the author's own paint.
//
// Shared by both faces: the fill's original mode and a border whose author paints
// per feature (explore's `cmap`). A per-feature author has no single colour value,
// so a swatch would lie; these read-outs state what the author actually declared.
//
// The author declared these colors (per feature, a scale, or a plain record);
// the panel shows them as read-outs, never as controls a user can edit. The
// caption, the count and the read-only frame are shared by this mode only;
// `buildOriginalDetail` builds the read-only detail rows.
import type { LayerUI } from "../surface.js";
import { type AuthorFill, authorFill, methodLabel } from "./fillAuthor.js";
import { originalGradient } from "./originalColor.js";
import { METHOD } from "#core/value/index.js";
import { dom } from "#platform/dom.js";
import { formRow, inlineControls, readOnlyValue } from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";

/** What the author's strip is, in the author's own terms.
 *
 *  A paired scale says whether it is continuous or how many classes the author
 *  drew. Without one (a categorical column, or `legend=False`) the only honest
 *  number is how many distinct colors the layer paints; 64+ means the scan
 *  capped and the layer paints more than the strip can count. */
const originalCaption = (ui: LayerUI, author: AuthorFill | null): string => {
  const scale = author?.scale;
  if (scale?.kind === "stepped") {
    return ui
      .T("style_fill_original_levels")
      .replace("{n}", String(scale.levels ?? author?.stops.length ?? 0));
  }
  if (scale) return ui.T("style_fill_original_continuous");
  const count = `${author?.distinct ?? 0}${author?.capped ? "+" : ""}`;
  return ui.T("style_fill_original_colors").replace("{n}", count);
};

/** What the author's record states as a count, in the same vocabulary the
 *  caption uses: a stepped scale's own class count, a categorical layer's
 *  distinct colors (with the "+" that marks a capped scan), and nothing at all
 *  for a continuous scale — it has no count to state, so the row shows a dash
 *  rather than a number the author never declared. */
const originalCount = (author: AuthorFill | null): string => {
  const scale = author?.scale;
  if (scale?.kind === "stepped") {
    return String(scale.levels ?? author?.stops.length ?? 0);
  }
  if (scale) return "—";
  return `${author?.distinct ?? 0}${author?.capped ? "+" : ""}`;
};

/** One read-only readout box: the form-control frame of the mode beside it,
 *  with no chevron, no focus and no pointer affordance. The detail states the
 *  author's presentation, so every control in it is a readout the panel cannot
 *  open, toggle or edit. */
const readOnlyBox = (
  className: string,
  opts: { role?: string } = {},
  ...children: HTMLElement[]
): HTMLElement =>
  // The shared primitive supplies the semantic READONLY class, aria-disabled
  // and the role; the caller keeps both its frame class (the read-only frame
  // is component-styled) and its specific hook class.
  readOnlyValue(
    { className: `${CONST.CLASSES.STYLE_FILL_READONLY} ${className}`, ...opts },
    ...children,
  );

/** The original-colors mode's read-only detail: the author's column, their
 *  colors, and the method + class-count pair on the same label/control grid
 *  the by-value mode uses, so each readout lands on the column edge of the
 *  control it replaces instead of spilling across the panel.
 *
 *  No select, no chevron and nothing clickable: these exist to classify data,
 *  and this mode is the author's presentation, not a user classification.
 *  Rendering them here is what squeezed a 43-color palette into the panel's
 *  2-9 class vocabulary and collapsed it to 9 on the first write.
 *
 *  The caption the row used to print on a line of its own is now the colors
 *  box's title and accessible name: the sentence is still reachable. */
const buildOriginalDetail = (ui: LayerUI, layerId: string): HTMLElement[] => {
  const author = authorFill(ui, layerId);
  const rows: HTMLElement[] = [];
  // A shipped scale always names its column (it is claimed only through a
  // caption naming a numeric property), so this guard only covers a hand-built
  // record: such a record still paints the real colors, everything but the row.
  if (author?.scale?.column) {
    rows.push(
      formRow(
        ui.T("style_fill_field"),
        readOnlyBox(
          CONST.CLASSES.STYLE_FILL_ORIGINAL_COLUMN,
          {},
          dom.el(
            "span",
            { class: CONST.CLASSES.STYLE_FILL_ORIGINAL_VALUE },
            author.scale.column,
          ),
        ),
        CONST.CLASSES.STYLE_FILL_ROW,
      ),
    );
  }

  const caption = originalCaption(ui, author);
  const colorsBox = readOnlyBox(
    CONST.CLASSES.STYLE_FILL_ORIGINAL_COLORS,
    { role: "img" },
    dom.el("div", {
      class: CONST.CLASSES.STYLE_FILL_ORIGINAL_STRIP,
      style: `background:${
        originalGradient(
          author?.stops.length ? author.stops : [CONST.COLOR.DEFAULT],
          author?.scale,
        ) || CONST.COLOR.DEFAULT
      }`,
    }),
  );
  colorsBox.title = caption;
  // The bar carries the caption as its accessible name; `img` is what makes
  // that name apply (a bare div is a generic role, where aria-label is
  // ignored). The colors are information, not a control.
  colorsBox.setAttribute("aria-label", caption);

  // Row order matches the by-value mode: Field, Method, Scheme. The method and
  // class count share one row (the by-value valueForm classes row's shape): a
  // single style_method label with two read-only boxes side by side, the method
  // box filling the control column (the by-value method select's role) and the
  // count box taking the compact secondary width (the class-count select's
  // role), so the two modes read as one grid.
  //
  // The method readout is honest to the record. A continuous scale is a
  // LinearColormap — the default explore mapping, an equally spaced interval
  // value fill — and states Equal Interval. A stepped scale states Equal Interval
  // only when the record proves it (``method: "equal"`` — the breaks are
  // equally spaced, see ``_fill_author.provable_equal_interval``); a stepped
  // scale whose method is null or absent (quantiles/jenks/heads are not
  // provable from the breaks alone) states a dash rather than guessing. A
  // categorical layer (no paired scale) uses the same dash. The row always
  // renders so the mode stays aligned with the by-value grid.
  // The two readouts stay distinguishable to assistive tech the way the
  // by-value selects do (the classes row keeps its own aria-labels): the
  // method box is named by the method label, the count box by the class-count
  // label. Both are readouts, never controls — the aria-label describes the
  // value, not an action.
  // The recorded method is what Python proved from the shipped breaks; the
  // continuous mode keeps its own honest Equal Interval (a LinearColormap is
  // an interval value fill by construction). A stepped scale reads "Equal
  // Interval" only when the record carries method: "equal", else the dash.
  const methodBox = readOnlyBox(
    CONST.CLASSES.STYLE_FILL_ORIGINAL_METHOD,
    { role: "group" },
    dom.el(
      "span",
      { class: CONST.CLASSES.STYLE_FILL_ORIGINAL_VALUE },
      author?.scale?.kind === "continuous" || author?.scale?.method === METHOD.EQUAL
        ? methodLabel(ui, METHOD.EQUAL)
        : "—",
    ),
  );
  // A bare div is a generic role: Chromium does expose the aria-label on it,
  // but that is not guaranteed across AT/browsers (and "text" is not an ARIA
  // role at all — it is a Safari/WebKit-ism). A standard namable role makes
  // the name stable, so these readout groups take role="group" the way the
  // colors box takes role="img".
  methodBox.setAttribute("aria-label", ui.T("classification_method"));
  const countBox = readOnlyBox(
    CONST.CLASSES.STYLE_FILL_ORIGINAL_COUNT,
    { role: "group" },
    dom.el(
      "span",
      { class: CONST.CLASSES.STYLE_FILL_ORIGINAL_VALUE },
      originalCount(author),
    ),
  );
  countBox.setAttribute("aria-label", ui.T("style_fill_classes"));
  rows.push(
    formRow(
      ui.T("classification_method"),
      inlineControls(methodBox, countBox),
      CONST.CLASSES.STYLE_FILL_ROW,
    ),
  );

  rows.push(
    formRow(ui.T("style_fill_scheme"), colorsBox, CONST.CLASSES.STYLE_FILL_ROW),
  );
  return rows;
};

export { buildOriginalDetail };

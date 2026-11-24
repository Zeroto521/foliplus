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
import { VISIBLE_FILL_OPACITY } from "./fillOpacity.js";
import { originalGradient } from "./originalColor.js";
import { FACE, authorFaceOf } from "./styleBag.js";
import { METHOD } from "#core/value/index.js";
import { dom } from "#platform/dom.js";
import { withUnit } from "#platform/format.js";
import {
  FORM_CLASS,
  PANEL_CLASS,
  formRow,
  inlineControls,
  readOnlyValue,
} from "#ui/index.js";
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

/** The read-only opacity readout, unified with the editable number field's
 *  unit-suffix chrome (the shared % suffix beside the value) so the original
 *  mode's readout paints the same box as the VALUE/SOLID number field it
 *  replaces — same width token, same right-aligned value, same muted % unit.
 *  The box stays a readout (readOnlyValue) but carries the number-group
 *  wrapper + number-suffix the number input uses, so the two presentations
 *  cannot drift. */
const readOnlyOpacity = (ui: LayerUI, pct: number): HTMLElement => {
  const value = `${Math.round(pct * 1000) / 10}%`;
  const box = readOnlyValue(
    {
      className: `${CONST.CLASSES.STYLE_FILL_READONLY} ${CONST.CLASSES.STYLE_FILL_ORIGINAL_OPACITY}`,
      role: "img",
    },
    dom.el(
      "span",
      { class: CONST.CLASSES.STYLE_FILL_ORIGINAL_VALUE },
      value.slice(0, -1),
    ),
    // The shared unit suffix (form.css) sits inside the box's right
    // padding, at the same inset the editable number field keeps — the
    // same class, token and gap, so the readout's % cannot drift from
    // the VALUE/SOLID number field's %. The box carries the relative
    // positioning (style.css) the suffix's absolute inset needs.
    dom.el(
      "span",
      { class: FORM_CLASS.NUMBER_SUFFIX, "aria-hidden": "true" },
      ui._("foliplus.unit_pct"),
    ),
  );
  box.setAttribute(
    "aria-label",
    withUnit(ui.T("style_fill_opacity"), ui._("foliplus.unit_pct")),
  );
  return box;
};

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
const buildOriginalDetail = (
  ui: LayerUI,
  layerId: string,
  opts: { includeOpacity?: boolean } = {},
): HTMLElement[] => {
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
  methodBox.setAttribute("aria-label", ui._("foliplus.classification_method"));
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
      ui._("foliplus.classification_method"),
      inlineControls(methodBox, countBox),
      CONST.CLASSES.STYLE_FILL_ROW,
    ),
  );

  rows.push(
    formRow(ui.T("style_fill_scheme"), colorsBox, CONST.CLASSES.STYLE_FILL_ROW),
  );
  // The read-only opacity row is the last row of the cmap original detail
  // (after the scheme, before the border mode): the author's own uniform
  // transparency, read from the first fill leaf, never an editable control.
  // The read-only opacity row belongs to the FILL channel alone: a border
  // whose author paints per feature reuses this detail for its column/
  // colors/method readouts, but must not re-emit the fill's opacity row
  // (the duplicate-row bug the user saw with ORIGINAL fill + ORIGINAL
  // border). The fill face owns the row; the border face passes
  // includeOpacity: false.
  if (opts.includeOpacity !== false) {
    const paint = authorFillPaint(ui, layerId);
    const pct = paint.opacity !== null ? paint.opacity : VISIBLE_FILL_OPACITY;
    const opacityBox = readOnlyOpacity(ui, pct);
    rows.push(
      formRow(
        ui.T("style_fill_opacity"),
        inlineControls(opacityBox),
        `${CONST.CLASSES.STYLE_FILL_ROW} ${CONST.CLASSES.STYLE_SIZE_ROW}`,
      ),
    );
  }

  return rows;
};

/** The author's own fill paint for the monochrome original readout.
 *
 *  Reads the first fill leaf's captured author bag when one exists, else its
 *  live options — the same priority `styleBaseOf` uses, so the row shows the
 *  author's paint rather than the last user drag that mutates `options` in
 *  place. Falls back to the documented constants only when no leaf declares a
 *  value (`leaf.options.fillColor ?? CONST.COLOR.DEFAULT`;
 *  `leaf.options.fillOpacity ?? VISIBLE_FILL_OPACITY`) — a layer the author
 *  left transparent still has a real 0% readout, and an empty/offscreen layer
 *  shows the default swatch + 20%. */
const authorFillPaint = (
  ui: LayerUI,
  layerId: string,
): { color: string; opacity: number | null } => ({
  // One shared reader per face + key (authorFaceOf): the captured author bag
  // wins, the live options fall back, then the face default. Same priority the
  // solid row's swatch uses, so the original readout and the map cannot
  // disagree about what the author painted.
  color: authorFaceOf(ui, layerId, FACE.FILL, "fillColor") ?? CONST.COLOR.DEFAULT,
  opacity: authorFaceOf(ui, layerId, FACE.FILL, "fillOpacity") ?? null,
});

/** The monochrome original-colors readout: ONE form-row holding the author's
 *  colour swatch and fill opacity side by side, both read-only.
 *
 *  Mirrors the SOLID row's shape ([colour | opacity] on one line) so the two
 *  modes read as one grid; unlike SOLID neither half is editable — the
 *  author's paint is not the user's to change. Reuses the shared read-only
 *  frame and the existing inline/form-row primitives; no new layout. */
const buildMonochromeOriginalDetail = (ui: LayerUI, layerId: string): HTMLElement[] => {
  const paint = authorFillPaint(ui, layerId);
  const pct = paint.opacity !== null ? paint.opacity : VISIBLE_FILL_OPACITY;
  // The read-only colour block reuses the SOLID row's own chrome verbatim:
  // the same shared form-color-input element and the same component class, so
  // the two rows paint the same box — flex:1, ctrl-size tall, one border, one
  // radius, the colour filling the whole block. Only the interaction differs:
  // a div is not focusable and carries an accessible name naming the colour
  // and the percentage instead of a colour picker.
  const colorBox = dom.el("div", {
    // The SOLID row's own chrome (form-color-input + the component class) with
    // the shared readonly marker on top: same box as the editable colour input,
    // but the input.css hover/focus rule skips it via :not(.foliplus-readonly)
    // and the background is the colour itself, not the picker swatch.
    class: `${FORM_CLASS.COLOR_INPUT} ${PANEL_CLASS.READONLY} ${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
    style: `background:${paint.color};cursor:default`,
    role: "img",
    "aria-label": `${ui.T("style_fill")} ${paint.color} ${Math.round(pct * 1000) / 10}%`,
    "aria-disabled": "true",
  });
  const opacityBox = readOnlyOpacity(ui, pct);
  return [
    formRow(
      ui.T("style_fill"),
      inlineControls(colorBox, opacityBox),
      CONST.CLASSES.STYLE_FILL_ROW,
    ),
  ];
};

export { buildMonochromeOriginalDetail, buildOriginalDetail };

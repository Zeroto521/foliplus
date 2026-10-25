// ui/style/row.ts — shared style-dimension row primitives.
//
// `buildModeRow` is the one mode selector shape the style panel uses: a
// labelled <select> plus a detail slot underneath (the active mode's rows).
// The fill dimension is its first consumer (solid / by value, T58); the icon
// and size-by-value batches reuse it so every mode row has the same label
// column, ARIA and spacing (design plan §4.7).
//
// The mode select is a native <select>: keyboard and screen-reader behavior
// come from the platform, and the panel never has to own a popup for it. The
// detail slot is one element — callers replace its children on a mode switch.
import { dom } from "#common/dom.js";

/** One mode offered by a mode row. `disabled` + `title` are how a mode that
 *  the layer cannot honestly offer (color-by-value without a numeric field)
 *  stays visible but not selectable, with the reason on the option. */
type ModeRowOption = {
  value: string;
  label: string;
  disabled?: boolean;
  title?: string;
};

/** What a caller gets back: the DOM root, the select for binding, and the
 *  empty detail slot to fill with the active mode's rows. */
type ModeRow = {
  block: HTMLElement;
  select: HTMLSelectElement;
  detail: HTMLElement;
};

const buildModeRow = (spec: {
  /** Row label (e.g. "Fill"). */
  label: string;
  /** Class on the <select>, so a caller/tests can find its own control. */
  selectClass: string;
  /** Class on the FORM_ROW itself (the panel binds dimensions by it). */
  rowClass: string;
  /** Class on the detail slot. */
  detailClass: string;
  /** Currently active mode value. */
  value: string;
  options: readonly ModeRowOption[];
}): ModeRow => {
  const select = dom.el("select", {
    class: `foliplus-form-select ${spec.selectClass}`,
    "aria-label": spec.label,
  }) as HTMLSelectElement;
  for (const option of spec.options) {
    select.appendChild(
      dom.el(
        "option",
        {
          value: option.value,
          ...(option.disabled ? { disabled: "" } : {}),
          ...(option.title ? { title: option.title } : {}),
        },
        option.label,
      ),
    );
  }
  select.value = spec.value;

  const detail = dom.el("div", { class: spec.detailClass });

  const block = dom.el(
    "div",
    { class: "foliplus-style-mode-block" },
    dom.el(
      "div",
      { class: `foliplus-form-row ${spec.rowClass}` },
      dom.el("label", { class: "foliplus-form-label" }, spec.label),
      dom.el(
        "div",
        { class: "foliplus-form-control" },
        dom.el("div", { class: "foliplus-form-inline" }, select),
      ),
    ),
    detail,
  );

  return { block, select, detail };
};

export { buildModeRow };

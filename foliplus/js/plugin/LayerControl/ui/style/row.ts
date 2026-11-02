// ui/style/row.ts — shared style-dimension row primitives.
//
// `buildModeRow` is the one mode selector shape the style panel uses: a
// labelled control plus a detail slot underneath (the active mode's rows).
// The fill dimension is its first consumer (solid / by value); the icon and
// size-by-value dimensions reuse it so every mode row has the same label
// column, ARIA and spacing.
//
// The control is the shared dropdown (common/dropdown.ts) bridged to a hidden
// native select: the visible mode list is the panel's one popup recipe, and the
// select stays the value/change carrier the panel's delegation reads. The
// detail slot is one element — callers replace its children on a mode switch.
import { dom } from "#common/dom.js";
import {
  type Dropdown,
  type DropdownSurface,
  createDropdown,
} from "#common/dropdown.js";
import { selectInput } from "#common/form.js";

/** One mode offered by a mode row. `disabled` + `title` let a later consumer
 *  (icon / size by value) show a mode it cannot offer yet with the reason on
 *  the option; the fill row hides the whole mode select when it has one arm. */
type ModeRowOption = {
  value: string;
  label: string;
  disabled?: boolean;
  title?: string;
};

/** What a caller gets back: the DOM root, the bridged select for binding, the
 *  dropdown that drives it, and the empty detail slot to fill with the active
 *  mode's rows. */
type ModeRow = {
  block: HTMLElement;
  select: HTMLSelectElement;
  dropdown: Dropdown;
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
  /** Popup host contract for the bridged dropdown (see common/dropdown). */
  surface?: DropdownSurface;
}): ModeRow => {
  const select = selectInput({
    className: spec.selectClass,
    ariaLabel: spec.label,
    value: spec.value,
    options: spec.options,
  });

  const dropdown = createDropdown({
    nativeSelect: select,
    ariaLabel: spec.label,
    ...spec.surface,
  });

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
        dom.el("div", { class: "foliplus-form-inline" }, dropdown.element),
      ),
    ),
    detail,
  );

  return { block, select, dropdown, detail };
};

export { buildModeRow };

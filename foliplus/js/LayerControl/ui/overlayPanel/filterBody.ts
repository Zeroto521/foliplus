// LayerControl UI — filter condition bodies.
//
// One body renders one filter dimension; the panel owns the shell, the
// kept/total readout and the Clear footer. A body owns the dimension row and
// its condition control, and writes through `deps.write` — it holds no
// committed state, so every write round-trips through the owner and repaints
// the control from the owner's model.
//
// `renderBody(dimension, model, deps)` receives a single dimension, not the
// whole model: a panel that renders several conditions mounts one body per
// dimension in order. Today the panel renders the first dimension only.
import type {
  FilterDimension,
  FilterEnumDimension,
  FilterRangeDimension,
  LayerFilter,
  LayerFilterModel,
} from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import * as SVGs from "#foliplus/LayerControl/icon.js";
import { Slider } from "#foliplus/LayerControl/slider.js";
import { dom } from "#common/dom.js";

/** What a body may use from the panel: translations, the owner write bridge
 *  and the panel's number formatters. */
type FilterBodyDeps = {
  T: (key: string) => string;
  write: (filter: LayerFilter | undefined) => void;
  formatCount: (n: number) => string;
  formatValue: (n: number) => string;
};

/** One rendered condition body. `dimension` is kept so the panel can decide
 *  between syncing and rebuilding without re-reading the model. */
type FilterBody = {
  root: HTMLElement;
  dimension: FilterDimension;
  /** Repaint the control from the owner's current model. */
  sync: (model: LayerFilterModel) => void;
  destroy: () => void;
  /** Close an open transient popup (the enum list). Returns true when the
   *  popup swallowed the press, so the panel stays open: the first outside
   *  press dismisses the popup, not the surface. */
  dismissTransient: (target: Element) => boolean;
};

/** The read-only dimension row: field label plus the owner-provided dimension
 *  name. Both bodies start with it; the enum body appends its control to the
 *  same cell so the name and the trigger read as one field. */
const buildDimensionRow = (
  T: FilterBodyDeps["T"],
  label: string,
): { row: HTMLElement; control: HTMLElement } => {
  const control = dom.el(
    "div",
    { class: `${CONST.CLASSES.FORM_CONTROL} ${CONST.CLASSES.FILTER_FIELD}` },
    label,
  );
  const row = dom.el(
    "div",
    { class: CONST.CLASSES.FORM_ROW },
    dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, T("filter_field")),
    control,
  );
  return { row, control };
};

/** The committed range clamped into the dimension's extent, or the full
 *  extent when no range filter is committed. */
const rangeValueOf = (
  dim: FilterRangeDimension,
  filter: LayerFilter | undefined,
): [number, number] => {
  if (filter?.kind !== "atom" || !filter.range) return [dim.range[0], dim.range[1]];
  return [
    Math.max(dim.range[0], Math.min(dim.range[1], filter.range[0])),
    Math.max(dim.range[0], Math.min(dim.range[1], filter.range[1])),
  ];
};

/** Shared dual-thumb range body: one field row plus the slider row. */
const renderRangeBody = (
  dim: FilterRangeDimension,
  model: LayerFilterModel,
  deps: FilterBodyDeps,
): FilterBody => {
  const { row: fieldRow } = buildDimensionRow(deps.T, dim.label);
  const host = dom.el("div", { class: CONST.CLASSES.FILTER_SLIDER });
  const slider = new Slider(host, {
    min: dim.range[0],
    max: dim.range[1],
    step: dim.step,
    value: rangeValueOf(dim, model.filter),
    label: deps.T("filter_range"),
    labels: [deps.T("filter_range_min"), deps.T("filter_range_max")],
    values: {
      min: deps.formatValue(dim.range[0]),
      max: deps.formatValue(dim.range[1]),
    },
    format: deps.formatValue,
    // Same appearance as the visible-range slider: a limit dot at each rail
    // end, no middle "current value" dot (a filter has no current readout).
    marks: [
      { at: dim.range[0], tone: "limit" },
      { at: dim.range[1], tone: "limit" },
    ],
    disabled: dim.range[0] === dim.range[1],
    input: value => deps.write(atomOf(dim.field, value as [number, number])),
    change: value => deps.write(atomOf(dim.field, value as [number, number])),
  });
  const rangeRow = dom.el(
    "div",
    { class: CONST.CLASSES.FORM_ROW },
    dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, deps.T("filter_range")),
    dom.el("div", { class: CONST.CLASSES.FORM_CONTROL }, host),
  );
  const root = dom.el("div", {}, fieldRow, rangeRow);

  const sync = (next: LayerFilterModel): void => {
    const stored = rangeValueOf(dim, next.filter);
    const current = slider.value;
    if (
      !Array.isArray(current) ||
      current[0] !== stored[0] ||
      current[1] !== stored[1]
    ) {
      slider.setValue(stored, { silent: true });
    }
  };

  return {
    root,
    dimension: dim,
    sync,
    destroy: () => slider.destroy(),
    dismissTransient: () => false,
  };
};

/** The panel's range atom — the only range shape the body emits. */
const atomOf = (
  field: string,
  range: [number, number],
): { kind: "atom"; field: string; op: "between"; range: [number, number] } => ({
  kind: "atom",
  field,
  op: "between",
  range,
});

/** The committed enum values for this dimension, in the owner's order. */
const enumValuesOf = (
  dim: FilterEnumDimension,
  filter: LayerFilter | undefined,
): readonly string[] =>
  filter?.kind === "enum" && filter.field === dim.field ? filter.values : [];

/** Build the commit for a value set: no selected value means "no filter",
 *  never "hide everything". Values keep the owner's option order so the
 *  serialized filter is stable regardless of click order. */
const enumFilterOf = (
  dim: FilterEnumDimension,
  selected: ReadonlySet<string>,
): LayerFilter | undefined => {
  const values = dim.options
    .map(option => option.value)
    .filter(value => selected.has(value));
  return values.length > 0 ? { kind: "enum", field: dim.field, values } : undefined;
};

/** Enum body: a read-only dimension row with a trigger that opens a checkbox
 *  listbox. Multi-select commits a value set; unselecting the last option
 *  commits `undefined`, so "nothing selected" always reads as "no filter" and
 *  the kept/total readout stays at 100%. */
const renderEnumBody = (
  dim: FilterEnumDimension,
  model: LayerFilterModel,
  deps: FilterBodyDeps,
): FilterBody => {
  const { row, control } = buildDimensionRow(deps.T, dim.label);
  control.classList.add(CONST.CLASSES.FILTER_ENUM);

  const trigger = dom.el(
    "button",
    {
      type: "button",
      class: `${CONST.CLASSES.FILTER_ENUM_TRIGGER} foliplus-form-select`,
      "aria-haspopup": "listbox",
      "aria-expanded": "false",
    },
    "",
  ) as HTMLButtonElement;
  const list = dom.el("div", {
    class: CONST.CLASSES.FILTER_ENUM_LIST,
    role: "listbox",
    "aria-multiselectable": "true",
  });
  list.hidden = true;

  const buttons = dim.options.map(option => {
    const optionButton = dom.el(
      "button",
      {
        type: "button",
        role: "option",
        class: CONST.CLASSES.FILTER_ENUM_OPTION,
        "aria-selected": "false",
        tabindex: "-1",
        "data-value": option.value,
      },
      dom.el("span", {
        class: CONST.CLASSES.FILTER_ENUM_CHECK,
        "aria-hidden": "true",
        innerHTML: SVGs.ICON_CHECK,
      }),
      dom.el("span", { class: CONST.CLASSES.FILTER_ENUM_LABEL }, option.label),
    );
    optionButton.addEventListener("click", () => toggleValue(option.value));
    list.appendChild(optionButton);
    return optionButton;
  });

  control.appendChild(trigger);
  control.appendChild(list);
  // The owner declared no options: nothing to select, and an empty popup
  // would read as a broken control.
  trigger.disabled = dim.options.length === 0;

  let open = false;

  const isOpen = (): boolean => open;

  const selectedValues = (): Set<string> => new Set(enumValuesOf(dim, currentFilter));

  const closeList = (focusTrigger: boolean): void => {
    if (!open) return;
    open = false;
    list.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (focusTrigger) trigger.focus();
  };

  const focusOption = (index: number): void => {
    const target =
      buttons[((index % buttons.length) + buttons.length) % buttons.length];
    target?.focus();
  };

  /** Open the listbox. A non-negative index also moves focus into the list
   *  (keyboard entry); a click-open leaves focus on the trigger, so the popup
   *  can be dismissed from the same element that opened it. */
  const openList = (focusIndex = -1): void => {
    open = true;
    list.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    if (focusIndex >= 0) focusOption(focusIndex);
  };

  const activeIndex = (): number =>
    buttons.findIndex(button => button === document.activeElement);

  const step = (delta: number): void => {
    const index = activeIndex();
    focusOption(index === -1 ? (delta > 0 ? 0 : buttons.length - 1) : index + delta);
  };

  const toggleValue = (value: string): void => {
    const next = selectedValues();
    if (next.has(value)) next.delete(value);
    else next.add(value);
    deps.write(enumFilterOf(dim, next));
  };

  let currentFilter: LayerFilter | undefined = model.filter;

  const sync = (next: LayerFilterModel): void => {
    currentFilter = next.filter;
    const selected = selectedValues();
    for (const [index, option] of dim.options.entries()) {
      buttons[index].setAttribute(
        "aria-selected",
        selected.has(option.value) ? "true" : "false",
      );
    }
    const labels = dim.options
      .filter(option => selected.has(option.value))
      .map(option => option.label);
    const text = labels.length > 0 ? labels.join(", ") : deps.T("filter_enum_any");
    trigger.textContent = text;
    trigger.title = text;
  };
  sync(model);

  trigger.addEventListener("click", () => {
    if (open) closeList(false);
    else openList();
  });

  trigger.addEventListener("keydown", event => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      if (open) step(1);
      else openList(0);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (open) step(-1);
      else openList(dim.options.length - 1);
    }
  });

  list.addEventListener("keydown", event => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      step(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      step(-1);
      return;
    }
    if (event.key === "Tab") {
      // Tab leaves the list, not the panel: hide the popup and hand focus
      // back to the trigger, which stays the panel's tab stop.
      event.preventDefault();
      closeList(true);
    }
  });

  // Escape closes the popup first. Stopping the event here keeps the panel's
  // own Escape handling (which closes the whole surface) from also running:
  // a popup is a step inside the panel, not a second surface.
  const root = row;
  rootEscapeGuard(root, () => {
    if (!isOpen()) return false;
    closeList(true);
    return true;
  });
  return {
    root,
    dimension: dim,
    sync,
    destroy: () => closeList(false),
    dismissTransient: target => {
      if (!open) return false;
      if (control.contains(target)) return false;
      closeList(false);
      return true;
    },
  };
};

/** Catch Escape on the body while a popup is open. Returns true when the
 *  guard consumed the key, so the panel's surface handler does not run. */
const rootEscapeGuard = (root: HTMLElement, consume: () => boolean): void => {
  root.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (!consume()) return;
    event.preventDefault();
    event.stopPropagation();
  });
};

/** Dispatch a body for one dimension. */
const renderBody = (
  dimension: FilterDimension,
  model: LayerFilterModel,
  deps: FilterBodyDeps,
): FilterBody =>
  dimension.kind === "range"
    ? renderRangeBody(dimension, model, deps)
    : renderEnumBody(dimension, model, deps);

/** A stable signature of a dimension's rendered shape (kind, field, label and
 *  the kind's own payload). Two dimensions with the same key can share one
 *  mounted body; any difference needs a rebuild, not a readout refresh. */
const dimensionShapeKey = (dimension: FilterDimension): string =>
  JSON.stringify(dimension);

export { dimensionShapeKey, renderBody };
export type { FilterBody };

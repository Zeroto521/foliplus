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
   *  press dismisses the popup, not the surface. `focusTrigger` is for the
   *  keyboard path, where the trigger is the popup's logical return target. */
  dismissTransient: (target: Element, focusTrigger?: boolean) => boolean;
};

/** The read-only dimension row: the label cell carries the dimension's own
 *  name, and the control cell is filled by the body. The name is localized by
 *  the owner (`dim.label`), so a component such as MeasureControl shows its
 *  own "Type" instead of the generic "Field" caption; the cell no longer
 *  repeats the name above the control. */
const buildDimensionRow = (
  label: string,
): {
  row: HTMLElement;
  control: HTMLElement;
} => {
  const control = dom.el("div", {
    class: `${CONST.CLASSES.FORM_CONTROL} ${CONST.CLASSES.FILTER_FIELD}`,
  });
  const row = dom.el(
    "div",
    { class: CONST.CLASSES.FORM_ROW },
    dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, label),
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
  const { row: fieldRow } = buildDimensionRow(dim.label);
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
 *  serialized filter is stable regardless of click order; values whose option
 *  disappeared from the owner's domain (a type with no measurement right now)
 *  are kept after it, so the filter cannot silently change under the user. */
const enumFilterOf = (
  dim: FilterEnumDimension,
  selected: ReadonlySet<string>,
): LayerFilter | undefined => {
  const values = dim.options
    .map(option => option.value)
    .filter(value => selected.has(value));
  for (const value of selected) {
    if (!values.includes(value)) values.push(value);
  }
  return values.length > 0 ? { kind: "enum", field: dim.field, values } : undefined;
};

/** One checkbox row: the native input owns focus and Space, the label supplies
 *  the localized option name. A null value builds the "All" row, which clears
 *  the selection instead of adding a value. */
const buildEnumOption = (
  value: string | null,
  label: string,
): { row: HTMLLabelElement; input: HTMLInputElement } => {
  const input = dom.el("input", { type: "checkbox" }) as HTMLInputElement;
  if (value === null) input.dataset.all = "true";
  else input.dataset.value = value;
  const row = dom.el(
    "label",
    { class: CONST.CLASSES.FILTER_ENUM_OPTION },
    input,
    dom.el("span", { class: CONST.CLASSES.FILTER_ENUM_LABEL }, label),
  ) as HTMLLabelElement;
  return { row, input };
};

/** Enum body: the dimension row plus a native `<details>` disclosure whose
 *  options are native checkboxes. The browser owns opening, focus and Space;
 *  the body only maps a checkbox change to a value set. An empty selection
 *  commits `undefined`, so "All" always reads as "no filter" and the
 *  kept/total readout stays at 100%. */
const renderEnumBody = (
  dim: FilterEnumDimension,
  model: LayerFilterModel,
  deps: FilterBodyDeps,
): FilterBody => {
  const { row, control } = buildDimensionRow(dim.label);
  const details = dom.el("details", {
    class: CONST.CLASSES.FILTER_ENUM,
  }) as HTMLDetailsElement;
  const summary = dom.el("summary", {
    class: `${CONST.CLASSES.FILTER_ENUM_TRIGGER} foliplus-form-select`,
  }) as HTMLElement;
  const list = dom.el("div", { class: CONST.CLASSES.FILTER_ENUM_LIST });
  const all = buildEnumOption(null, deps.T("filter_enum_any"));
  list.appendChild(all.row);
  const options = dim.options.map(option => {
    const built = buildEnumOption(option.value, option.label);
    list.appendChild(built.row);
    return { value: option.value, input: built.input };
  });
  details.appendChild(summary);
  details.appendChild(list);
  control.appendChild(details);

  let currentFilter: LayerFilter | undefined = model.filter;
  const selectedValues = (): Set<string> => new Set(enumValuesOf(dim, currentFilter));

  const sync = (next: LayerFilterModel): void => {
    currentFilter = next.filter;
    const selected = selectedValues();
    for (const option of options) {
      option.input.checked = selected.has(option.value);
    }
    all.input.checked = selected.size === 0;
    // A selected value whose option is gone still counts: the filter keeps it,
    // so the summary must not pretend that nothing is applied.
    const text =
      selected.size > 0
        ? deps.T("filter_enum_selected").replace("{n}", String(selected.size))
        : deps.T("filter_enum_any");
    summary.textContent = text;
    summary.title = text;
  };
  sync(model);

  const toggleValue = (value: string): void => {
    const next = selectedValues();
    if (next.has(value)) next.delete(value);
    else next.add(value);
    deps.write(enumFilterOf(dim, next));
  };

  const onListChange = (event: Event): void => {
    // The layer control listens for checkbox changes on its container to drive
    // row visibility; an enum checkbox is panel state, not a row slot, so its
    // change must not reach that handler.
    event.stopPropagation();
    event.stopImmediatePropagation();
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.dataset.all) {
      deps.write(undefined);
      return;
    }
    const value = input.dataset.value;
    if (value) toggleValue(value);
  };
  list.addEventListener("change", onListChange);

  return {
    root: row,
    dimension: dim,
    sync,
    destroy: () => {
      list.removeEventListener("change", onListChange);
      details.open = false;
    },
    dismissTransient: (target, focusTrigger = false) => {
      if (!details.open) return false;
      if (details.contains(target)) return false;
      details.open = false;
      if (focusTrigger) summary.focus();
      return true;
    },
  };
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

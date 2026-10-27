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

/** Enum body: one native `<select multiple>` listbox. The browser owns the
 *  listbox chrome, focus and keyboard; the body only maps the selected option
 *  set to a value set. An empty selection commits `undefined`, so "nothing
 *  selected" always reads as "no filter" and the kept/total readout stays at
 *  100%. Clicking an option toggles it (native multiple selects need Ctrl, so
 *  the pointerdown path flips the option itself and replays `change`). */
const renderEnumBody = (
  dim: FilterEnumDimension,
  model: LayerFilterModel,
  deps: FilterBodyDeps,
): FilterBody => {
  const { row, control } = buildDimensionRow(dim.label);
  const select = dom.el("select", {
    class: CONST.CLASSES.FILTER_ENUM,
    multiple: true,
    size: Math.min(Math.max(dim.options.length, 1), 4),
  }) as HTMLSelectElement;
  select.setAttribute("aria-label", dim.label);
  for (const option of dim.options) {
    select.appendChild(
      dom.el("option", { value: option.value }, option.label) as HTMLOptionElement,
    );
  }
  control.appendChild(select);

  let currentFilter: LayerFilter | undefined = model.filter;
  const selectedValues = (): Set<string> => new Set(enumValuesOf(dim, currentFilter));

  const sync = (next: LayerFilterModel): void => {
    currentFilter = next.filter;
    const selected = selectedValues();
    for (const option of Array.from(select.options)) {
      option.selected = selected.has(option.value);
    }
  };
  sync(model);

  // One click toggles one option: the native multiple listbox replaces the
  // selection on a plain press (Ctrl adds), so pointerdown flips the pressed
  // option and cancels the compatibility mouse events that would apply the
  // native single-select rule; the replayed change then writes the value set.
  // Keyboard stays native (Space toggles the focused option as usual).
  const onPointerDown = (event: PointerEvent): void => {
    if (!(event.target instanceof HTMLOptionElement)) return;
    event.preventDefault();
    event.target.selected = !event.target.selected;
    select.focus({ preventScroll: true });
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const onChange = (event: Event): void => {
    // The layer control listens for checkbox changes on its container to drive
    // row visibility; the filter listbox is panel state, not a row slot, so its
    // change must not reach that handler.
    event.stopPropagation();
    event.stopImmediatePropagation();
    // Start from the committed set, not the DOM: a value whose option is gone
    // (a measurement type with no items right now) is still filtered on and
    // must survive a click on a surviving option.
    const next = selectedValues();
    for (const option of Array.from(select.options)) {
      if (option.selected) next.add(option.value);
      else next.delete(option.value);
    }
    deps.write(enumFilterOf(dim, next));
  };

  select.addEventListener("pointerdown", onPointerDown);
  select.addEventListener("change", onChange);

  return {
    root: row,
    dimension: dim,
    sync,
    destroy: () => {
      select.removeEventListener("pointerdown", onPointerDown);
      select.removeEventListener("change", onChange);
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

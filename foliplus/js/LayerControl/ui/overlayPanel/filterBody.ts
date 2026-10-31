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
import { type DropdownSurface, createDropdown } from "#common/dropdown.js";

/** What a body may use from the panel: translations, the owner write bridge,
 *  the panel's number formatters and the popup surface an open control portals
 *  onto (the same contract the style panel's dropdowns receive). */
type FilterBodyDeps = {
  T: (key: string) => string;
  write: (filter: LayerFilter | undefined) => void;
  formatCount: (n: number) => string;
  formatValue: (n: number) => string;
  surface: DropdownSurface;
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

/** One dimension row: a caption cell and a control cell. The caption is
 *  owner-localized panel vocabulary ("Field", "Range", "Type"), never a raw
 *  field name — a `range` body pairs one of these with the read-only field
 *  row, an `enum` body mounts its dropdown in the control cell. */
const buildDimensionRow = (
  label: string,
  ...children: HTMLElement[]
): {
  row: HTMLElement;
  control: HTMLElement;
} => {
  const control = dom.el(
    "div",
    { class: `${CONST.CLASSES.FORM_CONTROL} ${CONST.CLASSES.FILTER_FIELD}` },
    ...children,
  );
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

/** The field row's read-only value: the dimension's field name in the style
 *  panel's read-only box frame — a form control's geometry with no chevron,
 *  focus ring or pointer affordance, so it lands on the same column edge as
 *  the select it sits beside and cannot be mistaken for something editable. */
const readOnlyField = (field: string): HTMLElement =>
  dom.el(
    "div",
    { class: CONST.CLASSES.STYLE_FILL_READONLY, "aria-disabled": "true" },
    dom.el("span", { class: CONST.CLASSES.FILTER_FIELD_VALUE }, field),
  );

/** Shared dual-thumb range body: the field row (caption + read-only field
 *  name, only when the owner provides `dim.fieldLabel`) plus the condition
 *  row (caption + slider). Two different questions are being answered —
 *  which field is being filtered, and over what range. An owner without a
 *  field row of its own (the Heatmap's aggregation field is chosen in the
 *  panel body, not this popup) passes no `fieldLabel` and gets only the
 *  condition row. `core` refuses to print the raw field name as a caption. */
const renderRangeBody = (
  dim: FilterRangeDimension,
  model: LayerFilterModel,
  deps: FilterBodyDeps,
): FilterBody => {
  // The field row is optional: an owner without a field row of its own (the
  // Heatmap's aggregation field is chosen in the panel body) passes no
  // fieldLabel and the popup renders only the condition row.
  const fieldRow = dim.fieldLabel
    ? buildDimensionRow(dim.fieldLabel, readOnlyField(dim.field)).row
    : null;
  // The condition row's caption is component vocabulary the owner may name;
  // absent that, the panel's own wording applies. This fallback is panel
  // chrome, never the field name.
  const conditionLabel = dim.label || deps.T("filter_range");
  const host = dom.el("div", { class: CONST.CLASSES.FILTER_SLIDER });
  const slider = new Slider(host, {
    min: dim.range[0],
    max: dim.range[1],
    step: dim.step,
    value: rangeValueOf(dim, model.filter),
    label: conditionLabel,
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
    dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, conditionLabel),
    dom.el("div", { class: CONST.CLASSES.FORM_CONTROL }, host),
  );
  const root = dom.el("div", {}, ...(fieldRow ? [fieldRow] : []), rangeRow);

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

/** Value-set equality: the owner's order is the option order, so a local
 *  toggle must not read as a model change — a repaint while the popup is open
 *  would rebuild the rows and drop focus off the row the user just toggled. */
const sameValues = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  const seen = new Set(a);
  return b.every(value => seen.has(value));
};

/** Enum body: the shared multiple dropdown. The trigger keeps the form-select
 *  chrome every other panel select uses, the popup is the shared menu shell,
 *  and one press toggles one option without closing the list. An empty
 *  selection commits `undefined`, so "nothing selected" always reads as "no
 *  filter" and the kept/total readout stays at 100%. */
const renderEnumBody = (
  dim: FilterEnumDimension,
  model: LayerFilterModel,
  deps: FilterBodyDeps,
): FilterBody => {
  const { row, control } = buildDimensionRow(dim.label);
  control.classList.add(CONST.CLASSES.FILTER_ENUM);

  // Escape ownership stays with the shared dropdown while its list is open:
  // common/dropdown claims the key on window capture and stops it there, so one
  // press closes the popup and the next one reaches the LAYER_FILTER panel —
  // "popup first, panel second", with the registry as the only panel
  // dispatcher. If this body ever grows a bespoke portal/popup, register it as
  // LAYER_FILTER (or PICKER_DROPDOWN) on the per-map overlay registry; never add
  // a document keydown of its own, because the registry's rank table is the
  // single Escape dispatcher.
  const dropdown = createDropdown({
    multiple: true,
    items: dim.options.map(option => ({
      value: option.value,
      label: option.label,
    })),
    values: enumValuesOf(dim, model.filter),
    placeholder: deps.T("filter_enum_any"),
    ariaLabel: dim.label,
    // The trigger answers "how many are picked"; the rows carry the check
    // slots and the listbox sets aria-multiselectable.
    selectedLabel: labels =>
      deps.T("filter_enum_count").replace("{n}", String(labels.length)),
    onChange: (_value, values) => deps.write(enumFilterOf(dim, new Set(values))),
    ...deps.surface,
  });
  // The owner declared no options: nothing to select, and an empty popup would
  // read as a broken control.
  dropdown.trigger.disabled = dim.options.length === 0;
  control.appendChild(dropdown.element);

  const sync = (next: LayerFilterModel): void => {
    const values = enumValuesOf(dim, next.filter);
    // Our own write lands here too, so only a real model change repaints.
    if (!sameValues(dropdown.getValues(), values)) dropdown.setValues(values);
  };

  return {
    root: row,
    dimension: dim,
    sync,
    destroy: () => dropdown.destroy(),
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

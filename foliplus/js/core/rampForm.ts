// core/rampForm — the shared Field / Classes / Scheme rows used by both
// classified schemes in the product: LayerControl's value-based fill detail
// and HeatmapControl's classification panel.
//
// Shared here: the row structure (label + control cell), the native control
// types (field + class count are selects, never number inputs), the method
// order and class-count options come from #core/classify, the scheme trigger
// markup the shared schemePicker expects, and the option builders. Consumers
// keep their own panel shell, their own labels (passed in, translated by the
// component's translator) and their own change wiring: the heatmap recomputes
// hexagons, the layer repaints leaves. Only the DOM row + control references
// are shared, so no cross-component innerHTML template exists.
import {
  CLASS_COUNT_VALUES,
  type ClassifyMethod,
  METHOD_ORDER,
} from "#core/classify.js";
import { dom } from "#common/dom.js";
import {
  type Dropdown,
  type DropdownSurface,
  createDropdown,
} from "#common/dropdown.js";
import { formRow, inlineControls, selectInput } from "#common/form.js";

/** Extra HTML attributes applied to the row/control, e.g. the heatmap's
 *  data-* seams that Python rendering tests pin. */
type Attributes = Record<string, string>;

/** Apply attributes to an element. */
const applyAttributes = (el: HTMLElement, attrs: Attributes | undefined): void => {
  if (!attrs) return;
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
};

type FieldRowOptions = {
  /** Row label, already translated by the consumer. */
  label: string;
  /** Accessible name for the field select. */
  ariaLabel: string;
  fields: readonly string[];
  value: string;
  rowClass?: string;
  selectClass?: string;
  rowAttributes?: Attributes;
  selectAttributes?: Attributes;
  onChange?: (field: string) => void;
  /** Popup host contract for the bridged dropdown (core/fullscreen's
   *  `dropdownSurface(map.getContainer())`), so an open list follows the
   *  surface covering the trigger. */
  surface?: DropdownSurface;
};

type FieldRow = {
  row: HTMLElement;
  /** The bridged native select: still the value/change carrier the consumers
   *  and the Python-rendered markup see, hidden behind the shared dropdown. */
  select: HTMLSelectElement;
  dropdown: Dropdown;
};

/** Field row: one shared dropdown listing the numeric/aggregation fields. */
const buildFieldRow = (opts: FieldRowOptions): FieldRow => {
  const select = selectInput({
    className: opts.selectClass,
    ariaLabel: opts.ariaLabel,
    value: opts.fields.includes(opts.value) ? opts.value : (opts.fields[0] ?? ""),
    options: opts.fields.map(field => ({ value: field, label: field })),
  });
  applyAttributes(select, opts.selectAttributes);
  if (opts.onChange) select.onchange = () => opts.onChange!(select.value);
  // The visible control is the shared dropdown; the select stays as the value
  // and change bridge so a consumer's own onchange/delegation keeps working.
  const dropdown = createDropdown({
    nativeSelect: select,
    ariaLabel: opts.ariaLabel,
    ...opts.surface,
  });

  const row = formRow(opts.label, dropdown.element, opts.rowClass);
  applyAttributes(row, opts.rowAttributes);
  return { row, select, dropdown };
};

type ClassesRowOptions = {
  /** Visible row label. Both panels name the method + class-count row by its
   *  primary control ("Method" / 分类方法); the class count is announced by the
   *  count select's own aria label. */
  label: string;
  /** Accessible name for the method select. */
  methodAriaLabel: string;
  /** Accessible name for the class-count select. */
  classesAriaLabel: string;
  methodValue: ClassifyMethod;
  classesValue: number;
  /** Method display label resolver (each component owns its locale keys). */
  methodLabel: (method: ClassifyMethod) => string;
  rowClass?: string;
  methodClass?: string;
  classesClass?: string;
  rowAttributes?: Attributes;
  methodAttributes?: Attributes;
  classesAttributes?: Attributes;
  onChange?: (next: { method?: ClassifyMethod; classes?: number }) => void;
  /** Popup host contract for both bridged dropdowns (see FieldRowOptions). */
  surface?: DropdownSurface;
};

type ClassesRow = {
  row: HTMLElement;
  methodSelect: HTMLSelectElement;
  classesSelect: HTMLSelectElement;
  methodDropdown: Dropdown;
  classesDropdown: Dropdown;
};

/** Method + class-count row. Both are shared dropdowns bridged to the native
 *  selects the panels and the Python-rendered markup still expect: the count
 *  comes from the shared 2..9 vocabulary, the method order from the shared
 *  classifier. */
const buildClassesRow = (opts: ClassesRowOptions): ClassesRow => {
  const methodSelect = selectInput({
    className: opts.methodClass,
    ariaLabel: opts.methodAriaLabel,
    value: opts.methodValue,
    options: METHOD_ORDER.map(method => ({
      value: method,
      label: opts.methodLabel(method),
    })),
  });
  applyAttributes(methodSelect, opts.methodAttributes);

  // Both consumers get the shared compact-count class: the class select is the
  // same role as a number field beside a flexed control, so its width contract
  // lives in one place (form.css) rather than per-component overrides.
  const classesSelect = selectInput({
    className: opts.classesClass
      ? `${opts.classesClass} foliplus-classes-select`
      : "foliplus-classes-select",
    ariaLabel: opts.classesAriaLabel,
    value: String(opts.classesValue),
    options: CLASS_COUNT_VALUES.map(count => ({
      value: String(count),
      label: String(count),
    })),
  });
  applyAttributes(classesSelect, opts.classesAttributes);
  if (opts.onChange) {
    const onChange = opts.onChange;
    methodSelect.onchange = () => {
      onChange({ method: methodSelect.value as ClassifyMethod });
    };
    classesSelect.onchange = () => {
      const classes = parseInt(classesSelect.value, 10);
      if (Number.isFinite(classes)) onChange({ classes });
    };
  }

  const methodDropdown = createDropdown({
    nativeSelect: methodSelect,
    ariaLabel: opts.methodAriaLabel,
    ...opts.surface,
  });
  const classesDropdown = createDropdown({
    nativeSelect: classesSelect,
    ariaLabel: opts.classesAriaLabel,
    // The wrapper replaces the select in the flex row, so the compact-count
    // width contract (form.css) has to size it.
    className: "foliplus-classes-select",
    ...opts.surface,
  });

  const row = formRow(
    opts.label,
    inlineControls(methodDropdown.element, classesDropdown.element),
    opts.rowClass,
  );
  applyAttributes(row, opts.rowAttributes);
  return {
    row,
    methodSelect,
    classesSelect,
    methodDropdown,
    classesDropdown,
  };
};

type SchemeRowOptions = {
  /** Row label ("Scheme" in both panels). */
  label: string;
  /** Class of the picker trigger element. */
  triggerClass: string;
  /** Class of the color-strip element inside the trigger. */
  barClass: string;
  /** Extra class on the color strip (heatmap's inner-bar class). */
  barInnerClass?: string;
  /** Class of the hidden select (defaults to the shared picker class). */
  hiddenClass?: string;
  rowClass?: string;
  rowAttributes?: Attributes;
  triggerAttributes?: Attributes;
  barAttributes?: Attributes;
  hiddenAttributes?: Attributes;
};

/** The scheme picker's trigger + hidden select, wrapped in a labelled row.
 *  The consumer creates the picker with these references (its onChange owns
 *  the repaint) — the trigger shows the color strip only, no scheme name, in
 *  both panels. */
const buildSchemeRow = (
  opts: SchemeRowOptions,
): {
  row: HTMLElement;
  trigger: HTMLElement;
  bar: HTMLElement;
  hiddenSelect: HTMLSelectElement;
} => {
  const barClass = opts.barInnerClass
    ? `${opts.barClass} foliplus-scheme-picker-bar ${opts.barInnerClass}`
    : `${opts.barClass} foliplus-scheme-picker-bar`;
  const bar = dom.el("div", {
    class: barClass,
    "data-scheme-bar-inner": "",
  });
  applyAttributes(bar, opts.barAttributes);
  // The trigger recipe is shared (common/scheme-picker.css); the consumer's
  // class stays on the element as its own hook.
  const trigger = dom.el(
    "div",
    {
      class: `${opts.triggerClass} foliplus-scheme-picker-trigger`,
      tabindex: "0",
      role: "combobox",
      "aria-haspopup": "listbox",
    },
    bar,
  );
  applyAttributes(trigger, opts.triggerAttributes);
  const hiddenSelect = dom.el("select", {
    class: opts.hiddenClass ?? "foliplus-scheme-picker-hidden",
    tabindex: "-1",
    "aria-hidden": "true",
  }) as HTMLSelectElement;
  applyAttributes(hiddenSelect, opts.hiddenAttributes);

  const row = formRow(opts.label, inlineControls(trigger, hiddenSelect), opts.rowClass);
  applyAttributes(row, opts.rowAttributes);
  return { row, trigger, bar, hiddenSelect };
};

export { buildClassesRow, buildFieldRow, buildSchemeRow };

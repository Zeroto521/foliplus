// common/dropdown — the shared replacement for a native single/multi select.
//
// This module is now an ADAPTER over the one listbox engine (common/listbox.ts).
// The engine owns every mechanism — row rendering skeleton, the ARIA listbox
// contract, keyboard walk, positioning/flip/clamp, portal mount + surface
// re-seat, wheel containment, focus restore, teardown, outside-press/Escape
// ownership — and this file owns only the *dropdown* value model and trigger
// appearance (the bridged native select, the standalone item list, the label
// button). The six historical shape divergences from the scheme picker are
// explicit engine config (common/listbox.ts), so a bug fix lands in one place.
//
// Trigger: a <button> that keeps the existing `.foliplus-form-select` chrome
// (common/form.css). Popup: joins the shared floating-menu shell
// (common/menu.css) for border, background, shadow and item states;
// dropdown.css adds only what the shell leaves per-component (anchoring,
// option rows, the multi-select check slot).
//
// Two modes:
//  - bridged (pass `nativeSelect`): the select stays in the DOM as the value +
//    `change` bridge — hidden and out of the tab order, but still the element
//    delegated handlers and the Python-rendered markup see. A user pick writes
//    `select.value` and dispatches a bubbling `change`. Call `refresh()` after
//    rewriting the options or the value programmatically.
//  - standalone (pass `items`, optional `multiple`): the dropdown owns the
//    value and reports it through `onChange` / `getValue` / `getValues`.
import { dom } from "#common/dom.js";
import {
  type DropdownSurface,
  applyOptionA11y,
  createListbox,
} from "#common/listbox.js";
import { createLogger } from "#common/log.js";

const log = createLogger("dropdown");

/** Classes this module owns. Also the seam tests and consumer CSS key off. */
const DROPDOWN_CLASSES = {
  wrapper: "foliplus-dropdown",
  trigger: "foliplus-dropdown-trigger",
  label: "foliplus-dropdown-label",
  placeholder: "foliplus-dropdown-placeholder",
  list: "foliplus-dropdown-list",
  option: "foliplus-dropdown-option",
  optionLabel: "foliplus-dropdown-option-label",
  open: "foliplus-dropdown-open",
  up: "foliplus-dropdown-up",
  portal: "foliplus-dropdown-portal",
  selected: "foliplus-is-selected",
  nativeHost: "foliplus-dropdown-native-host",
} as const;

/** One option, mirroring the native `<option>` fields the panels already use. */
interface DropdownItem {
  value: string;
  label: string;
  disabled?: boolean;
  title?: string;
  disabledHint?: string;
}

interface DropdownOptions extends DropdownSurface {
  nativeSelect?: HTMLSelectElement;
  items?: readonly DropdownItem[];
  value?: string;
  values?: readonly string[];
  multiple?: boolean;
  placeholder?: string;
  defaultToFirst?: boolean;
  ariaLabel?: string;
  className?: string;
  triggerAttributes?: Record<string, string>;
  selectedLabel?: (labels: readonly string[]) => string;
  onChange?: (value: string, values: readonly string[]) => void;
  onToggle?: (open: boolean, list: HTMLElement | null) => void;
}

interface Dropdown {
  element: HTMLElement;
  trigger: HTMLButtonElement;
  getList(): HTMLElement | null;
  isOpen(): boolean;
  getValue(): string;
  getValues(): readonly string[];
  setValue(value: string): void;
  setValues(values: readonly string[]): void;
  refresh(): void;
  setHint(text: string): void;
  open(): void;
  close(opts?: { restoreFocus?: boolean }): void;
  toggle(): void;
  destroy(): void;
}

interface InternalState {
  wrapper: HTMLElement;
  trigger: HTMLButtonElement;
  labelEl: HTMLElement;
  native: HTMLSelectElement | null;
  multiple: boolean;
  items: DropdownItem[];
  values: Set<string>;
  placeholder: string;
  hint: string;
  selectedLabel: (labels: readonly string[]) => string;
  onChange: ((value: string, values: readonly string[]) => void) | null;
  destroyed: boolean;
  listbox: ReturnType<typeof createListbox> | null;
}

let idCounter = 0;
const nextListId = (): string => `foliplus-dropdown-list-${String(++idCounter)}`;

/** One dropdown per select: a second upgrade of the same element would stack
 *  two triggers and two `change` bridges on one control. */
const ownerMap = new WeakMap<HTMLSelectElement, Dropdown>();

/** Items read off a bridged select, so the popup always lists the options the
 *  panel currently renders (they are rebuilt whenever a layer/field changes). */
const nativeItemsOf = (select: HTMLSelectElement): DropdownItem[] =>
  Array.from(select.options).map(option => ({
    value: option.value,
    label: option.textContent || option.value,
    ...(option.disabled ? { disabled: true } : {}),
    ...(option.title ? { title: option.title } : {}),
  }));

const valuesOf = (state: InternalState): string[] =>
  state.native
    ? state.native.value === ""
      ? []
      : [state.native.value]
    : Array.from(state.values);

const selectedItems = (state: InternalState): DropdownItem[] => {
  const selected = new Set(valuesOf(state));
  return state.items.filter(item => selected.has(item.value));
};

/** Trigger text: the selected label (single), or placeholder / one label /
 *  "<n> selected" (multiple). */
const labelTextOf = (state: InternalState): string => {
  const items = selectedItems(state);
  if (items.length === 0) {
    const prompt = state.items.find(item => item.value === "");
    return prompt ? prompt.label : state.placeholder;
  }
  if (items.length === 1) return items[0].label;
  return state.selectedLabel(items.map(item => item.label));
};

const renderLabel = (state: InternalState): void => {
  const text = labelTextOf(state);
  state.labelEl.textContent = text;
  state.trigger.classList.toggle(
    DROPDOWN_CLASSES.placeholder,
    selectedItems(state).length === 0,
  );
  const full =
    state.hint ||
    selectedItems(state)
      .map(item => item.label)
      .join(", ");
  if (full) state.trigger.title = full;
  else state.trigger.removeAttribute("title");
};

/** Write the user's pick through the bridged select (value + bubbling change)
 *  and/or the consumer callback. */
const commit = (state: InternalState): void => {
  const values = valuesOf(state);
  const value = state.multiple ? "" : (values[0] ?? "");
  state.onChange?.(value, values);
  if (state.native) {
    state.native.dispatchEvent(new Event("change", { bubbles: true }));
  }
};

const listboxOf = (state: InternalState): ReturnType<typeof createListbox> =>
  state.listbox as ReturnType<typeof createListbox>;

const createDropdown = (opts: DropdownOptions): Dropdown => {
  const native = opts.nativeSelect ?? null;
  if (native && opts.multiple) {
    throw new Error(
      log.msg("a native select cannot back a multiple dropdown — pass items"),
    );
  }
  if (native && ownerMap.has(native)) {
    throw new Error(
      log.msg("this select already has a dropdown — call destroy() first"),
    );
  }

  const multiple = opts.multiple ?? false;
  const wrapper = dom.el("div", { class: DROPDOWN_CLASSES.wrapper });
  const trigger = dom.el("button", {
    type: "button",
    class: `foliplus-form-select ${DROPDOWN_CLASSES.trigger}`,
    "aria-haspopup": "listbox",
    "aria-expanded": "false",
  }) as HTMLButtonElement;
  const labelEl = dom.el("span", { class: DROPDOWN_CLASSES.label });
  trigger.appendChild(labelEl);

  const listId = nextListId();

  // The native label is moved onto the trigger; the hidden select drops its own.
  const nativeLabel = native?.getAttribute("aria-label") ?? "";
  const ariaLabel = opts.ariaLabel ?? nativeLabel;
  if (ariaLabel) trigger.setAttribute("aria-label", ariaLabel);
  native?.removeAttribute("aria-label");
  for (const [name, value] of Object.entries(opts.triggerAttributes ?? {})) {
    trigger.setAttribute(name, value);
  }

  const state: InternalState = {
    wrapper,
    trigger,
    labelEl,
    native,
    multiple,
    items: opts.items ? [...opts.items] : [],
    values: new Set(opts.values ?? (opts.value ? [opts.value] : [])),
    placeholder: opts.placeholder ?? "",
    hint: "",
    selectedLabel:
      opts.selectedLabel ?? (labels => `${String(labels.length)} selected`),
    onChange: opts.onChange ?? null,
    destroyed: false,
    listbox: null,
  };

  wrapper.append(trigger);
  if (native) {
    wrapper.classList.add(DROPDOWN_CLASSES.nativeHost);
    native.hidden = true;
    native.tabIndex = -1;
    native.setAttribute("aria-hidden", "true");
    const parent = native.parentNode;
    if (parent) parent.insertBefore(wrapper, native);
    wrapper.append(native);
  }

  const listbox = createListbox({
    trigger,
    items: () => state.items,
    selected: () => valuesOf(state),
    multiple,
    shape: {
      rowTag: "button",
      dataKey: "data-value",
      selectedClass: DROPDOWN_CLASSES.selected,
      disabledAttr: "disabled",
      activedescendant: "none",
    },
    classes: {
      list: DROPDOWN_CLASSES.list,
      row: DROPDOWN_CLASSES.option,
      rowLabel: DROPDOWN_CLASSES.optionLabel,
      portal: DROPDOWN_CLASSES.portal,
      up: DROPDOWN_CLASSES.up,
      open: DROPDOWN_CLASSES.open,
    },
    surface: {
      resolveHost: opts.resolveHost ?? null,
      onSurfaceChange: opts.onSurfaceChange ?? null,
    },
    dismiss: { kind: "local" },
    onBeforeOpen: () => {
      // A bridged select's options/value may have been rebuilt since the last
      // open; re-read them so the popup always lists the current options (the
      // old dropdown did this at the top of openDropdown).
      syncFromNative();
    },
    renderTrigger: () => renderLabel(state),
    onRowActivate: index => activateRow(state, index),
    onToggle: opts.onToggle ?? undefined,
  });
  state.listbox = listbox;

  // The engine creates its own list with a generated id. We must keep the
  // dropdown's id namespace so existing tests that read the list id still
  // work. The engine assigns foliplus-listbox-N; reassign the engine list's
  // id to the dropdown's own namespace and re-link aria-controls/owns.
  const engineList = listbox.getList();
  if (engineList) {
    engineList.id = listId;
    trigger.setAttribute("aria-controls", listId);
    trigger.setAttribute("aria-owns", listId);
  }

  wrapper.append(engineList!);

  const syncFromNative = (): void => {
    if (!state.native) return;
    state.items = nativeItemsOf(state.native);
    state.values = new Set(state.native.value === "" ? [] : [state.native.value]);
  };

  const refresh = (): void => {
    if (state.destroyed) return;
    syncFromNative();
    renderLabel(state);
    if (listboxOf(state).isOpen()) {
      listboxOf(state).refresh();
    }
  };

  // A programmatic `change` (tests, a preset loader, another control) is the
  // one signal we get that the select moved: re-read it.
  const onChangeNative = (): void => refresh();
  if (native) native.addEventListener("change", onChangeNative);

  if (native) syncFromNative();

  // Empty is a state, not "uninitialized". (Same rule as before.)
  if (!multiple && state.values.size === 0) {
    const takeFirst = opts.defaultToFirst ?? (!native && !opts.placeholder);
    const first = takeFirst && state.items.find(item => !item.disabled);
    if (first) {
      state.values = new Set([first.value]);
      if (native) native.value = first.value;
    }
  }

  renderLabel(state);

  const dropdown: Dropdown = {
    element: wrapper,
    trigger,
    getList: () => listboxOf(state).getList(),
    isOpen: () => listboxOf(state).isOpen(),
    getValue: () => valuesOf(state)[0] ?? "",
    getValues: () => valuesOf(state),
    setValue(value: string) {
      if (state.destroyed) return;
      if (state.native) state.native.value = value;
      state.values = new Set(value === "" ? [] : [value]);
      refresh();
    },
    setValues(values: readonly string[]) {
      if (state.destroyed || !state.multiple) return;
      state.values = new Set(values);
      renderLabel(state);
      if (listboxOf(state).isOpen()) listboxOf(state).refresh();
    },
    refresh,
    setHint(text: string) {
      if (state.destroyed) return;
      state.hint = text;
      renderLabel(state);
    },
    open() {
      if (state.destroyed) return;
      listboxOf(state).open();
    },
    close(closeOpts) {
      if (state.destroyed) return;
      listboxOf(state).close(closeOpts);
    },
    toggle() {
      if (state.destroyed) return;
      listboxOf(state).toggle();
    },
    destroy() {
      if (state.destroyed) return;
      listboxOf(state).destroy();
      state.destroyed = true;
      if (native) {
        native.removeEventListener("change", onChangeNative);
        ownerMap.delete(native);
      }
    },
  };

  if (native) ownerMap.set(native, dropdown);
  return dropdown;
};

/** Activate row `index` in the dropdown's value model and fire the change. */
const activateRow = (state: InternalState, index: number): void => {
  const item = state.items[index];
  if (!item || item.disabled) return;
  if (state.multiple) {
    if (state.values.has(item.value)) state.values.delete(item.value);
    else state.values.add(item.value);
    commit(state);
    renderLabel(state);
    return;
  }
  if (state.native) state.native.value = item.value;
  else state.values = new Set([item.value]);
  renderLabel(state);
  commit(state);
};

const dropdownOf = (select: HTMLSelectElement): Dropdown | null =>
  ownerMap.get(select) ?? null;

export { applyOptionA11y, createDropdown, dropdownOf };
export type { Dropdown, DropdownSurface };

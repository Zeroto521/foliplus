// ui/dropdown — the shared replacement for a native single/multi select.
//
// This module is now an ADAPTER over the one listbox engine (ui/listbox.ts).
// The engine owns every mechanism — row rendering skeleton, the ARIA listbox
// contract, keyboard walk, positioning/flip/clamp, portal mount + surface
// re-seat, wheel containment, focus restore, teardown, outside-press/Escape
// ownership — and this file owns only the *dropdown* value model and trigger
// appearance (the bridged native select, the standalone item list, the label
// button). The six historical shape divergences from the scheme picker are
// explicit engine config (ui/listbox.ts), so a bug fix lands in one place.
//
// Trigger: a <button> that keeps the existing FORM_CLASS.FORM_SELECT chrome
// (ui/form.css). Popup: joins the shared floating-menu shell
// (ui/menu.css) for border, background, shadow and item states;
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
import { buildCheckboxSlot, buildLeadSlot } from "./checkSlot.js";
import { CHECK_SLOT_CLASS } from "./checkSlotClassName.js";
import { DROPDOWN_CLASS } from "./dropdownClassName.js";
import { FORM_CLASS } from "./formClassName.js";
import { createListbox } from "./listbox.js";
import { MENU_ROW_CLASS } from "./menuRowClassName.js";
import { applyOptionRowA11y } from "./optionRow.js";
import { selectAllAction, selectAllStateOf } from "./selectAllState.js";
import type { Dropdown, DropdownSurface } from "./type.js";
import { dom } from "#platform/dom.js";
import { createLogger } from "#platform/log.js";

const log = createLogger("dropdown");

/** One option, mirroring the native `<option>` fields the panels already use. */
interface DropdownItem {
  value: string;
  label: string;
  disabled?: boolean;
  title?: string;
  disabledHint?: string;
}

/** Highest host-panel rank a popup can sit in. The registry owns the
 *  ESC_PRIORITY table (core); ui cannot import core, so the guard test
 *  (overlayRegistry.test.ts) asserts this equals max(ESC_PRIORITY) over the
 *  host panels — if a new panel outranks this, the test fails and the
 *  developer must raise it. LAYER_MENU (800) is the highest panel that can
 *  host a dropdown; LAYER_RENAME (900) is exempt (never registered). */
const POPUP_HOST_RANK = 800;
/** Fixed increment above the highest host-panel rank: the popup band. Kept
 *  strictly above every panel so Escape closes the popup first, the panel on
 *  the next Escape — one layer at a time. */
const POPUP_ESCAPE_DELTA = 60;
/** The popup band rank: host panel rank + the fixed delta. */
const POPUP_OVERLAY_RANK = POPUP_HOST_RANK + POPUP_ESCAPE_DELTA;

/** Shared registry id for every dropdown popup. Only one listbox is open at a
 *  time (openStates is module-global), so all dropdowns may own the same id;
 *  the registry rejects a duplicate, and a popup never coexists with another
 *  listbox popup. */
const DROPDOWN_OVERLAY_ID = "foliplus.popup.dropdown";

/** The overlay-registry hook a dropdown consumer injects (core/control has the
 *  per-map registry; ui never imports core). When present, the open list
 *  registers a floating surface with the registry instead of self-installing a
 *  window keydown — the single Escape dispatcher closes the stacked popup one
 *  layer at a time. */
interface DropdownOverlay {
  /** Register a floating surface; returns its unregister (called on close). */
  register(entry: {
    id: string;
    isOpen(): boolean;
    close(opts: { restoreFocus: boolean }): void | boolean;
    panels(): Element[];
    dismissOn: "mousedown" | "click";
    pressPriority: number;
    escapeRank?: number;
  }): () => void;
  /** Stable identity for the Escape order / duplicate rejection. */
  id: string;
  /** Escape + press rank: higher = closer to the top. */
  rank: number;
}

interface DropdownOptions extends DropdownSurface {
  nativeSelect?: HTMLSelectElement;
  /** The open list registers with the overlay registry instead
   *  of binding its own document/window Escape. */
  overlay: DropdownOverlay;
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
  /** Locale label for the built-in select-all row. The dropdown paints the
   *  row itself in `multiple` mode and reads only this text from the consumer,
   *  so no language is hardcoded here. Falls back to "Select all". Ignored
   *  when `multiple` is false. */
  selectAllLabel?: string;
  /** Locale label for the select-all row once every option is picked: pressing
   *  it then clears the selection, so it needs a different word. Defaults to
   *  `selectAllLabel`. Ignored when `multiple` is false. */
  selectAllDeselectLabel?: string;
  onChange?: (value: string, values: readonly string[]) => void;
  onToggle?: (open: boolean, list: HTMLElement | null) => void;
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
    DROPDOWN_CLASS.PLACEHOLDER,
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

/** Build the overlay hook a dropdown consumer injects, from the per-map
 *  registry register. One call per consumer keeps the shared id + rank in one
 *  place (the engine's single Escape rank) while the register stays injected
 *  (ui never imports core). */
/** The slice of the per-map overlay registry a dropdown consumer injects. */
interface OverlayRegistryLike {
  register(entry: {
    id: string;
    isOpen(): boolean;
    close(opts: { restoreFocus: boolean }): void | boolean;
    panels(): Element[];
    dismissOn: "mousedown" | "click";
    pressPriority: number;
    escapeRank?: number;
  }): () => void;
}

const dropdownOverlay = (registry: OverlayRegistryLike): DropdownOverlay => ({
  register: entry => registry.register(entry),
  id: DROPDOWN_OVERLAY_ID,
  rank: POPUP_OVERLAY_RANK,
});

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
  const wrapper = dom.el("div", { class: DROPDOWN_CLASS.WRAPPER });
  if (opts.className) {
    // A consumer can size or theme the wrapper with a bespoke class (e.g. the
    // compact classes-count width contract in form.css). The native select is
    // replaced by this wrapper in the flex row, so the class lands here.
    wrapper.classList.add(...opts.className.split(/\s+/).filter(Boolean));
  }
  const trigger = dom.el("button", {
    type: "button",
    class: `${FORM_CLASS.INPUT_SKIN} ${FORM_CLASS.FORM_SELECT} ${DROPDOWN_CLASS.TRIGGER}`,
    "aria-haspopup": "listbox",
    "aria-expanded": "false",
  }) as HTMLButtonElement;
  const labelEl = dom.el("span", { class: DROPDOWN_CLASS.LABEL });
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
    wrapper.classList.add(DROPDOWN_CLASS.NATIVE_HOST);
    native.hidden = true;
    native.tabIndex = -1;
    native.setAttribute("aria-hidden", "true");
    const parent = native.parentNode;
    if (parent) parent.insertBefore(wrapper, native);
    wrapper.append(native);
  }

  // The multiple-mode set actions: select every option / clear the selection,
  // then commit through the same write path a row press uses (onChange +
  // native change). A re-render follows so the options and the select-all row
  // answer the new selection.
  const selectAllValues = (): void => {
    if (state.destroyed || !state.multiple) return;
    state.values = new Set(state.items.map(item => item.value));
    renderLabel(state);
    commit(state);
    // refreshHead, not refresh: the options are untouched, so rebuilding them
    // would drop focus off the row a keyboard user is walking.
    if (listboxOf(state).isOpen()) listboxOf(state).refreshHead();
  };
  const clearValues = (): void => {
    if (state.destroyed || !state.multiple) return;
    state.values = new Set();
    renderLabel(state);
    commit(state);
    if (listboxOf(state).isOpen()) listboxOf(state).refreshHead();
  };
  /** The built-in select-all row: one tri-state checkbox above the options,
   *  pressing it selects everything or clears it (a tri-state toggle over the
   *  whole set, so no separate Clear action is needed).
   *
   *  Rebuilt on every renderRows — the listbox clears the list first — so the
   *  checkbox is always read off the current selection. */
  /** Render one option row: single-mode paints a ✓ lead on the selected row,
   *  multiple-mode paints a per-row checkbox. The row button is built by the
   *  engine; this fills its content and the leading indicator cell.
   */
  const renderOptionRow = (
    item: DropdownItem,
    ctx: { selected: boolean; index: number },
    st: InternalState,
  ): HTMLElement => {
    const label = dom.el("span", { class: DROPDOWN_CLASS.OPTION_LABEL }, item.label);
    if (!st.multiple) {
      const lead = buildLeadSlot(DROPDOWN_CLASS.LEAD);
      lead.paint(ctx.selected);
      return dom.el("span", null, lead.slot, label);
    }
    const box = dom.el("input", {
      type: "checkbox",
      class: `${CHECK_SLOT_CLASS.BOX} ${DROPDOWN_CLASS.ROW_CHECKBOX}`,
      // The row button is the interactive control; the box is the visual
      // mark only (demo fidelity), so it is hidden from AT and the tab order.
      "aria-hidden": "true",
      tabindex: "-1",
    }) as HTMLInputElement;
    box.checked = ctx.selected;
    const slot = dom.el("span", { class: CHECK_SLOT_CLASS.SLOT }, box);
    return dom.el("span", null, slot, label);
  };

  /** Repaint one row's indicator in place (no rebuild). The row button is
   *  the interactive control; its leading mark is queried and repainted,
   *  so a toggle never needs a full renderRows.
   */
  const paintOptionRow = (
    row: HTMLElement,
    ctx: { selected: boolean },
  ): void => {
    const box = row.querySelector<HTMLInputElement>("input[type=checkbox]");
    if (box) box.checked = ctx.selected;
  };

  const selectAllRowOf = (): HTMLElement => {
    const total = state.items.length;
    const count = valuesOf(state).length;
    const verdict = selectAllStateOf(total, count);
    const { slot, box } = buildCheckboxSlot(total, count);
    // The box is the row control: a real <input type="checkbox">, so focus,
    // keyboard and the indeterminate state all come from the platform. It is
    // pointer-transparent (CSS) so a press anywhere on the row reaches the row
    // handler below; keyboard stays on the box, where Space toggles it natively
    // and fires change.
    const label = dom.el(
      "span",
      { class: DROPDOWN_CLASS.SELECT_ALL_LABEL },
      verdict.allChecked
        ? (opts.selectAllDeselectLabel ?? opts.selectAllLabel ?? "Select all")
        : (opts.selectAllLabel ?? "Select all"),
    );
    const row = dom.el("div", {
      role: "button",
      "aria-pressed": String(verdict.allChecked),
      class: DROPDOWN_CLASS.SELECT_ALL_ROW,
    });
    row.append(slot, label);
    // Pressing the row moves the whole set: everything picked clears it, anything
    // less selects it all (selectAllAction — the layer toggle-all shares this).
    // The action answers the CURRENT state read at press time, not at build time:
    // a stale read would clear a partially-picked list on its first press.
    const act = (): void => {
      if (state.destroyed) return;
      const now = selectAllStateOf(state.items.length, valuesOf(state).length);
      if (selectAllAction(now.state) === "clear") clearValues();
      else selectAllValues();
    };
    // One dispatch, however the press lands: a row press forwards to the box,
    // which is what fires change. Wiring both the row and the box would toggle
    // twice on a press that lands on the box itself (its own click bubbles up to
    // the row), so the box is the only thing that fires the action.
    // listener-exempt: control-DOM, removed with the dropdown
    row.onclick = () => {
      if (state.destroyed) return;
      box.click();
    };
    box.onchange = () => act();
    return row;
  };
  const listbox = createListbox({
    trigger,
    items: () => state.items,
    selected: () => valuesOf(state),
    multiple,
    shape: {
      rowTag: "button",
      dataKey: "data-value",
      selectedClass: DROPDOWN_CLASS.SELECTED,
      disabledAttr: "disabled",
      activedescendant: "none",
      renderRow: (item, ctx) => renderOptionRow(item, ctx, state),
      // Repaint the row's own indicator after a state change without a full
      // rebuild (ui/listbox calls this from the row-toggle and refreshHead).
      paintRow: (row, _item, ctx) => paintOptionRow(row, ctx),
    },
    classes: {
      list: DROPDOWN_CLASS.LIST,
      row: [DROPDOWN_CLASS.OPTION, MENU_ROW_CLASS.ROW].join(" "),
      rowLabel: DROPDOWN_CLASS.OPTION_LABEL,
      portal: DROPDOWN_CLASS.PORTAL,
      up: DROPDOWN_CLASS.UP,
      open: DROPDOWN_CLASS.OPEN,
    },
    surface: {
      resolveHost: opts.resolveHost ?? null,
      onSurfaceChange: opts.onSurfaceChange ?? null,
    },
    dismiss: {
      kind: "registry",
      register: opts.overlay.register,
      id: opts.overlay.id,
      rank: opts.overlay.rank,
    },
    onBeforeOpen: () => {
      // A bridged select's options/value may have been rebuilt since the last
      // open; re-read them so the popup always lists the current options (the
      // old dropdown did this at the top of openDropdown).
      syncFromNative();
    },
    renderTrigger: () => renderLabel(state),
    onRowActivate: index => activateRow(state, index),
    // The select-all row paints itself above the options: the dropdown builds
    // it once (multiple mode only) and re-reads the selection after every change,
    // so its box and label always answer the current pick.
    head: multiple ? selectAllRowOf : undefined,
    onToggle: open => {
      opts.onToggle?.(open, listbox.getList());
    },
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
  // The engine only calls onRowActivate for enabled, in-range rows, so a
  // disabled/undefined item cannot reach here (the engine blocks them first).
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

export {
  DROPDOWN_OVERLAY_ID,
  POPUP_ESCAPE_DELTA,
  POPUP_HOST_RANK,
  POPUP_OVERLAY_RANK,
  applyOptionRowA11y,
  createDropdown,
  dropdownOf,
  dropdownOverlay,
};
export type { DropdownOverlay };

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
import { DROPDOWN_CLASS } from "./dropdownClassName.js";
import { FORM_CLASS } from "./formClassName.js";
import { type ListFilter, createListFilter } from "./listFilter.js";
import { createListbox } from "./listbox.js";
import { applyOptionRowA11y } from "./optionRow.js";
import { createSearchField } from "./searchField.js";
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

/** Item count past which the "auto" search mode shows a search box. The popup
 *  shows ~8 rows before it scrolls (menu-max-height 240px / row-h ~30px), so a
 *  list a bit over one screen is where filtering pays. Consumers with a
 *  different semantic (a field list) pass an explicit threshold. */
const DROPDOWN_SEARCH_AUTO_THRESHOLD = 10;

/** Debounce for the search input: typing filters the item set on a short
 *  settle, not per keystroke (a 1000-item field list is O(n) per filter). */
const SEARCH_DEBOUNCE_MS = 150;

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

/** Search configuration for a dropdown popup. */
type DropdownSearch =
  | false
  | "auto"
  | {
      threshold: number;
      renderLimit?: number;
    };

/** The search/filter state published to the consumer so it can render the
 *  footer ("showing N of M · K selected"). */
interface DropdownSearchState {
  shown: number;
  total: number;
  query: string;
  selected: number;
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
  onChange?: (value: string, values: readonly string[]) => void;
  onToggle?: (open: boolean, list: HTMLElement | null) => void;
  /** Show a search box in the popup when the item count exceeds the threshold.
   *  "auto" = { threshold: DROPDOWN_SEARCH_AUTO_THRESHOLD }; false (default)
   *  disables search — the existing callers are byte-identical. */
  search?: DropdownSearch;
  /** Placeholder for the search input (caller-localized). */
  searchPlaceholder?: string;
  /** Text shown when no item matches the query (caller-localized). */
  searchNoResult?: string;
  /** Called when the filtered/total/query/selected state changes. */
  onSearchState?: (info: DropdownSearchState) => void;
  /** Formats the footer count line (caller-localized). Default: "shown of total · selected". */
  searchFooterText?: (info: {
    shown: number;
    total: number;
    selected: number;
  }) => string;
  /** Label for the multi-select "select all" footer button (caller-localized). */
  searchSelectAllText?: string;
  /** Label for the multi-select "clear all" footer button (caller-localized). */
  searchClearAllText?: string;
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
  /** Parsed search config, or null when search is off (existing path). */
  search: {
    threshold: number;
    renderLimit?: number;
  } | null;
  /** The pure filter over the item set (null when search off). */
  listFilter: ListFilter<DropdownItem> | null;
  /** The search input + status region (null when search off). */
  searchField: ReturnType<typeof createSearchField> | null;
  /** The floating shell (search on) or null (search off — the listbox uses the
   *  list itself as the mount root). */
  mountRoot: HTMLElement | null;
  /** The currently active row index in the searchable list, or -1. Single
   *  source of truth for aria-activedescendant / the active row class. */
  activeIndex: number;
  /** The current query (kept across refresh; reset on open). */
  query: string;
  /** Debounce timer for the search input. */
  searchTimer: ReturnType<typeof setTimeout> | null;
  /** True when the current render is pinned (multi-select search). */
  searchRenderLimitApplied: boolean;
  /** The "no result" text (caller-localized). */
  searchNoResult: string;
  /** The footer element (showing N of M · K selected + all/clear), or null. */
  footerEl: HTMLElement | null;
  /** The text-only live region inside the footer (role=status), or null. */
  statusTextEl: HTMLElement | null;
  onSearchState: ((info: DropdownSearchState) => void) | null;
  /** Formats the footer count line (caller-localized). */
  searchFooterText:
    ((info: { shown: number; total: number; selected: number }) => string) | null;
  /** Label for the multi-select "select all" footer button. */
  searchSelectAllText: string;
  /** Label for the multi-select "clear all" footer button. */
  searchClearAllText: string;
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

/** Parse the search option into a normalized config (null = off). */
const parseSearch = (
  search: DropdownSearch | undefined,
): {
  threshold: number;
  renderLimit?: number;
} | null => {
  if (search === undefined || search === false) return null;
  if (search === "auto") return { threshold: DROPDOWN_SEARCH_AUTO_THRESHOLD };
  return search;
};

/** The filtered item set the searchable dropdown renders. */
const filteredItems = (
  state: InternalState,
): { items: DropdownItem[]; shown: number; matchedCount: number } => {
  const filter = state.listFilter;
  if (!filter) {
    return {
      items: state.items,
      shown: state.items.length,
      matchedCount: state.items.length,
    };
  }
  const matched = filter.setQuery(state.query);
  const renderLimit = state.search?.renderLimit;
  const pinned: DropdownItem[] = [];
  const matchedValues = new Set(matched.map(item => item.value));
  if (state.multiple) {
    for (const item of state.items) {
      if (state.values.has(item.value) && !matchedValues.has(item.value)) {
        pinned.push(item);
      }
    }
  }
  const capped = renderLimit ? matched.slice(0, renderLimit) : matched;
  return {
    items: [...pinned, ...capped],
    shown: capped.length,
    matchedCount: matched.length,
  };
};

/** Re-render the searchable list after a query change: re-filter, refresh the
 *  listbox, and publish the search state. */
/** Fill the footer ("showing N of M · K selected" + select-all/clear
 *  for multi-select). Uses the search state's shown/total/selected. */
const updateSearchFooter = (
  state: InternalState,
  shown: number,
  matchedCount: number,
): void => {
  const el = state.footerEl;
  if (!el) return;
  const statusEl = state.statusTextEl;
  if (!statusEl) return;
  // No matches: the single status region carries only the no-result line (it
  // and the count are mutually exclusive — P2-c). Buttons do not render here.
  if (shown === 0) {
    statusEl.textContent = state.searchNoResult ?? "";
    return;
  }
  const selected = state.values.size;
  // The footer denominator is the matched set, not the full domain: with a
  // query active it reads "showing 5 of 12" (12 = what the query matched),
  // and the full-domain count is what onSearchState publishes separately.
  const parts: string[] = [];
  if (shown !== matchedCount) {
    parts.push(`showing ${String(shown)} of ${String(matchedCount)}`);
  }
  parts.push(`${String(selected)} selected`);
  statusEl.textContent = state.searchFooterText
    ? state.searchFooterText({ shown, total: matchedCount, selected })
    : parts.join(" · ");
  if (state.multiple) {
    const all = dom.el(
      "button",
      { class: DROPDOWN_CLASS.FOOTER_BTN },
      state.searchSelectAllText,
    );
    all.addEventListener("click", () => {
      // Select-all covers the FULL matched set, not the renderLimit-capped
      // view: a 40-item domain with a 30 cap must not silently drop the last
      // ten from the selection.
      const full = filterAll(state);
      for (const item of full) state.values.add(item.value);
      state.onChange?.(state.values.values().next().value ?? "", [...state.values]);
      refreshSearch(state);
    });
    const clear = dom.el(
      "button",
      { class: DROPDOWN_CLASS.FOOTER_BTN },
      state.searchClearAllText,
    );
    clear.addEventListener("click", () => {
      state.values.clear();
      state.onChange?.("", []);
      refreshSearch(state);
    });
    // Replace the action row on every refresh (select-all/clear rebuild through
    // refreshSearch), keeping exactly one pair of buttons.
    el.querySelectorAll(`.${DROPDOWN_CLASS.FOOTER_BTN}`).forEach(node => node.remove());
    el.append(all, clear);
  }
};

/** The full matched set (no renderLimit cap), for select-all. */
const filterAll = (state: InternalState): DropdownItem[] => {
  const filter = state.listFilter;
  if (!filter) return state.items;
  return [...filter.setQuery(state.query)];
};

const refreshSearch = (state: InternalState): void => {
  const { shown, matchedCount } = filteredItems(state);
  state.listbox?.refresh();
  state.activeIndex = -1;
  setActiveRow(state, -1);
  // Single status region (P2-c): no-result and the footer count share the
  // same role=status element and never coexist. With a query that matches
  // nothing, only the no-result line shows; otherwise the count (and the
  // multi-select buttons) render in that same region.
  updateSearchFooter(state, shown, matchedCount);
  state.onSearchState?.({
    shown,
    total: state.listFilter?.total() ?? 0,
    query: state.query,
    selected: state.values.size,
  });
};

/** Keyboard handling for the search input. */
const searchKeyDown = (state: InternalState, event: KeyboardEvent): void => {
  const listbox = state.listbox;
  if (!listbox) return;
  const rows = listbox.getRows();
  switch (event.key) {
    case "ArrowDown": {
      event.preventDefault();
      state.activeIndex = Math.min(state.activeIndex + 1, Math.max(0, rows.length - 1));
      setActiveRow(state, state.activeIndex);
      const el = rows[state.activeIndex] as HTMLElement | undefined;
      if (el) el.scrollIntoView({ block: "nearest" });
      break;
    }
    case "ArrowUp": {
      event.preventDefault();
      state.activeIndex = Math.max(state.activeIndex - 1, -1);
      setActiveRow(state, state.activeIndex);
      const el = rows[state.activeIndex] as HTMLElement | undefined;
      if (el) el.scrollIntoView({ block: "nearest" });
      break;
    }
    case "Home": {
      event.preventDefault();
      state.activeIndex = 0;
      setActiveRow(state, state.activeIndex);
      const el = rows[state.activeIndex] as HTMLElement | undefined;
      if (el) el.scrollIntoView({ block: "nearest" });
      break;
    }
    case "End": {
      event.preventDefault();
      state.activeIndex = Math.max(0, rows.length - 1);
      setActiveRow(state, state.activeIndex);
      const el = rows[state.activeIndex] as HTMLElement | undefined;
      if (el) el.scrollIntoView({ block: "nearest" });
      break;
    }
    case "Enter": {
      if (state.activeIndex >= 0 && rows[state.activeIndex]) {
        event.preventDefault();
        (rows[state.activeIndex] as HTMLButtonElement).click();
      }
      break;
    }
    case " ": {
      // Space mirrors Enter (a search input cannot be the Space activator
      // otherwise): both activate the active row. Matches the non-search
      // listbox path where Space toggles the focused row. A query that ends
      // in a space is still being typed, so Space there must not activate.
      if (
        state.activeIndex >= 0 &&
        !state.query.endsWith(" ") &&
        rows[state.activeIndex]
      ) {
        event.preventDefault();
        (rows[state.activeIndex] as HTMLButtonElement).click();
      }
      break;
    }
    case "Escape": {
      if (state.query) {
        // Consume the Escape so the popup stays open; the registry's
        // escPassthroughOnEditable already guarantees only the editable gets
        // the event, so we must NOT stopPropagation (that would break the
        // "one Escape closes one layer" contract for the parent dispatcher).
        event.preventDefault();
        state.query = "";
        state.searchField?.clear();
        refreshSearch(state);
      } else {
        event.preventDefault();
        listbox.close();
      }
      break;
    }
    case "Tab": {
      state.activeIndex = -1;
      setActiveRow(state, -1);
      break;
    }
  }
};

const setActiveRow = (state: InternalState, index: number): void => {
  const rows = state.listbox?.getRows() ?? [];
  rows.forEach(row => row.classList.remove(DROPDOWN_CLASS.ACTIVE));
  const row = rows[index];
  if (row) row.classList.add(DROPDOWN_CLASS.ACTIVE);
  state.searchField?.setAriaActive(row?.id ?? null);
};

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
    search: parseSearch(opts.search),
    listFilter: null,
    searchField: null,
    mountRoot: null,
    activeIndex: -1,
    query: "",
    searchTimer: null,
    searchRenderLimitApplied: false,
    searchNoResult: opts.searchNoResult ?? "",
    footerEl: null,
    statusTextEl: null,
    onSearchState: opts.onSearchState ?? null,
    searchFooterText: opts.searchFooterText ?? null,
    searchSelectAllText: opts.searchSelectAllText ?? "Select all",
    searchClearAllText: opts.searchClearAllText ?? "Clear",
  };
  // Threshold gating: the search box only appears when the item set is
  // large enough that a plain list would overflow the one-screen cap
  // (menu-max-height 240px / menu-row-h ~30px ≈ 8 rows). Below it the
  // dropdown is byte-for-byte the non-search control.
  if (state.search && state.items.length <= state.search.threshold) {
    state.search = null;
  }

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

  // Searchable popup: the list is wrapped in a shell that holds the search
  // input, the options container and the status/footer region. The shell is
  // the listbox's mount root (positioning/portal classes land on it); the list
  // stays the role=listbox options container inside. Search off: mountRoot
  // stays null and the engine uses the list itself — byte-identical.
  if (state.search) {
    state.listFilter = createListFilter<DropdownItem>();
    state.listFilter.normalize(
      state.items.map(item => ({ value: item.value, label: item.label })),
    );
    state.searchField = createSearchField({
      placeholder: opts.searchPlaceholder ?? "",
      ariaLabel: opts.searchPlaceholder ?? "",
      inputClass: FORM_CLASS.INPUT_SKIN,
      onInput: query => {
        state.query = query;
        if (state.searchTimer) clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(() => {
          state.searchTimer = null;
          refreshSearch(state);
        }, SEARCH_DEBOUNCE_MS);
      },
      onKeyDown: event => searchKeyDown(state, event),
    });
    state.searchField.element.setAttribute("role", "combobox");
    state.searchField.element.setAttribute("aria-expanded", "false");
    state.searchField.element.setAttribute("aria-autocomplete", "list");
    state.mountRoot = dom.el("div", { class: DROPDOWN_CLASS.LIST });
    state.mountRoot.append(
      dom.el("div", { class: DROPDOWN_CLASS.SEARCH }, state.searchField.element),
    );
    // The footer row splits the live status text (role=status + aria-live,
    // text only — P2-B) from the action buttons so the live region never
    // announces a button press as a status update.
    state.footerEl = dom.el("div", { class: DROPDOWN_CLASS.STATUS });
    state.statusTextEl = dom.el("span", {
      role: "status",
      "aria-live": "polite",
    });
    state.footerEl.append(state.statusTextEl);
  }

  const listbox = createListbox({
    trigger,
    items: () => filteredItems(state).items,
    selected: () => valuesOf(state),
    multiple,
    shape: {
      rowTag: "button",
      dataKey: "data-value",
      selectedClass: DROPDOWN_CLASS.SELECTED,
      disabledAttr: "disabled",
      activedescendant: "none",
      rowIds: !!state.search,
    },
    classes: {
      list: DROPDOWN_CLASS.LIST,
      row: DROPDOWN_CLASS.OPTION,
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
    mountRoot: () => state.mountRoot,
    escPassthroughOnEditable: !!state.search,
    onBeforeOpen: () => {
      // A bridged select's options/value may have been rebuilt since the last
      // open; re-read them so the popup always lists the current options (the
      // old dropdown did this at the top of openDropdown).
      syncFromNative();
      if (state.search) {
        state.query = "";
        state.searchField?.clear();
        state.listFilter?.normalize(
          state.items.map(item => ({ value: item.value, label: item.label })),
        );
        refreshSearch(state);
      }
    },
    renderTrigger: () => renderLabel(state),
    onRowActivate: index => activateRow(state, index),
    onToggle: open => {
      state.searchField?.element.setAttribute("aria-expanded", String(open));
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
    if (state.searchField) {
      state.searchField.element.setAttribute("aria-controls", listId);
    }
  }

  if (state.search && state.mountRoot && state.searchField) {
    engineList!.classList.add(DROPDOWN_CLASS.OPTIONS);
    state.mountRoot.append(engineList!);
    state.mountRoot.append(state.footerEl!);
  } else {
    wrapper.append(engineList!);
  }

  /** S2: build the search box (input + no-result notice) pinned above the
   *  option list. Only created when the consumer opts in. Returns the DOM
   *  trio and a refresh that re-inserts them after a renderRows wipe. */
  const buildSearch = (search: NonNullable<DropdownOptions["search"]>) => {
    const searchEl = dom.el("div", { class: DROPDOWN_CLASS.SEARCH });
    const input = dom.el("input", {
      type: "search",
      class: DROPDOWN_CLASS.SEARCH_INPUT,
      placeholder: search.placeholder,
      "aria-label": search.placeholder,
      autocomplete: "off",
      spellcheck: "false",
    }) as HTMLInputElement;
    const noResult = dom.el(
      "div",
      { class: DROPDOWN_CLASS.NO_RESULT, hidden: "" },
      search.noResult,
    );
    searchEl.append(input, noResult);

    // Keep the search box pinned to the top of the popup: the engine's
    // renderRows wipes the list and appends fresh rows, so a refresh must
    // re-insert the box (and the no-result notice) before the first row.
    const ensure = (): void => {
      const list = listbox.getList();
      if (!list) return;
      const first = list.firstElementChild;
      if (first !== searchEl) list.insertBefore(searchEl, first);
      const rows = list.querySelectorAll(`.${DROPDOWN_CLASS.OPTION}`);
      const empty = rows.length === 0 && state.query.trim() !== "";
      noResult.hidden = !empty;
    };

    input.addEventListener("input", () => {
      state.query = input.value;
      if (listbox.isOpen()) {
        listbox.refresh();
        ensure();
      }
    });
    // Escape in the search field closes the popup (the engine's list keydown
    // never sees the search field — it is a sibling, not a row).
    input.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.stopPropagation();
        listbox.close({ restoreFocus: false });
      }
    });
    // ArrowDown from the search field moves into the first visible row.
    input.addEventListener("keydown", event => {
      if (event.key === "ArrowDown") {
        const list = listbox.getList();
        const row = list?.querySelector(`.${DROPDOWN_CLASS.OPTION}`);
        if (row) {
          event.preventDefault();
          (row as HTMLElement).focus();
        }
      }
    });

    return {
      input,
      ensure,
      reset: () => {
        state.query = "";
        input.value = "";
      },
    };
  };

  const search = opts.search ? buildSearch(opts.search) : null;
  searchBox = search;
  if (search) search.ensure();
  const syncFromNative = (): void => {
    if (!state.native) return;
    state.items = nativeItemsOf(state.native);
    state.values = new Set(state.native.value === "" ? [] : [state.native.value]);
  };

  const refresh = (): void => {
    if (state.destroyed) return;
    syncFromNative();
    renderLabel(state);
    if (state.search && state.listFilter) {
      state.listFilter = createListFilter<DropdownItem>();
      state.listFilter.normalize(
        state.items.map(item => ({ value: item.value, label: item.label })),
      );
      if (listboxOf(state).isOpen()) refreshSearch(state);
    }
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
      if (state.search && state.listFilter) {
        state.query = "";
        state.searchField?.clear();
        state.listFilter.normalize(
          state.items.map(item => ({ value: item.value, label: item.label })),
        );
      }
      listboxOf(state).open();
      if (state.search && state.searchField) {
        state.searchField.focus();
      }
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
      if (state.searchTimer) {
        clearTimeout(state.searchTimer);
        state.searchTimer = null;
      }
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
  // The engine passes the index in the RENDERED list (items() -> filteredItems),
  // which in search mode differs from the full state.items array. Index the
  // rendered view, not the source, or a filtered row activates the wrong item.
  const item = filteredItems(state).items[index];
  // The engine only calls onRowActivate for enabled, in-range rows, so a
  // disabled/undefined item cannot reach here (the engine blocks them first).
  if (state.multiple) {
    if (state.values.has(item.value)) state.values.delete(item.value);
    else state.values.add(item.value);
    commit(state);
    renderLabel(state);
    // Multi-select keeps the popup open and the keyboard path must stay on the
    // search input (P2-F); refresh the list so pinned rows repaint.
    if (state.search) refreshSearch(state);
    state.searchField?.focus();
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
  DROPDOWN_SEARCH_AUTO_THRESHOLD,
  POPUP_ESCAPE_DELTA,
  POPUP_HOST_RANK,
  POPUP_OVERLAY_RANK,
  applyOptionRowA11y,
  createDropdown,
  dropdownOf,
  dropdownOverlay,
};
export type { DropdownOverlay, DropdownOptions };

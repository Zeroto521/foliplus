// common/dropdown — the shared replacement for a native single/multi select.
//
// Trigger: a <button> that keeps the existing `.foliplus-form-select` chrome
// (common/form.css). The closed state therefore keeps the native select's
// look without a second recipe — this module owns behaviour, not a skin.
// Popup: joins the shared floating-menu shell (common/menu.css) for border,
// background, shadow and item states; dropdown.css adds only what the shell
// leaves per-component (anchoring, option rows, the multi-select check slot).
//
// Two modes:
//  - bridged (pass `nativeSelect`): the select stays in the DOM as the value +
//    `change` bridge — hidden and out of the tab order, but still the element
//    delegated handlers and the Python-rendered markup see. A user pick writes
//    `select.value` and dispatches a bubbling `change`, so a panel that
//    listens on its root keeps working. Call `refresh()` after rewriting the
//    options or the value programmatically.
//  - standalone (pass `items`, optional `multiple`): the dropdown owns the
//    value and reports it through `onChange` / `getValue` / `getValues`.
//
// The open popup is portalled: it leaves the panel and mounts on the surface
// covering the trigger — native fullscreen element, the control's
// pseudo-fullscreen container, or <body> — with fixed viewport coordinates
// anchored to the trigger. While it is open it registers itself as a portal
// root (common/portalRoot), so the panel that owns the trigger counts a press
// on a row as its own instead of dismissing itself under the click. The panel is often shorter than the popup — the heatmap's layer row
// is one row tall until a layer is picked, LayerControl's content scrolls — so
// a popup living inside that clip box collapsed to a single option row, which
// is why it no longer lives there. Scrolling the panel re-pins the popup
// instead of dismissing it, so a long option list stays usable; one dropdown
// is open at a time. Same portal contract as createSchemePicker.
import { dom } from "#common/dom.js";
import { createLogger } from "#common/log.js";
import { registerPortalRoot } from "#common/portalRoot.js";

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

/** Vertical gap kept between the popup and the viewport edge. */
const POPUP_EDGE_GAP = 8;
/** Gap between the trigger and the popup, matching --foliplus-menu-gap so the
 *  in-flow (CSS margin) and the portalled (inline offset) popups agree. */
const POPUP_GAP = 4;
/** Rows the popup shows before it scrolls internally. */
const MAX_VISIBLE_ROWS = 8;
/** A popup with less room than this below flips above the trigger. */
const MIN_ROWS_BELOW = 2;

/** One option, mirroring the native `<option>` fields the panels already use. */
interface DropdownItem {
  value: string;
  label: string;
  disabled?: boolean;
  /** Native tooltip, mirroring SelectOption.title. */
  title?: string;
}
/** The three ARIA attributes shared by every option row (the dropdown's own
 *  rows and the scheme picker's). This is the ONLY part of the row contract
 *  that is genuinely identical between the two builders — data-*, disabled,
 *  the selected class and the click wiring all diverge by design (see the
 *  divergence note on renderOptions). Keep this helper to exactly these
 *  three attributes; folding in the divergent ones would make it a cfg soup.
 *  The element itself is created by the caller (button vs div), so the
 *  helper only paints the a11y contract both must satisfy. */
const applyOptionA11y = (el: HTMLElement, opts: { selected: boolean }): void => {
  el.setAttribute("role", "option");
  el.setAttribute("tabindex", "-1");
  el.setAttribute("aria-selected", opts.selected ? "true" : "false");
};

/** The popup-host contract: where an open popup mounts and how it hears that
 *  the covering surface changed. Consumers pass core/fullscreen's
 *  `dropdownSurface(scope)`; builders that create dropdowns on a consumer's
 *  behalf (core/rampForm, core/label) forward it untouched. */
interface DropdownSurface {
  resolveHost?: (() => HTMLElement | null) | null;
  onSurfaceChange?: ((cb: () => void) => () => void) | null;
}

interface DropdownOptions extends DropdownSurface {
  /** Bridged mode: the select the trigger replaces. Its options seed the
   *  popup and it stays mounted (hidden) as the value / change bridge. */
  nativeSelect?: HTMLSelectElement;
  /** Standalone mode: the option list. Ignored when `nativeSelect` is given. */
  items?: readonly DropdownItem[];
  /** Initial value (single) — standalone mode; bridged mode reads the select. */
  value?: string;
  /** Initial values (multiple) — standalone mode. */
  values?: readonly string[];
  multiple?: boolean;
  /** Trigger text when nothing is selected (multiple mode / empty list). */
  placeholder?: string;
  /** Take the first enabled item when nothing is selected. The opt-in for a
   *  surface whose field domain has no empty state — see the default rule in
   *  createDropdown: an empty value is a state, so this is never implicit for
   *  a bridged select. */
  defaultToFirst?: boolean;
  /** Accessible name; bridged mode defaults to the select's own aria-label. */
  ariaLabel?: string;
  /** Extra hook class, applied to the wrapper (same slot the select's own
   *  hook classes take, so width/flex rules keep applying). */
  className?: string;
  /** Extra attributes on the trigger (data-* seams for tests). */
  triggerAttributes?: Record<string, string>;
  /** Multi-select summary. Defaults to "<n> selected"; consumers pass their
   *  localized text / join separator. */
  selectedLabel?: (labels: readonly string[]) => string;
  /** Fired after a user pick (multiple mode also on every toggle). */
  onChange?: (value: string, values: readonly string[]) => void;
  /** Fired when the popup opens or closes. */
  onToggle?: (open: boolean, list: HTMLElement | null) => void;
}

interface Dropdown {
  /** Wrapper to mount: it replaces the native select in the form cell. */
  element: HTMLElement;
  trigger: HTMLButtonElement;
  getList(): HTMLElement | null;
  isOpen(): boolean;
  getValue(): string;
  getValues(): readonly string[];
  /** Set one value (single mode, or "replace the set" in multiple mode). */
  setValue(value: string): void;
  setValues(values: readonly string[]): void;
  /** Re-read options/value from the bridged select. */
  refresh(): void;
  /** Tooltip for the trigger. A non-empty hint wins over the label summary;
   *  consumers use it to explain a temporarily limited control. */
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
  list: HTMLElement;
  native: HTMLSelectElement | null;
  multiple: boolean;
  items: DropdownItem[];
  values: Set<string>;
  placeholder: string;
  /** Consumer-supplied tooltip; empty falls back to the label summary. */
  hint: string;
  selectedLabel: (labels: readonly string[]) => string;
  onChange: ((value: string, values: readonly string[]) => void) | null;
  onToggle: ((open: boolean, list: HTMLElement | null) => void) | null;
  resolveHost: (() => HTMLElement | null) | null;
  onSurfaceChange: ((cb: () => void) => () => void) | null;
  optionEls: HTMLButtonElement[];
  isOpen: boolean;
  destroyed: boolean;
  /** Close this popup without touching focus: used by the module to keep one
   *  open dropdown at a time when another opens. */
  closer: () => void;
  /** Popup-scope listeners; drained whenever the popup closes. */
  mountCleanup: (() => void)[];
  /** Release the popup node's portal-root registration; null while closed. */
  releasePortalRoot: (() => void) | null;
}

let idCounter = 0;
const nextListId = (): string => "foliplus-dropdown-list-" + String(++idCounter);

/** One dropdown per select: a second upgrade of the same element would stack
 *  two triggers and two `change` bridges on one control. */
const ownerMap = new WeakMap<HTMLSelectElement, Dropdown>();

/** Items read off a bridged select, so the popup always lists the options the
 *  panel currently renders (they are rebuilt whenever a layer/field changes). */
const nativeItemsOf = (select: HTMLSelectElement): DropdownItem[] =>
  Array.from(select.options).map(option => ({
    value: option.value,
    // A label-less <option> renders an empty row; the value is the only thing
    // the user could recognise it by, so it stands in (same as the browser's
    // own fallback for a missing label).
    label: option.textContent || option.value,
    ...(option.disabled ? { disabled: true } : {}),
    ...(option.title ? { title: option.title } : {}),
  }));

/** Where an open popup is mounted. The panel's own clip box is short — a
 *  heatmap panel is one row tall until a layer is picked, LayerControl's
 *  content scrolls — and a popup clamped to it collapses to a single option
 *  row, which is unusable. The list therefore leaves the panel: it mounts on
 *  the surface covering the trigger — native fullscreen, the control's
 *  pseudo-fullscreen container, or <body> — with fixed coordinates and re-pins
 *  on scroll/resize.
 *
 *  The host comes from the consumer's resolver (core/fullscreen owns the
 *  surface contract, including the scoping rule that keeps one map's overlay
 *  out of a sibling map's pseudo container) — this module sits below core/ and
 *  cannot import it. A body-level popup would otherwise sit behind the opaque
 *  pseudo/fullscreen surface, the same bug the scheme picker's injected
 *  resolveHost fixed for its list. */
const popupHost = (state: InternalState): HTMLElement =>
  state.resolveHost?.() ??
  (document.fullscreenElement as HTMLElement | null) ??
  document.body;

/** Space the popup may use, above and below the trigger, in viewport terms. */
const spaceAround = (trigger: HTMLElement): { below: number; above: number } => {
  const rect = trigger.getBoundingClientRect();
  return {
    below: window.innerHeight - rect.bottom - POPUP_EDGE_GAP,
    above: rect.top - POPUP_EDGE_GAP,
  };
};

/** The value(s) the control currently shows. */
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
    // A bridged select may carry a disabled empty-value row as its own
    // placeholder (the heatmap's layer prompt): show that label rather than a
    // blank trigger, which is what the native control did.
    const prompt = state.items.find(item => item.value === "");
    return prompt ? prompt.label : state.placeholder;
  }
  if (items.length === 1) return items[0].label;
  return state.selectedLabel(items.map(item => item.label));
};

const renderLabel = (state: InternalState): void => {
  const text = labelTextOf(state);
  state.labelEl.textContent = text;
  // Muted ink for "nothing selected", whatever label that state shows.
  state.trigger.classList.toggle(
    DROPDOWN_CLASSES.placeholder,
    selectedItems(state).length === 0,
  );
  // The trigger ellipsizes; the tooltip keeps the full label reachable without
  // opening the popup. A consumer hint (a control that is temporarily limited)
  // wins: it explains why the option set is restricted, which the label cannot.
  const full =
    state.hint ||
    selectedItems(state)
      .map(item => item.label)
      .join(", ");
  if (full) state.trigger.title = full;
  else state.trigger.removeAttribute("title");
};

/** Pin the popup to the trigger in viewport coordinates: below it when there
 *  is room for at least two rows, otherwise above it, and clamped to the room
 *  the viewport leaves. Fixed positioning is what makes the popup survive the
 *  panel's own scroll box; the row cap (MAX_VISIBLE_ROWS) keeps it scrollable
 *  inside instead of running off the screen. */
const positionList = (state: InternalState): void => {
  const list = state.list;
  list.style.maxHeight = "";
  list.classList.remove(DROPDOWN_CLASSES.up);

  const rect = state.trigger.getBoundingClientRect();
  const natural = list.getBoundingClientRect().height;
  const rowHeight = Math.max(24, ...state.optionEls.map(option => option.offsetHeight));
  const desired = Math.min(natural, rowHeight * MAX_VISIBLE_ROWS);
  const space = spaceAround(state.trigger);
  const fitsBelow = space.below >= Math.min(desired, rowHeight * MIN_ROWS_BELOW);
  const up = !fitsBelow && space.above > space.below;
  const height = Math.max(
    rowHeight,
    Math.min(desired, Math.max(up ? space.above : space.below, rowHeight)),
  );

  list.style.position = "fixed";
  list.style.right = "auto";
  list.style.left = String(rect.left) + "px";
  // Width follows the trigger, but a label must not be cut when the control's
  // own cell leaves room to grow: the closed trigger ellipsizes on purpose
  // (the row is fixed-width), while the popup is the place that spells the
  // value out. The cell is the wrapper's own parent — the popup is portalled,
  // so this is the only handle left on the space the panel reserved for this
  // control. Clamping to that edge keeps a long option list over the map and
  // never past the panel content box the control lives in.
  list.style.width = "max-content";
  const contentWidth = list.getBoundingClientRect().width;
  const cell = state.wrapper.parentElement;
  const room = cell ? cell.getBoundingClientRect().right - rect.left : rect.width;
  const width = Math.max(
    rect.width,
    Math.min(contentWidth, Math.max(rect.width, room)),
  );
  list.style.width = String(width) + "px";
  if (up) {
    list.style.top = "";
    list.style.bottom = String(window.innerHeight - rect.top + POPUP_GAP) + "px";
    list.classList.add(DROPDOWN_CLASSES.up);
  } else {
    list.style.bottom = "";
    list.style.top = String(rect.bottom + POPUP_GAP) + "px";
  }
  list.classList.add(DROPDOWN_CLASSES.portal);
  if (height < natural) list.style.maxHeight = String(Math.round(height)) + "px";
};

const focusOption = (state: InternalState, index: number): void => {
  const option = state.optionEls[index];
  if (!option) return;
  option.focus();
  // A clamped popup scrolls internally; keep the focused row visible.
  option.scrollIntoView?.({ block: "nearest", inline: "nearest" });
};

/** The first enabled row from `index`, walking in `step` direction and
 *  wrapping. -1 when every row is disabled (the cursor then stays put). */
const enabledFrom = (state: InternalState, index: number, step: 1 | -1): number => {
  const total = state.items.length;
  for (let offset = 0; offset < total; offset++) {
    const at = (((index + offset * step) % total) + total) % total;
    if (!state.items[at]?.disabled) return at;
  }
  return -1;
};

/** Home/End land on the first/last row that can actually be picked. A native
 *  select skips disabled options for those keys, and so must this listbox —
 *  otherwise the key parks focus on a row that ignores Enter. */
const focusEdge = (state: InternalState, edge: "start" | "end"): void => {
  const total = state.items.length;
  for (let offset = 0; offset < total; offset++) {
    const index = edge === "start" ? offset : total - 1 - offset;
    if (!state.items[index]?.disabled) {
      focusOption(state, index);
      return;
    }
  }
};

/** Index of the focused option, or -1 when focus is still on the trigger. */
const focusedIndex = (state: InternalState): number =>
  state.optionEls.findIndex(option => option === document.activeElement);

/** Move by `delta` rows, skipping disabled entries and wrapping around so the
 *  keyboard never parks on a row that cannot be picked. */
const stepFocus = (state: InternalState, delta: number): void => {
  const total = state.optionEls.length;
  if (total === 0) return;
  const start = focusedIndex(state);
  let index = start === -1 ? (delta > 0 ? -1 : 0) : start;
  for (let step = 0; step < total; step++) {
    index = (index + delta + total) % total;
    if (!state.items[index]?.disabled) {
      focusOption(state, index);
      return;
    }
  }
};

/** Write the user's pick through the bridged select (value + bubbling change)
 *  and/or the consumer callback. */
const commit = (state: InternalState): void => {
  const values = valuesOf(state);
  const value = state.multiple ? "" : (values[0] ?? "");
  state.onChange?.(value, values);
  if (state.native) {
    // Bubbles: panels that delegate `change` on their root keep working, and
    // the select's own handlers see the same event a native pick would fire.
    state.native.dispatchEvent(new Event("change", { bubbles: true }));
  }
};

const activate = (state: InternalState, index: number): void => {
  const item = state.items[index];
  if (!item || item.disabled) return;
  if (state.multiple) {
    if (state.values.has(item.value)) state.values.delete(item.value);
    else state.values.add(item.value);
    const selected = state.values.has(item.value);
    const option = state.optionEls[index];
    option?.setAttribute("aria-selected", selected ? "true" : "false");
    option?.classList.toggle(DROPDOWN_CLASSES.selected, selected);
    renderLabel(state);
    commit(state);
    return;
  }
  if (state.native) state.native.value = item.value;
  else state.values = new Set([item.value]);
  renderLabel(state);
  closeDropdown(state, { restoreFocus: true });
  commit(state);
};

// Deliberate divergence from common/schemePicker's row builder. The two
// builders share exactly one genuinely-identical piece — the ARIA contract
// that applyOptionA11y paints (role/tabindex/aria-selected) — and the
// keyboard contract (Home/End/arrow skip disabled rows, Escape, Tab close;
// see schemePicker's focusables()). Everything else diverges by design and
// is deliberately NOT folded into a shared helper:
//
//  - element: <button type=button> vs <div> (scheme)
//  - disabled: native disabled attr (skips tab order, cannot fire click)
//    vs aria-disabled=true (still focusable, activate is a no-op)
//  - data key: data-value vs data-scheme-name
//  - selected class: foliplus-is-selected vs foliplus-is-active
//  - click wiring: activate(index) with no guard (a disabled button cannot
//    fire) vs stopPropagation + disabled guard + selectScheme
//  - trigger: a module-owned label button vs the scheme picker's
//    consumer-drawn color bar — no shared trigger shape, so the dropdown
//    keeps its own open/step focus handling.
//
// If you change the row shape here, mirror the intent in schemePicker's
// buildDropdown — not a shared abstraction.
const renderOptions = (state: InternalState): void => {
  state.list.textContent = "";
  const selected = new Set(valuesOf(state));
  state.optionEls = state.items.map((item, index) => {
    const option = dom.el(
      "button",
      {
        type: "button",
        class: DROPDOWN_CLASSES.option,
        "data-value": item.value,
        ...(item.disabled ? { disabled: "" } : {}),
        ...(item.title ? { title: item.title } : {}),
      },
      dom.el("span", { class: DROPDOWN_CLASSES.optionLabel }, item.label),
    ) as HTMLButtonElement;
    applyOptionA11y(option, { selected: selected.has(item.value) });
    option.classList.toggle(DROPDOWN_CLASSES.selected, selected.has(item.value));
    option.addEventListener("click", () => activate(state, index));
    return option;
  });
  state.list.append(...state.optionEls);
};

const syncFromNative = (state: InternalState): void => {
  if (!state.native) return;
  state.items = nativeItemsOf(state.native);
  state.values = new Set(state.native.value === "" ? [] : [state.native.value]);
};

const closeDropdown = (
  state: InternalState,
  opts?: { restoreFocus?: boolean },
): void => {
  const wasOpen = state.isOpen;
  state.isOpen = false;
  const openIndex = openStates.indexOf(state);
  if (openIndex >= 0) openStates.splice(openIndex, 1);
  state.list.hidden = true;
  state.list.classList.remove(DROPDOWN_CLASSES.up, DROPDOWN_CLASSES.portal);
  state.list.style.maxHeight = "";
  state.trigger.classList.remove(DROPDOWN_CLASSES.open);
  state.trigger.setAttribute("aria-expanded", "false");
  state.trigger.removeAttribute("aria-activedescendant");
  state.mountCleanup.forEach(fn => fn());
  state.mountCleanup = [];
  // Drop the portal-root registration with the popup: while it is live the
  // panel dismiss predicates must treat a press on it as their own.
  state.releasePortalRoot?.();
  state.releasePortalRoot = null;
  // The popup goes back into the wrapper when it is closed: the open state is
  // the only one that has to escape the panel's clip box.
  if (state.list.parentElement !== state.wrapper) state.wrapper.append(state.list);
  if (wasOpen && opts?.restoreFocus !== false) state.trigger.focus();
  if (wasOpen) state.onToggle?.(false, null);
};

/** Open popups, newest last. One at a time: two portalled lists on <body>
 *  would stack z-index on each other and orphan the older node. */
const openStates: InternalState[] = [];

const openDropdown = (
  state: InternalState,
  focusIndex = -1,
  focusStep: 1 | -1 = 1,
): void => {
  if (state.destroyed || state.isOpen) return;
  for (const other of [...openStates]) {
    if (other !== state && other.isOpen) other.closer?.();
  }
  openStates.push(state);
  if (state.native) syncFromNative(state);
  renderOptions(state);
  renderLabel(state);
  // Mount on the portal host *before* unhiding so the first measurement has a
  // laid-out box to read (a detached list reports 0×0).
  const host = popupHost(state);
  if (state.list.parentElement !== host) host.appendChild(state.list);
  state.list.hidden = false;
  // Register the popup as part of *this* overlay while it is on screen, keyed
  // by its trigger, so a press on a row is not classified "outside" by the
  // panel that owns that trigger and stays outside every other panel.
  state.releasePortalRoot = registerPortalRoot(state.list, state.trigger);
  state.isOpen = true;
  state.trigger.classList.add(DROPDOWN_CLASSES.open);
  state.trigger.setAttribute("aria-expanded", "true");
  positionList(state);

  // Dismiss on any press outside the control. Capture phase, so the press
  // closes the popup before the element under it reacts.
  const onOutsidePress = (event: Event): void => {
    const target = event.target as Node | null;
    if (!target) return;
    // The popup is portalled out of the wrapper, so it is its own hit area.
    if (state.wrapper.contains(target) || state.list.contains(target)) return;
    closeDropdown(state, { restoreFocus: false });
  };
  document.addEventListener("pointerdown", onOutsidePress, true);
  state.mountCleanup.push(() =>
    document.removeEventListener("pointerdown", onOutsidePress, true),
  );

  // The popup is pinned to the trigger in viewport coordinates, so a scroll of
  // the panel (or of any clip box) has to re-pin it rather than dismiss it —
  // dismissing was what made a long option list unusable: the list's own
  // scroll box and focusOption's scrollIntoView fire the same event. A scroll
  // *inside* the list moves nothing the anchor cares about, so it is skipped.
  const reposition = (event: Event): void => {
    const target = event.target;
    if (target instanceof Node) {
      if (state.list === target || state.list.contains(target)) return;
    }
    positionList(state);
  };
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition, { passive: true });
  // The covering surface can change under an open popup — native fullscreen
  // entering/exiting, or the control's pseudo-fullscreen fallback (a class
  // toggle that emits no fullscreenchange). Re-seat and re-pin instead of
  // leaving the node on a host that is about to be covered.
  const reseat = (): void => {
    if (!state.isOpen) return;
    const nextHost = popupHost(state);
    if (state.list.parentElement !== nextHost) nextHost.appendChild(state.list);
    positionList(state);
  };
  const unsubscribeSurface = state.onSurfaceChange
    ? state.onSurfaceChange(reseat)
    : (() => {
        document.addEventListener("fullscreenchange", reseat);
        return () => document.removeEventListener("fullscreenchange", reseat);
      })();
  state.mountCleanup.push(() => {
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
    unsubscribeSurface();
  });

  // Escape belongs to the popup while it is open — the popup is the topmost
  // surface, so the key must not reach the panel underneath. The panel
  // dispatcher (#783) listens on document *capture*, so a bubble-phase
  // handler here would lose: this listener sits on window capture, which runs
  // before any document capture listener and stops the event there. The
  // second Escape reaches the panel (this listener dies with the popup).
  //
  // Why claiming the key here cannot steal an Escape from a higher-priority
  // surface (core/overlayRegistry's ESC_PRIORITY, LAYER_RENAME at 900): a
  // rename session ends on the next real pointer press outside it — including
  // a press on any other panel (measured: the rename input leaves the DOM and
  // focus returns to the row). A popup only exists inside a panel, and opening
  // that panel or pressing anywhere else already ended the rename, so no
  // surface ranked above this popup can be live at the same time. Guard tests
  // pin both paths (test_dropdown_panel.py: opening the style drawer, and a
  // real press on the heatmap panel, each end the rename).
  const onEscapeCapture = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    closeDropdown(state, { restoreFocus: true });
  };
  window.addEventListener("keydown", onEscapeCapture, true);
  state.mountCleanup.push(() =>
    window.removeEventListener("keydown", onEscapeCapture, true),
  );

  if (focusIndex >= 0) {
    // Opening with an arrow key lands on the first enabled row in that
    // direction, the way a native select skips its disabled options.
    const index = enabledFrom(state, focusIndex, focusStep);
    if (index >= 0) focusOption(state, index);
  }
  state.onToggle?.(true, state.list);
};

/** Trigger keys. Enter/Space are the button's own activation (they fire the
 *  click that toggles), so only the list-navigation keys are claimed here. */
const onTriggerKeyDown = (state: InternalState, event: KeyboardEvent): void => {
  const key = event.key;
  if (key === "ArrowDown" || key === "ArrowUp") {
    event.preventDefault();
    event.stopPropagation();
    if (state.isOpen) {
      stepFocus(state, key === "ArrowDown" ? 1 : -1);
      return;
    }
    openDropdown(
      state,
      key === "ArrowDown" ? 0 : Math.max(0, state.items.length - 1),
      key === "ArrowDown" ? 1 : -1,
    );
    return;
  }
  if ((key === "Home" || key === "End") && state.isOpen) {
    event.preventDefault();
    event.stopPropagation();
    focusEdge(state, key === "Home" ? "start" : "end");
  }
  // Escape is not handled here: an open popup claims it on window capture
  // (see openDropdown), which outranks the document-capture panel dispatcher.
};

const onListKeyDown = (state: InternalState, event: KeyboardEvent): void => {
  const key = event.key;
  if (key === "ArrowDown" || key === "ArrowUp") {
    event.preventDefault();
    event.stopPropagation();
    stepFocus(state, key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (key === "Home" || key === "End") {
    event.preventDefault();
    event.stopPropagation();
    focusEdge(state, key === "Home" ? "start" : "end");
    return;
  }
  if (key === " " || key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    const index = focusedIndex(state);
    if (index >= 0) activate(state, index);
    return;
  }
  if (key === "Tab") {
    // Tab leaves the control. Returning focus to the trigger first is what
    // makes the browser's own Tab handling continue from the control instead
    // of from the row that is about to be hidden: the focused row lives in the
    // portal, and hiding it drops focus on <body>, which restarts the next Tab
    // from the top of the page. No preventDefault — the default movement after
    // this handler is the one that should happen, it just needs the trigger as
    // its starting point (the same shape as leaving a native select).
    closeDropdown(state, { restoreFocus: true });
  }
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
  const wrapper = dom.el("div", { class: DROPDOWN_CLASSES.wrapper });
  const trigger = dom.el("button", {
    type: "button",
    class: "foliplus-form-select " + DROPDOWN_CLASSES.trigger,
    "aria-haspopup": "listbox",
    "aria-expanded": "false",
  }) as HTMLButtonElement;
  const labelEl = dom.el("span", { class: DROPDOWN_CLASSES.label });
  trigger.appendChild(labelEl);

  const listId = nextListId();
  const list = dom.el("div", {
    id: listId,
    class: DROPDOWN_CLASSES.list,
    role: "listbox",
    ...(multiple ? { "aria-multiselectable": "true" } : {}),
  });
  list.hidden = true;
  trigger.setAttribute("aria-controls", listId);
  // The popup is portalled out of the trigger's subtree, so the accessibility
  // tree needs an explicit owner link: aria-controls alone describes "what it
  // operates", aria-owns keeps the listbox inside the trigger's subtree for a
  // screen reader. Both stay in sync with the same id.
  trigger.setAttribute("aria-owns", listId);

  // The wrapper is the layout box (it replaces the select in the form cell),
  // so a sizing hook such as `foliplus-classes-select` belongs on it. The
  // select keeps its own classes and data-* (consumers and the Python-rendered
  // markup query those); they are not copied here, or a `querySelector` for a
  // hook class would start returning the wrapper instead of the select.
  if (opts.className) wrapper.classList.add(opts.className);

  const nativeLabel = native?.getAttribute("aria-label") ?? "";
  const ariaLabel = opts.ariaLabel ?? nativeLabel;
  if (ariaLabel) trigger.setAttribute("aria-label", ariaLabel);
  // One accessible name per control: the trigger carries it and the hidden
  // select drops its own copy. Otherwise the row exposes two names for one
  // value and a screen reader (or a panel test counting aria-labels) sees
  // the control twice.
  native?.removeAttribute("aria-label");
  for (const [name, value] of Object.entries(opts.triggerAttributes ?? {})) {
    trigger.setAttribute(name, value);
  }

  const state: InternalState = {
    wrapper,
    trigger,
    labelEl,
    list,
    native,
    multiple,
    items: opts.items ? [...opts.items] : [],
    values: new Set(opts.values ?? (opts.value ? [opts.value] : [])),
    placeholder: opts.placeholder ?? "",
    hint: "",
    selectedLabel:
      opts.selectedLabel ?? (labels => String(labels.length) + " selected"),
    onChange: opts.onChange ?? null,
    onToggle: opts.onToggle ?? null,
    resolveHost: opts.resolveHost ?? null,
    onSurfaceChange: opts.onSurfaceChange ?? null,
    optionEls: [],
    isOpen: false,
    destroyed: false,
    closer: () => undefined,
    mountCleanup: [],
    releasePortalRoot: null,
  };

  state.closer = () => closeDropdown(state, { restoreFocus: false });

  wrapper.append(trigger);
  if (native) {
    wrapper.classList.add(DROPDOWN_CLASSES.nativeHost);
    native.hidden = true;
    native.tabIndex = -1;
    native.setAttribute("aria-hidden", "true");
    // Bridged: the select keeps its own data-* / hook classes; it only stays
    // mounted so the panel's delegated handlers and the `change` contract
    // keep pointing at a real element. Move it inside the wrapper so the
    // wrapper can replace it in one swap.
    const parent = native.parentNode;
    if (parent) parent.insertBefore(wrapper, native);
    wrapper.append(native);
    // A programmatic `change` (tests, a preset loader, another control) is the
    // one signal we get that the select moved: re-read it.
    native.addEventListener("change", () => refresh());
  }
  wrapper.append(list);

  if (native) syncFromNative(state);

  // Empty is a state, not "uninitialized": a trigger with nothing selected
  // keeps showing its placeholder (or nothing) unless the field domain behind
  // it has no empty state to show. The standalone single-select without a
  // placeholder is that case by construction — there is no prompt to show and
  // nothing behind an empty pick — so it opens on its first enabled item. A
  // declared placeholder (the filter's "Any") and every multi-select keep the
  // empty state: auto-picking there would silently filter the data. A bridged
  // select never takes this branch either — its empty value is whatever the
  // native select reports, and in the heatmap that is a real state ("no source
  // picked yet"), so a bridged surface whose domain truly has no empty state
  // has to say so with `defaultToFirst`.
  if (!state.multiple && state.values.size === 0) {
    const takeFirst = opts.defaultToFirst ?? (!native && !opts.placeholder);
    const first = takeFirst && state.items.find(item => !item.disabled);
    if (first) {
      state.values = new Set([first.value]);
      // The native select is the value carrier in bridged mode: leaving it on
      // "" would make the next refresh read the empty value back and undo the
      // pick.
      if (native) native.value = first.value;
    }
  }

  renderLabel(state);

  const onTriggerClick = (): void => {
    if (state.destroyed) return;
    if (state.isOpen) closeDropdown(state, { restoreFocus: false });
    else openDropdown(state);
  };

  const onTriggerKey = (event: KeyboardEvent): void => onTriggerKeyDown(state, event);
  const onListKey = (event: KeyboardEvent): void => onListKeyDown(state, event);

  trigger.addEventListener("click", onTriggerClick);
  trigger.addEventListener("keydown", onTriggerKey);
  list.addEventListener("keydown", onListKey);

  const refresh = (): void => {
    if (state.destroyed) return;
    // Standalone dropdowns own their items: syncFromNative is a no-op there
    // (its own guard), so one call covers both modes.
    syncFromNative(state);
    renderLabel(state);
    if (state.isOpen) {
      renderOptions(state);
      positionList(state);
    }
  };

  const dropdown: Dropdown = {
    element: wrapper,
    trigger,
    getList: () => (state.destroyed ? null : state.list),
    isOpen: () => state.isOpen,
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
      if (state.isOpen) renderOptions(state);
    },
    refresh,
    setHint(text: string) {
      if (state.destroyed) return;
      state.hint = text;
      renderLabel(state);
    },
    open() {
      if (state.destroyed) return;
      openDropdown(state);
    },
    close(closeOpts) {
      if (state.destroyed) return;
      closeDropdown(state, closeOpts);
    },
    toggle() {
      if (state.destroyed) return;
      if (state.isOpen) closeDropdown(state, { restoreFocus: false });
      else openDropdown(state);
    },
    destroy() {
      if (state.destroyed) return;
      closeDropdown(state, { restoreFocus: false });
      state.destroyed = true;
      trigger.removeEventListener("click", onTriggerClick);
      trigger.removeEventListener("keydown", onTriggerKey);
      list.removeEventListener("keydown", onListKey);
      list.remove();
      if (native) ownerMap.delete(native);
    },
  };

  if (native) ownerMap.set(native, dropdown);
  return dropdown;
};

/** The dropdown bridged to a select, if any. A consumer that writes
 *  `select.value` programmatically calls this so the closed trigger follows
 *  (the dropdown cannot see a property write, only a `change` event). */
const dropdownOf = (select: HTMLSelectElement): Dropdown | null =>
  ownerMap.get(select) ?? null;

export { applyOptionA11y, createDropdown, dropdownOf };
export type { Dropdown, DropdownSurface };

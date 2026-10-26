// Shared colour-scheme picker — a trigger bar + dropdown listbox with
// keyboard navigation, outside-click dismissal, focus management, and
// colour-bar preview.
//
// Consumers pass a trigger element (the bar they already render) and the
// picker owns the dropdown lifecycle, keyboard handlers, outside-click,
// focus return, hidden-select sync, and colour-bar drawing.
//
// Does NOT import any Heatmap or LayerControl module.
import { dom } from "#common/dom.js";
import { createLogger } from "#common/log.js";

// Thrown messages carry the same `[schemePicker]` prefix as every other
// foliplus diagnostic (shared modules name themselves, not a CONFIG component).
const log = createLogger("schemePicker");

// ── Class-name defaults ────────────────────────────────────────────────

const DEFAULT_CLASSES = {
  open: "foliplus-scheme-picker-open",
  dropdown: "foliplus-scheme-picker-dropdown",
  item: "foliplus-scheme-picker-item",
  bar: "foliplus-scheme-picker-bar",
  block: "foliplus-scheme-picker-block",
  active: "foliplus-is-active",
} as const;

// Extra class on a portaled dropdown only. A portaled dropdown lives outside
// the panel that opened it, so it has to paint above that panel — while an
// inline dropdown stays inside the trigger's own stacking context and needs no
// lift. The class is what the stylesheet keys the z band off, so the JS keeps
// its distance from z numbers.
const PORTAL_CLASS = "foliplus-scheme-picker-portal";

/** Selector for a portaled dropdown, for `closest()`-style ownership checks.
 *  The panel dismiss predicates match it through `core/overlay`'s
 *  `isInsideOverlay`, so a press on the portalled list counts as a press
 *  inside the panel that opened the picker. */
const SCHEME_PICKER_PORTAL_SELECTOR = `.${PORTAL_CLASS}`;

interface SchemePickerClasses {
  open: string;
  dropdown: string;
  item: string;
  bar: string;
  block: string;
  active: string;
}

interface SchemePickerOptions {
  trigger: HTMLElement;
  hiddenSelect?: HTMLSelectElement;
  schemes: readonly string[];
  value: string;
  numClasses: number;
  onChange: (name: string) => void;
  classes?: Partial<SchemePickerClasses>;
  portal: boolean;
  /** Called when the dropdown opens or closes, with the dropdown element
   *  (or null when closed). Useful for consumers that need to track the
   *  dropdown reference (e.g. for test assertions). */
  onToggle?: (open: boolean, dropdown: HTMLElement | null) => void;
  /** Colour-scale resolver: returns an array of `n` hex colours for a
   *  scheme name.  Injected by the consumer so the picker stays free of
   *  core/ imports. */
  colorScale: (name: string, n: number) => string[];
  /** Accessible name for the trigger. Consumers pass their localized text
   *  (e.g. `T("scheme")`); the factory stays locale-free. */
  label?: string;
}

interface SchemePicker {
  /** Set the selected scheme without closing the dropdown or triggering
   *  onChange. Use to programmatically update the display. */
  setValue(name: string): void;
  /** Select a scheme: close the dropdown, update all DOM, and call onChange. */
  selectScheme(name: string): void;
  /** Update the number of classes and redraw all colour bars. */
  setNumClasses(n: number): void;
  /** Redraw colour bars in an open dropdown (e.g. after numClasses changes). */
  refresh(): void;
  /** Toggle the dropdown open/close. */
  toggle(): void;
  /** Close the dropdown.  Set restoreFocus to false when the close was
   *  triggered by outside-click, data-clear, or destroy — those should
   *  not yank the user's focus back to the trigger. */
  close(opts?: { restoreFocus?: boolean }): void;
  /** Get the current dropdown element (null when closed). */
  getDropdown(): HTMLElement | null;
  /** Destroy all listeners, timers, and DOM elements. */
  destroy(): void;
}

// Module-level counter for stable dropdown/item ids (avoids Math.random()
// churn that makes aria-activedescendant values jump between snapshots).
let idCounter = 0;
const nextId = (prefix: string): string => `${prefix}-${++idCounter}`;

// Owner map: prevents two pickers from binding the same trigger (which
// would cause double-dropdowns on a single click).  A consumer that
// needs to re-create the picker must destroy the old one first.
const ownerMap = new WeakMap<HTMLElement, SchemePicker>();

// ── Internal state ─────────────────────────────────────────────────────

interface InternalState {
  classes: SchemePickerClasses;
  trigger: HTMLElement;
  hiddenSelect: HTMLSelectElement | null;
  schemes: readonly string[];
  numClasses: number;
  onChange: (name: string) => void;
  onToggle: ((open: boolean, dropdown: HTMLElement | null) => void) | null;
  portal: boolean;
  value: string;
  dropdown: HTMLElement | null;
  items: HTMLElement[];
  isOpen: boolean;
  /** True after destroy() — all public methods become no-ops. */
  destroyed: boolean;
  colorScale: (name: string, n: number) => string[];
  /** Lifecycle-scope listeners (trigger click/keydown) — drained on destroy(). */
  cleanupFns: (() => void)[];
  /** Mount-scope listeners (outside-click, scroll, fullscreen, item focus) —
   *  drained on every closeDropdown() so repeated open/close cycles don't leak. */
  mountCleanupFns: (() => void)[];
}

// ── Inner-element lookup ──────────────────────────────────────────────

const getInner = (trigger: HTMLElement): HTMLElement | null => {
  const el =
    trigger.querySelector("[data-scheme-bar-inner]") ?? trigger.firstElementChild;
  return el instanceof HTMLElement ? el : null;
};

// ── Colour-bar renderer ────────────────────────────────────────────────

const renderColorBar = (
  container: HTMLElement,
  name: string,
  numClasses: number,
  blockClass: string,
  colorScale: (name: string, n: number) => string[],
) => {
  let colors: string[];
  try {
    colors = colorScale(name, numClasses);
  } catch {
    // Same value as core/palette's SCHEME_FALLBACK_COLOR but injected by
    // the consumer; the shared component must not import core/.
    colors = Array(numClasses).fill("#999");
  }
  container.innerHTML = "";
  for (const color of colors) {
    dom.el("div", {
      class: blockClass,
      style: `background:${color};width:${(100 / colors.length).toFixed(4)}%`,
      parent: container,
    });
  }
};

// ── Dropdown builder ───────────────────────────────────────────────────

const buildDropdown = (state: InternalState): HTMLElement => {
  const { classes, schemes, numClasses, value } = state;

  const dropdown = dom.el("div", {
    class: classes.dropdown,
    role: "listbox",
  });

  const items: HTMLElement[] = [];

  schemes.forEach(name => {
    const item = dom.el("div", {
      class: classes.item,
      role: "option",
      tabindex: "-1",
      "data-scheme-name": name,
      "aria-selected": String(name === value),
      parent: dropdown,
    });

    if (name === value) {
      item.classList.add(classes.active);
    }

    const bar = dom.el("div", {
      class: classes.bar,
      parent: item,
    });
    renderColorBar(bar, name, numClasses, classes.block, state.colorScale);
    item.title = name;

    item.addEventListener("click", (event: MouseEvent) => {
      event.stopPropagation();
      selectScheme(state, name);
    });

    items.push(item);
  });

  state.items = items;

  // ── Dropdown keyboard handler ──

  const onKeydown = (event: KeyboardEvent) => {
    const key = event.key;
    const idx = state.items.indexOf(document.activeElement as HTMLElement);

    if (key === "ArrowDown" || key === "Down") {
      event.preventDefault();
      event.stopPropagation();
      const next = state.items.length > 0 ? (idx + 1) % state.items.length : 0;
      state.items[next]?.focus();
    } else if (key === "ArrowUp" || key === "Up") {
      event.preventDefault();
      event.stopPropagation();
      const prev =
        state.items.length > 0
          ? (idx - 1 + state.items.length) % state.items.length
          : 0;
      state.items[prev]?.focus();
    } else if (key === "Home") {
      event.preventDefault();
      event.stopPropagation();
      state.items[0]?.focus();
    } else if (key === "End") {
      event.preventDefault();
      event.stopPropagation();
      state.items[state.items.length - 1]?.focus();
    } else if (key === "Enter" || key === " ") {
      event.preventDefault();
      event.stopPropagation();
      const active = document.activeElement as HTMLElement;
      const activeIdx = state.items.indexOf(active);
      if (activeIdx >= 0) {
        const name = active.getAttribute("data-scheme-name");
        if (name) selectScheme(state, name);
      }
    } else if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeDropdown(state);
    }
  };

  dropdown.addEventListener("keydown", onKeydown);
  state.mountCleanupFns.push(() => dropdown.removeEventListener("keydown", onKeydown));

  return dropdown;
};

// ── Mount / unmount dropdown ───────────────────────────────────────────

const getPortalHost = (): HTMLElement =>
  (document.fullscreenElement as HTMLElement) ?? document.body;

const mountDropdown = (state: InternalState) => {
  const dropdown = buildDropdown(state);
  state.dropdown = dropdown;

  if (state.portal) {
    dropdown.style.position = "fixed";
    dropdown.style.visibility = "hidden";
    dropdown.classList.add(PORTAL_CLASS);
    const host = getPortalHost();
    host.appendChild(dropdown);
    // Measure after append — detached elements report 0×0.
    positionDropdown(state, dropdown);
    dropdown.style.visibility = "";
    // Keep the dropdown pinned when the host element changes (fullscreen
    // enter/exit). Every listener below is mount-scoped (drained on close), so
    // the dropdown is open whenever it runs — no "still open" guard needed.
    const onFullscreen = () => {
      const target = getPortalHost();
      if (dropdown.parentElement !== target) {
        target.appendChild(dropdown);
      }
      positionDropdown(state, dropdown);
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    state.mountCleanupFns.push(() =>
      document.removeEventListener("fullscreenchange", onFullscreen),
    );
    // Re-pin on a trigger scroll or a window resize. Portal-only: inline mode
    // is anchored by CSS, so it needs neither listener.
    const reposition = () => positionDropdown(state, dropdown);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    state.mountCleanupFns.push(() => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    });
  } else {
    // Inline mode: mount into the trigger's parent (schemeControlWrap)
    const parent =
      state.trigger.closest(".foliplus-form-control") ??
      state.trigger.parentElement ??
      state.trigger;
    parent.appendChild(dropdown);
  }

  state.isOpen = true;
  state.trigger.classList.add(state.classes.open);
  state.trigger.setAttribute("aria-expanded", "true");

  // Stable id for aria-controls (counter, not Math.random).
  const id = nextId("foliplus-scheme-dropdown");
  dropdown.id = id;
  state.trigger.setAttribute("aria-controls", id);

  // Update aria-activedescendant to the currently focused item
  const updateActiveDescendant = () => {
    const active = document.activeElement as HTMLElement;
    if (state.items.includes(active)) {
      // Items always carry a generated id (assigned below).
      state.trigger.setAttribute("aria-activedescendant", active.id);
    }
  };
  state.items.forEach(item => {
    item.id = nextId("foliplus-scheme-item");
    item.addEventListener("focus", updateActiveDescendant);
    state.mountCleanupFns.push(() =>
      item.removeEventListener("focus", updateActiveDescendant),
    );
  });

  // Outside-click handler — does NOT restore focus (user clicked elsewhere).
  const onDocClick = (event: MouseEvent) => {
    if (
      state.dropdown &&
      !state.trigger.contains(event.target as Node) &&
      !state.dropdown.contains(event.target as Node)
    ) {
      closeDropdown(state, { restoreFocus: false });
    }
  };
  document.addEventListener("click", onDocClick);
  state.mountCleanupFns.push(() => document.removeEventListener("click", onDocClick));

  // Focus the selected item now that the dropdown is in the DOM and all
  // listeners are installed. Doing this before append leaves the focus on the
  // trigger, which breaks keyboard navigation. `findIndex` is -1 only if a
  // future consumer supplies items without the active class; `Math.max` folds
  // that into the first row without a second condition.
  if (state.items.length > 0) {
    const activeIdx = Math.max(
      0,
      state.items.findIndex(item => item.classList.contains(state.classes.active)),
    );
    state.items[activeIdx].focus();
  }

  state.onToggle?.(true, dropdown);
};

/** Pin a portal dropdown under its trigger. Portal-only: inline mode is
 *  anchored by the trigger's own CSS, so it never calls this. */
const positionDropdown = (state: InternalState, dropdown: HTMLElement) => {
  const rect = state.trigger.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Set an explicit width (trigger width) so the dropdown does not inherit the
  // portal host's width (e.g. document.body = 100%).
  dropdown.style.width = `${rect.width}px`;
  const dropdownRect = dropdown.getBoundingClientRect();

  let top = rect.bottom;
  let left = rect.left;

  // Clamp right edge
  if (left + dropdownRect.width > vw - 8) {
    left = Math.max(8, vw - dropdownRect.width - 8);
  }
  // Clamp bottom edge — flip above if needed
  if (top + dropdownRect.height > vh - 8) {
    top = rect.top - dropdownRect.height - 4;
    if (top < 8) top = 8;
  }

  dropdown.style.top = `${top}px`;
  dropdown.style.left = `${left}px`;
};

const closeDropdown = (state: InternalState, opts?: { restoreFocus?: boolean }) => {
  const wasOpen = state.isOpen;
  if (state.dropdown) {
    state.dropdown.remove();
    state.dropdown = null;
  }
  state.items = [];
  state.isOpen = false;
  state.trigger.classList.remove(state.classes.open);
  state.trigger.setAttribute("aria-expanded", "false");
  state.trigger.removeAttribute("aria-activedescendant");
  // Only restore focus if the dropdown was actually open (close() on an
  // already-closed picker must not steal focus from the user's current
  // target).  Keyboard-initiated closes (Escape, Enter, select) pass
  // restoreFocus: true; outside-click and data-clear pass false.
  if (wasOpen && opts?.restoreFocus !== false) {
    state.trigger.focus();
  }
  // Drain mount-scope listeners (outside-click, scroll, fullscreen, item focus).
  // Lifecycle listeners (trigger click/keydown) stay until destroy().
  state.mountCleanupFns.forEach(fn => fn());
  state.mountCleanupFns = [];
  if (wasOpen) {
    state.onToggle?.(false, null);
  }
};

// ── Scheme selection ───────────────────────────────────────────────────

const selectScheme = (state: InternalState, name: string) => {
  state.value = name;

  // Sync hidden select
  if (state.hiddenSelect) {
    state.hiddenSelect.value = name;
  }

  // Update trigger's title
  state.trigger.title = name;

  // Redraw the trigger's colour bar (the trigger's inner element)
  const barInner = getInner(state.trigger);
  if (barInner) {
    renderColorBar(
      barInner,
      name,
      state.numClasses,
      state.classes.block,
      state.colorScale,
    );
  }

  // Update dropdown items: move active class
  state.items.forEach(item => {
    const isSelected = item.getAttribute("data-scheme-name") === name;
    item.classList.toggle(state.classes.active, isSelected);
    item.setAttribute("aria-selected", String(isSelected));
  });

  // Close dropdown
  closeDropdown(state);

  // Notify consumer
  state.onChange(name);
};

// ── Trigger keyboard handler ───────────────────────────────────────────

const setupTriggerKeydown = (state: InternalState) => {
  const onKeydown = (event: KeyboardEvent) => {
    const key = event.key;
    if (state.isOpen) return; // dropdown handles keys when open

    if (key === "ArrowUp" || key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      const schemes = state.schemes;
      const idx = schemes.indexOf(state.value);
      if (key === "ArrowUp" && idx > 0) {
        selectScheme(state, schemes[idx - 1]);
      } else if (key === "ArrowDown" && idx < schemes.length - 1) {
        selectScheme(state, schemes[idx + 1]);
      }
    } else if (key === "Enter" || key === " ") {
      event.preventDefault();
      event.stopPropagation();
      mountDropdown(state);
    }
  };

  state.trigger.addEventListener("keydown", onKeydown);
  state.cleanupFns.push(() => state.trigger.removeEventListener("keydown", onKeydown));
};

// ── Open / toggle ──────────────────────────────────────────────────────

const toggleDropdown = (state: InternalState) => {
  if (state.isOpen) {
    closeDropdown(state);
  } else {
    mountDropdown(state);
  }
};

// ── Refresh ────────────────────────────────────────────────────────────

const refreshDropdown = (state: InternalState) => {
  if (!state.dropdown) return;
  state.items.forEach(item => {
    const name = item.getAttribute("data-scheme-name");
    if (!name) return;
    // The bar class may be a concatenation of default + consumer classes,
    // so use [class~='default'] to match any element with the default class.
    const barClass = DEFAULT_CLASSES.bar;
    const bar = item.querySelector(`[class~='${barClass}']`) as HTMLElement | null;
    if (bar) {
      renderColorBar(
        bar,
        name,
        state.numClasses,
        state.classes.block,
        state.colorScale,
      );
    }
  });
};

// ── Factory ────────────────────────────────────────────────────────────

const createSchemePicker = (options: SchemePickerOptions): SchemePicker => {
  // Guard against double-binding: one trigger = one picker.
  const existing = ownerMap.get(options.trigger);
  if (existing) {
    throw new Error(
      log.msg("this trigger already has an active picker — call destroy() first"),
    );
  }
  // Validate that value is in schemes (or schemes is empty, meaning any value is allowed).
  if (options.schemes.length > 0 && !options.schemes.includes(options.value)) {
    throw new RangeError(
      log.msg(
        `value "${options.value}" is not in schemes — add it to schemes or use a value from the list`,
      ),
    );
  }

  // Clamp numClasses to a valid positive integer (1–100).
  const numClasses = Math.max(1, Math.min(100, Math.round(options.numClasses) || 1));

  // Base structure classes are never replaced — consumer classes are additive
  // modifiers only. This prevents the CSS/DOM contract break that caused the
  // "custom colour bar + native select both visible" screenshot bug.
  const consumerClasses = options.classes ?? {};
  // The base class is never replaced, so a consumer can only add a modifier.
  const withModifier = (base: string, extra: string | undefined): string =>
    extra ? `${base} ${extra}` : base;
  const classes: SchemePickerClasses = {
    dropdown: withModifier(DEFAULT_CLASSES.dropdown, consumerClasses.dropdown),
    item: withModifier(DEFAULT_CLASSES.item, consumerClasses.item),
    bar: withModifier(DEFAULT_CLASSES.bar, consumerClasses.bar),
    block: withModifier(DEFAULT_CLASSES.block, consumerClasses.block),
    active: withModifier(DEFAULT_CLASSES.active, consumerClasses.active),
    open: consumerClasses.open ?? DEFAULT_CLASSES.open,
  };
  const state: InternalState = {
    classes,
    trigger: options.trigger,
    hiddenSelect: options.hiddenSelect ?? null,
    schemes: options.schemes,
    numClasses,
    onChange: options.onChange,
    onToggle: options.onToggle ?? null,
    portal: options.portal,
    colorScale: options.colorScale,
    value: options.value,
    dropdown: null,
    items: [],
    isOpen: false,
    destroyed: false,
    cleanupFns: [],
    mountCleanupFns: [],
  };

  // Populate hidden select — make it non-interactive (tabindex=-1, aria-hidden)
  // so it does not appear as an invisible Tab stop. It is a state mirror only.
  if (state.hiddenSelect) {
    state.hiddenSelect.innerHTML = "";
    options.schemes.forEach(name => {
      dom.el("option", { value: name, parent: state.hiddenSelect }, name);
    });
    state.hiddenSelect.value = options.value;
    state.hiddenSelect.setAttribute("tabindex", "-1");
    state.hiddenSelect.setAttribute("aria-hidden", "true");
  }

  // Set combobox a11y attributes on the trigger.
  // aria-label is required because the adjacent <label> cannot name a
  // <div role="combobox"> automatically (no `for` attribute). The consumer
  // injects the localized name; the factory carries no locale table.
  state.trigger.setAttribute("aria-haspopup", "listbox");
  state.trigger.setAttribute("aria-expanded", "false");
  if (
    !state.trigger.hasAttribute("aria-label") &&
    !state.trigger.hasAttribute("aria-labelledby")
  ) {
    state.trigger.setAttribute("aria-label", options.label ?? "Color scheme");
  }

  // Set initial trigger title and draw the colour bar
  state.trigger.title = options.value;
  const initialBarInner = getInner(state.trigger);
  if (initialBarInner) {
    // The clamped count, not the raw option: the first paint must match every
    // later setNumClasses redraw (and the dropdown rows built with it).
    renderColorBar(
      initialBarInner,
      options.value,
      numClasses,
      classes.block,
      options.colorScale,
    );
  }

  // Trigger click handler
  const onClick = (event: MouseEvent) => {
    event.stopPropagation();
    toggleDropdown(state);
  };
  state.trigger.addEventListener("click", onClick);
  state.cleanupFns.push(() => state.trigger.removeEventListener("click", onClick));

  // Trigger keyboard
  setupTriggerKeydown(state);
  // Register as the owner of this trigger
  const picker: SchemePicker = {
    setValue(name: string) {
      if (state.destroyed) return;
      // Validate that the new value is in schemes.
      if (state.schemes.length > 0 && !state.schemes.includes(name)) {
        throw new RangeError(
          log.msg(
            `value "${name}" is not in schemes — add it to schemes or use a value from the list`,
          ),
        );
      }
      state.value = name;
      if (state.hiddenSelect) state.hiddenSelect.value = name;
      state.trigger.title = name;
      // Redraw trigger colour bar
      const barInner = getInner(state.trigger);
      if (barInner) {
        renderColorBar(
          barInner,
          name,
          state.numClasses,
          classes.block,
          state.colorScale,
        );
      }
      // Update dropdown items if open
      state.items.forEach(item => {
        const isSelected = item.getAttribute("data-scheme-name") === name;
        item.classList.toggle(classes.active, isSelected);
        item.setAttribute("aria-selected", String(isSelected));
      });
    },

    selectScheme(name: string) {
      if (state.destroyed) return;
      // Skip onChange for same-value selection — just close and return focus.
      if (name === state.value) {
        closeDropdown(state, { restoreFocus: true });
        return;
      }
      selectScheme(state, name);
    },

    setNumClasses(n: number) {
      if (state.destroyed) return;
      const clamped = Math.max(1, Math.min(100, Math.round(n) || 1));
      if (clamped === state.numClasses) return;
      state.numClasses = clamped;
      // Redraw trigger bar
      const barInner = getInner(state.trigger);
      if (barInner) {
        renderColorBar(barInner, state.value, clamped, classes.block, state.colorScale);
      }
      // Redraw dropdown items
      refreshDropdown(state);
    },

    refresh() {
      if (state.destroyed) return;
      refreshDropdown(state);
    },

    toggle() {
      if (state.destroyed) return;
      toggleDropdown(state);
    },

    close(opts?: { restoreFocus?: boolean }) {
      if (state.destroyed) return;
      closeDropdown(state, opts);
    },

    getDropdown() {
      return state.destroyed ? null : state.dropdown;
    },

    destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      closeDropdown(state, { restoreFocus: false });
      state.cleanupFns.forEach(fn => fn());
      state.cleanupFns = [];
      state.items = [];
      state.dropdown = null;
      // Remove from owner map so a new picker can be created on this trigger.
      // This picker is the registered owner by construction (the factory
      // refuses a second one), so the delete needs no identity re-check.
      ownerMap.delete(state.trigger);
      // Fully clean up ARIA attributes so the trigger is indistinguishable
      // from its initial state (destroy, not just close).
      state.trigger.removeAttribute("aria-expanded");
      state.trigger.removeAttribute("aria-controls");
    },
  };
  ownerMap.set(options.trigger, picker);
  return picker;
};

export { SCHEME_PICKER_PORTAL_SELECTOR, createSchemePicker };
export type { SchemePicker };

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

// ── Class-name defaults ────────────────────────────────────────────────

const DEFAULT_CLASSES = {
  open: "foliplus-scheme-picker-open",
  dropdown: "foliplus-scheme-picker-dropdown",
  item: "foliplus-scheme-picker-item",
  bar: "foliplus-scheme-picker-bar",
  block: "foliplus-scheme-picker-block",
  active: "foliplus-is-active",
} as const;

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
  /** Close the dropdown and return focus to the trigger. */
  close(): void;
  /** Get the current dropdown element (null when closed). */
  getDropdown(): HTMLElement | null;
  /** Destroy all listeners, timers, and DOM elements. */
  destroy(): void;
}

// Module-level counter for stable dropdown/item ids (avoids Math.random()
// churn that makes aria-activedescendant values jump between snapshots).
let idCounter = 0;
const nextId = (prefix: string): string => prefix + "-" + ++idCounter;

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
      style: "background:" + color + ";width:" + (100 / colors.length).toFixed(4) + "%",
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

  let focusIdx = -1;
  const items: HTMLElement[] = [];

  schemes.forEach((name, idx) => {
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
      focusIdx = idx;
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
  if (items.length > 0) {
    const focusItem = focusIdx >= 0 ? items[focusIdx] : items[0];
    focusItem.focus();
  }

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
    positionDropdown(state);
    const host = getPortalHost();
    host.appendChild(dropdown);
    // Keep the dropdown pinned when the host element changes (fullscreen
    // enter/exit). We use a MutationObserver on the document for the
    // fullscreenchange event instead of a direct listener, so destroy
    // can clean it up.
    const onFullscreen = () => {
      if (state.dropdown && !state.isOpen) return;
      const target = getPortalHost();
      if (dropdown.parentElement !== target) {
        target.appendChild(dropdown);
      }
      if (state.isOpen) positionDropdown(state);
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    state.mountCleanupFns.push(() =>
      document.removeEventListener("fullscreenchange", onFullscreen),
    );
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
      state.trigger.setAttribute("aria-activedescendant", active.id ?? "");
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

  // Re-position if the trigger scrolls or resizes (portal mode only).
  const onScroll = () => {
    if (state.isOpen && state.portal) positionDropdown(state);
  };
  window.addEventListener("scroll", onScroll, true);
  state.mountCleanupFns.push(() =>
    window.removeEventListener("scroll", onScroll, true),
  );

  state.onToggle?.(true, dropdown);
};

const positionDropdown = (state: InternalState) => {
  if (!state.dropdown) return;
  const rect = state.trigger.getBoundingClientRect();
  const dropdownRect = state.dropdown.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

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

  state.dropdown.style.top = top + "px";
  state.dropdown.style.left = left + "px";
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
  // Only steal focus back for keyboard-initiated closes (Escape, Enter,
  // select). Outside-click passes restoreFocus: false so the user's new
  // focus target isn't yanked away.
  if (opts?.restoreFocus !== false) {
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
      openDropdown(state);
    }
  };

  state.trigger.addEventListener("keydown", onKeydown);
  state.cleanupFns.push(() => state.trigger.removeEventListener("keydown", onKeydown));
};

// ── Open / toggle ──────────────────────────────────────────────────────

const openDropdown = (state: InternalState) => {
  if (state.isOpen) return;
  mountDropdown(state);
};

const toggleDropdown = (state: InternalState) => {
  if (state.isOpen) {
    closeDropdown(state);
  } else {
    openDropdown(state);
  }
};

// ── Refresh ────────────────────────────────────────────────────────────

const refreshDropdown = (state: InternalState) => {
  if (!state.dropdown) return;
  state.items.forEach(item => {
    const name = item.getAttribute("data-scheme-name");
    if (!name) return;
    const bar = item.querySelector("." + state.classes.bar) as HTMLElement | null;
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
  const classes: SchemePickerClasses = { ...DEFAULT_CLASSES, ...options.classes };
  const state: InternalState = {
    classes,
    trigger: options.trigger,
    hiddenSelect: options.hiddenSelect ?? null,
    schemes: options.schemes,
    numClasses: options.numClasses,
    onChange: options.onChange,
    onToggle: options.onToggle ?? null,
    portal: options.portal,
    colorScale: options.colorScale,
    value: options.value,
    dropdown: null,
    items: [],
    isOpen: false,
    cleanupFns: [],
    mountCleanupFns: [],
  };

  // Populate hidden select
  if (state.hiddenSelect) {
    state.hiddenSelect.innerHTML = "";
    options.schemes.forEach(name => {
      dom.el("option", { value: name, parent: state.hiddenSelect }, name);
    });
    state.hiddenSelect.value = options.value;
  }

  // Set initial trigger title and draw the colour bar
  state.trigger.title = options.value;
  const initialBarInner = getInner(state.trigger);
  if (initialBarInner) {
    renderColorBar(
      initialBarInner,
      options.value,
      options.numClasses,
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

  return {
    setValue(name: string) {
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
      selectScheme(state, name);
    },

    setNumClasses(n: number) {
      state.numClasses = n;
      // Redraw trigger bar
      const barInner = getInner(state.trigger);
      if (barInner) {
        renderColorBar(barInner, state.value, n, classes.block, state.colorScale);
      }
      // Redraw dropdown items
      refreshDropdown(state);
    },

    refresh() {
      refreshDropdown(state);
    },

    toggle() {
      toggleDropdown(state);
    },

    close() {
      closeDropdown(state);
    },

    getDropdown() {
      return state.dropdown;
    },

    destroy() {
      closeDropdown(state);
      state.cleanupFns.forEach(fn => fn());
      state.cleanupFns = [];
      state.items = [];
      state.dropdown = null;
      // Fully clean up ARIA attributes so the trigger is indistinguishable
      // from its initial state (destroy, not just close).
      state.trigger.removeAttribute("aria-expanded");
      state.trigger.removeAttribute("aria-controls");
    },
  };
};

export {
  type SchemePicker,
  // eslint-disable-next-line import/no-unused-modules
  type SchemePickerClasses,
  // eslint-disable-next-line import/no-unused-modules
  type SchemePickerOptions,
  createSchemePicker,
};

// ui/schemePicker — shared color-scheme picker: a thin adapter over the one listbox engine.
//
// The engine (ui/listbox.ts) owns the dropdown lifecycle, keyboard
// navigation, outside-click dismissal, focus return, portal/inline mounting
// and aria-activedescendant tracking. This adapter only supplies the value
// model (scheme + hidden select), the color-bar drawing, the trigger label,
// and the engine's shape/config knobs that reproduce the picker's historical
// behavior.
//
// Does NOT import any Heatmap or LayerControl module.
import { createListbox } from "./listbox.js";
import type { SchemePicker } from "./type.js";
import { dom } from "#platform/dom.js";
import { createLogger } from "#platform/log.js";

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
// its distance from z numbers. The engine's `classes.portal` slot carries it.
const PORTAL_CLASS = "foliplus-scheme-picker-portal";

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
  /** Resolve the host the portalled dropdown mounts into. Consumers inject
   *  this so the list follows the surface that actually covers the trigger —
   *  a control in pseudo-fullscreen. Absent, the picker falls back to
   *  document.fullscreenElement ?? <body>. */
  resolveHost?: () => HTMLElement;
  /** Subscribe to host-surface changes (native fullscreen enter/exit and the
   *  pseudo-fullscreen fallback's own transitions, which emit no
   *  fullscreenchange). The picker re-seats its dropdown into the new host
   *  whenever the callback fires; the returned function unsubscribes on
   *  close/destroy. Consumers wire this to the shared platform/fullscreen
   *  contract — platform/** must not import core/**. */
  onSurfaceChange?: (cb: () => void) => () => void;
  /** Called when the dropdown opens or closes, with the dropdown element
   *  (or null when closed). Useful for consumers that need to track the
   *  dropdown reference (e.g. for test assertions). */
  onToggle?: (open: boolean, dropdown: HTMLElement | null) => void;
  /** color-scale resolver: returns an array of `n` hex colors for a
   *  scheme name. Injected by the consumer so the picker stays free of
   *  core/ imports. */
  colorScale: (name: string, n: number) => string[];
  /** Accessible name for the trigger. Consumers pass their localized text
   *  (e.g. `T("scheme")`); the factory stays locale-free. */
  label?: string;
  /** Display label for a scheme name, for pickers whose vocabulary includes a
   *  consumer-owned entry (e.g. the author palette). Defaults to the name. */
  schemeLabel?: (name: string) => string;
  /** Schemes shown as the current value but not selectable: a consumer-owned
   *  state that only its own reset can leave (the author palette). Disabled
   *  entries still take focus during keyboard navigation and are announced as
   *  disabled; activating them is a no-op, never an onChange. */
  disabledSchemes?: readonly string[];
  /** Tooltip for a disabled scheme entry (when no schemeLabel is more
   *  specific). Disabled entries keep their focus and aria-disabled semantics;
   *  this only gives a mouse user the reason on hover. */
  disabledHint?: string;
}

// Owner map: prevents two pickers from binding the same trigger (which
// would cause double-dropdowns on a single click). A consumer that
// needs to re-create the picker must destroy the old one first.
const ownerMap = new WeakMap<HTMLElement, SchemePicker>();

// ── Inner-element lookup ──────────────────────────────────────────────

const getInner = (trigger: HTMLElement): HTMLElement | null => {
  const el =
    trigger.querySelector("[data-scheme-bar-inner]") ?? trigger.firstElementChild;
  return el instanceof HTMLElement ? el : null;
};

// ── color-bar renderer ────────────────────────────────────────────────

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

// ── scrollbar lane publishing ─────────────────────────────────────────

// The item's right inset subtracts this lane, so the property has to be
// published on every mount and re-measured on resize. The value is the lane
// the list's own overflow-y scrollbar occupies; a platform with overlay
// scrollbars reports 0, and the strip then reaches the item's right inset.
const syncScrollbarWidth = (dropdown: HTMLElement): void => {
  const style = getComputedStyle(dropdown);
  const borderPx =
    parseFloat(style.borderLeftWidth || "0") +
    parseFloat(style.borderRightWidth || "0");
  const lane = Math.max(
    0,
    Math.round(dropdown.offsetWidth - dropdown.clientWidth - borderPx),
  );
  dropdown.style.setProperty("--foliplus-scheme-picker-scrollbar-width", `${lane}px`);
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
  let numClasses = Math.max(1, Math.min(100, Math.round(options.numClasses) || 1));

  // Base structure classes are never replaced — consumer classes are additive
  // modifiers only. This prevents the CSS/DOM contract break that caused the
  // "custom color bar + native select both visible" screenshot bug.
  const consumerClasses = options.classes ?? {};
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

  const trigger = options.trigger;
  const hiddenSelect = options.hiddenSelect ?? null;
  const schemes = options.schemes;
  const colorScale = options.colorScale;
  const schemeLabel = options.schemeLabel ?? ((name: string) => name);
  const disabledSchemes = options.disabledSchemes ?? [];
  const disabledHint = options.disabledHint ?? "";
  let value = options.value;
  let destroyed = false;

  // Populate hidden select — make it non-interactive (tabindex=-1, aria-hidden)
  // so it does not appear as an invisible Tab stop. It is a state mirror only.
  if (hiddenSelect) {
    hiddenSelect.innerHTML = "";
    schemes.forEach(name => {
      dom.el("option", { value: name, parent: hiddenSelect }, name);
    });
    hiddenSelect.value = options.value;
    hiddenSelect.setAttribute("tabindex", "-1");
    hiddenSelect.setAttribute("aria-hidden", "true");
  }

  // Set combobox a11y attributes on the trigger.
  // aria-label is required because the adjacent <label> cannot name a
  // <div role="combobox"> automatically (no `for` attribute). The consumer
  // injects the localized name; the factory carries no locale table.
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  if (!trigger.hasAttribute("aria-label") && !trigger.hasAttribute("aria-labelledby")) {
    trigger.setAttribute("aria-label", options.label ?? "Color scheme");
  }

  // Set initial trigger title and draw the color bar
  trigger.title = schemeLabel(options.value);
  const initialBarInner = getInner(trigger);
  if (initialBarInner) {
    renderColorBar(
      initialBarInner,
      options.value,
      numClasses,
      classes.block,
      colorScale,
    );
  }

  const syncBar = () => {
    const barInner = getInner(trigger);
    if (barInner) {
      renderColorBar(barInner, value, numClasses, classes.block, colorScale);
    }
  };

  // A scheme row: the label bar the engine paints plus the row's disabled
  // tooltip. The engine owns the row's class/data-key/ARIA/click/keyboard and
  // renders the title from `item.title` (provided by itemsOf, where the
  // disabled hint lives); the adapter owns only the color bar.
  const renderRow = (item: { value: string; disabled?: boolean }) => {
    const bar = dom.el("div", { class: classes.bar });
    renderColorBar(bar, item.value, numClasses, classes.block, colorScale);
    return bar;
  };

  // Apply a selection: update the value model + all picker-owned DOM, close
  // the dropdown, and notify. The engine calls this for a row activation
  // (click/Enter/Space) and the adapter calls it for trigger-key cycling.
  const applyScheme = (name: string): void => {
    value = name;
    if (hiddenSelect) hiddenSelect.value = name;
    trigger.title = schemeLabel(name);
    syncBar();
    listbox.close({ restoreFocus: true });
    options.onChange(name);
  };

  // The engine's selected() read — the value lives here, in the adapter.
  const selectedOf = () => [value];
  const itemsOf = (): {
    value: string;
    label: string;
    disabled?: boolean;
    title?: string;
  }[] =>
    schemes.map(name => {
      const disabled = disabledSchemes.includes(name);
      return {
        value: name,
        label: schemeLabel(name),
        disabled,
        title: disabled ? disabledHint || schemeLabel(name) : schemeLabel(name),
      };
    });

  const listbox = createListbox({
    trigger,
    items: itemsOf,
    selected: selectedOf,
    shape: {
      rowTag: "div",
      dataKey: "data-scheme-name",
      selectedClass: classes.active,
      disabledAttr: "aria-disabled",
      activedescendant: "trigger",
      renderRow,
    },
    classes: {
      list: classes.dropdown,
      row: classes.item,
      portal: PORTAL_CLASS,
      up: "",
      open: classes.open,
    },
    place: "fixed",
    focusOnOpen: "selected",
    // Publish the lane after every position pass (the engine calls onPosition
    // after positionList in portal mode and after the inline mount).
    onPosition: () => {
      const dropdown = listbox.getList();
      // Every position pass happens while the list is mounted, so the null branch
      // is a defensive guard, not a reachable state.
      /* v8 ignore next -- defensive: onPosition only runs with a mounted list */
      if (dropdown) syncScrollbarWidth(dropdown);
    },
    inline: !options.portal,
    inlineHost: options.portal
      ? undefined
      : () =>
          trigger.closest(".foliplus-form-control") ?? trigger.parentElement ?? trigger,
    triggerKeys: "cycle",
    stopTriggerClick: true,
    detachOnClose: true,
    surface: {
      resolveHost: options.resolveHost,
      onSurfaceChange: options.onSurfaceChange,
    },
    dismiss: { kind: "local" },
    onRowActivate: index => {
      // Closed: the trigger's cycle key activates the value model directly
      // (the list is not rendered). Open: the list row is the source of truth
      // — a malformed row without a data-scheme-name must be skipped rather
      // than activating by index.
      if (!listbox.isOpen()) {
        applyScheme(itemsOf()[index].value);
        return;
      }
      const name = listbox
        .getList()
        ?.querySelectorAll("[role=option]")
        [index]?.getAttribute("data-scheme-name");
      if (name) applyScheme(name);
    },
    onToggle: options.onToggle ?? undefined,
  });

  const listOf = (): HTMLElement | null =>
    destroyed || !listbox.isOpen() ? null : listbox.getList();

  const picker: SchemePicker = {
    setValue(name: string) {
      if (destroyed) return;
      // Validate that the new value is in schemes.
      if (schemes.length > 0 && !schemes.includes(name)) {
        throw new RangeError(
          log.msg(
            `value "${name}" is not in schemes — add it to schemes or use a value from the list`,
          ),
        );
      }
      value = name;
      if (hiddenSelect) hiddenSelect.value = name;
      trigger.title = schemeLabel(name);
      syncBar();
      if (listbox.isOpen()) listbox.refresh();
    },

    selectScheme(name: string) {
      if (destroyed) return;
      // Skip onChange for same-value selection — just close and return focus.
      if (name === value) {
        listbox.close({ restoreFocus: true });
        return;
      }
      applyScheme(name);
    },

    setNumClasses(n: number) {
      if (destroyed) return;
      const clamped = Math.max(1, Math.min(100, Math.round(n) || 1));
      if (clamped === numClasses) return;
      // The engine re-renders rows on refresh; setNumClasses redraws the
      // trigger bar and every visible bar in the open list.
      numClasses = clamped;
      syncBar();
      listbox.refresh();
    },

    refresh() {
      if (destroyed) return;
      listbox.refresh();
    },

    toggle() {
      if (destroyed) return;
      listbox.toggle();
    },

    close(opts?: { restoreFocus?: boolean }) {
      if (destroyed) return;
      listbox.close(opts);
    },

    getDropdown() {
      return listOf();
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      listbox.destroy();
      // A destroyed picker holds no consumer callbacks.
      // Fully clean up ARIA attributes so the trigger is indistinguishable
      // from its initial state (destroy, not just close). The engine's close
      // only sets aria-expanded=false and keeps aria-controls/aria-owns.
      trigger.removeAttribute("aria-expanded");
      trigger.removeAttribute("aria-controls");
      trigger.removeAttribute("aria-owns");
      // Remove from owner map so a new picker can be created on this trigger.
      ownerMap.delete(trigger);
    },
  };
  ownerMap.set(trigger, picker);
  return picker;
};

export { createSchemePicker };

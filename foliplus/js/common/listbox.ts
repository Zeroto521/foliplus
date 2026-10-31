// common/listbox — the ONE listbox engine behind every self-built dropdown.
//
// The shared select replacement (common/dropdown) and the scheme picker
// (common/schemePicker) grew up as two parallel implementations that shared
// only their ARIA contract text. Each bug needed the same fix twice (#832's
// wheel fix, #824's disabled affordance), and the divergence was a *conscious*
// decision (see schemePicker's note at :199-222): element <div> vs <button>,
// disabled aria-disabled vs native disabled, data key data-scheme-name vs
// data-value, selected class foliplus-is-active vs foliplus-is-selected, click
// wiring, and a consumer-drawn trigger vs a module-owned label button.
//
// This module owns ALL of that mechanism once — row rendering skeleton, the
// ARIA listbox contract, keyboard walk, positioning/flip/clamp, portal mount +
// surface re-seat, wheel containment, focus restore, teardown — and the six
// *shape* differences drop to explicit config in one file, covered by one set
// of contract tests. A bug fix now lands in exactly one place.
//
// The engine does NOT own the value model or the trigger's appearance. The
// consumer owns those (dropdown bridges a native select; the picker draws a
// colour bar); the engine owns the listbox the trigger opens.
//
// The shape slots are fixed and documented here so they never become a second
// divergence source: each has a contract-test case on both sides.
import { dom } from "#common/dom.js";
import { registerPortalRoot } from "#common/portalRoot.js";

/** The three ARIA attributes shared by every option row. The engine paints
 *  the exact trio the dropdown and picker have always painted, so existing
 *  call sites and tests are untouched. */
const applyOptionA11y = (el: HTMLElement, opts: { selected: boolean }): void => {
  el.setAttribute("role", "option");
  el.setAttribute("tabindex", "-1");
  el.setAttribute("aria-selected", opts.selected ? "true" : "false");
};

/** One option row, mirroring the native <option> fields the panels already use. */
interface ListboxItem {
  value: string;
  label: string;
  disabled?: boolean;
  /** Native tooltip, mirroring SelectOption.title. */
  title?: string;
  /** Fallback tooltip for a disabled option that carries no title. */
  disabledHint?: string;
}

/**
 * The six explicit shape slots. Each one is a point where the two historical
 * builders deliberately diverged; folding them into engine config (instead of
 * merging the behaviour) keeps S-A/S-B behaviour-equivalent so existing tests
 * stay untouched. Every slot is covered by a contract-test case on both shapes.
 */
type ListboxRowShape = {
  /** dropdown/menu rows are <button>; picker rows are <div> (behaviour-equivalent). */
  rowTag: "button" | "div";
  /** data-value (dropdown) vs data-scheme-name (picker). */
  dataKey: "data-value" | "data-scheme-name";
  /** foliplus-is-selected (dropdown) vs foliplus-is-active (picker). */
  selectedClass: string;
  /** native disabled (dropdown, skips tab order) vs aria-disabled (picker, still focusable). */
  disabledAttr: "disabled" | "aria-disabled";
  /** Trigger-side aria-activedescendant management: the picker tracks the
   *  focused row on the trigger; the dropdown does not (its trigger is a
   *  button that keeps its own focus, and the list rows are tabindex=-1). */
  activedescendant: "trigger" | "none";
  /** Row content: default is the label text; the picker draws a colour block. */
  renderRow?: (
    item: ListboxItem,
    ctx: { selected: boolean; index: number },
  ) => HTMLElement;
};

/** The popup-host contract: where an open popup mounts and how it hears that
 *  the covering surface changed. Consumers pass core/fullscreen's
 *  dropdownSurface(scope); builders that create listboxes on a consumer's
 *  behalf (core/rampForm, core/label) forward it untouched. */
interface DropdownSurface {
  resolveHost?: (() => HTMLElement | null) | null;
  onSurfaceChange?: ((cb: () => void) => () => void) | null;
}

/**
 * Dismiss ownership. Phase 1 (S-A..S-E): the engine is the ONLY implementation
 * of outside-press / Escape / one-at-a-time, so its "local" port is a single
 * implementation rather than a second one. Phase 2 (S-F, after task-47 M1 +
 * M2 PR-B/C) switches to the PanelController registry and the engine stops
 * listening on document/window entirely.
 */
type ListboxDismiss =
  | { kind: "local" }
  | {
      kind: "registry";
      owner: string;
      rank: number;
      open: () => void;
      close: () => void;
    };

/** CSS classes the engine toggles. The consumer supplies them so the engine
 *  never hardcodes another module's stylesheet contract. */
interface ListboxClasses {
  /** The list element (e.g. foliplus-dropdown-list). */
  list: string;
  /** Each row (e.g. foliplus-dropdown-option). */
  row: string;
  /** Optional label span inside a row. */
  rowLabel?: string;
  /** Added to the list while it is portalled. */
  portal: string;
  /** Added to the list when it flips above the trigger. */
  up: string;
  /** Toggled on the trigger while the list is open. */
  open: string;
}

interface ListboxSpec {
  /** The trigger the engine toggles. Consumer-owned (button or colour bar). */
  trigger: HTMLElement;
  /** Current items, re-read on every open/refresh (panels rebuild their lists). */
  items: () => readonly ListboxItem[];
  /** Current selected values, re-read for row state. */
  selected: () => readonly string[];
  multiple?: boolean;
  shape: ListboxRowShape;
  classes: ListboxClasses;
  surface?: DropdownSurface;
  /** Phase 1: always { kind: "local" }. */
  dismiss: ListboxDismiss;
  /** Called at the very start of open(), before rows are rendered, so the
   *  consumer can re-read its value/items from a source that may have changed
   *  since the last open (a bridged select's options are rebuilt whenever the
   *  panel changes). */
  onBeforeOpen?: () => void;
  /** Called on open (after items refresh) and after every row activation, so
   *  the consumer re-renders its trigger (label text / colour bar). */
  renderTrigger?: () => void;
  /** Row activated by click or Enter/Space. The consumer mutates its value
   *  model and fires its change callback; the engine decides close vs stay
   *  open (single closes, multiple stays) and refreshes the row state. */
  onRowActivate: (index: number) => void;
  onToggle?: (open: boolean, list: HTMLElement | null) => void;
}

interface Listbox {
  getList(): HTMLElement | null;
  isOpen(): boolean;
  open(): void;
  close(opts?: { restoreFocus?: boolean }): void;
  toggle(): void;
  /** Re-render rows from a fresh items()/selected() read; re-pins while open. */
  refresh(): void;
  destroy(): void;
}

/** Vertical gap kept between the popup and the viewport edge. */
const POPUP_EDGE_GAP = 8;
/** Gap between the trigger and the popup, matching --foliplus-menu-gap. */
const POPUP_GAP = 4;
/** Rows the popup shows before it scrolls internally. */
const MAX_VISIBLE_ROWS = 8;
/** A popup with less room than this below flips above the trigger. */
const MIN_ROWS_BELOW = 2;

let idCounter = 0;
const nextListId = (): string => `foliplus-listbox-${String(++idCounter)}`;
let rowIdCounter = 0;
const nextRowId = (): string => `foliplus-listbox-row-${String(++rowIdCounter)}`;

interface InternalState {
  trigger: HTMLElement;
  list: HTMLElement;
  rowEls: HTMLElement[];
  spec: ListboxSpec;
  isOpen: boolean;
  destroyed: boolean;
  mountCleanup: (() => void)[];
  releasePortalRoot: (() => void) | null;
}

/** Open popups, newest last. One at a time: two portalled lists on <body>
 *  would stack z-index on each other and orphan the older node. */
const openStates: InternalState[] = [];

/** Space the popup may use, above and below the trigger, in viewport terms. */
const spaceAround = (trigger: HTMLElement): { below: number; above: number } => {
  const rect = trigger.getBoundingClientRect();
  return {
    below: window.innerHeight - rect.bottom - POPUP_EDGE_GAP,
    above: rect.top - POPUP_EDGE_GAP,
  };
};

/** Where an open popup is mounted. The panel's own clip box is short, so the
 *  list leaves the panel: it mounts on the surface covering the trigger —
 *  native fullscreen, the control's pseudo-fullscreen container, or <body> —
 *  with fixed coordinates and re-pins on scroll/resize. */
const popupHost = (state: InternalState): HTMLElement =>
  state.spec.surface?.resolveHost?.() ??
  (document.fullscreenElement as HTMLElement | null) ??
  document.body;

const itemDisabled = (item: ListboxItem | undefined): boolean => !!item?.disabled;

const isEnabled = (state: InternalState, index: number): boolean =>
  !itemDisabled(state.spec.items()[index]);

/** The first enabled row from `index`, walking in `step` direction and
 *  wrapping. -1 when every row is disabled (the cursor then stays put). */
const enabledFrom = (state: InternalState, index: number, step: 1 | -1): number => {
  const items = state.spec.items();
  const total = items.length;
  for (let offset = 0; offset < total; offset++) {
    const at = (((index + offset * step) % total) + total) % total;
    if (isEnabled(state, at)) return at;
  }
  return -1;
};

/** Home/End land on the first/last row that can actually be picked. A native
 *  select skips disabled options for those keys, and so must this listbox. */
const focusEdge = (state: InternalState, edge: "start" | "end"): void => {
  const items = state.spec.items();
  const total = items.length;
  for (let offset = 0; offset < total; offset++) {
    const index = edge === "start" ? offset : total - 1 - offset;
    if (isEnabled(state, index)) {
      focusOption(state, index);
      return;
    }
  }
};

/** Index of the focused row, or -1 when focus is still on the trigger. */
const focusedIndex = (state: InternalState): number =>
  state.rowEls.findIndex(row => row === document.activeElement);

/** Move by `delta` rows, skipping disabled entries and wrapping around so the
 *  keyboard never parks on a row that cannot be picked. */
const stepFocus = (state: InternalState, delta: number): void => {
  const total = state.rowEls.length;
  if (total === 0) return;
  const start = focusedIndex(state);
  let index = start === -1 ? (delta > 0 ? -1 : 0) : start;
  for (let step = 0; step < total; step++) {
    index = (index + delta + total) % total;
    if (isEnabled(state, index)) {
      focusOption(state, index);
      return;
    }
  }
};

const focusOption = (state: InternalState, index: number): void => {
  const option = state.rowEls[index];
  if (!option) return;
  option.focus();
  // A clamped popup scrolls internally; keep the focused row visible.
  option.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  // The picker tracks the focused row on the trigger; the dropdown does not.
  if (state.spec.shape.activedescendant === "trigger") {
    const id = option.id;
    if (id) state.trigger.setAttribute("aria-activedescendant", id);
  }
};

/** Build one row per the shape. The ARIA trio comes from the shared helper;
 *  the data key, disabled semantics and selected class come from the shape. */
const buildRow = (
  state: InternalState,
  item: ListboxItem,
  index: number,
): HTMLElement => {
  const { shape, classes } = state.spec;
  const selected = state.spec.selected().includes(item.value);
  const attrs: Record<string, string | undefined> = {
    class: classes.row,
    [shape.dataKey]: item.value,
  };
  if (shape.rowTag === "button") attrs.type = "button";
  if (item.title) attrs.title = item.title;
  else if (item.disabled && item.disabledHint) attrs.title = item.disabledHint;
  if (shape.disabledAttr === "disabled" && item.disabled) {
    attrs.disabled = "";
  } else if (shape.disabledAttr === "aria-disabled" && item.disabled) {
    attrs["aria-disabled"] = "true";
  }
  // The picker shape tracks the focused row on the trigger via
  // aria-activedescendant, so its rows need stable ids to reference.
  if (shape.activedescendant === "trigger") attrs.id = nextRowId();
  const row = dom.el(shape.rowTag, attrs) as HTMLElement;
  applyOptionA11y(row, { selected });
  row.classList.toggle(shape.selectedClass, selected);
  const content = shape.renderRow
    ? shape.renderRow(item, { selected, index })
    : dom.el("span", classes.rowLabel ? { class: classes.rowLabel } : null, item.label);
  row.appendChild(content);
  return row;
};

/** Re-render every row from a fresh items()/selected() read. */
const renderRows = (state: InternalState): void => {
  const items = state.spec.items();
  state.list.textContent = "";
  state.rowEls = items.map((item, index) => {
    const row = buildRow(state, item, index);
    row.addEventListener("click", () => {
      if (itemDisabled(item)) return;
      state.spec.onRowActivate(index);
      // Multiple mode keeps the list open and refreshes the toggled row.
      if (state.spec.multiple) {
        const selectedNow = state.spec.selected().includes(item.value);
        row.setAttribute("aria-selected", selectedNow ? "true" : "false");
        row.classList.toggle(state.spec.shape.selectedClass, selectedNow);
      } else {
        close(state, { restoreFocus: true });
      }
    });
    return row;
  });
  state.list.append(...state.rowEls);
};

/** Pin the popup to the trigger in viewport coordinates: below it when there
 *  is room for at least two rows, otherwise above it, and clamped to the room
 *  the viewport leaves. */
const positionList = (state: InternalState): void => {
  const list = state.list;
  list.style.maxHeight = "";
  list.classList.remove(state.spec.classes.up);

  const rect = state.trigger.getBoundingClientRect();
  const natural = list.getBoundingClientRect().height;
  const rowHeight = Math.max(24, ...state.rowEls.map(row => row.offsetHeight));
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
  list.style.left = `${String(rect.left)}px`;
  list.style.width = "max-content";
  const contentWidth = list.getBoundingClientRect().width;
  const cell = state.trigger.parentElement?.parentElement ?? null;
  const room = cell ? cell.getBoundingClientRect().right - rect.left : rect.width;
  const width = Math.max(
    rect.width,
    Math.min(contentWidth, Math.max(rect.width, room)),
  );
  list.style.width = `${String(width)}px`;
  if (up) {
    list.style.top = "";
    list.style.bottom = `${String(window.innerHeight - rect.top + POPUP_GAP)}px`;
    list.classList.add(state.spec.classes.up);
  } else {
    list.style.bottom = "";
    list.style.top = `${String(rect.bottom + POPUP_GAP)}px`;
  }
  list.classList.add(state.spec.classes.portal);
  if (height < natural) list.style.maxHeight = `${String(Math.round(height))}px`;
};

const close = (state: InternalState, opts?: { restoreFocus?: boolean }): void => {
  const wasOpen = state.isOpen;
  state.isOpen = false;
  const openIndex = openStates.indexOf(state);
  if (openIndex >= 0) openStates.splice(openIndex, 1);
  state.list.hidden = true;
  state.list.classList.remove(state.spec.classes.up, state.spec.classes.portal);
  state.list.style.maxHeight = "";
  state.trigger.classList.remove(state.spec.classes.open);
  state.trigger.setAttribute("aria-expanded", "false");
  state.trigger.removeAttribute("aria-activedescendant");
  state.mountCleanup.forEach(fn => fn());
  state.mountCleanup = [];
  state.releasePortalRoot?.();
  state.releasePortalRoot = null;
  // The popup goes back into the wrapper when it is closed: the open state is
  // the only one that has to escape the panel's clip box.
  const wrapper = state.trigger.parentElement;
  if (wrapper && state.list.parentElement !== wrapper) wrapper.append(state.list);
  if (wasOpen && opts?.restoreFocus !== false) state.trigger.focus();
  if (wasOpen) state.spec.onToggle?.(false, null);
};

const open = (state: InternalState): void => {
  if (state.destroyed || state.isOpen) return;
  for (const other of [...openStates]) {
    if (other !== state && other.isOpen) close(other, { restoreFocus: false });
  }
  openStates.push(state);
  state.spec.onBeforeOpen?.();
  renderRows(state);
  state.spec.renderTrigger?.();
  // Mount on the portal host *before* unhiding so the first measurement has a
  // laid-out box to read (a detached list reports 0×0).
  const host = popupHost(state);
  if (state.list.parentElement !== host) host.appendChild(state.list);
  state.list.hidden = false;
  state.releasePortalRoot = registerPortalRoot(state.list, state.trigger);
  state.isOpen = true;
  state.trigger.classList.add(state.spec.classes.open);
  state.trigger.setAttribute("aria-expanded", "true");
  positionList(state);

  // Dismiss on any press outside the control. Capture phase, so the press
  // closes the popup before the element under it reacts.
  const onOutsidePress = (event: Event): void => {
    const target = event.target as Node | null;
    if (!target) return;
    const wrapper = state.trigger.parentElement;
    if (wrapper?.contains(target) || state.list.contains(target)) return;
    close(state, { restoreFocus: false });
  };
  document.addEventListener("pointerdown", onOutsidePress, true);
  state.mountCleanup.push(() =>
    document.removeEventListener("pointerdown", onOutsidePress, true),
  );

  // Re-pin on scroll/resize instead of dismissing.
  const reposition = (event: Event): void => {
    const target = event.target;
    if (target instanceof Node) {
      if (state.list === target || state.list.contains(target)) return;
    }
    positionList(state);
  };
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition, { passive: true });
  const reseat = (): void => {
    if (!state.isOpen) return;
    const nextHost = popupHost(state);
    if (state.list.parentElement !== nextHost) nextHost.appendChild(state.list);
    positionList(state);
  };
  const unsubscribeSurface = state.spec.surface?.onSurfaceChange
    ? state.spec.surface.onSurfaceChange(reseat)
    : (() => {
        document.addEventListener("fullscreenchange", reseat);
        return () => document.removeEventListener("fullscreenchange", reseat);
      })();
  state.mountCleanup.push(() => {
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
    unsubscribeSurface();
  });

  // Escape belongs to the popup while it is open. The panel dispatcher (#783)
  // listens on document *capture*, so this sits on window capture, which runs
  // before any document capture listener and stops the event there.
  const onEscapeCapture = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    close(state, { restoreFocus: true });
  };
  window.addEventListener("keydown", onEscapeCapture, true);
  state.mountCleanup.push(() =>
    window.removeEventListener("keydown", onEscapeCapture, true),
  );

  state.spec.onToggle?.(true, state.list);
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
    if (index >= 0) {
      const item = state.spec.items()[index];
      if (!itemDisabled(item)) {
        state.spec.onRowActivate(index);
        if (state.spec.multiple) {
          const selectedNow = state.spec.selected().includes(item.value);
          state.rowEls[index]?.setAttribute(
            "aria-selected",
            selectedNow ? "true" : "false",
          );
          state.rowEls[index]?.classList.toggle(
            state.spec.shape.selectedClass,
            selectedNow,
          );
        } else {
          close(state, { restoreFocus: true });
        }
      }
    }
    return;
  }
  if (key === "Tab") {
    // Returning focus to the trigger is what lets the browser's own Tab
    // movement continue from the control instead of from the row that is
    // about to be hidden. No preventDefault.
    close(state, { restoreFocus: true });
  }
};

const onTriggerKeyDown = (state: InternalState, event: KeyboardEvent): void => {
  const key = event.key;
  if (key === "ArrowDown" || key === "ArrowUp") {
    event.preventDefault();
    event.stopPropagation();
    if (state.isOpen) {
      stepFocus(state, key === "ArrowDown" ? 1 : -1);
      return;
    }
    const items = state.spec.items();
    open(state);
    if (state.rowEls.length > 0) {
      const from = key === "ArrowDown" ? 0 : Math.max(0, items.length - 1);
      const index = enabledFrom(state, from, key === "ArrowDown" ? 1 : -1);
      if (index >= 0) focusOption(state, index);
    }
    return;
  }
  if ((key === "Home" || key === "End") && state.isOpen) {
    event.preventDefault();
    event.stopPropagation();
    focusEdge(state, key === "Home" ? "start" : "end");
  }
};

const createListbox = (spec: ListboxSpec): Listbox => {
  const listId = nextListId();
  const list = dom.el("div", {
    id: listId,
    class: spec.classes.list,
    role: "listbox",
    ...(spec.multiple ? { "aria-multiselectable": "true" } : {}),
  }) as HTMLElement;
  list.hidden = true;
  // A wheel over the open popup must not zoom the map. The popup is portalled
  // out of the control container, so the container's disableScrollPropagation
  // does not cover it. Stop propagation only: the list's own overflow-y scroll
  // still works.
  list.addEventListener("wheel", event => event.stopPropagation());
  spec.trigger.setAttribute("aria-haspopup", "listbox");
  spec.trigger.setAttribute("aria-expanded", "false");
  spec.trigger.setAttribute("aria-controls", listId);
  spec.trigger.setAttribute("aria-owns", listId);

  const state: InternalState = {
    trigger: spec.trigger,
    list,
    rowEls: [],
    spec,
    isOpen: false,
    destroyed: false,
    mountCleanup: [],
    releasePortalRoot: null,
  };

  const onTriggerClick = (): void => {
    if (state.destroyed) return;
    if (state.isOpen) close(state, { restoreFocus: false });
    else open(state);
  };
  const onTriggerKey = (event: KeyboardEvent): void => onTriggerKeyDown(state, event);
  const onListKey = (event: KeyboardEvent): void => onListKeyDown(state, event);
  spec.trigger.addEventListener("click", onTriggerClick);
  spec.trigger.addEventListener("keydown", onTriggerKey);
  list.addEventListener("keydown", onListKey);

  const listbox: Listbox = {
    getList: () => (state.destroyed ? null : state.list),
    isOpen: () => state.isOpen,
    open() {
      if (state.destroyed) return;
      open(state);
    },
    close(closeOpts) {
      if (state.destroyed) return;
      close(state, closeOpts);
    },
    toggle() {
      if (state.destroyed) return;
      if (state.isOpen) close(state, { restoreFocus: false });
      else open(state);
    },
    refresh() {
      if (state.destroyed) return;
      if (state.isOpen) {
        renderRows(state);
        positionList(state);
      }
    },
    destroy() {
      if (state.destroyed) return;
      close(state, { restoreFocus: false });
      state.destroyed = true;
      spec.trigger.removeEventListener("click", onTriggerClick);
      spec.trigger.removeEventListener("keydown", onTriggerKey);
      list.removeEventListener("keydown", onListKey);
      list.remove();
    },
  };

  // Attach the list to the trigger's wrapper so the closed DOM shape is intact.
  const wrapper = spec.trigger.parentElement;
  if (wrapper) wrapper.append(list);
  return listbox;
};

export { applyOptionA11y, createListbox };
export type { DropdownSurface };

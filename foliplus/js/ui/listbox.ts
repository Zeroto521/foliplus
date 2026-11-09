// ui/listbox — the ONE listbox engine behind every self-built dropdown.
//
// The shared select replacement (ui/dropdown) and the scheme picker
// (ui/schemePicker) grew up as two parallel implementations that shared
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
import { bindDismiss } from "./dismiss.js";
import { applyOptionRowA11y, nextOptionId } from "./optionRow.js";
import { ensureActiveVisible } from "./scrollIntoView.js";
import type { DropdownSurface } from "./type.js";
import { dom } from "#platform/dom.js";
import {
  type Floating,
  bindFloatingGestures,
  mountFloating,
} from "#platform/floating.js";
import { registerPortalRoot } from "#platform/portalRoot.js";
import { throttleRaf } from "#platform/throttle.js";

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
 *  the covering surface changed. Consumers pass platform/fullscreen's
 *  dropdownSurface(scope); builders that create listboxes on a consumer's
 *  behalf (core/rampForm, core/label) forward it untouched. */
/**
 * Dismiss ownership. Phase 1 (S-A..S-E): the engine is the ONLY implementation
 * of outside-press / Escape / one-at-a-time, so its "local" port is a single
 * implementation rather than a second one. Phase 2 (S-F, after the
 * PanelController registry work) switches to the registry and the engine stops
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
  /** The engine's own outside-press / Escape dismissal. Default OFF: #807
   *  gives the overlay registry single ownership of closing a floating layer,
   *  and the scheme picker's consumer wires that registry itself. The bridged
   *  dropdown has no such owner, so its adapter opts in. */
  ownDismiss?: boolean;
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
  /** Positioning strategy. "auto" (default) is the shared dropdown rule
   *  (max-content width, room-based clamp, flip by a two-row minimum). "fixed"
   *  fixes the popup to the trigger width with an 8px viewport edge clamp and
   *  flips by the full popup height (the scheme picker's historical rule). */
  place?: "auto" | "fixed";
  /** Focus a row on open. The picker lands on the selected row (fallback row
   *  0); the dropdown focuses nothing (its rows are reached by keyboard). */
  focusOnOpen?: "first" | "last" | "selected";
  /** Called after every position pass (portal) or after the inline mount —
   *  the consumer publishes a measured lane (scrollbar width) here. */
  onPosition?: () => void;
  /** Inline mount: append into the trigger's parent instead of portalling to
   *  the surface, no fixed coordinates / portal class / surface listeners.
   *  CSS anchors the list. Default false (the dropdown always portals). */
  inline?: boolean;
  /** Inline mount host. Default: trigger.parentElement ?? trigger. */
  inlineHost?: () => HTMLElement;
  /** Trigger keyboard mode. "open" (default): Arrow opens and focuses the list;
   *  Enter/Space is left to the trigger (a <button> fires its own click).
   *  "cycle": Arrow cycles the selection without opening, Enter/Space open. */
  triggerKeys?: "open" | "cycle";
  /** stopPropagation on a trigger click. The picker's trigger sits inside a
   *  panel whose own handlers must not see the press. */
  stopTriggerClick?: boolean;
  /** Detach the closed list from the DOM instead of parking it in the
   *  trigger's wrapper. The dropdown parks its hidden list in the wrapper
   *  (a closed control keeps its DOM shape); the picker detaches it, which
   *  is what keeps the closed list out of the owning panel — a detached
   *  node is not inside any overlay. Default false (park in wrapper). */
  detachOnClose?: boolean;
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

interface InternalState {
  trigger: HTMLElement;
  list: HTMLElement;
  rowEls: HTMLElement[];
  spec: ListboxSpec;
  isOpen: boolean;
  destroyed: boolean;
  mountCleanup: (() => void)[];
  /** The mounted floating layer (portal mount/re-pin/re-seat/wheel). */
  floating: Floating | null;
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
  ensureActiveVisible(option);
  // The picker tracks the focused row on the trigger; the dropdown does not.
  if (state.spec.shape.activedescendant === "trigger") {
    // buildRow assigns a stable id to every row of the trigger shape, so the
    // id is an engine invariant here — no need to re-check it.
    state.trigger.setAttribute("aria-activedescendant", option.id);
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
  if (shape.activedescendant === "trigger") attrs.id = nextOptionId("listbox-row");
  const row = dom.el(shape.rowTag, attrs) as HTMLElement;
  applyOptionRowA11y({ el: row, selected, id: attrs.id });
  row.classList.toggle(shape.selectedClass, selected);
  // The trigger shape tracks the focused row via aria-activedescendant. A
  // click (or a programmatic .focus()) focuses a row directly, bypassing
  // focusOption, so the engine listens for the row's own focus event and
  // re-publishes it. The guard re-checks the active element: a focus event
  // queued after focus already left the list must not claim it is on the row.
  if (shape.activedescendant === "trigger") {
    row.addEventListener("focus", () => {
      if (document.activeElement === row) {
        state.trigger.setAttribute("aria-activedescendant", row.id);
      }
    });
  }
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
/** Pin the popup to the trigger in viewport coordinates: below it when there
 *  is room for at least two rows, otherwise above it, and clamped to the room
 *  the viewport leaves. The picker mode keeps the scheme picker's historical
 *  rule (fixed trigger width, 8px viewport edge clamp, flip by full height). */
/** classList.add/remove throw on an empty token; the scheme picker's up slot
 *  is deliberately empty (its stylesheet keys nothing off the flipped class).
 *  Skip empty strings. */
const classAdd = (el: HTMLElement, cls: string): void => {
  if (cls) el.classList.add(cls);
};
const classRemove = (el: HTMLElement, cls: string): void => {
  if (cls) el.classList.remove(cls);
};
const positionList = (state: InternalState): void => {
  const list = state.list;
  list.style.maxHeight = "";
  classRemove(list, state.spec.classes.up);

  const rect = state.trigger.getBoundingClientRect();
  const natural = list.getBoundingClientRect().height;
  const rowHeight = Math.max(24, ...state.rowEls.map(row => row.offsetHeight));
  const desired = Math.min(natural, rowHeight * MAX_VISIBLE_ROWS);
  const space = spaceAround(state.trigger);
  const fitsBelow =
    state.spec.place === "fixed"
      ? space.below >= natural
      : space.below >= Math.min(desired, rowHeight * MIN_ROWS_BELOW);
  const up = !fitsBelow && space.above > space.below;
  const height = Math.max(
    rowHeight,
    Math.min(desired, Math.max(up ? space.above : space.below, rowHeight)),
  );

  list.style.position = "fixed";
  // CSS gives in-flow mounts the gap via margin-top; a fixed (portalled) mount
  // expresses the same gap via its offset, so the margin must be zeroed or the
  // two stack and every real scheme dropdown sits 4px low (P2-1).
  list.style.marginTop = "0px";
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
  if (state.spec.place === "fixed") {
    // Fixed trigger width, right-edge clamp at 8px, top/bottom clamp at 8px.
    list.style.width = `${String(rect.width)}px`;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect.left;
    const listRect = list.getBoundingClientRect();
    if (left + listRect.width > vw - 8) {
      left = Math.max(8, vw - listRect.width - 8);
    }
    let top = up ? rect.top - listRect.height - POPUP_GAP : rect.bottom + POPUP_GAP;
    top = Math.max(8, Math.min(top, vh - 8 - listRect.height));
    list.style.left = `${String(left)}px`;
    list.style.bottom = "";
    list.style.top = `${String(top)}px`;
    if (up) {
      classAdd(list, state.spec.classes.up);
    }
  } else if (up) {
    list.style.top = "";
    list.style.bottom = `${String(window.innerHeight - rect.top + POPUP_GAP)}px`;
    classAdd(list, state.spec.classes.up);
  } else {
    list.style.bottom = "";
    list.style.top = `${String(rect.bottom + POPUP_GAP)}px`;
  }
  list.classList.add(state.spec.classes.portal);
  if (height < natural) list.style.maxHeight = `${String(Math.round(height))}px`;
  state.spec.onPosition?.();
};
const close = (state: InternalState, opts?: { restoreFocus?: boolean }): void => {
  const wasOpen = state.isOpen;
  state.isOpen = false;
  const openIndex = openStates.indexOf(state);
  if (openIndex >= 0) openStates.splice(openIndex, 1);
  state.list.hidden = true;
  classRemove(state.list, state.spec.classes.up);
  classRemove(state.list, state.spec.classes.portal);
  state.list.style.maxHeight = "";
  state.trigger.classList.remove(state.spec.classes.open);
  state.trigger.setAttribute("aria-expanded", "false");
  state.trigger.removeAttribute("aria-activedescendant");
  state.floating?.release();
  state.floating = null;
  state.mountCleanup.forEach(fn => fn());
  state.mountCleanup = [];
  // The popup goes back into the wrapper when it is closed: the open state is
  // the only one that has to escape the panel's clip box.
  if (state.spec.detachOnClose) {
    state.list.remove();
  } else {
    const wrapper = state.spec.inline
      ? (state.spec.inlineHost?.() ?? state.trigger.parentElement ?? state.trigger)
      : state.trigger.parentElement;
    if (wrapper && state.list.parentElement !== wrapper) wrapper.append(state.list);
  }
  if (wasOpen && opts?.restoreFocus !== false) state.trigger.focus();
  if (wasOpen) state.spec.onToggle?.(false, null);
};

const open = (state: InternalState): void => {
  if (state.destroyed || state.isOpen) return;
  for (const other of [...openStates]) {
    // openStates only ever contains open states (close() splices the state out),
    // so the other's isOpen flag is redundant here.
    close(other, { restoreFocus: false });
  }
  openStates.push(state);
  state.spec.onBeforeOpen?.();
  renderRows(state);
  state.spec.renderTrigger?.();
  // Mount on the portal host *before* unhiding so the first measurement has a
  // laid-out box to read (a detached list reports 0×0). Inline mode stays in
  // the trigger's parent — CSS anchors it, no fixed coordinates.
  if (state.spec.inline) {
    const host =
      state.spec.inlineHost?.() ?? state.trigger.parentElement ?? state.trigger;
    if (state.list.parentElement !== host) host.appendChild(state.list);
    state.list.hidden = false;
    state.isOpen = true;
    state.trigger.classList.add(state.spec.classes.open);
    state.trigger.setAttribute("aria-expanded", "true");
    state.spec.onPosition?.();
  } else {
    state.floating = mountFloating({
      root: state.list,
      anchor: state.trigger,
      position: () => positionList(state),
      surface: state.spec.surface,
      registerPortalRoot,
    });
    state.list.hidden = false;
    state.isOpen = true;
    state.trigger.classList.add(state.spec.classes.open);
    state.trigger.setAttribute("aria-expanded", "true");
    positionList(state);
  }

  if (!state.spec.inline) {
    if (state.spec.ownDismiss) {
      // Outside press + Escape + focus return, as one primitive (the engine
      // no longer keeps a private copy — icon.ts had a second one that got
      // it wrong twice, and this is the root cause of the "outside press
      // does not close the glyph popup" defect).
      state.mountCleanup.push(
        bindDismiss({
          root: state.list,
          trigger: state.trigger,
          // A portalled list is not inside the trigger's wrapper, so the
          // containment is wrapper + list (the historical ownDismiss rule).
          containment: target =>
            (state.trigger.parentElement?.contains(target) ?? false) ||
            state.list.contains(target),
          onClose: () => close(state, { restoreFocus: false }),
        }),
      );
    }

    // The trigger is the popup's width source and can resize without a window
    // resize (a panel gaining/losing a layout scrollbar lane moves every control
    // inside it by that lane). Follow the trigger, coalesced per frame.
    const followTrigger = throttleRaf(() => {
      if (state.isOpen && !state.spec.inline) positionList(state);
    });
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(followTrigger);
      observer.observe(state.trigger);
      state.mountCleanup.push(() => {
        observer.disconnect();
        followTrigger.cancel();
      });
    }
  }

  // Focus the requested row now that the list is in the DOM and all listeners
  // are installed (the picker lands on the selected row; the dropdown focuses
  // nothing). Doing this before the toggle callback lets the consumer read the
  // focused row.
  if (state.spec.focusOnOpen && state.rowEls.length > 0) {
    let index = 0;
    if (state.spec.focusOnOpen === "selected") {
      const selected = state.spec.selected();
      const found = state.rowEls.findIndex((row, i) =>
        selected.includes(state.spec.items()[i]?.value ?? ""),
      );
      index = found >= 0 ? found : 0;
    } else if (state.spec.focusOnOpen === "last") {
      index = state.rowEls.length - 1;
    }
    const target = enabledFrom(
      state,
      index,
      state.spec.focusOnOpen === "last" ? -1 : 1,
    );
    if (target >= 0) focusOption(state, target);
  }

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
      if (state.spec.triggerKeys === "cycle") return;
      stepFocus(state, key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (state.spec.triggerKeys === "cycle") {
      // The picker cycles the selection without opening, never wrapping:
      // ArrowDown stops at the last enabled scheme, ArrowUp at the first.
      const items = state.spec.items();
      const selected = state.spec.selected();
      const current = items.findIndex(item => selected.includes(item.value));
      if (current < 0) return;
      const step = key === "ArrowDown" ? 1 : -1;
      let index = -1;
      for (let at = current + step; at >= 0 && at < items.length; at += step) {
        if (isEnabled(state, at)) {
          index = at;
          break;
        }
      }
      if (index >= 0 && index !== current) state.spec.onRowActivate(index);
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
  if ((key === "Enter" || key === " ") && state.spec.triggerKeys === "cycle") {
    event.preventDefault();
    event.stopPropagation();
    open(state);
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
  // Gesture containment: the popup must never pan or zoom the map beneath it.
  // Non-inline mode is covered automatically by mountFloating (the unified
  // entry); inline mode mounts inside the trigger's parent (CSS-anchored, no
  // portal) so it binds here via the unified bindFloatingGestures entry.
  // Either way one entry point — no caller remembers a raw touch/wheel bind.
  if (spec.inline) bindFloatingGestures(list);
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
    floating: null,
  };

  const onTriggerClick = (event: MouseEvent): void => {
    // destroy() removes this listener before setting state.destroyed, so the
    // destroyed flag can never be observed here — the guard would be dead.
    // The picker's trigger sits inside a panel whose own handlers must not
    // see the press, so it stops propagation before toggling.
    if (spec.stopTriggerClick) event.stopPropagation();
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

export { createListbox };

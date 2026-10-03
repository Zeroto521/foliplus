// LayerControl UI —Roving keyboard cursor + key handling.
import { HINT_DURATION } from "#core/hint.js";
import { isNativeControl } from "#core/inputOwnership.js";
import { GROUP } from "#core/layer/index.js";
import { ListCursor } from "#core/listCursor.js";
import * as CONST from "../const.js";
import type { LayerAccess } from "./access.js";
import { closeAttrsPanel } from "./attr.js";
import { inFloatingPanel, owningRow } from "./context.js";
import { toggleFold } from "./drag.js";
import {
  cancelFocus,
  focusLayer,
  isFocusing,
  showFocusDisabledHint,
  toggleFocusedLayer,
} from "./focus.js";
import type { FocusStore } from "./focusStore.js";
import { activateDeleteItem, closeMoreMenu, openMoreMenu } from "./menu.js";
import type { PanelStore } from "./panelStore.js";
import { finishRename, renameLayer } from "./rename.js";
import { closeStylePanel } from "./style/index.js";

/** Ensure the shared ListCursor and re-apply ARIA / roving tabindex.
 *  setIndex, not adopt: callers that already painted FOCUSED (keyboard /
 *  restoreCursor) must keep it; only the pointer path adopts (strips). */
const syncListCursor = (la: LayerAccess, ps: PanelStore, fs: FocusStore): void => {
  // initTypesAndVisibility is on a timer and can fire after the panel is
  // torn down (unit tests, control remove) — do not touch a detached root.
  if (!ps.uiContainer?.isConnected) return;
  if (!ps.listCursor) {
    ps.listCursor = new ListCursor({
      root: ps.uiContainer,
      itemSelector: `${CONST.SEL.LAYER_ITEM},${CONST.SEL.TOGGLE_ALL}`,
      activeClass: CONST.CLASSES.FOCUSED,
      mode: "roving",
    });
  }
  ps.listCursor.refresh();
  ps.listCursor.setIndex(ps.activeIdx ?? -1);
};

/** Identity of the row the keyboard cursor points at, for re-homing after a
 *  rebuild: a layer row's id, or a toggle-all row's group. */

const cursorRef = (la: LayerAccess, ps: PanelStore, fs: FocusStore): string | null => {
  if (ps.activeIdx === null) return null;
  const el = getNavigableItems(la, ps, fs)[ps.activeIdx];
  return el
    ? (el.getAttribute(CONST.DATA.LAYER_ID) ?? el.getAttribute("data-group"))
    : null;
};

/** Re-attach the cursor (marker + DOM focus) to the rebuilt row. A row hidden
 *  by folding is not focusable, so the cursor falls back to that group's
 *  toggle-all row. If the row is gone entirely, the cursor is cleared. */

const restoreCursor = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  ref: string | null,
): void => {
  if (ref === null) {
    ps.activeIdx = null;
    return;
  }
  const items = getNavigableItems(la, ps, fs);
  let idx = items.findIndex(
    el =>
      el.getAttribute(CONST.DATA.LAYER_ID) === ref ||
      el.getAttribute("data-group") === ref,
  );
  if (idx !== -1 && items[idx].classList.contains(CONST.CLASSES.GROUP_FOLDED)) {
    const group = items[idx].getAttribute("data-layer-type");
    idx = items.findIndex(
      el =>
        el.classList.contains(CONST.CLASSES.TOGGLE_ALL) &&
        el.getAttribute("data-group") === group,
    );
  }
  if (idx !== -1) setActiveItem(la, ps, fs, idx);
  else clearActiveItem(la, ps, fs);
};

/** Get all keyboard-navigable rows: layer items and toggle-all rows, in DOM
 *  order.
 *
 *  Enumerates the row elements themselves, not their checkboxes. The old
 *  checkbox-first traversal silently dropped any row without a checkbox, so
 *  arrow-key navigation and Tab order could disagree about which rows exist.
 *  Rows are selected by class rather than `[tabindex]` because the inline
 *  rename input is also `tabindex=0` and is not a navigable row. */
const getNavigableItems = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
): HTMLElement[] => {
  return Array.from(
    ps.uiContainer!.querySelectorAll<HTMLElement>(
      `${CONST.SEL.LAYER_ITEM},${CONST.SEL.TOGGLE_ALL}`,
    ),
  );
};

/** Index of the nearest row in `step` direction that is not folded away,
 *  or -1 when the cursor would leave the list. Folded rows are display:none
 *  and not focusable, so a plain index + 1 / - 1 would strand the cursor
 *  on them. */

const findVisibleNeighbor = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  items: HTMLElement[],
  idx: number,
  step: 1 | -1,
): number => {
  for (let i = idx + step; i >= 0 && i < items.length; i += step) {
    if (!items[i].classList.contains(CONST.CLASSES.GROUP_FOLDED)) return i;
  }
  return -1;
};

/** Get the currently focused layer item element. */

const getActiveLayerItem = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
): HTMLElement | null => {
  if (ps.activeIdx === null) return null;
  return getNavigableItems(la, ps, fs)[ps.activeIdx] ?? null;
};

/** Set the active item index and apply focus styling. */

const setActiveItem = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  idx: number,
): void => {
  clearActiveItem(la, ps, fs);
  const items = getNavigableItems(la, ps, fs);
  if (idx < 0 || idx >= items.length) {
    ps.activeIdx = null;
    return;
  }
  const item = items[idx];
  moveActiveMarker(la, ps, fs, item, items);
  item.focus();
};

/** Move the focus marker onto an item. The marker lives on the element as
 *  well as in activeIdx, so it must travel with the cursor — otherwise the
 *  row that was clicked before keeps the marker and reads as the active row.
 *  blurActiveItem() scans the DOM rather than following activeIdx, so a
 *  marker stranded on an old, rebuilt element is picked up too. Callers pass
 *  the item list they already hold rather than re-querying for indexOf. */

const moveActiveMarker = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  item: HTMLElement | null,
  items: HTMLElement[],
): void => {
  blurActiveItem(la, ps, fs);
  // indexOf yields -1 for an item outside the list; normalize it to null so
  // activeIdx never holds an index getActiveLayerItem() would misread.
  const idx = item ? items.indexOf(item) : -1;
  ps.activeIdx = idx === -1 ? null : idx;
  item?.classList.add(CONST.CLASSES.FOCUSED);
  // Tab stop follows the cursor; setIndex does not touch FOCUSED.
  ps.listCursor?.setIndex(ps.activeIdx ?? -1);
};

/** Remove the focus marker from whichever item carries it.
 *  Scans the DOM instead of following activeIdx: a re-render rebuilds the
 *  item elements, leaving the marker on an old, now-detached node. */

const blurActiveItem = (la: LayerAccess, ps: PanelStore, fs: FocusStore): void => {
  ps.uiContainer!.querySelector(`.${CONST.CLASSES.FOCUSED}`)?.classList.remove(
    CONST.CLASSES.FOCUSED,
  );
};

/** Clear the active item state. */

const clearActiveItem = (la: LayerAccess, ps: PanelStore, fs: FocusStore): void => {
  blurActiveItem(la, ps, fs);
  ps.activeIdx = null;
  ps.listCursor?.setIndex(-1);
};

/**
 * Mousedown outside the panel drops the keyboard cursor — the pointer
 * counterpart of Escape, dispatched by InteractionManager (event observed,
 * not swallowed: the press keeps its native behavior). This is a full reset
 * (clearActiveItem, not blurActiveItem): unlike Escape the user has left the
 * panel, so the next ArrowDown re-bootstraps rather than resuming.
 *
 * mousedown (not click) is what makes the target test safe: it fires before
 * the click-driven list rebuild, so the target is still connected — clicking
 * a fold button (which rebuilds the list) stays inside the panel and won't
 * clear it. The class match covers every `.foliplus-layer-ctrl` on the map,
 * not just this instance's container.
 */

const handleOutsideMousedown = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  event: MouseEvent,
): void => {
  const target = event.target as HTMLElement | null;
  if (!target || typeof target.closest !== "function") {
    closeAttrsPanel(la, ps, fs, false);
    closeStylePanel(la, ps, fs, false);
    clearActiveItem(la, ps, fs);
    return;
  }
  // The attributes panel and the style panel are floating surfaces anchored
  // to their row: a press anywhere outside them dismisses them, panel and
  // map alike. One surface per press — the overflow menu keeps its own
  // click-delegated close in interaction.ts, and Escape pops the menu before
  // the panels.
  if (!target.closest(`.${CONST.CLASSES.ATTRS_PANEL}`)) {
    closeAttrsPanel(la, ps, fs, false);
  }
  if (!target.closest(`.${CONST.CLASSES.STYLE_PANEL}`)) {
    closeStylePanel(la, ps, fs, false);
  }
  if (!target.closest(".foliplus-layer-ctrl")) clearActiveItem(la, ps, fs);
};

/** Index of the keyboard cursor from DOM focus, or the previous index.
 *  One ledger: focus on a row (or a child control) *is* the cursor. */

const resolveActiveIdx = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  items: HTMLElement[],
): number | null => {
  const row = owningRow(document.activeElement);
  if (row) {
    const idx = items.indexOf(row);
    if (idx !== -1) {
      ps.activeIdx = idx;
      return idx;
    }
  }
  return ps.activeIdx;
};

/** Align the cursor marker with whichever row resolveActiveIdx() names.
 *  Keep the existing cursor when resolve cannot name a new row. */

const syncActiveItem = (la: LayerAccess, ps: PanelStore, fs: FocusStore): void => {
  const items = getNavigableItems(la, ps, fs);
  const idx = resolveActiveIdx(la, ps, fs, items);
  if (idx === null) return;
  moveActiveMarker(la, ps, fs, items[idx], items);
  ps.listCursor?.setIndex(idx);
};

/** Reindex all layer items after a move, preserving the active focus position.
 *  renderInitialList already re-homes the cursor and restores DOM focus, so
 *  no additional focus work is needed here. */

/**
 * Keyboard event handler for layer navigation and interaction.
 *
 * Ownership is decided before this runs, not here: the dispatcher checks the
 * key-ownership table once and drops the event if the focused control
 * natively consumes the key, so a range slider or a row checkbox parked in
 * the panel never reaches this function. This handler used to re-ask "is
 * focus inside my panel?" itself — the same answer the dispatcher had already
 * settled, which is how a new native control in a panel went unnoticed.
 *
 * Supported shortcuts:
 *   ArrowUp / ArrowDown - Navigate between layer items
 *   ArrowLeft / ArrowRight / Space / Enter - Toggle visibility of focused layer
 *   Ctrl+ArrowUp / Ctrl+ArrowDown - Move focused layer up/down in z-order
 *   Escape - Cancel: inline rename, overflow menu, the attributes panel,
 *     the layer focus overlay, or the row keyboard cursor
 */
const handleKeyDown = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  event: KeyboardEvent,
): void => {
  // Escape discharges whatever is open, in the order the user would
  // dismiss it, and otherwise lifts the keyboard cursor. It runs before the
  // cursor guard below: the point of Escape is to drop the cursor.
  if (event.key === "Escape") {
    if (ps.activeRenameId) {
      // finishRename() removes the input, which blurs it to `<body>`.
      // Restore the row focus the rename started from before dropping the
      // cursor: a cursor parked on <body> leaves the panel unreachable —      // the very next arrow key would not reach this handler. The focusin
      // that fires on the restored row may re-apply the class; the
      // escapeClearCursor() below runs last and wins.
      const layerId = ps.activeRenameId;
      finishRename(la, ps, fs);
      focusLayerRow(la, ps, fs, layerId);
    } else if (ps.activeMenu) {
      // closeMoreMenu returns focus to the row, so the cursor must be
      // dropped after it rather than before.
      closeMoreMenu(la, ps, fs, true);
    } else if (ps.activeAttrsPanel) {
      // The attributes panel and the overflow menu both float from the same
      // ⋮ button, so Escape dismisses whichever is on top.
      closeAttrsPanel(la, ps, fs, true);
    } else if (ps.stylePanelLayerId) {
      // The style panel floats from the same ⋮ button; Escape dismisses it
      // and returns focus to its row (the panel's own controls consume the
      // key first, so this is the fallback for Escape from the row, the map,
      // or a control that does not handle it).
      closeStylePanel(la, ps, fs, true);
    } else if (isFocusing(la, ps, fs)) {
      cancelFocus(la, ps, fs);
    }
    escapeClearCursor(la, ps, fs);
    return;
  }

  const items = getNavigableItems(la, ps, fs);
  if (items.length === 0) return;

  // Re-resolve the cursor from DOM focus. Clicking the label and a re-render
  // both move focus, so a stored index could name a row the user has left.
  // This also establishes the cursor on the very first key.
  syncActiveItem(la, ps, fs);
  const idx = ps.activeIdx;
  if (idx === null || !items[idx]) return;
  const item = items[idx];

  if (event.ctrlKey || event.metaKey) {
    const id = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const moved = la.moveLayerUp(id);
      if (!moved) {
        la.map.foliplus!.showHint(
          CONFIG.name,
          ps.T("reorder_top"),
          HINT_DURATION.SHORT,
        );
      }
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      const moved = la.moveLayerDown(id);
      if (!moved) {
        la.map.foliplus!.showHint(
          CONFIG.name,
          ps.T("reorder_bottom"),
          HINT_DURATION.SHORT,
        );
      }
    }
    const newItems = getNavigableItems(la, ps, fs);
    const next = newItems.findIndex(el => el.getAttribute(CONST.DATA.LAYER_ID) === id);
    // findIndex yields -1 if the row is gone (e.g. layer removed mid-drag);
    // normalize it so activeIdx never holds an invalid index.
    ps.activeIdx = next === -1 ? null : next;
    return;
  }

  // Alt+Enter: focus-layer on the currently navigated layer item. This
  // is a dedicated keyboard entry point (in addition to the overflow menu) so
  // power users can focus without leaving the keyboard.
  if (event.altKey && event.key === "Enter" && ps.activeIdx !== null) {
    const item = items[ps.activeIdx];
    if (item) {
      const layerId = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
      if (layerId) {
        event.preventDefault();
        focusLayer(la, ps, fs, layerId);
        return;
      }
    }
  }

  switch (event.key) {
    case "ArrowUp": {
      event.preventDefault();
      const up = findVisibleNeighbor(la, ps, fs, items, idx, -1);
      if (up !== -1) setActiveItem(la, ps, fs, up);
      break;
    }
    case "ArrowDown": {
      event.preventDefault();
      const down = findVisibleNeighbor(la, ps, fs, items, idx, 1);
      if (down !== -1) setActiveItem(la, ps, fs, down);
      break;
    }
    case "ArrowLeft":
    case "ArrowRight":
    case " ":
    case "Enter": {
      // An overflow-menu button is focused — that key opens the overflow menu, not the
      // row checkbox.
      if (document.activeElement?.classList.contains(CONST.CLASSES.MORE_BTN)) {
        event.preventDefault();
        event.stopPropagation();
        const item = (document.activeElement as HTMLElement).closest(
          CONST.SEL.LAYER_ITEM,
        ) as HTMLElement | null;
        if (item) openMoreMenu(la, ps, fs, item);
        break;
      }
      // The chevron button is focused — that key folds the group, not
      // select-all. Left untouched, resolveActiveIdx() walks up from the
      // button to its toggle-all row and the row checkbox flips instead.
      if (document.activeElement?.classList.contains(CONST.CLASSES.FOLD_BTN)) {
        event.preventDefault();
        event.stopPropagation();
        const row = (document.activeElement as HTMLElement).closest(
          CONST.SEL.TOGGLE_ALL,
        ) as HTMLElement | null;
        if (row) toggleFold(la, ps, fs, row.dataset.group ?? "");
        break;
      }
      // Menu item (li) is focused — trigger the focus-layer action.
      // Skip disabled items so the hidden-layer guard applies to keyboard too.
      const menuLi = ((document.activeElement as HTMLElement | null)?.closest?.(
        ".foliplus-layer-more-menu li",
      ) ?? null) as HTMLElement | null;
      if (menuLi && ps.activeMenu) {
        event.preventDefault();
        event.stopPropagation();
        const action = menuLi.getAttribute("data-action") ?? "";
        if (menuLi.getAttribute("disabled")) {
          // The entry's own title carries the reason (no useful extent, hidden
          // row, no labelable fields, color basemap cannot be deleted), so it
          // is the hint too — a fixed "cannot focus" string would be wrong for
          // every disabled entry but focus. Every menu builder sets a title, so
          // an entry without one has nothing to say.
          const reason = menuLi.getAttribute("title");
          if (reason) {
            la.map.foliplus!.showHint(CONFIG.name, reason, HINT_DURATION.SHORT);
          }
          break;
        }
        if (action === CONST.ACTION.DELETE_LAYER) {
          // Armed in place like the click path: the first Enter arms, the
          // second deletes. While armed the menu stays open.
          if (activateDeleteItem(la, ps, fs, menuLi)) closeMoreMenu(la, ps, fs, true);
          break;
        }
        if (action === CONST.ACTION.RENAME_LAYER) {
          renameLayer(la, ps, fs, ps.activeMenu.layerId);
        } else {
          focusLayer(la, ps, fs, ps.activeMenu.layerId);
          closeMoreMenu(la, ps, fs, true);
        }
        break;
      }
      event.preventDefault();
      toggleFocusedLayer(la, ps, fs);
      break;
    }
  }
};

/** Drop the row keyboard cursor.
 *
 * blurActiveItem() rather than clearActiveItem(): clearActiveItem() resets
 * activeIdx, so the next ArrowUp / ArrowDown would call syncActiveItem() to
 * bootstrap a fresh cursor from document.activeElement — the very row the
 * user just cancelled — and instantly redraw it. Blur-only keeps activeIdx
 * pointing at the last row, so arrow keys resume from there instead of
 * re-lighting the escaped one.
 *
 * Removing the class is sufficient: the CSS recipe keys only on
 * `.foliplus-is-focused-row` + `:hover`, never on `:focus-visible`. DOM
 * focus stays on the row (Escape must not blur to `<body>`), and a later
 * focusin re-applies the class only if the browser still reports
 * keyboard-visible focus. */

const escapeClearCursor = (la: LayerAccess, ps: PanelStore, fs: FocusStore): void => {
  blurActiveItem(la, ps, fs);
};

/** Return DOM focus to a layer's row. Used by the Escape-rename path:
 *  finishRename() removes the inline input, which blurs it to `<body>` and
 *  would leave the panel unreachable. */

const focusLayerRow = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  layerId: string,
): void => {
  if (!ps.uiContainer || !layerId) return;
  ps.uiContainer
    .querySelector<HTMLElement>(`[${CONST.DATA.LAYER_ID}="${CSS.escape(layerId)}"]`)
    ?.focus();
};

/** Double-click on a layer row →focus the map on that layer.
 *  Only dead space on the row counts: every row control is a denylist hit,
 *  and presses inside floating panels (style / attributes) are the panel's
 *  business — two quick toggles / menu clicks / rename edits / label-switch
 *  flips must not zoom the map. */

const handleDblClick = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  event: MouseEvent,
): void => {
  const target = event.target as HTMLElement;
  const item = target.closest(CONST.SEL.LAYER_ITEM) as HTMLElement | null;
  if (!item) return;
  if (inFloatingPanel(target)) return;
  // Every control on the row owns its own press — checkbox, rename field,
  // color picker, ⋮, chevron — so foliplus owns the row's dead space only.
  // One shared predicate rather than a selector list: a new control type is
  // not a new entry here.
  if (
    isNativeControl(target) ||
    target.closest(".foliplus-layer-more-menu, .drag-handle")
  ) {
    return;
  }
  // Base basemap has no meaningful extent to zoom to — explain instead of
  // silently ignoring the double-click. Hidden layers ARE passed through:
  // focusLayer shows the "hidden" hint for them.
  if (item.dataset.layerType === GROUP.BASE) {
    showFocusDisabledHint(la, ps, fs, "base");
    return;
  }
  const layerId = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
  if (!layerId) return;
  focusLayer(la, ps, fs, layerId);
};

export {
  syncListCursor,
  cursorRef,
  restoreCursor,
  getNavigableItems,
  findVisibleNeighbor,
  getActiveLayerItem,
  setActiveItem,
  moveActiveMarker,
  blurActiveItem,
  clearActiveItem,
  handleOutsideMousedown,
  resolveActiveIdx,
  syncActiveItem,
  handleKeyDown,
  escapeClearCursor,
  focusLayerRow,
  handleDblClick,
};

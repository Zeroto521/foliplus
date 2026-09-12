// LayerControl UI 鈥?Roving keyboard cursor + key handling.
import { HINT_DURATION } from "#core/hint.js";
import { ListCursor } from "#core/listCursor.js";
import * as CONST from "../const.js";
import type { LayerUI } from "./index.js";
import { T } from "./context.js";
import { owningRow } from "./context.js";

/** Ensure the shared ListCursor and re-apply ARIA / roving tabindex.
 *  setIndex, not adopt: callers that already painted FOCUSED (keyboard /
 *  restoreCursor) must keep it; only the pointer path adopts (strips). */
const syncListCursor = (ui: LayerUI): void => {
  // initTypesAndVisibility is on a timer and can fire after the panel is
  // torn down (unit tests, control remove) 鈥?do not touch a detached root.
  if (!ui.uiContainer?.isConnected) return;
  if (!ui.listCursor) {
    ui.listCursor = new ListCursor({
      root: ui.uiContainer,
      // Same set as getNavigableItems(): layer rows + toggle-all, no color.
      itemSelector: `${CONST.SEL.LAYER_ITEM}:not(${CONST.SEL.COLOR_ITEM}),${CONST.SEL.TOGGLE_ALL}`,
      activeClass: CONST.CLASSES.FOCUSED,
      mode: "roving",
    });
  }
  ui.listCursor.refresh();
  ui.listCursor.setIndex(ui.activeIdx ?? -1);
};

/** Identity of the row the keyboard cursor points at, for re-homing after a
 *  rebuild: a layer row's id, or a toggle-all row's group. */

const cursorRef = (ui: LayerUI): string | null => {
  if (ui.activeIdx === null) return null;
  const el = ui.getNavigableItems()[ui.activeIdx];
  return el
    ? (el.getAttribute(CONST.DATA.LAYER_ID) ?? el.getAttribute("data-group"))
    : null;
};

/** Re-attach the cursor (marker + DOM focus) to the rebuilt row. A row hidden
 *  by folding is not focusable, so the cursor falls back to that group's
 *  toggle-all row. If the row is gone entirely, the cursor is cleared. */

const restoreCursor = (ui: LayerUI, ref: string | null): void => {
  if (ref === null) {
    ui.activeIdx = null;
    return;
  }
  const items = ui.getNavigableItems();
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
  if (idx !== -1) ui.setActiveItem(idx);
  else ui.clearActiveItem();
};

/** Get all keyboard-navigable rows: layer items and toggle-all rows, in DOM
 *  order. The color item is excluded (it is a picker, not a layer).
 *
 *  Enumerates the row elements themselves, not their checkboxes. The old
 *  checkbox-first traversal silently dropped any row without a checkbox, so
 *  arrow-key navigation and Tab order could disagree about which rows exist.
 *  Rows are selected by class rather than `[tabindex]` because the inline
 *  rename input is also `tabindex=0` and is not a navigable row. */
const getNavigableItems = (ui: LayerUI): HTMLElement[] => {
  return Array.from(
    ui.uiContainer.querySelectorAll<HTMLElement>(
      `${CONST.SEL.LAYER_ITEM},${CONST.SEL.TOGGLE_ALL}`,
    ),
  ).filter(el => !el.classList.contains(CONST.CLASSES.COLOR_ITEM));
};

/** Index of the nearest row in `step` direction that is not folded away,
 *  or -1 when the cursor would leave the list. Folded rows are display:none
 *  and not focusable, so plain index 卤 1 would strand the cursor on them. */

const findVisibleNeighbor = ( ui: LayerUI, items: HTMLElement[], idx: number, step: 1 | -1, ): number => {
  for (let i = idx + step; i >= 0 && i < items.length; i += step) {
    if (!items[i].classList.contains(CONST.CLASSES.GROUP_FOLDED)) return i;
  }
  return -1;
};

/** Get the currently focused layer item element. */

const getActiveLayerItem = (ui: LayerUI): HTMLElement | null => {
  if (ui.activeIdx === null) return null;
  return ui.getNavigableItems()[ui.activeIdx] ?? null;
};

/** Set the active item index and apply focus styling. */

const setActiveItem = (ui: LayerUI, idx: number): void => {
  ui.clearActiveItem();
  const items = ui.getNavigableItems();
  if (idx < 0 || idx >= items.length) {
    ui.activeIdx = null;
    return;
  }
  const item = items[idx];
  ui.moveActiveMarker(item, items);
  item.focus();
};

/** Move the focus marker onto an item. The marker lives on the element as
 *  well as in activeIdx, so it must travel with the cursor 鈥?otherwise the
 *  row that was clicked before keeps the marker and reads as the active row.
 *  blurActiveItem() scans the DOM rather than following activeIdx, so a
 *  marker stranded on an old, rebuilt element is picked up too. Callers pass
 *  the item list they already hold rather than re-querying for indexOf. */

const moveActiveMarker = ( ui: LayerUI, item: HTMLElement | null, items: HTMLElement[], ): void => {
  ui.blurActiveItem();
  // indexOf yields -1 for an item outside the list; normalize it to null so
  // activeIdx never holds an index getActiveLayerItem() would misread.
  const idx = item ? items.indexOf(item) : -1;
  ui.activeIdx = idx === -1 ? null : idx;
  item?.classList.add(CONST.CLASSES.FOCUSED);
  // Tab stop follows the cursor; setIndex does not touch FOCUSED.
  ui.listCursor?.setIndex(ui.activeIdx ?? -1);
};

/** Remove the focus marker from whichever item carries it.
 *  Scans the DOM instead of following activeIdx: a re-render rebuilds the
 *  item elements, leaving the marker on an old, now-detached node. */

const blurActiveItem = (ui: LayerUI): void => {
  ui.uiContainer
    .querySelector(`.${CONST.CLASSES.FOCUSED}`)
    ?.classList.remove(CONST.CLASSES.FOCUSED);
};

/** Clear the active item state. */

const clearActiveItem = (ui: LayerUI): void => {
  ui.blurActiveItem();
  ui.activeIdx = null;
  ui.listCursor?.setIndex(-1);
};

/**
 * Mousedown outside the panel drops the keyboard cursor 鈥?the pointer
 * counterpart of Escape, dispatched by InteractionManager (event observed,
 * not swallowed: the press keeps its native behavior). This is a full reset
 * (clearActiveItem, not blurActiveItem): unlike Escape the user has left the
 * panel, so the next ArrowDown re-bootstraps rather than resuming.
 *
 * mousedown (not click) is what makes the target test safe: it fires before
 * the click-driven list rebuild, so the target is still connected 鈥?clicking
 * a fold button (which rebuilds the list) stays inside the panel and won't
 * clear it. The class match covers every `.foliplus-layer-ctrl` on the map,
 * not just this instance's container.
 */

const handleOutsideMousedown = (ui: LayerUI, event: MouseEvent): void => {
  const target = event.target as HTMLElement | null;
  if (!target || typeof target.closest !== "function") {
    ui.closeAttrsPanel(false);
    ui.clearActiveItem();
    return;
  }
  // The attributes panel is a floating surface anchored to its row: a press
  // anywhere outside it dismisses it, panel and map alike. One surface per
  // press 鈥?the overflow menu keeps its own click-delegated close in
  // interaction.ts, and Escape pops the menu before the panel.
  if (!target.closest(`.${CONST.CLASSES.ATTRS_PANEL}`)) ui.closeAttrsPanel(false);
  if (!target.closest(".foliplus-layer-ctrl")) ui.clearActiveItem();
};

/** Index of the keyboard cursor from DOM focus, or the previous index.
 *  One ledger: focus on a row (or a child control) *is* the cursor. */

const resolveActiveIdx = (ui: LayerUI, items: HTMLElement[]): number | null => {
  const row = owningRow(document.activeElement);
  if (row) {
    const idx = items.indexOf(row);
    if (idx !== -1) {
      ui.activeIdx = idx;
      return idx;
    }
  }
  return ui.activeIdx;
};

/** Align the cursor marker with whichever row resolveActiveIdx() names.
 *  Keep the existing cursor when resolve cannot name a new row. */

const syncActiveItem = (ui: LayerUI): void => {
  const items = ui.getNavigableItems();
  const idx = ui.resolveActiveIdx(items);
  if (idx === null) return;
  ui.moveActiveMarker(items[idx], items);
  ui.listCursor?.setIndex(idx);
};

/** Reindex all layer items after a move, preserving the active focus position.
 *  renderInitialList already re-homes the cursor and restores DOM focus, so
 *  no additional focus work is needed here. */

/**
 * Keyboard event handler for layer navigation and interaction.
 * Only responds when focus is within the layer panel.
 *
 * Supported shortcuts:
 *   ArrowUp / ArrowDown - Navigate between layer items
 *   ArrowLeft / ArrowRight / Space / Enter - Toggle visibility of focused layer
 *   Ctrl+ArrowUp / Ctrl+ArrowDown - Move focused layer up/down in z-order
 *   Escape - Cancel: inline rename, overflow menu, the attributes panel,
 *     the layer focus overlay, or the row keyboard cursor
 */
const handleKeyDown = (ui: LayerUI, event: KeyboardEvent): void => {
  if (!ui.uiContainer.contains(document.activeElement)) return;

  // Escape discharges whatever is open, in the order the user would
  // dismiss it, and otherwise lifts the keyboard cursor. It runs before the
  // cursor guard below: the point of Escape is to drop the cursor.
  if (event.key === "Escape") {
    if (ui.activeRenameId) {
      // finishRename() removes the input, which blurs it to `<body>`.
      // Restore the row focus the rename started from before dropping the
      // cursor: a cursor parked on <body> leaves the panel unreachable 鈥?      // the very next arrow key would not reach this handler. The focusin
      // that fires on the restored row may re-apply the class; the
      // escapeClearCursor() below runs last and wins.
      const layerId = ui.activeRenameId;
      ui.finishRename();
      ui.focusLayerRow(layerId);
    } else if (ui.activeMenu) {
      // closeMoreMenu returns focus to the row, so the cursor must be
      // dropped after it rather than before.
      ui.closeMoreMenu(true);
    } else if (ui.activeAttrsPanel) {
      // The attributes panel and the overflow menu both float from the same
      // 鈰?button, so Escape dismisses whichever is on top.
      ui.closeAttrsPanel(true);
    } else if (ui.isFocusing()) {
      ui.cancelFocus();
    }
    ui.escapeClearCursor();
    return;
  }

  const items = ui.getNavigableItems();
  if (items.length === 0) return;

  // Re-resolve the cursor from DOM focus. Clicking the label and a re-render
  // both move focus, so a stored index could name a row the user has left.
  // This also establishes the cursor on the very first key.
  ui.syncActiveItem();
  const idx = ui.activeIdx;
  if (idx === null || !items[idx]) return;
  const item = items[idx];

  if (event.ctrlKey || event.metaKey) {
    const id = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const moved = ui.m.moveLayerUp(id);
      if (!moved) {
        map.foliplus!.showHint(CONF.name, T("reorder_top"), HINT_DURATION.SHORT);
      }
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      const moved = ui.m.moveLayerDown(id);
      if (!moved) {
        map.foliplus!.showHint(CONF.name, T("reorder_bottom"), HINT_DURATION.SHORT);
      }
    }
    const newItems = ui.getNavigableItems();
    const next = newItems.findIndex(el => el.getAttribute(CONST.DATA.LAYER_ID) === id);
    // findIndex yields -1 if the row is gone (e.g. layer removed mid-drag);
    // normalize it so activeIdx never holds an invalid index.
    ui.activeIdx = next === -1 ? null : next;
    return;
  }

  // Alt+Enter: focus-layer on the currently navigated layer item. This
  // is a dedicated keyboard entry point (in addition to the 鈰?menu) so
  // power users can focus without leaving the keyboard.
  if (event.altKey && event.key === "Enter" && ui.activeIdx !== null) {
    const item = items[ui.activeIdx];
    if (item) {
      const layerId = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
      if (layerId) {
        event.preventDefault();
        ui.focusLayer(layerId);
        return;
      }
    }
  }

  switch (event.key) {
    case "ArrowUp": {
      event.preventDefault();
      const up = ui.findVisibleNeighbor(items, idx, -1);
      if (up !== -1) ui.setActiveItem(up);
      break;
    }
    case "ArrowDown": {
      event.preventDefault();
      const down = ui.findVisibleNeighbor(items, idx, 1);
      if (down !== -1) ui.setActiveItem(down);
      break;
    }
    case "ArrowLeft":
    case "ArrowRight":
    case " ":
    case "Enter": {
      // A 鈰?button is focused 鈥?that key opens the overflow menu, not the
      // row checkbox.
      if (document.activeElement?.classList.contains(CONST.CLASSES.MORE_BTN)) {
        event.preventDefault();
        event.stopPropagation();
        const item = (document.activeElement as HTMLElement).closest(
          CONST.SEL.LAYER_ITEM,
        ) as HTMLElement | null;
        if (item) ui.openMoreMenu(item);
        break;
      }
      // The chevron button is focused 鈥?that key folds the group, not
      // select-all. Left untouched, resolveActiveIdx() walks up from the
      // button to its toggle-all row and the row checkbox flips instead.
      if (document.activeElement?.classList.contains(CONST.CLASSES.FOLD_BTN)) {
        event.preventDefault();
        event.stopPropagation();
        const row = (document.activeElement as HTMLElement).closest(
          CONST.SEL.TOGGLE_ALL,
        ) as HTMLElement | null;
        if (row) ui.toggleFold(row.dataset.group ?? "");
        break;
      }
      // Menu item (li) is focused 鈥?trigger the focus-layer action.
      // Skip disabled items so the hidden-layer guard applies to keyboard too.
      const menuLi = (document.activeElement as HTMLElement | null)?.closest?.(
        ".foliplus-layer-more-menu li",
      );
      if (menuLi && ui.activeMenu) {
        event.preventDefault();
        event.stopPropagation();
        const action = menuLi.getAttribute("data-action") ?? "";
        if (menuLi.getAttribute("disabled")) {
          ui.m.map.foliplus!.showHint(
            CONF.name,
            T("focus_layer_hidden"),
            HINT_DURATION.SHORT,
          );
          break;
        }
        if (action === CONST.ACTION.RENAME_LAYER) {
          ui.renameLayer(ui.activeMenu.layerId);
        } else {
          ui.focusLayer(ui.activeMenu.layerId);
          ui.closeMoreMenu(true);
        }
        break;
      }
      event.preventDefault();
      ui.toggleFocusedLayer();
      break;
    }
  }
};

/** Drop the row keyboard cursor.
 *
 * blurActiveItem() rather than clearActiveItem(): clearActiveItem() resets
 * activeIdx, so the next ArrowUp / ArrowDown would call syncActiveItem() to
 * bootstrap a fresh cursor from document.activeElement 鈥?the very row the
 * user just cancelled 鈥?and instantly redraw it. Blur-only keeps activeIdx
 * pointing at the last row, so arrow keys resume from there instead of
 * re-lighting the escaped one.
 *
 * Removing the class is sufficient: the CSS recipe keys only on
 * `.foliplus-layer-focused` + `:hover`, never on `:focus-visible`. DOM
 * focus stays on the row (Escape must not blur to `<body>`), and a later
 * focusin re-applies the class only if the browser still reports
 * keyboard-visible focus. */

const escapeClearCursor = (ui: LayerUI): void => {
  ui.blurActiveItem();
};

/** Return DOM focus to a layer's row. Used by the Escape-rename path:
 *  finishRename() removes the inline input, which blurs it to `<body>` and
 *  would leave the panel unreachable. */

const focusLayerRow = (ui: LayerUI, layerId: string): void => {
  if (!ui.uiContainer || !layerId) return;
  ui.uiContainer
    .querySelector<HTMLElement>(`[${CONST.DATA.LAYER_ID}="${CSS.escape(layerId)}"]`)
    ?.focus();
};

/** Double-click on a layer row 鈫?focus the map on that layer.
 *  Only dead space on the row counts. Every control on the row is a
 *  denylist hit: two quick toggles / menu clicks / rename edits must not
 *  zoom the map. */

const handleDblClick = (ui: LayerUI, event: MouseEvent): void => {
  const target = event.target as HTMLElement;
  const item = target.closest(CONST.SEL.LAYER_ITEM) as HTMLElement | null;
  if (!item) return;
  if (
    target.closest(
      [
        "input",
        "button",
        `.${CONST.CLASSES.MORE_BTN}`,
        `.${CONST.CLASSES.FOLD_BTN}`,
        `.${CONST.CLASSES.RENAME_INPUT}`,
        `.${CONST.CLASSES.COLOR_INPUT}`,
        ".foliplus-layer-more-menu",
        ".drag-handle",
      ].join(","),
    )
  ) {
    return;
  }
  // Base basemap / color picker have no meaningful extent to zoom to 鈥?  // explain instead of silently ignoring the double-click. Hidden layers
  // ARE passed through: focusLayer shows the "hidden" hint for them.
  if (item.classList.contains(CONST.CLASSES.COLOR_ITEM)) {
    ui.showBaseFocusHint();
    return;
  }
  if (item.dataset.layerType === CONST.GROUP.BASE) {
    ui.showBaseFocusHint();
    return;
  }
  const layerId = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
  if (!layerId) return;
  ui.focusLayer(layerId);
};

/** Basemaps / color pickers cannot be focused 鈥?hint instead of silence. */

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

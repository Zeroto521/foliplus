// LayerControl UI — Roving cursor state + navigation primitives.
// Owns the activeIdx / FOCUSED-marker / ListCursor bookkeeping; both the list
// rebuild path (list.ts) and the keyboard handler (keyboard.ts) delegate here
// so they don't need to import each other.
import { ListCursor } from "#core/listCursor.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import { owningRow } from "../context.js";
import type { LayerUI } from "../surface.js";

/** Ensure the shared ListCursor and re-apply ARIA / roving tabindex.
 *  setIndex, not adopt: callers that already painted FOCUSED (keyboard /
 *  restoreCursor) must keep it; only the pointer path adopts (strips). */
const syncListCursor = (ui: LayerUI): void => {
  // initTypesAndVisibility is on a timer and can fire after the panel is
  // torn down (unit tests, control remove) — do not touch a detached root.
  if (!ui.uiContainer?.isConnected) return;
  ui.listPanel.listCursor ??= new ListCursor({
    root: ui.uiContainer,
    itemSelector: `${CONST.SEL.LAYER_ITEM},${CONST.SEL.TOGGLE_ALL}`,
    activeClass: CONST.CLASSES.FOCUSED,
    mode: "roving",
  });
  ui.listPanel.listCursor.refresh();
  ui.listPanel.listCursor.setIndex(ui.listPanel.activeIdx ?? -1);
};

/** Identity of the row the keyboard cursor points at, for re-homing after a
 *  rebuild: a layer row's id, or a toggle-all row's group. */

const cursorRef = (ui: LayerUI): string | null => {
  if (ui.listPanel.activeIdx === null) return null;
  const el = getNavigableItems(ui)[ui.listPanel.activeIdx];
  return el
    ? (el.getAttribute(CONST.DATA.LAYER_ID) ?? el.getAttribute("data-group"))
    : null;
};

/** Re-attach the cursor (marker + DOM focus) to the rebuilt row. A row hidden
 *  by folding is not focusable, so the cursor falls back to that group's
 *  toggle-all row. If the row is gone entirely, the cursor is cleared. */

const restoreCursor = (ui: LayerUI, ref: string | null): void => {
  if (ref === null) {
    ui.listPanel.activeIdx = null;
    return;
  }
  const items = getNavigableItems(ui);
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
  if (idx !== -1) setActiveItem(ui, idx);
  else clearActiveItem(ui);
};

/** Get all keyboard-navigable rows: layer items and toggle-all rows, in DOM
 *  order.
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
  );
};

/** Index of the nearest row in `step` direction that is not folded away,
 *  or -1 when the cursor would leave the list. Folded rows are display:none
 *  and not focusable, so a plain index + 1 / - 1 would strand the cursor
 *  on them. */

const findVisibleNeighbor = (
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

const getActiveLayerItem = (ui: LayerUI): HTMLElement | null => {
  if (ui.listPanel.activeIdx === null) return null;
  return getNavigableItems(ui)[ui.listPanel.activeIdx] ?? null;
};

/** Set the active item index and apply focus styling. */

const setActiveItem = (ui: LayerUI, idx: number): void => {
  clearActiveItem(ui);
  const items = getNavigableItems(ui);
  if (idx < 0 || idx >= items.length) {
    ui.listPanel.activeIdx = null;
    return;
  }
  const item = items[idx];
  moveActiveMarker(ui, item, items);
  item.focus();
};

/** Move the focus marker onto an item. The marker lives on the element as
 *  well as in activeIdx, so it must travel with the cursor — otherwise the
 *  row that was clicked before keeps the marker and reads as the active row.
 *  blurActiveItem() scans the DOM rather than following activeIdx, so a
 *  marker stranded on an old, rebuilt element is picked up too. Callers pass
 *  the item list they already hold rather than re-querying for indexOf. */

const moveActiveMarker = (
  ui: LayerUI,
  item: HTMLElement | null,
  items: HTMLElement[],
): void => {
  blurActiveItem(ui);
  // indexOf yields -1 for an item outside the list; normalize it to null so
  // activeIdx never holds an index getActiveLayerItem() would misread.
  const idx = item ? items.indexOf(item) : -1;
  ui.listPanel.activeIdx = idx === -1 ? null : idx;
  item?.classList.add(CONST.CLASSES.FOCUSED);
  // Tab stop follows the cursor; setIndex does not touch FOCUSED.
  ui.listPanel.listCursor?.setIndex(ui.listPanel.activeIdx ?? -1);
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
  blurActiveItem(ui);
  ui.listPanel.activeIdx = null;
  ui.listPanel.listCursor?.setIndex(-1);
};

/** Index of the keyboard cursor from DOM focus, or the previous index.
 *  One ledger: focus on a row (or a child control) *is* the cursor. */

const resolveActiveIdx = (ui: LayerUI, items: HTMLElement[]): number | null => {
  const row = owningRow(document.activeElement);
  if (row) {
    const idx = items.indexOf(row);
    if (idx !== -1) {
      ui.listPanel.activeIdx = idx;
      return idx;
    }
  }
  return ui.listPanel.activeIdx;
};

/** Align the cursor marker with whichever row resolveActiveIdx() names.
 *  Keep the existing cursor when resolve cannot name a new row. */

const syncActiveItem = (ui: LayerUI): void => {
  const items = getNavigableItems(ui);
  const idx = resolveActiveIdx(ui, items);
  if (idx === null) return;
  moveActiveMarker(ui, items[idx], items);
  ui.listPanel.listCursor?.setIndex(idx);
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
  resolveActiveIdx,
  syncActiveItem,
};

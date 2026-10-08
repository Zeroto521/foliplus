// LayerControl UI — Row keyboard events (navigation, toggle, menu).
// The roving cursor state lives in ./cursor.js; this module owns the key
// handler and the mousedown/dblclick listeners that call into it.
import { HINT_DURATION } from "#core/hint.js";
import { isNativeControl } from "#core/interaction/index.js";
import { GROUP } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import { inFloatingPanel } from "../context.js";
import { showFocusDisabledHint, toggleFocusedLayer } from "../focus.js";
import { activateDeleteItem } from "../overlayPanel/menu.js";
import type { LayerUI } from "../surface.js";
import {
  blurActiveItem,
  clearActiveItem,
  findVisibleNeighbor,
  getNavigableItems,
  setActiveItem,
  syncActiveItem,
} from "./cursor.js";
import { toggleFold } from "./drag.js";

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

const handleOutsideMousedown = (ui: LayerUI, event: MouseEvent): void => {
  const target = event.target as HTMLElement | null;
  if (!target || typeof target.closest !== "function") {
    ui.closeAttrsPanel(false);
    ui.closeStylePanel(false);
    clearActiveItem(ui);
    return;
  }
  // The attributes panel and the style panel are floating surfaces anchored
  // to their row: a press anywhere outside them dismisses them, panel and
  // map alike. One surface per press — the overflow menu keeps its own
  // click-delegated close in interaction.ts, and Escape pops the menu before
  // the panels.
  if (!target.closest(`.${CONST.CLASSES.ATTRS_PANEL}`)) ui.closeAttrsPanel(false);
  if (!target.closest(`.${CONST.CLASSES.STYLE_PANEL}`)) ui.closeStylePanel(false);
  if (!target.closest(".foliplus-layer-ctrl")) clearActiveItem(ui);
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
const handleKeyDown = (ui: LayerUI, event: KeyboardEvent): void => {
  // Escape discharges whatever is open, in the order the user would
  // dismiss it, and otherwise lifts the keyboard cursor. It runs before the
  // cursor guard below: the point of Escape is to drop the cursor.
  if (event.key === "Escape") {
    if (ui.overlayPanel.activeRenameId) {
      // finishRename() removes the input, which blurs it to `<body>`.
      // Restore the row focus the rename started from before dropping the
      // cursor: a cursor parked on <body> leaves the panel unreachable —      // the very next arrow key would not reach this handler. The focusin
      // that fires on the restored row may re-apply the class; the
      // escapeClearCursor() below runs last and wins.
      const layerId = ui.overlayPanel.activeRenameId;
      ui.finishRename();
      focusLayerRow(ui, layerId);
    } else if (ui.overlayPanel.activeMenu) {
      // closeMoreMenu returns focus to the row, so the cursor must be
      // dropped after it rather than before.
      ui.closeMoreMenu(true);
    } else if (ui.overlayPanel.activeAttrsPanel) {
      // The attributes panel and the overflow menu both float from the same
      // ⋮ button, so Escape dismisses whichever is on top.
      ui.closeAttrsPanel(true);
    } else if (ui.overlayPanel.stylePanelLayerId) {
      // The style panel floats from the same ⋮ button; Escape dismisses it
      // and returns focus to its row (the panel's own controls consume the
      // key first, so this is the fallback for Escape from the row, the map,
      // or a control that does not handle it).
      ui.closeStylePanel(true);
    } else if (ui.isFocusing()) {
      ui.cancelFocus();
    }
    escapeClearCursor(ui);
    return;
  }

  const items = getNavigableItems(ui);
  if (items.length === 0) return;

  // Re-resolve the cursor from DOM focus. Clicking the label and a re-render
  // both move focus, so a stored index could name a row the user has left.
  // This also establishes the cursor on the very first key.
  syncActiveItem(ui);
  const idx = ui.listPanel.activeIdx;
  if (idx === null || !items[idx]) return;
  const item = items[idx];

  if (event.ctrlKey || event.metaKey) {
    const id = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const moved = ui.c.moveLayerUp(id);
      if (!moved) {
        ui.c.map.foliplus!.showHint(
          ui.config.name,
          ui.T("reorder_top"),
          HINT_DURATION.SHORT,
        );
      }
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      const moved = ui.c.moveLayerDown(id);
      if (!moved) {
        ui.c.map.foliplus!.showHint(
          ui.config.name,
          ui.T("reorder_bottom"),
          HINT_DURATION.SHORT,
        );
      }
    }
    const newItems = getNavigableItems(ui);
    const next = newItems.findIndex(el => el.getAttribute(CONST.DATA.LAYER_ID) === id);
    // findIndex yields -1 if the row is gone (e.g. layer removed mid-drag);
    // normalize it so activeIdx never holds an invalid index.
    ui.listPanel.activeIdx = next === -1 ? null : next;
    return;
  }

  // Alt+Enter: focus-layer on the currently navigated layer item. This
  // is a dedicated keyboard entry point (in addition to the overflow menu) so
  // power users can focus without leaving the keyboard.
  if (event.altKey && event.key === "Enter") {
    const layerId = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
    if (layerId) {
      event.preventDefault();
      ui.focusLayer(layerId);
      return;
    }
  }

  switch (event.key) {
    case "ArrowUp": {
      event.preventDefault();
      const up = findVisibleNeighbor(items, idx, -1);
      if (up !== -1) setActiveItem(ui, up);
      break;
    }
    case "ArrowDown": {
      event.preventDefault();
      const down = findVisibleNeighbor(items, idx, 1);
      if (down !== -1) setActiveItem(ui, down);
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
        const menuItem = (document.activeElement as HTMLElement).closest(
          CONST.SEL.LAYER_ITEM,
        ) as HTMLElement | null;
        if (menuItem) ui.openMoreMenu(menuItem);
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
        if (row) toggleFold(ui, row.dataset.group ?? "");
        break;
      }
      // Menu item (li) is focused — trigger the focus-layer action.
      // Skip disabled items so the hidden-layer guard applies to keyboard too.
      const menuLi = ((document.activeElement as HTMLElement | null)?.closest?.(
        ".foliplus-layer-more-menu li",
      ) ?? null) as HTMLElement | null;
      if (menuLi && ui.overlayPanel.activeMenu) {
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
            ui.c.map.foliplus!.showHint(ui.config.name, reason, HINT_DURATION.SHORT);
          }
          break;
        }
        if (action === CONST.ACTION.DELETE_LAYER) {
          // Armed in place like the click path: the first Enter arms, the
          // second deletes. While armed the menu stays open.
          if (activateDeleteItem(ui, menuLi)) ui.closeMoreMenu(true);
          break;
        }
        if (action === CONST.ACTION.RENAME_LAYER) {
          ui.renameLayer(ui.overlayPanel.activeMenu.layerId);
        } else {
          ui.focusLayer(ui.overlayPanel.activeMenu.layerId);
          ui.closeMoreMenu(true);
        }
        break;
      }
      event.preventDefault();
      toggleFocusedLayer(ui);
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

const escapeClearCursor = (ui: LayerUI): void => {
  blurActiveItem(ui);
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

/** Double-click on a layer row → focus the map on that layer.
 *  Only dead space on the row counts: every row control is a denylist hit,
 *  and presses inside floating panels (style / attributes) are the panel's
 *  business — two quick toggles / menu clicks / rename edits / label-switch
 *  flips must not zoom the map. */

const handleDblClick = (ui: LayerUI, event: MouseEvent): void => {
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
    showFocusDisabledHint(ui, "base");
    return;
  }
  const layerId = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
  if (!layerId) return;
  ui.focusLayer(layerId);
};

export {
  handleOutsideMousedown,
  handleKeyDown,
  escapeClearCursor,
  focusLayerRow,
  handleDblClick,
};

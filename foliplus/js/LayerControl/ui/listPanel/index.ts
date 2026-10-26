// LayerControl UI — ListPanel subsystem: rows, cursor, drag-reorder, fold.
//
// This is the first of the three view subsystems carved out of LayerUI. The
// controller (LayerController) owns domain state; the view subsystems own
// per-panel state that only makes sense in the panel's own lifetime — fold
// state, the roving cursor index, the in-flight drag, the press-in-panel
// verdict. LayerUI holds a reference to this subsystem so shared modules
// (lifecycle, state) can still reach the panel's state.
//
// Cross-subsystem and intra-subsystem callers all take LayerUI and reach
// into `ui.listPanel.*` directly; no module receives a bare ListPanel.
import type { ListCursor } from "#core/interaction/index.js";
import type { LayerInfo } from "#core/layer/index.js";
import {
  blurActiveItem,
  clearActiveItem,
  cursorRef,
  findVisibleNeighbor,
  getActiveLayerItem,
  getNavigableItems,
  moveActiveMarker,
  reconcileCursorByIdentity,
  resolveActiveIdx,
  restoreCursor,
  setActiveItem,
  syncActiveItem,
  syncListCursor,
} from "./cursor.js";
import {
  clearDragState,
  handleDragEnd,
  handleDragLeave,
  handleDragOver,
  handleDragStart,
  handleDrop,
  showReorderBlockedHint,
  toggleFold,
} from "./drag.js";
import { handleDblClick, handleKeyDown, handleOutsideMousedown } from "./keyboard.js";
import {
  colorLayerName,
  initLayerItem,
  initTypesAndVisibility,
  insertLayerItem,
  markSettled,
  rebuildList,
  renderInitialList,
  renderLayerItem,
  renderToggleAllRow,
  syncRowOrder,
  updateLayerItemLabel,
} from "./list.js";
import {
  type RowCell,
  type RowLabels,
  type RowView,
  applyRowView,
  buildRowCell,
  displayName,
  inZoomRange,
  rowView,
} from "./rowView.js";
import {
  applyVisibility,
  bumpCheckedCount,
  getLayerItems,
  handleChange,
  syncNoBasemap,
  syncToggleAll,
  syncToggleAllFromCount,
  toggleAll,
} from "./visibility.js";

/** View subsystem that owns the panel's row layout state: which groups are
 *  folded, which rows are checked, where the roving keyboard cursor sits,
 *  and the in-flight drag. Nothing here is domain — none of these fields
 *  persist across page reloads except what `state.ts` writes through the
 *  `ui.c.persistence` channel. */
class ListPanel {
  /** Per-group fold state. Persisted through `ui.c.persistence` on change. */
  foldedGroups: Set<string> = new Set();
  /** Per-group tri-state checkbox counts. Rebuilt by the full-scan
   *  `syncToggleAll` at reconcile points; kept in sync by
   *  `bumpCheckedCount` on each single-row toggle. */
  checkedCount: Record<string, { total: number; on: number }> = {};
  /** Index of the currently-navigable row the cursor is parked on, or null
   *  when the cursor is cleared (Escape, outside press). */
  activeIdx: number | null = null;
  /** Shared ARIA roving-tabindex controller on the panel's row set. */
  listCursor: ListCursor | null = null;
  /** The registry entry the in-flight drag armed with, or null. Identity,
   *  not position: the gesture spans events and timers, and reordering in
   *  between would re-point a saved index at a neighbor — the entry is
   *  re-resolved through the registry at every use, which also retires the
   *  session when the entry is unregistered or replaced under its id. */
  dragEntry: LayerInfo | null = null;
  /** Wall-clock timestamp of the last drag hint shown; used to enforce the
   *  hint cooldown so a fast drag does not spam the tooltip. */
  lastDragHintAt: number = 0;
  /** Last element the drag pointer hovered; used to move the
   *  `DRAG_OVER_TOP` / `DRAG_OVER_BOTTOM` class as the pointer moves. */
  lastDragOverItem: HTMLElement | null = null;
  /** True when the current pointer press began inside a floating row panel.
   *  Written by the panel's document-level capture handler; read by
   *  `handleDragStart` because the drag event is dispatched on the row, not
   *  the panel. */
  pressInPanel: boolean = false;
  /** Cleanup for the interaction manager (keyboard nav, drag gestures) —
   *  called once on unbind. */
  interactionCleanup?: () => void;
}

export {
  initTypesAndVisibility,
  markSettled,
  rebuildList,
  syncRowOrder,
  renderInitialList,
  insertLayerItem,
  updateLayerItemLabel,
  renderToggleAllRow,
  renderLayerItem,
  colorLayerName,
  initLayerItem,
};
export { ListPanel };
export {
  applyRowView,
  buildRowCell,
  displayName,
  inZoomRange,
  rowView,
  type RowCell,
  type RowLabels,
  type RowView,
};
export {
  toggleFold,
  handleDragStart,
  showReorderBlockedHint,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleDragEnd,
  clearDragState,
};
export {
  syncListCursor,
  cursorRef,
  restoreCursor,
  reconcileCursorByIdentity,
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
export { handleOutsideMousedown, handleKeyDown, handleDblClick };
export {
  getLayerItems,
  toggleAll,
  syncToggleAll,
  syncToggleAllFromCount,
  bumpCheckedCount,
  syncNoBasemap,
  applyVisibility,
  handleChange,
};

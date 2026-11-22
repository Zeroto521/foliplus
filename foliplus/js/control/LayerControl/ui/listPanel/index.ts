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
  groupCountTooltip,
  inZoomRange,
  roleCountText,
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
import type { ListCursor } from "#core/interaction/index.js";
import type { LayerInfo } from "#core/layer/index.js";

/** View subsystem that owns the panel's row layout state: which groups are
 *  folded, which rows are checked, where the roving keyboard cursor sits,
 *  and the in-flight drag. Nothing here is domain — none of these fields
 *  persist across page reloads except what `state.ts` writes through the
 *  `ui.c.persistence` channel. */
class ListPanel {
  /** Per-role user fold opinion. Record<role, boolean>: key = role, value =
   *  true (fold) / false (explicit expand); absent key = no user opinion.
   *  Persisted through `ui.c.persistence` on change. The tri-state (not a
   *  Set) is what lets a user expand an author-folded role and keep it
   *  expanded across a reload. */
  foldedRoles: Record<string, boolean> = {};
  /** Per-folder fold state: `role::normalizedFolderName` → folded. A
   *  tri-state user opinion (absent = never touched), so an explicit EXPAND
   *  over an author default fold survives. Author defaults sit below it,
   *  built-in "all expanded" below that. Persisted through the same channel. */
  foldedFolders: Record<string, boolean> = {};
  /** The author's declared default folded-folder key set, derived from
   *  `CONF.folders` (never persisted — it is author config baked into the
   *  page, so a reload always re-derives it). This is the "default" layer of
   *  the fold state: the user override (foldedFolders) is checked
   *  first and this falls back under it. See control/LayerControl/declaredFolder.ts. */
  authorFoldedFolders: Set<string> = new Set();
  /** The author's declared default folded role map, derived from
   *  `CONF.roles` (never persisted — it is author config baked into the
   *  page, so a reload always re-derives it). The user override
   *  (foldedRoles) is checked first and this falls back under it. See
   *  control/LayerControl/declaredRole.ts. */
  authorDefaultFoldedRoles: Record<string, boolean> = {};
  /** Per-role tri-state checkbox counts. Rebuilt by the full-scan
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
  /** The folder block the in-flight drag armed with, or null. A folder drag
   *  moves the whole block (row + members), so it carries the block identity
   *  (role + normalized key) instead of a registry entry. */
  dragFolder: { role: string; key: string } | null = null;
  /** Whether the dragged folder was already folded when the gesture began, so
   *  dragend restores the pre-drag state instead of unfolding a folder the
   *  user had folded themselves. */
  dragFolderWasFolded: boolean = false;
  /** Wall-clock timestamp of the last drag hint shown; used to enforce the
   *  hint cooldown so a fast drag does not spam the tooltip. */
  lastDragHintAt: number = 0;
  /** Last element the drag pointer hovered; used to move the
   *  `DRAG_OVER_TOP` / `DRAG_OVER_BOTTOM` class as the pointer moves. */
  lastDragOverItem: HTMLElement | null = null;
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
  groupCountTooltip,
  inZoomRange,
  roleCountText,
  rowView,
};
export type { RowCell, RowLabels, RowView };
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

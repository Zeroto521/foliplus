// LayerControl UI — ListPanel subsystem: rows, cursor, drag-reorder, fold.
//
// This is the first of the three view subsystems carved out of LayerUI. The
// controller (LayerController) owns domain state; the view subsystems own
// per-panel state that only makes sense in the panel's own lifetime — fold
// state, the roving cursor index, the in-flight drag, the press-in-panel
// verdict. LayerUI holds a reference to this subsystem so shared modules
// (lifecycle, state) can still reach the panel's state.
//
// Signature contract: modules that exclusively touch list state receive a
// ListPanel (see list.ts / rowView.ts / visibility.ts / drag.ts /
// keyboard.ts). Cross-subsystem code takes LayerUI and reaches into
// `ui.listPanel.*` directly.
import type { ListCursor } from "#core/listCursor.js";

/** View subsystem that owns the panel's row layout state: which groups are
 *  folded, which rows are checked, where the roving keyboard cursor sits,
 *  and the in-flight drag. Nothing here is domain — none of these fields
 *  persist across page reloads except what `state.ts` writes through the
 *  `ui.m.persistence` channel. */
class ListPanel {
  /** Per-group fold state. Persisted through `ui.m.persistence` on change. */
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
  /** Index of the row currently being dragged, or null. */
  dragIdx: number | null = null;
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

export { ListPanel };

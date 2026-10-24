// LayerControl UI — HTML5 drag reorder + group fold.
import { HINT_DURATION } from "#core/hint.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import { saveFoldState } from "../state.js";
import type { LayerUI } from "../surface.js";
import { rebuildList } from "./list.js";

/** Fold or unfold one group. Shared by the pointer (row click) and the
 *  keyboard (Enter / Space over the chevron) so both paths stay in sync. */
const toggleFold = (ui: LayerUI, group: string): void => {
  if (ui.listPanel.foldedGroups.has(group)) ui.listPanel.foldedGroups.delete(group);
  else ui.listPanel.foldedGroups.add(group);
  // Same rebuild the reorder APIs use: repaint, settle the counts and the
  // readiness flag, then announce the round the replay produced.
  rebuildList(ui);
  saveFoldState(ui);
};

/** Translate a row's data-layer-id into its registry index. The row carries
 *  the identity in data-layer-id while reorder takes registry indices — not
 *  DOM positions. A late registration can sit anywhere in the DOM, so reading
 *  a positional index here would drag a neighbor's layer. Returns -1 for a
 *  row with no id (or one the registry does not know). */
const registryIdx = (ui: LayerUI, id: string | null): number => {
  return id ? ui.c.layers.findIndex(l => l.id === id) : -1;
};

/** Current registry index of the armed drag, or -1 when the session went
 *  stale. The gesture is armed with the entry itself, not its position: an
 *  HTML5 drag spans events and timers, and any reorder in between would
 *  silently re-point a saved index at a neighbor. Resolving through the
 *  entry also retires the session on identity loss — an unregister or a
 *  same-id replacement makes `indexOf` miss, because the registry now holds
 *  a different object under the same id. Callers gate on `dragEntry` first;
 *  this helper answers for an armed session only. */
const dragIdx = (ui: LayerUI): number =>
  ui.c.layerRegistry.indexOf(ui.listPanel.dragEntry!);

const handleDragStart = (ui: LayerUI, event: DragEvent) => {
  // A press that began on a floating row panel is not a reorder gesture: the
  // panel is a detail surface, not a drag handle, and it is a *descendant* of
  // the draggable row — so the browser reports the row as the drag source and
  // the panel's own `dragstart` listener can never fire. The press is what
  // carries the verdict (ui.listPanel.pressInPanel), not the drag event.
  if (ui.listPanel.pressInPanel) {
    event.preventDefault();
    return;
  }
  const item = (event.target as HTMLElement).closest(
    CONST.SEL.LAYER_ITEM,
  ) as HTMLElement | null;
  if (!item) return;
  const id = item.getAttribute(CONST.DATA.LAYER_ID);
  const entry = id ? ui.c.layerRegistry.get(id) : undefined;
  if (!entry) return;
  ui.listPanel.dragEntry = entry;
  item.classList.add(CONST.CLASSES.DRAGGING);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
};

const showReorderBlockedHint = (ui: LayerUI) => {
  const now = Date.now();
  if (now - ui.listPanel.lastDragHintAt < CONST.DRAG.HINT_COOLDOWN_MS) return;
  ui.listPanel.lastDragHintAt = now;
  ui.c.map.foliplus!.showHint(
    ui.config.name,
    ui.T("reorder_group_only"),
    HINT_DURATION.SHORT,
  );
};

const handleDragOver = (ui: LayerUI, event: DragEvent) => {
  if (!ui.listPanel.dragEntry) return;
  const armed = dragIdx(ui);
  if (armed < 0) {
    // The armed entry retired mid-gesture (an unregister or a same-id
    // replacement): the session is over now. The source row may already be
    // gone, so a later native dragend cannot be counted on to reach this
    // container — the hover chrome comes down here.
    clearDragState(ui);
    return;
  }
  event.preventDefault();
  const item = (event.target as HTMLElement).closest(
    CONST.SEL.LAYER_ITEM,
  ) as HTMLElement | null;
  if (!item) return;

  const targetIdx = registryIdx(ui, item.getAttribute(CONST.DATA.LAYER_ID));
  if (targetIdx < 0) return;
  const prev = ui.listPanel.lastDragOverItem;
  if (prev && prev !== item) {
    prev.classList.remove(CONST.CLASSES.DRAG_OVER_TOP, CONST.CLASSES.DRAG_OVER_BOTTOM);
  }
  item.classList.remove(CONST.CLASSES.DRAG_OVER_TOP, CONST.CLASSES.DRAG_OVER_BOTTOM);
  ui.listPanel.lastDragOverItem = item;

  if (!ui.c.canReorderBetween(armed, targetIdx)) {
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    showReorderBlockedHint(ui);
    return;
  }
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

  if (targetIdx < armed) item.classList.add(CONST.CLASSES.DRAG_OVER_TOP);
  else if (targetIdx > armed) item.classList.add(CONST.CLASSES.DRAG_OVER_BOTTOM);
};

const handleDragLeave = (event: DragEvent) => {
  const item = (event.target as HTMLElement).closest(
    CONST.SEL.LAYER_ITEM,
  ) as HTMLElement | null;
  if (item) {
    item.classList.remove(CONST.CLASSES.DRAG_OVER_TOP, CONST.CLASSES.DRAG_OVER_BOTTOM);
  }
};

const handleDrop = (ui: LayerUI, event: DragEvent) => {
  event.preventDefault();
  const target = (event.target as HTMLElement).closest(
    CONST.SEL.LAYER_ITEM,
  ) as HTMLElement | null;
  if (!ui.listPanel.dragEntry) return;
  if (!target) return;

  // The session is validated at every use, not just at the end: the entry
  // the gesture armed with must still be the one the registry holds. An
  // unregister, or a replacement under the same id, retires the whole
  // session here — entry, hover chrome and all — instead of moving
  // whatever now sits at the old position.
  const armed = dragIdx(ui);
  if (armed < 0) {
    clearDragState(ui);
    return;
  }

  const targetId = target.getAttribute(CONST.DATA.LAYER_ID);
  const targetIdx = targetId ? registryIdx(ui, targetId) : -1;
  if (targetIdx < 0) return;
  if (armed === targetIdx) return;
  if (!ui.c.canReorderBetween(armed, targetIdx)) {
    showReorderBlockedHint(ui);
    return;
  }

  // Everything else is the controller's commit funnel — registry move, z
  // repricing, saved order, the panel-order signal that relocates the rows,
  // and the layer CHANGE — the same sequence a keyboard or API move runs, so
  // a drag is no longer invisible to event consumers. A terminal consumer
  // can throw out of it after the commit landed; the gesture state comes
  // down regardless, or the panel would keep claiming a drag in flight.
  const entry = ui.listPanel.dragEntry;
  try {
    ui.c.reorderLayer(entry.id, targetId!);
  } finally {
    clearDragState(ui);
  }
};

/** Idempotent gesture teardown: the armed session, the hover marker and the
 *  drag chrome all go — whether the drop committed, was refused, threw, or
 *  the control unmounted mid-gesture. The drop's commit boundary, the
 *  native dragend and the unbind boundary share it; it clears the pure
 *  session state even when the panel itself is already gone. */
const clearDragState = (ui: LayerUI): void => {
  ui.listPanel.dragEntry = null;
  ui.listPanel.lastDragOverItem = null;
  const allItems = ui.uiContainer?.querySelectorAll(CONST.SEL.LAYER_ITEM);
  allItems?.forEach((i: Element) =>
    i.classList.remove(
      CONST.CLASSES.DRAGGING,
      CONST.CLASSES.DRAG_OVER_TOP,
      CONST.CLASSES.DRAG_OVER_BOTTOM,
    ),
  );
};

const handleDragEnd = (ui: LayerUI) => {
  clearDragState(ui);
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

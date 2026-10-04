// LayerControl UI — HTML5 drag reorder + group fold.
import { HINT_DURATION } from "#core/hint.js";
import * as CONST from "../const.js";
import type { LayerUI } from "./index.js";
import { initTypesAndVisibility, renderInitialList } from "./list.js";
import type { ListPanel } from "./listPanel.js";
import { saveFoldState } from "./state.js";

/** Fold or unfold one group. Shared by the pointer (row click) and the
 *  keyboard (Enter / Space over the chevron) so both paths stay in sync. */
const toggleFold = (lp: ListPanel, ui: LayerUI, group: string): void => {
  if (lp.foldedGroups.has(group)) lp.foldedGroups.delete(group);
  else lp.foldedGroups.add(group);
  renderInitialList(ui.listPanel, ui);
  initTypesAndVisibility(ui.listPanel, ui);
  ui.refreshAllCounts();
  saveFoldState(ui.listPanel);
};

/** Translate a row's data-layer-id into its registry index. The row carries
 *  the identity in data-layer-id while reorder takes registry indices — not
 *  DOM positions. A late registration can sit anywhere in the DOM, so reading
 *  a positional index here would drag a neighbor's layer. Returns -1 for a
 *  row with no id (or one the registry does not know). */
const registryIdx = (ui: LayerUI, id: string | null): number => {
  return id ? ui.m.layers.findIndex(l => l.id === id) : -1;
};

const handleDragStart = (lp: ListPanel, ui: LayerUI, event: DragEvent) => {
  // A press that began on a floating row panel is not a reorder gesture: the
  // panel is a detail surface, not a drag handle, and it is a *descendant* of
  // the draggable row — so the browser reports the row as the drag source and
  // the panel's own `dragstart` listener can never fire. The press is what
  // carries the verdict (lp.pressInPanel), not the drag event.
  if (lp.pressInPanel) {
    event.preventDefault();
    return;
  }
  const item = (event.target as HTMLElement).closest(
    CONST.SEL.LAYER_ITEM,
  ) as HTMLElement | null;
  if (!item) return;
  const idx = registryIdx(ui, item.getAttribute(CONST.DATA.LAYER_ID));
  if (idx < 0) return;
  lp.dragIdx = idx;
  item.classList.add(CONST.CLASSES.DRAGGING);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
};

const showReorderBlockedHint = (lp: ListPanel) => {
  const now = Date.now();
  if (now - lp.lastDragHintAt < CONST.DRAG.HINT_COOLDOWN_MS) return;
  lp.lastDragHintAt = now;
  lp.m.map.foliplus!.showHint(
    lp.config.name,
    lp.T("reorder_group_only"),
    HINT_DURATION.SHORT,
  );
};

const handleDragOver = (lp: ListPanel, ui: LayerUI, event: DragEvent) => {
  if (lp.dragIdx === null) return;
  event.preventDefault();
  const item = (event.target as HTMLElement).closest(
    CONST.SEL.LAYER_ITEM,
  ) as HTMLElement | null;
  if (!item) return;

  const targetIdx = registryIdx(ui, item.getAttribute(CONST.DATA.LAYER_ID));
  if (targetIdx < 0) return;
  const prev = lp.lastDragOverItem;
  if (prev && prev !== item) {
    prev.classList.remove(CONST.CLASSES.DRAG_OVER_TOP, CONST.CLASSES.DRAG_OVER_BOTTOM);
  }
  item.classList.remove(CONST.CLASSES.DRAG_OVER_TOP, CONST.CLASSES.DRAG_OVER_BOTTOM);
  lp.lastDragOverItem = item;

  if (!ui.m.canReorderBetween(lp.dragIdx, targetIdx)) {
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    showReorderBlockedHint(lp);
    return;
  }
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

  if (targetIdx < lp.dragIdx) item.classList.add(CONST.CLASSES.DRAG_OVER_TOP);
  else if (targetIdx > lp.dragIdx) {
    item.classList.add(CONST.CLASSES.DRAG_OVER_BOTTOM);
  }
};

const handleDragLeave = (event: DragEvent) => {
  const item = (event.target as HTMLElement).closest(
    CONST.SEL.LAYER_ITEM,
  ) as HTMLElement | null;
  if (item) {
    item.classList.remove(CONST.CLASSES.DRAG_OVER_TOP, CONST.CLASSES.DRAG_OVER_BOTTOM);
  }
};

const handleDrop = (lp: ListPanel, ui: LayerUI, event: DragEvent) => {
  event.preventDefault();
  const target = (event.target as HTMLElement).closest(
    CONST.SEL.LAYER_ITEM,
  ) as HTMLElement | null;
  if (lp.dragIdx === null) return;
  if (!target) return;

  if (lp.dragIdx < 0 || lp.dragIdx >= ui.m.layers.length) {
    lp.dragIdx = null;
    return;
  }

  const targetIdx = registryIdx(ui, target.getAttribute(CONST.DATA.LAYER_ID));
  if (targetIdx < 0) return;
  if (lp.dragIdx === targetIdx) return;
  if (!ui.m.canReorderBetween(lp.dragIdx, targetIdx)) {
    showReorderBlockedHint(lp);
    return;
  }

  // Capture the dragged id before reorder: after the move the registry index
  // of the dragged layer equals targetIdx, but the id is the stable key for
  // locating its DOM row to physically relocate.
  const dragId = ui.m.layers[lp.dragIdx]?.id;
  if (!dragId) {
    lp.dragIdx = null;
    return;
  }

  ui.m.layerRegistry.reorder(lp.dragIdx, targetIdx);

  const movedItem = ui.uiContainer.querySelector(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(dragId)}"]`,
  );
  if (!movedItem) {
    lp.dragIdx = null;
    return;
  }

  if (targetIdx < lp.dragIdx) {
    if (target.parentNode) target.parentNode.insertBefore(movedItem, target);
  } else if (target.parentNode) {
    target.parentNode.insertBefore(movedItem, target.nextSibling);
  }

  ui.m.enforceOrder();
  ui.m.saveOrder();
  lp.dragIdx = null;
};

const handleDragEnd = (lp: ListPanel, ui: LayerUI) => {
  lp.dragIdx = null;
  lp.lastDragOverItem = null;
  const allItems = ui.uiContainer.querySelectorAll(CONST.SEL.LAYER_ITEM);
  allItems.forEach((i: Element) =>
    i.classList.remove(
      CONST.CLASSES.DRAGGING,
      CONST.CLASSES.DRAG_OVER_TOP,
      CONST.CLASSES.DRAG_OVER_BOTTOM,
    ),
  );
};

export {
  toggleFold,
  handleDragStart,
  showReorderBlockedHint,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleDragEnd,
};

// LayerControl UI — HTML5 drag reorder + group fold.
import { HINT_DURATION } from "#core/hint.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import { saveFoldState } from "../state.js";
import type { LayerUI } from "../types.js";
import { initTypesAndVisibility, renderInitialList } from "./list.js";

/** Fold or unfold one group. Shared by the pointer (row click) and the
 *  keyboard (Enter / Space over the chevron) so both paths stay in sync. */
const toggleFold = (ui: LayerUI, group: string): void => {
  if (ui.listPanel.foldedGroups.has(group)) ui.listPanel.foldedGroups.delete(group);
  else ui.listPanel.foldedGroups.add(group);
  renderInitialList(ui);
  initTypesAndVisibility(ui);
  ui.refreshAllCounts();
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
  const idx = registryIdx(ui, item.getAttribute(CONST.DATA.LAYER_ID));
  if (idx < 0) return;
  ui.listPanel.dragIdx = idx;
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
  if (ui.listPanel.dragIdx === null) return;
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

  if (!ui.c.canReorderBetween(ui.listPanel.dragIdx, targetIdx)) {
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    showReorderBlockedHint(ui);
    return;
  }
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

  if (targetIdx < ui.listPanel.dragIdx) item.classList.add(CONST.CLASSES.DRAG_OVER_TOP);
  else if (targetIdx > ui.listPanel.dragIdx) {
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

const handleDrop = (ui: LayerUI, event: DragEvent) => {
  event.preventDefault();
  const target = (event.target as HTMLElement).closest(
    CONST.SEL.LAYER_ITEM,
  ) as HTMLElement | null;
  if (ui.listPanel.dragIdx === null) return;
  if (!target) return;

  if (ui.listPanel.dragIdx < 0 || ui.listPanel.dragIdx >= ui.c.layers.length) {
    ui.listPanel.dragIdx = null;
    return;
  }

  const targetIdx = registryIdx(ui, target.getAttribute(CONST.DATA.LAYER_ID));
  if (targetIdx < 0) return;
  if (ui.listPanel.dragIdx === targetIdx) return;
  if (!ui.c.canReorderBetween(ui.listPanel.dragIdx, targetIdx)) {
    showReorderBlockedHint(ui);
    return;
  }

  // Capture the dragged id before reorder: after the move the registry index
  // of the dragged layer equals targetIdx, but the id is the stable key for
  // locating its DOM row to physically relocate.
  const dragId = ui.c.layers[ui.listPanel.dragIdx]?.id;
  if (!dragId) {
    ui.listPanel.dragIdx = null;
    return;
  }

  ui.c.layerRegistry.reorder(ui.listPanel.dragIdx, targetIdx);

  const movedItem = ui.uiContainer.querySelector(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(dragId)}"]`,
  );
  if (!movedItem) {
    ui.listPanel.dragIdx = null;
    return;
  }

  if (targetIdx < ui.listPanel.dragIdx) {
    if (target.parentNode) target.parentNode.insertBefore(movedItem, target);
  } else if (target.parentNode) {
    target.parentNode.insertBefore(movedItem, target.nextSibling);
  }

  ui.c.enforceOrder();
  ui.c.saveOrder();
  ui.listPanel.dragIdx = null;
};

const handleDragEnd = (ui: LayerUI) => {
  ui.listPanel.dragIdx = null;
  ui.listPanel.lastDragOverItem = null;
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

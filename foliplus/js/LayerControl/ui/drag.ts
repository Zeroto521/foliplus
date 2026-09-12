// LayerControl UI —HTML5 drag reorder + group fold.
import { HINT_DURATION } from "#core/hint.js";
import * as CONST from "../const.js";
import { T } from "./context.js";
import type { LayerUI } from "./index.js";
import { initTypesAndVisibility, reindexItems, renderInitialList } from "./list.js";
import { saveFoldState } from "./state.js";

/** Fold or unfold one group. Shared by the pointer (row click) and the
 *  keyboard (Enter / Space over the chevron) so both paths stay in sync. */
const toggleFold = (ui: LayerUI, group: string): void => {
  if (ui.foldedGroups.has(group)) ui.foldedGroups.delete(group);
  else ui.foldedGroups.add(group);
  renderInitialList(ui);
  initTypesAndVisibility(ui);
  ui.refreshAllCounts();
  saveFoldState(ui);
};

const handleDragStart = (ui: LayerUI, event: DragEvent) => {
  const item = (event.target as HTMLElement).closest(
    CONST.SEL.LAYER_ITEM,
  ) as HTMLElement | null;
  if (!item) return;
  ui.dragIdx = parseInt(item.dataset.index ?? "", 10);
  item.classList.add(CONST.CLASSES.DRAGGING);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
};

const showReorderBlockedHint = (ui: LayerUI) => {
  const now = Date.now();
  if (now - ui.lastDragHintAt < CONST.DRAG.HINT_COOLDOWN_MS) return;
  ui.lastDragHintAt = now;
  map.foliplus!.showHint(CONF.name, T("reorder_group_only"), HINT_DURATION.SHORT);
};

const handleDragOver = (ui: LayerUI, event: DragEvent) => {
  if (ui.dragIdx === null) return;
  event.preventDefault();
  const item = (event.target as HTMLElement).closest(
    CONST.SEL.LAYER_ITEM,
  ) as HTMLElement | null;
  if (!item || item.classList.contains(CONST.CLASSES.COLOR_ITEM)) return;

  const targetIdx = parseInt(item.dataset.index ?? "", 10);
  const prev = ui.lastDragOverItem;
  if (prev && prev !== item) {
    prev.classList.remove(CONST.CLASSES.DRAG_OVER_TOP, CONST.CLASSES.DRAG_OVER_BOTTOM);
  }
  item.classList.remove(CONST.CLASSES.DRAG_OVER_TOP, CONST.CLASSES.DRAG_OVER_BOTTOM);
  ui.lastDragOverItem = item;

  if (!ui.m.canReorderBetween(ui.dragIdx, targetIdx)) {
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    showReorderBlockedHint(ui);
    return;
  }
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

  if (targetIdx < ui.dragIdx) item.classList.add(CONST.CLASSES.DRAG_OVER_TOP);
  else if (targetIdx > ui.dragIdx) {
    item.classList.add(CONST.CLASSES.DRAG_OVER_BOTTOM);
  }
};

const handleDragLeave = (ui: LayerUI, event: DragEvent) => {
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
  if (ui.dragIdx === null) return;
  if (!target || target.classList.contains(CONST.CLASSES.COLOR_ITEM)) return;

  if (ui.dragIdx < 0 || ui.dragIdx >= ui.m.layers.length) {
    ui.dragIdx = null;
    return;
  }

  const targetIdx = parseInt(target.dataset.index ?? "", 10);
  if (ui.dragIdx === targetIdx) return;
  if (!ui.m.canReorderBetween(ui.dragIdx, targetIdx)) {
    showReorderBlockedHint(ui);
    return;
  }

  ui.m.layerRegistry.reorder(ui.dragIdx, targetIdx);
  const moved = ui.m.layers[targetIdx];

  const movedItem = ui.uiContainer.querySelector(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(moved.id)}"]`,
  );
  if (!movedItem) {
    ui.dragIdx = null;
    return;
  }

  if (targetIdx < ui.dragIdx) {
    if (target.parentNode) target.parentNode.insertBefore(movedItem, target);
  } else if (target.parentNode) {
    target.parentNode.insertBefore(movedItem, target.nextSibling);
  }

  reindexItems(ui);
  ui.m.enforceOrder();
  ui.m.saveOrder();
  ui.dragIdx = null;
};

const handleDragEnd = (ui: LayerUI) => {
  ui.dragIdx = null;
  ui.lastDragOverItem = null;
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

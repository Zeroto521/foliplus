// LayerControl UI —HTML5 drag reorder + group fold.
import { HINT_DURATION } from "#core/hint.js";
import { createScopedTranslator } from "#common/locale.js";
import * as CONST from "../const.js";
import type { LayerAccess } from "./access.js";
import type { FocusStore } from "./focusStore.js";
import { refreshAllCounts } from "./lifecycle.js";
import { initTypesAndVisibility, renderInitialList } from "./list.js";
import type { PanelStore } from "./panelStore.js";
import { saveFoldState } from "./state.js";

const T = createScopedTranslator(CONF);

/** Fold or unfold one group. Shared by the pointer (row click) and the
 *  keyboard (Enter / Space over the chevron) so both paths stay in sync. */
const toggleFold = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  group: string,
): void => {
  if (ps.foldedGroups.has(group)) ps.foldedGroups.delete(group);
  else ps.foldedGroups.add(group);
  renderInitialList(la, ps, fs);
  initTypesAndVisibility(la, ps, fs);
  refreshAllCounts(la, ps, fs);
  saveFoldState(la, ps, fs);
};

/** Translate a row's data-layer-id into its registry index. The row carries
 *  the identity in data-layer-id while reorder takes registry indices — not
 *  DOM positions. A late registration can sit anywhere in the DOM, so reading
 *  a positional index here would drag a neighbor's layer. Returns -1 for a
 *  row with no id (or one the registry does not know). */
const registryIdx = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  id: string | null,
): number => {
  return id ? la.layers.findIndex(l => l.id === id) : -1;
};

const handleDragStart = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  event: DragEvent,
) => {
  // A press that began on a floating row panel is not a reorder gesture: the
  // panel is a detail surface, not a drag handle, and it is a *descendant* of
  // the draggable row — so the browser reports the row as the drag source and
  // the panel's own `dragstart` listener can never fire. The press is what
  // carries the verdict (ps.pressInPanel), not the drag event.
  if (ps.pressInPanel) {
    event.preventDefault();
    return;
  }
  const item = (event.target as HTMLElement).closest(
    CONST.SEL.LAYER_ITEM,
  ) as HTMLElement | null;
  if (!item) return;
  const idx = registryIdx(la, ps, fs, item.getAttribute(CONST.DATA.LAYER_ID));
  if (idx < 0) return;
  ps.dragIdx = idx;
  item.classList.add(CONST.CLASSES.DRAGGING);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
};

const showReorderBlockedHint = (la: LayerAccess, ps: PanelStore, fs: FocusStore) => {
  const now = Date.now();
  if (now - ps.lastDragHintAt < CONST.DRAG.HINT_COOLDOWN_MS) return;
  ps.lastDragHintAt = now;
  la.map.foliplus!.showHint(CONF.name, T("reorder_group_only"), HINT_DURATION.SHORT);
};

const handleDragOver = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  event: DragEvent,
) => {
  if (ps.dragIdx === null) return;
  event.preventDefault();
  const item = (event.target as HTMLElement).closest(
    CONST.SEL.LAYER_ITEM,
  ) as HTMLElement | null;
  if (!item) return;

  const targetIdx = registryIdx(la, ps, fs, item.getAttribute(CONST.DATA.LAYER_ID));
  if (targetIdx < 0) return;
  const prev = ps.lastDragOverItem;
  if (prev && prev !== item) {
    prev.classList.remove(CONST.CLASSES.DRAG_OVER_TOP, CONST.CLASSES.DRAG_OVER_BOTTOM);
  }
  item.classList.remove(CONST.CLASSES.DRAG_OVER_TOP, CONST.CLASSES.DRAG_OVER_BOTTOM);
  ps.lastDragOverItem = item;

  if (!la.canReorderBetween(ps.dragIdx, targetIdx)) {
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    showReorderBlockedHint(la, ps, fs);
    return;
  }
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

  if (targetIdx < ps.dragIdx) item.classList.add(CONST.CLASSES.DRAG_OVER_TOP);
  else if (targetIdx > ps.dragIdx) {
    item.classList.add(CONST.CLASSES.DRAG_OVER_BOTTOM);
  }
};

const handleDragLeave = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  event: DragEvent,
) => {
  const item = (event.target as HTMLElement).closest(
    CONST.SEL.LAYER_ITEM,
  ) as HTMLElement | null;
  if (item) {
    item.classList.remove(CONST.CLASSES.DRAG_OVER_TOP, CONST.CLASSES.DRAG_OVER_BOTTOM);
  }
};

const handleDrop = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  event: DragEvent,
) => {
  event.preventDefault();
  const target = (event.target as HTMLElement).closest(
    CONST.SEL.LAYER_ITEM,
  ) as HTMLElement | null;
  if (ps.dragIdx === null) return;
  if (!target) return;

  if (ps.dragIdx < 0 || ps.dragIdx >= la.layers.length) {
    ps.dragIdx = null;
    return;
  }

  const targetIdx = registryIdx(la, ps, fs, target.getAttribute(CONST.DATA.LAYER_ID));
  if (targetIdx < 0) return;
  if (ps.dragIdx === targetIdx) return;
  if (!la.canReorderBetween(ps.dragIdx, targetIdx)) {
    showReorderBlockedHint(la, ps, fs);
    return;
  }

  // Capture the dragged id before reorder: after the move the registry index
  // of the dragged layer equals targetIdx, but the id is the stable key for
  // locating its DOM row to physically relocate.
  const dragId = la.layers[ps.dragIdx]?.id;
  if (!dragId) {
    ps.dragIdx = null;
    return;
  }

  la.layerRegistry.reorder(ps.dragIdx, targetIdx);

  const movedItem = ps.uiContainer!.querySelector(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(dragId)}"]`,
  );
  if (!movedItem) {
    ps.dragIdx = null;
    return;
  }

  if (targetIdx < ps.dragIdx) {
    if (target.parentNode) target.parentNode.insertBefore(movedItem, target);
  } else if (target.parentNode) {
    target.parentNode.insertBefore(movedItem, target.nextSibling);
  }

  la.enforceOrder();
  la.saveOrder();
  ps.dragIdx = null;
};

const handleDragEnd = (la: LayerAccess, ps: PanelStore, fs: FocusStore) => {
  ps.dragIdx = null;
  ps.lastDragOverItem = null;
  const allItems = ps.uiContainer!.querySelectorAll(CONST.SEL.LAYER_ITEM);
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

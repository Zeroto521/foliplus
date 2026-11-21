// LayerControl UI — HTML5 drag reorder + role fold.
import { saveFoldState } from "../state.js";
import type { LayerUI } from "../surface.js";
import { rebuildList } from "./list.js";
import { type LayerRole, normalizeFolderName } from "#core/layer/index.js";
import { HINT_DURATION, ensureOverlayRegistry } from "#core/overlay/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { effectiveFolderFolded } from "#control/LayerControl/declaredFolder.js";
import { effectiveRoleFolded } from "#control/LayerControl/declaredRole.js";

/** Fold or unfold one role. Shared by the pointer (row click) and the
 *  keyboard (Enter / Space over the chevron) so both paths stay in sync. */
const toggleFold = (ui: LayerUI, role: string): void => {
  // Flip the EFFECTIVE state and write it as an explicit user opinion (both
  // directions — a manual expand of an author-folded role records false).
  const current = effectiveRoleFolded(
    ui.listPanel.foldedRoles,
    ui.listPanel.authorDefaultFoldedRoles,
    role,
  );
  ui.listPanel.foldedRoles[role] = !current;
  // Same rebuild the reorder APIs use: repaint, settle the counts and the
  // readiness flag, then announce the round the replay produced.
  rebuildList(ui);
  saveFoldState(ui);
};

/** Build the persisted folder-fold key: `role::normalizedFolderName` — the
 *  folder's identity is its role plus its normalized name (a rename is a new
 *  folder, matching the layout model). Single source, so the folder row, the
 *  keyboard branch and the persistence all agree. */
/** The key separator between the role and the normalized folder name. */
const FOLDER_KEY_SEP = "::";

const folderFoldKey = (role: string, name: string): string =>
  role + FOLDER_KEY_SEP + normalizeFolderName(name);

/** Fold or unfold one folder. The single entry for the pointer (row click /
 *  chevron) and the keyboard (Enter / Space), exactly as toggleFold is for a
 *  role — no second fold implementation. */
const toggleFolderFold = (ui: LayerUI, role: string, name: string): void => {
  const key = folderFoldKey(role, name);
  if (ui.listPanel.foldedFolders.has(key)) ui.listPanel.foldedFolders.delete(key);
  else ui.listPanel.foldedFolders.add(key);
  rebuildList(ui);
  saveFoldState(ui);
};

/** Whether a folder is currently folded, honoring the priority chain
 *  built-in (expanded) < author default < user override. The author default
 *  (ui.listPanel.authorFoldedFolders) sits below the user override, so a
 *  user's manual fold always wins; Reset clears the user override and the
 *  folder falls back to the author default. */
const isFolderFolded = (ui: LayerUI, role: string, name: string): boolean =>
  effectiveFolderFolded(
    ui.listPanel.authorFoldedFolders,
    ui.listPanel.foldedFolders,
    role,
    name,
  );

/** Translate a row's data-layer-id into its registry index. The row carries
 *  the identity in data-layer-id while reorder takes registry indices — not
 *  DOM positions. A late registration can sit anywhere in the DOM, so reading
 *  a positional index here would drag a neighbor's layer. The registry owns
 *  the id → position map, so dragover does not scan the list on every event.
 *  Returns -1 for a row with no id (or one the registry does not know). */
const registryIdx = (ui: LayerUI, id: string | null): number =>
  id ? ui.c.layerRegistry.indexOfId(id) : -1;

/** Current registry index of the armed drag's entry, or -1 when the session
 *  went stale. The gesture is armed with the entry itself, not its position:
 *  an HTML5 drag spans events and timers, and any reorder in between would
 *  silently re-point a saved index at a neighbor. Resolving through the
 *  entry also retires the session on identity loss — an unregister or a
 *  same-id replacement makes `indexOf` miss, because the registry now holds
 *  a different object under the same id. The entry comes in already gated by
 *  the caller (`dragEntry` checked non-null); no assertion lives here. */
const dragIdx = (ui: LayerUI, entry: LayerInfo): number => {
  const registry = ui.c.layerRegistry;
  const idx = registry.indexOfId(entry.id);
  // The id alone is not the lease: a same-id replacement makes the id
  // resolve while the entry the gesture armed with is gone, and moving the
  // successor would move a layer the user never grabbed.
  return idx !== -1 && registry.at(idx) === entry ? idx : -1;
};

const handleDragStart = (ui: LayerUI, event: DragEvent) => {
  // A press that began on a floating row panel is not a reorder gesture: the
  // panel is a detail surface, not a drag handle, and it is a *descendant* of
  // the draggable row — so the browser reports the row as the drag source and
  // the panel's own `dragstart` listener can never fire. The registry's press
  // dispatcher carries the verdict, not the drag event.
  if (ensureOverlayRegistry(ui.c.map).lastPressInside()) {
    event.preventDefault();
    return;
  }
  const item = (event.target as HTMLElement).closest(
    CONST.SEL.LAYER_ITEM,
  ) as HTMLElement | null;
  if (!item) return;

  // A folder row drags its whole block. The block identity is role + key, not
  // a registry entry: the folder row owns no layer, and the block order lives
  // in the layout, so the gesture carries the key the layout knows.
  const folderKey = item.getAttribute(CONST.DATA.FOLDER_KEY);
  if (folderKey) {
    const role = item.getAttribute(CONST.DATA.ROLE) ?? "";
    if (!role) return;
    ui.listPanel.dragFolder = { role, key: folderKey };
    // Auto-fold so the block reads as one unit while it travels. The fold is
    // temporary: it is not persisted, and dragend restores the pre-drag state
    // (a folder the user had folded themselves stays folded).
    const foldKey = folderFoldKey(role, folderKey);
    ui.listPanel.dragFolderWasFolded = ui.listPanel.foldedFolders.has(foldKey);
    if (!ui.listPanel.dragFolderWasFolded) {
      ui.listPanel.foldedFolders.add(foldKey);
      // The rebuild replaces the row element, so the drag chrome is applied to
      // the fresh row, not the detached one.
      rebuildList(ui);
      const fresh = ui.uiContainer?.querySelector(
        `[${CONST.DATA.FOLDER_KEY}="${CSS.escape(folderKey)}"]`,
      ) as HTMLElement | null;
      fresh?.classList.add(CONST.CLASSES.DRAGGING);
    } else {
      item.classList.add(CONST.CLASSES.DRAGGING);
    }
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    return;
  }

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

/** Whether the pointer sits in the bottom half of a row, i.e. the drop lands
 *  after it. The block order is a list, so the half decides before/after. */
const dropsAfter = (event: DragEvent, row: HTMLElement): boolean => {
  const rect = row.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2;
};

/** The folder row a folder drag may land on: a folder row of the same role,
 *  other than the one being dragged. Returns null for anything else, so a
 *  folder cannot be dropped onto a layer row or into the other role. */
const folderDropTarget = (ui: LayerUI, event: DragEvent): HTMLElement | null => {
  const armed = ui.listPanel.dragFolder;
  if (!armed) return null;
  const row = (event.target as HTMLElement).closest(
    CONST.SEL.FOLDER_ROW,
  ) as HTMLElement | null;
  if (!row) return null;
  if (row.getAttribute(CONST.DATA.ROLE) !== armed.role) return null;
  const key = row.getAttribute(CONST.DATA.FOLDER_KEY);
  if (!key || key === armed.key) return null;
  return row;
};

const handleDragOver = (ui: LayerUI, event: DragEvent) => {
  // A folder drag only ever reorders blocks: it never enters the layer-index
  // path below, which would resolve a folder row to no registry entry.
  if (ui.listPanel.dragFolder) {
    const row = folderDropTarget(ui, event);
    const prev = ui.listPanel.lastDragOverItem;
    if (prev && prev !== row) {
      prev.classList.remove(
        CONST.CLASSES.DRAG_OVER_TOP,
        CONST.CLASSES.DRAG_OVER_BOTTOM,
      );
    }
    if (!row) {
      ui.listPanel.lastDragOverItem = null;
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    row.classList.remove(CONST.CLASSES.DRAG_OVER_TOP, CONST.CLASSES.DRAG_OVER_BOTTOM);
    row.classList.add(
      dropsAfter(event, row)
        ? CONST.CLASSES.DRAG_OVER_BOTTOM
        : CONST.CLASSES.DRAG_OVER_TOP,
    );
    ui.listPanel.lastDragOverItem = row;
    return;
  }

  const armed = ui.listPanel.dragEntry ? dragIdx(ui, ui.listPanel.dragEntry) : -1;
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

  // Folder block reorder: the whole block travels, so the commit is the
  // layout's block order, not a registry move.
  const armedFolder = ui.listPanel.dragFolder;
  if (armedFolder) {
    const row = folderDropTarget(ui, event);
    const targetKey = row?.getAttribute(CONST.DATA.FOLDER_KEY) ?? "";
    try {
      if (row && targetKey) {
        ui.c.reorderFolder(
          armedFolder.role as LayerRole,
          armedFolder.key,
          targetKey,
          dropsAfter(event, row),
        );
      }
    } finally {
      clearDragState(ui);
    }
    return;
  }

  const target = (event.target as HTMLElement).closest(
    CONST.SEL.LAYER_ITEM,
  ) as HTMLElement | null;
  const armedEntry = ui.listPanel.dragEntry;
  if (!armedEntry) return;
  if (!target) return;

  // The session is validated at every use, not just at the end: the entry
  // the gesture armed with must still be the one the registry holds. An
  // unregister, or a replacement under the same id, retires the whole
  // session here — entry, hover chrome and all — instead of moving
  // whatever now sits at the old position.
  const armed = dragIdx(ui, armedEntry);
  if (armed < 0) {
    clearDragState(ui);
    return;
  }

  const targetId = target.getAttribute(CONST.DATA.LAYER_ID);
  const targetIdx = targetId ? registryIdx(ui, targetId) : -1;
  if (targetIdx < 0) return;
  if (armed === targetIdx) {
    // A drop on the armed row finishes the gesture: a programmatic drop never
    // sends the native dragend the browser would, so the session comes down
    // here instead of staying armed with no commit behind it.
    clearDragState(ui);
    return;
  }
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
  try {
    ui.c.reorderLayer(armedEntry.id, targetId!);
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
  const folder = ui.listPanel.dragFolder;
  const wasFolded = ui.listPanel.dragFolderWasFolded;
  ui.listPanel.dragEntry = null;
  ui.listPanel.dragFolder = null;
  ui.listPanel.dragFolderWasFolded = false;
  ui.listPanel.lastDragOverItem = null;
  // Restore the pre-drag fold state: the auto-fold was a gesture aid, never a
  // user decision, so it must not survive the gesture (and must not be
  // persisted — this path never calls saveFoldState).
  if (folder && !wasFolded) {
    const foldKey = folderFoldKey(folder.role, folder.key);
    if (ui.listPanel.foldedFolders.delete(foldKey)) rebuildList(ui);
  }
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
  toggleFolderFold,
  folderFoldKey,
  isFolderFolded,
  handleDragStart,
  showReorderBlockedHint,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleDragEnd,
  clearDragState,
};

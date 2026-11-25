// LayerControl UI — HTML5 drag reorder + role fold.
import { saveFoldState } from "../state.js";
import type { LayerUI } from "../surface.js";
import { displayBlocks, rebuildList } from "./list.js";
import { type LayerRole, isGroupRow, rootLayerEntry } from "#core/layer/index.js";
import { HINT_DURATION, ensureOverlayRegistry } from "#core/overlay/index.js";
import * as CONST from "#control/LayerControl/const.js";
import {
  effectiveFolderFolded,
  folderFoldKey,
} from "#control/LayerControl/declaredFolder.js";
import { effectiveRoleFolded } from "#control/LayerControl/declaredRole.js";

/** Write the row's ONE indicator state; null clears it. A single attribute
 *  with one value is the whole point: two indicators on one row are
 *  unrepresentable, not merely discouraged. Re-writing the same value is a
 *  no-op so the gap pulse keeps running while the pointer moves inside the
 *  same row; a new row (or a new gap on the same row) starts the animation. */
const setDragState = (row: HTMLElement, state: string | null): void => {
  const current = row.getAttribute(CONST.DRAG_STATE_ATTR);
  if (state === null) {
    if (current !== null) row.removeAttribute(CONST.DRAG_STATE_ATTR);
    return;
  }
  if (current === state) return;
  row.setAttribute(CONST.DRAG_STATE_ATTR, state);
};

/** Clear the indicator from every row in the panel — the one clearer every
 *  teardown path shares. */
const clearDragStateAttr = (ui: LayerUI): void => {
  ui.uiContainer
    ?.querySelectorAll<HTMLElement>(`[${CONST.DRAG_STATE_ATTR}]`)
    .forEach(row => row.removeAttribute(CONST.DRAG_STATE_ATTR));
};

/** The commit acknowledgement's duration, read from the CSS token so the
 *  stylesheet stays the single source; the fallback keeps a stylesheet-less
 *  environment (jsdom) working. The token is a millisecond duration
 *  (--foliplus-motion-quick), the same unit every motion token uses. */
const commitMs = (row: HTMLElement): number =>
  Number.parseFloat(getComputedStyle(row).getPropertyValue("--foliplus-drag-commit")) ||
  CONST.DRAG.COMMIT_MS;

/** Hold the committed state on the row's new position for one commit beat,
 *  then clear it: the drop is acknowledged with the same single indicator the
 *  hover used, never with a second channel. */
const flashCommit = (ui: LayerUI, selector: string, state: string): void => {
  const row = ui.uiContainer?.querySelector<HTMLElement>(selector);
  if (!row) return;
  setDragState(row, state);
  window.setTimeout(() => setDragState(row, null), commitMs(row));
};

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

/** Fold or unfold one folder. The single entry for the pointer (row click /
 *  chevron) and the keyboard (Enter / Space), exactly as toggleFold is for a
 *  role — no second fold implementation. */
const toggleFolderFold = (ui: LayerUI, role: string, name: string): void => {
  const key = folderFoldKey(role, name);
  // Record the flip as an explicit opinion in BOTH directions: an expand over
  // an author default fold has to be distinguishable from "never touched".
  ui.listPanel.foldedFolders[key] = !isFolderFolded(ui, role, name);
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

/** Current registry index of the dragged drag's entry, or -1 when the session
 *  went stale. The gesture is dragged with the entry itself, not its position:
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
  // resolve while the entry the gesture dragged with is gone, and moving the
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
    // No rebuild here. The row is the drag source, and replacing it mid-gesture
    // cancels the native drag — the browser drops a source that left the DOM,
    // which is why a folder could not be dragged at all. The block still
    // travels as one unit: the drop commits the layout's block order, not the
    // members' positions, so the members do not need to be folded away.
    setDragState(item, CONST.DRAG_STATE.SOURCE);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    return;
  }

  const id = item.getAttribute(CONST.DATA.LAYER_ID);
  const entry = id ? ui.c.layerRegistry.get(id) : undefined;
  if (!entry) return;
  ui.listPanel.dragEntry = entry;
  setDragState(item, CONST.DRAG_STATE.SOURCE);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
};

/** One transient hint per gesture, throttled so a drag that keeps crossing
 *  the same refusal does not stack toasts. */
const showDragHint = (ui: LayerUI, key: string) => {
  const now = Date.now();
  if (now - ui.listPanel.lastDragHintAt < CONST.DRAG.HINT_COOLDOWN_MS) return;
  ui.listPanel.lastDragHintAt = now;
  ui.c.map.foliplus!.hint.set(ui.config.name, "", ui.T(key), {
    duration: HINT_DURATION.SHORT,
  });
};

const showReorderBlockedHint = (ui: LayerUI) => {
  showDragHint(ui, "same_role_only");
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
  const dragged = ui.listPanel.dragFolder;
  if (!dragged) return null;
  const row = (event.target as HTMLElement).closest(
    CONST.SEL.FOLDER_ROW,
  ) as HTMLElement | null;
  if (!row) return null;
  if (row.getAttribute(CONST.DATA.ROLE) !== dragged.role) return null;
  const key = row.getAttribute(CONST.DATA.FOLDER_KEY);
  if (!key || key === dragged.key) return null;
  return row;
};

/** A group row never joins a folder: its children are its own
 *  sub-layers, and a folder groups registry rows. Dropping one on a folder row
 *  is refused rather than silently accepted. */
const isGroupDrag = (ui: LayerUI, layerId: string): boolean =>
  isGroupRow(ui.c.layerRegistry.get(layerId), ui.c.findLayer(layerId));

/** The block-order entry a row belongs to: a folder row's key, a root layer
 *  row's `layer:<id>`, or — for a member row — the folder block above it. */
const blockEntryOfRow = (row: HTMLElement): string | null => {
  const folderKey = row.getAttribute(CONST.DATA.FOLDER_KEY);
  if (folderKey) return folderKey;
  const id = row.getAttribute(CONST.DATA.LAYER_ID);
  if (!id) return null;
  // A member row carries the tree guide; a root layer row does not (list.ts
  // renders the guide only when memberInfo.isMember). Only a member row belongs
  // to the folder block above it — a root layer row is a block of its own, so
  // walking up here would return the folder key to a root row that sits below a
  // member row and silently drop the folder onto itself.
  if (!row.querySelector(CONST.SEL.FOLD_TREE)) return rootLayerEntry(id);
  let prev = row.previousElementSibling as HTMLElement | null;
  while (prev) {
    const key = prev.getAttribute(CONST.DATA.FOLDER_KEY);
    if (key) return key;
    if (prev.classList.contains(CONST.CLASSES.ROLE_ROW)) break;
    prev = prev.previousElementSibling as HTMLElement | null;
  }
  return rootLayerEntry(id);
};

/** The block-order entry that follows `entry` in the role's block order, or
 *  null when it is the last block. Used to place a layer AFTER a folder block:
 *  inserting before the next block is the same position. */
const blockEntryAfter = (ui: LayerUI, role: string, entry: string): string | null => {
  const blocks = displayBlocks(ui, role);
  const idx = blocks.findIndex(block =>
    block.kind === "folder"
      ? block.key === entry
      : rootLayerEntry(block.layer.id) === entry,
  );
  if (idx < 0 || idx + 1 >= blocks.length) return null;
  const next = blocks[idx + 1];
  return next.kind === "folder" ? next.key : rootLayerEntry(next.layer.id);
};

/** Which third of a folder row the pointer is over. The middle takes the layer
 *  INTO the folder; the edges place it as a root block before/after the block,
 *  which is how a layer gets between two folders — the rows are adjacent, so
 *  there is no gap to drop into. */
const folderDropZone = (
  row: HTMLElement,
  clientY: number,
): "before" | "into" | "after" => {
  const rect = row.getBoundingClientRect();
  if (rect.height === 0) return "into";
  const ratio = (clientY - rect.top) / rect.height;
  if (ratio < 0.25) return "before";
  if (ratio > 0.75) return "after";
  return "into";
};

/** The block-order entry the pointer sits BEFORE, for a drop that lands in the
 *  gap between rows (no row under the cursor). Null means "after every block".
 *  Only block rows count: a member row resolves to the folder block above it,
 *  so a drop in the middle of a folder's members lands before that folder. */
const blockEntryBefore = (ui: LayerUI, clientY: number): string | null => {
  const rows = ui.uiContainer?.querySelectorAll<HTMLElement>(
    `${CONST.SEL.LAYER_ITEM}, ${CONST.SEL.TOGGLE_ALL}`,
  );
  if (!rows) return null;
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (rect.height === 0) continue;
    if (rect.top + rect.height / 2 > clientY) return blockEntryOfRow(row);
  }
  return null;
};

const handleDragOver = (ui: LayerUI, event: DragEvent) => {
  // A folder drag only ever reorders blocks: it never enters the layer-index
  // path below, which would resolve a folder row to no registry entry.
  const draggedFolder = ui.listPanel.dragFolder;
  if (draggedFolder) {
    const row = folderDropTarget(ui, event);
    const prev = ui.listPanel.lastDragOverItem;
    if (prev && prev !== row) setDragState(prev, null);
    if (!row) {
      ui.listPanel.lastDragOverItem = null;
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
      // A folder over a group row is a refusal worth naming: the two are
      // different kinds of block, and silence reads as a broken drag.
      const over = (event.target as HTMLElement | null)?.closest(
        CONST.SEL.LAYER_ITEM,
      ) as HTMLElement | null;
      const overId = over?.getAttribute(CONST.DATA.LAYER_ID);
      if (overId && isGroupDrag(ui, overId)) {
        showDragHint(ui, "no_nest");
      } else if (over?.getAttribute(CONST.DATA.FOLDER_KEY)) {
        // A folder row of the OTHER role: blocks belong to one section.
        showDragHint(ui, "same_role_only");
      } else if (overId && over) {
        // A layer row: a root layer is a block of its own, and a member row
        // belongs to the folder block above it — either way the folder can be
        // placed beside that block, but only inside the same role. A row of
        // another role used to be silent.
        const entry = blockEntryOfRow(over);
        const overRole = ui.c.layerRegistry.get(overId)?.role;
        if (entry === draggedFolder.key) return; // its own block: no-op
        if (overRole !== draggedFolder.role || !entry) {
          showDragHint(ui, "same_role_only");
        } else {
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
          setDragState(
            over,
            dropsAfter(event, over) ? CONST.DRAG_STATE.AFTER : CONST.DRAG_STATE.BEFORE,
          );
          ui.listPanel.lastDragOverItem = over;
        }
      }
      return;
    }
    // A folder never nests inside another folder. The middle of the row is the
    // "into" gesture; the edges still reorder the block, so the refusal is
    // named rather than silently ignored.
    if (folderDropZone(row, event.clientY) === "into") {
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
      // Draw the refusal: without it the middle half of the row is a strip
      // that neither lights up nor accepts, and the user cannot tell whether
      // the pointer is over a droppable zone.
      setDragState(row, CONST.DRAG_STATE.REFUSE);
      ui.listPanel.lastDragOverItem = row;
      showDragHint(ui, "no_nest");
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    setDragState(
      row,
      dropsAfter(event, row) ? CONST.DRAG_STATE.AFTER : CONST.DRAG_STATE.BEFORE,
    );
    ui.listPanel.lastDragOverItem = row;
    return;
  }

  const dragged = ui.listPanel.dragEntry ? dragIdx(ui, ui.listPanel.dragEntry) : -1;
  if (dragged < 0) {
    // The dragged entry retired mid-gesture (an unregister or a same-id
    // replacement): the session is over now. The source row may already be
    // gone, so a later native dragend cannot be counted on to reach this
    // group — the hover chrome comes down here.
    clearDragState(ui);
    return;
  }
  event.preventDefault();
  const item = (event.target as HTMLElement).closest(
    CONST.SEL.LAYER_ITEM,
  ) as HTMLElement | null;
  const prev = ui.listPanel.lastDragOverItem;
  if (prev && prev !== item) setDragState(prev, null);
  // A folder row is a drop target: the layer joins that folder. A group
  // row is not — its children are its own sub-layers, so it never joins a
  // folder.
  const folderKey = item?.getAttribute(CONST.DATA.FOLDER_KEY) ?? null;
  if (item && folderKey) {
    // A folder belongs to one role: dropping a layer on the OTHER role's folder
    // row would materialise a same-named folder in the layer's own role (the
    // directory is name-keyed and global), which reads as a duplicate. The
    // folder-drag path already refuses a cross-role target; this is the same
    // rule for a layer drag.
    const targetRole = item.getAttribute(CONST.DATA.ROLE) ?? "";
    if (targetRole && targetRole !== ui.listPanel.dragEntry!.role) {
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
      setDragState(item, CONST.DRAG_STATE.REFUSE);
      ui.listPanel.lastDragOverItem = item;
      showDragHint(ui, "same_role_only");
      return;
    }
    const zone = folderDropZone(item, event.clientY);
    if (zone === "into" && isGroupDrag(ui, ui.listPanel.dragEntry!.id)) {
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
      setDragState(item, CONST.DRAG_STATE.REFUSE);
      ui.listPanel.lastDragOverItem = item;
      showDragHint(ui, "no_nest");
      return;
    }
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    // The edge zones are legal moves (the drop handler places the layer
    // before/after the folder block), so they are position states — never a
    // refusal. The old writer added the blocked class here as well, which is
    // the double indicator this redesign removes.
    setDragState(
      item,
      zone === "before"
        ? CONST.DRAG_STATE.BEFORE
        : zone === "after"
          ? CONST.DRAG_STATE.AFTER
          : CONST.DRAG_STATE.JOIN,
    );
    ui.listPanel.lastDragOverItem = item;
    return;
  }
  if (!item) {
    // The gap between rows: the layer lands at that block position.
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    ui.listPanel.lastDragOverItem = null;
    return;
  }

  const targetIdx = registryIdx(ui, item.getAttribute(CONST.DATA.LAYER_ID));
  if (targetIdx < 0) return;
  ui.listPanel.lastDragOverItem = item;

  // A group dropped on a folder's member row would join that folder, which
  // a layer group cannot do. The folder row's middle zone already refuses with
  // this sentence; a member row is the same rule reached from the inside, so it
  // must answer the same way instead of falling through to the reorder path
  // (which allows the hover and then silently drops the move).
  const targetId = item.getAttribute(CONST.DATA.LAYER_ID);
  // A layer group never nests inside another layer group. The middle of the
  // row is the "into" gesture; the edges still reorder the group, so the
  // refusal is named rather than silently ignored.
  if (
    targetId &&
    isGroupDrag(ui, ui.listPanel.dragEntry!.id) &&
    isGroupDrag(ui, targetId) &&
    folderDropZone(item, event.clientY) === "into"
  ) {
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    setDragState(item, CONST.DRAG_STATE.REFUSE);
    ui.listPanel.lastDragOverItem = item;
    showDragHint(ui, "no_nest");
    return;
  }
  if (
    targetId &&
    isGroupDrag(ui, ui.listPanel.dragEntry!.id) &&
    ui.c.folderNameOf(targetId)
  ) {
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    // A refusal is not a hover: the row still shows the refusal state, but the
    // pointer is dropped so the next move does not treat it as a target.
    setDragState(item, CONST.DRAG_STATE.REFUSE);
    ui.listPanel.lastDragOverItem = null;
    showDragHint(ui, "no_nest");
    return;
  }

  if (!ui.c.canReorderBetween(dragged, targetIdx)) {
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    setDragState(item, null);
    ui.listPanel.lastDragOverItem = null;
    showReorderBlockedHint(ui);
    return;
  }
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

  // Hovering the carried row itself is not a gap: it keeps its pickup marker
  // and paints no drop state.
  if (targetIdx < dragged) setDragState(item, CONST.DRAG_STATE.BEFORE);
  else if (targetIdx > dragged) setDragState(item, CONST.DRAG_STATE.AFTER);
};

const handleDragLeave = (event: DragEvent) => {
  const item = (event.target as HTMLElement).closest(
    CONST.SEL.LAYER_ITEM,
  ) as HTMLElement | null;
  if (item) setDragState(item, null);
};

const handleDrop = (ui: LayerUI, event: DragEvent) => {
  event.preventDefault();

  // Folder block reorder: the whole block travels, so the commit is the
  // layout's block order, not a registry move.
  const draggedFolder = ui.listPanel.dragFolder;
  if (draggedFolder) {
    const row = folderDropTarget(ui, event);
    const targetKey = row?.getAttribute(CONST.DATA.FOLDER_KEY) ?? "";
    // No folder row under the pointer: a root layer row is a block of its own,
    // so the folder can be placed beside it. Anything else (another role, a
    // group) was refused during dragover and commits nothing.
    const overRow = row
      ? null
      : ((event.target as HTMLElement | null)?.closest(
          CONST.SEL.LAYER_ITEM,
        ) as HTMLElement | null);
    const overId = overRow?.getAttribute(CONST.DATA.LAYER_ID) ?? null;
    const overRole = overId ? ui.c.layerRegistry.get(overId)?.role : undefined;
    try {
      if (row && targetKey) {
        ui.c.reorderFolder(
          draggedFolder.role as LayerRole,
          draggedFolder.key,
          targetKey,
          dropsAfter(event, row),
        );
      } else if (
        overRow &&
        overId &&
        overRole === draggedFolder.role &&
        !isGroupDrag(ui, overId)
      ) {
        // A member row belongs to the folder block above it; a root layer row
        // is a block of its own. `blockEntryOfRow` resolves both.
        const entry = blockEntryOfRow(overRow);
        if (entry && entry !== draggedFolder.key) {
          ui.c.reorderFolder(
            draggedFolder.role as LayerRole,
            draggedFolder.key,
            entry,
            dropsAfter(event, overRow),
          );
        }
      }
    } finally {
      clearDragState(ui);
      // The commit acknowledgement: the same single state, held on the block's
      // new position for one --foliplus-drag-commit beat.
      if (row && targetKey) {
        flashCommit(
          ui,
          `[${CONST.DATA.FOLDER_KEY}="${targetKey}"]`,
          dropsAfter(event, row) ? CONST.DRAG_STATE.AFTER : CONST.DRAG_STATE.BEFORE,
        );
      }
    }
    return;
  }

  const target = (event.target as HTMLElement).closest(
    CONST.SEL.LAYER_ITEM,
  ) as HTMLElement | null;
  const draggedEntry = ui.listPanel.dragEntry;
  if (!draggedEntry) return;

  // A folder row takes the layer into that folder — unless the layer is a
  // group, whose children are its own sub-layers.
  const folderKey = target?.getAttribute(CONST.DATA.FOLDER_KEY) ?? null;
  if (target && folderKey) {
    const zone = folderDropZone(target, event.clientY);
    try {
      if (zone === "into") {
        if (!isGroupDrag(ui, draggedEntry.id)) {
          ui.c.moveLayerToFolder(draggedEntry.id, folderKey);
        }
      } else if (zone === "before") {
        ui.c.moveLayerToRootAt(draggedEntry.id, folderKey);
      } else {
        const role = target.getAttribute(CONST.DATA.ROLE) ?? "";
        ui.c.moveLayerToRootAt(draggedEntry.id, blockEntryAfter(ui, role, folderKey));
      }
    } finally {
      clearDragState(ui);
      flashCommit(
        ui,
        `[${CONST.DATA.FOLDER_KEY}="${folderKey}"]`,
        zone === "into"
          ? CONST.DRAG_STATE.JOIN
          : zone === "before"
            ? CONST.DRAG_STATE.BEFORE
            : CONST.DRAG_STATE.AFTER,
      );
    }
    return;
  }

  // No row under the pointer: the layer lands at that block position, which is
  // how it gets between two folder blocks.
  if (!target) {
    const before = blockEntryBefore(ui, event.clientY);
    try {
      ui.c.moveLayerToRootAt(draggedEntry.id, before);
    } finally {
      clearDragState(ui);
    }
    return;
  }

  // The session is validated at every use, not just at the end: the entry
  // the gesture dragged with must still be the one the registry holds. An
  // unregister, or a replacement under the same id, retires the whole
  // session here — entry, hover chrome and all — instead of moving
  // whatever now sits at the old position.
  const dragged = dragIdx(ui, draggedEntry);
  if (dragged < 0) {
    clearDragState(ui);
    return;
  }

  const targetId = target.getAttribute(CONST.DATA.LAYER_ID);
  const targetIdx = targetId ? registryIdx(ui, targetId) : -1;
  if (targetIdx < 0) {
    clearDragState(ui);
    return;
  }
  // Dropping on a row adopts that row's folder: onto a root row the layer
  // leaves its folder, onto a member row it joins that member's folder. The
  // tree guide follows from the assignment, so this is the whole move. Keys,
  // not display names: a renamed folder's name no longer normalises to its key,
  // so a name-keyed move would materialise a second folder under the new name.
  const targetFolder = ui.c.folderKeyOf(targetId!) ?? "";
  const sourceFolder = ui.c.folderKeyOf(draggedEntry.id) ?? "";
  if (targetFolder !== sourceFolder && !isGroupDrag(ui, draggedEntry.id)) {
    ui.c.moveLayerToFolder(draggedEntry.id, targetFolder);
  }
  if (dragged === targetIdx) {
    // A drop on the dragged row finishes the gesture: a programmatic drop never
    // sends the native dragend the browser would, so the session comes down
    // here instead of staying dragged with no commit behind it.
    clearDragState(ui);
    return;
  }
  if (!ui.c.canReorderBetween(dragged, targetIdx)) {
    // A programmatic drop never receives the native dragend, so the session
    // has to be closed here — same reason as the no-op branch above.
    showReorderBlockedHint(ui);
    clearDragState(ui);
    return;
  }

  // Everything else is the controller's commit funnel — registry move, z
  // repricing, saved order, the panel-order signal that relocates the rows,
  // and the layer CHANGE — the same sequence a keyboard or API move runs, so
  // a drag is no longer invisible to event consumers. A terminal consumer
  // can throw out of it after the commit landed; the gesture state comes
  // down regardless, or the panel would keep claiming a drag in flight.
  try {
    ui.c.reorderLayer(draggedEntry.id, targetId!);
  } finally {
    clearDragState(ui);
    flashCommit(
      ui,
      `[${CONST.DATA.LAYER_ID}="${targetId}"]`,
      dragged < targetIdx ? CONST.DRAG_STATE.AFTER : CONST.DRAG_STATE.BEFORE,
    );
  }
};

/** Idempotent gesture teardown: the dragged session, the hover marker and the
 *  drag chrome all go — whether the drop committed, was refused, threw, or
 *  the control unmounted mid-gesture. The drop's commit boundary, the
 *  native dragend and the unbind boundary share it; it clears the pure
 *  session state even when the panel itself is already gone. */
const clearDragState = (ui: LayerUI): void => {
  ui.listPanel.dragEntry = null;
  ui.listPanel.dragFolder = null;
  ui.listPanel.lastDragOverItem = null;
  clearDragStateAttr(ui);
};

const handleDragEnd = (ui: LayerUI) => {
  clearDragState(ui);
};

export {
  toggleFold,
  toggleFolderFold,
  isFolderFolded,
  handleDragStart,
  showReorderBlockedHint,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleDragEnd,
  clearDragState,
};

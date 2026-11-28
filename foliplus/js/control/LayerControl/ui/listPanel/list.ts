// LayerControl UI — Layer row structure / list layout / insert / reindex.
import { type ProjectionBatch, notifyDeltas } from "../apply.js";
import { getColorSurface } from "../color.js";
import { seedAuthorVisible } from "../intent.js";
import { closeAttrsPanel } from "../overlayPanel/attr.js";
import { ROW_NOUN, withNoun } from "../rowNoun.js";
import { closeStylePanel } from "../style/index.js";
import type { LayerUI } from "../surface.js";
import {
  cursorRef,
  getNavigableItems,
  reconcileCursorByIdentity,
  restoreCursor,
  syncListCursor,
} from "./cursor.js";
import {
  applyRowView,
  buildRowCell,
  countLabelTitle,
  countTooltip,
  displayName,
  roleCountText,
} from "./rowView.js";
import {
  type RoleAggregates,
  roleAggregates,
  syncNoBasemap,
  syncToggleAll,
} from "./visibility.js";
import {
  type LayerRole,
  ROLE,
  folderEntries,
  folderOf,
  groupByFolder,
  roleBlocks,
} from "#core/layer/index.js";
import { dom, updateItemLabel } from "#platform/dom.js";
import { ICON_GLOBE } from "#platform/icon.js";
import {
  createCheckbox,
  finishSlidersIn,
  sectionDivider,
  triStateOf,
} from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";
import {
  effectiveFolderFolded,
  effectiveRoleFolded,
} from "#control/LayerControl/fold/index.js";
import * as SVGs from "#control/LayerControl/icon.js";

/** Full re-scan of every row (used on attach/fold-toggle). Idempotent —
 *  re-run on each CONTROL_ATTACHED so late-registering components are
 *  folded in.
 *
 *  Returns the round its replay produced instead of announcing it: the callers
 *  that own the panel — attach, the init timer, the control-attached re-run and
 *  `rebuildList` — finish their own rows, counts and readiness first, and only
 *  they know when that is done. */
const initTypesAndVisibility = (ui: LayerUI): ProjectionBatch => {
  // The color basemap is a first-class base-role layer: `getColorSurface`
  // registers it and returns the surface; a re-run is a no-op. Only after the
  // registry entry exists is its author default marked hidden — the entry is
  // what `setAuthorVisible` keys on.
  getColorSurface(ui);
  const colorLi = ui.c.layerRegistry.get(CONST.SOLID_BASEMAP_ID);
  if (colorLi) {
    // The color basemap starts unchecked (hidden) by default.
    ui.runtimeStore.setAuthorVisible(CONST.SOLID_BASEMAP_ID, false);
  }

  // Apply persisted hidden state first so initLayerItem reads the corrected
  // map state: folium adds every layer before the control IIFE runs, so on
  // reload hidden layers are back on the map. An id that is not in the
  // registry is skipped by the sweep, not dropped from the record —
  // stored
  // state is erased only by an explicit delete.
  const moved = ui.c.replayStoredStateAll();

  // First-load visibility is the author's `show=`: no code fallback for
  // "no basemap visible" — the A′ hatch (see paintNoBasemapHatch) is the
  // honest empty state. Adding a color layer here would violate the
  // intent-only invariant: derived state may suppress display but never
  // authorize it.
  for (let i = 0; i < ui.c.layers.length; i++) {
    initLayerItem(ui, ui.c.layers[i]);
  }
  ui.c.enforceOrder();
  syncToggleAll(ui, ROLE.OVERLAY);
  syncToggleAll(ui, ROLE.BASE);
  syncNoBasemap(ui);
  // enforceOrder may have moved rows; keep roving tabindex aligned.
  syncListCursor(ui);
  return moved;
};

/** Ready signal for tests and integrations: the entry that owns the panel has
 *  finished painting it. Set last, once, by that entry — a flag that also went
 *  up mid-pass would describe a bare list as settled. */
const markSettled = (ui: LayerUI): void => {
  ui.uiContainer?.setAttribute("data-ready", "true");
};

/** The one entry that rebuilds the row list — fold toggles, the reorder APIs
 *  and the post-move reindex all come through here, so "rows, counts,
 *  readiness, then the round" is written once.
 *
 *  `data-ready` comes down first: the rows are about to be replaced with bare
 *  ones, and leaving the previous pass's value up would report an arrangement
 *  that no longer exists as settled. */
const rebuildList = (ui: LayerUI): void => {
  const container = ui.uiContainer;
  if (!container) return;
  container.removeAttribute("data-ready");
  renderInitialList(ui);
  const moved = initTypesAndVisibility(ui);
  ui.refreshAllCounts();
  container.setAttribute("data-ready", "true");
  // Last: the rows are painted, the counts and the tri-state agree with them,
  // and the readiness flag is up — a subscriber that re-enters reads a
  // finished panel rather than the bare list this pass started from.
  notifyDeltas(ui, moved);
};

/** Index path from `root` down to `target`, for a `target` the caller has
 *  already proved is a descendant (`previous.contains(activeEl)`).
 *  Duplicates are clones, so the same path addresses the "same" node in the
 *  surviving copy — the exact checkbox / ⋮ button / fold control the user
 *  was on, not the row that happens to contain it. */
const pathWithin = (root: HTMLElement, target: HTMLElement): number[] => {
  const path: number[] = [];
  let node: HTMLElement = target;
  while (node !== root) {
    // `contains` above guarantees the chain reaches `root`, so a null parent
    // is unreachable here — the cast keeps the walk branch-free.
    const parent = node.parentElement as HTMLElement;
    path.unshift(Array.prototype.indexOf.call(parent.children, node));
    node = parent;
  }
  return path;
};

/** Resolve a path produced by `pathWithin` against another clone. */
const nodeAtPath = (root: HTMLElement, path: number[]): HTMLElement | null => {
  let node: Element = root;
  for (const index of path) {
    const next = node.children[index];
    if (!next) return null;
    node = next;
  }
  // The source was an HTMLElement and a clone preserves node types.
  return node as HTMLElement;
};

/** Focus `el` for real. `focus()` on a node the engine refuses to focus is a
 *  silent no-op, and the restore chain below needs to know whether to move on
 *  instead of assuming the first candidate took. */
const focusIfPossible = (el: HTMLElement | null): boolean => {
  if (!el?.isConnected) return false;
  el.focus();
  return document.activeElement === el;
};

/** Restore focus after a duplicate node is dropped: the exact descendant first
 *  (a native <select> popup or a menu's keyboard chain depends on that
 *  precision), then the caller's fallback, then the surviving node itself,
 *  then the nearest navigable row/anchor, and finally the panel container. A
 *  stripped clone — the survivor's controls were removed before the duplicate
 *  was detected — must not leave the keyboard user on <body>. */
const restoreFocusAfterDuplicate = (
  ui: LayerUI,
  survivor: HTMLElement,
  focusPath: number[],
  focusFallback: () => HTMLElement | null,
): void => {
  if (focusIfPossible(nodeAtPath(survivor, focusPath))) return;
  if (focusIfPossible(focusFallback())) return;
  if (focusIfPossible(survivor)) return;
  // Browser-only defense: a surviving row IS focusable by construction
  // (rows render `tabindex="0"`), so this rung is reached only when the
  // survivor is not rendered — a duplicate inside a folded role, where the
  // engine refuses focus on a `display: none` subtree. jsdom applies no
  // stylesheet, so the suite stages that refusal with an inline style
  // ("walks to a visible neighbour when the surviving duplicate is folded"),
  // which exercises the walk end to end. The forward/backward exits depend on
  // which neighbours refuse focus — a browser-only distribution the suite
  // cannot faithfully stage — and the container last resort additionally
  // needs every navigable item to refuse focus, so the tail stays exempt from
  // the branch gate rather than deleted: folding the wrong row must not
  // strand keyboard focus on <body>.
  // unreachable: the surviving row is focusable by construction; only a
  // folded duplicate (display:none) refuses focus, which jsdom cannot stage.
  /* v8 ignore start */
  // Nearest navigable neighbour: forward first, then backward. Folded or
  // otherwise unfocusable rows simply fail the probe and the walk moves on.
  const items = getNavigableItems(ui);
  const survivorIdx = items.indexOf(survivor);
  for (let i = survivorIdx + 1; i < items.length; i++) {
    if (focusIfPossible(items[i])) return;
  }
  for (let i = survivorIdx - 1; i >= 0; i--) {
    if (focusIfPossible(items[i])) return;
  }
  const container = ui.uiContainer;
  if (!container) return;
  // Last resort: make the panel itself programmatically focusable. Removing
  // the attribute right after would blur the very node just focused, so it
  // stays for the session — `tabindex="-1"` is not a Tab stop and costs no
  // layout.
  if (!container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
  focusIfPossible(container);
  /* v8 ignore stop */
};

/** Repair one duplicated node — a layer row or a toggle-all anchor: finish an
 *  in-flight slider edit, carry the cursor and DOM focus onto the surviving
 *  later node, then drop the earlier one. The pair names the same layer (or
 *  role), so the cursor can move to the survivor without re-resolving an
 *  identity that is about to change position. Focus returns to the same
 *  descendant path when the clone still carries it; `focusFallback` covers a
 *  stripped clone. */
const removeDuplicateNode = (
  ui: LayerUI,
  previous: HTMLElement,
  survivor: HTMLElement,
  focusFallback: () => HTMLElement | null,
): void => {
  const activeEl = document.activeElement as HTMLElement | null;
  // null when focus is elsewhere: the path is also the "did the removed node
  // own focus?" answer, so one lookup carries both facts.
  const focusPath =
    activeEl && previous.contains(activeEl) ? pathWithin(previous, activeEl) : null;
  const items = getNavigableItems(ui);
  const activeRow =
    ui.listPanel.activeIdx === null ? null : (items[ui.listPanel.activeIdx] ?? null);
  // DOM focus is the cursor even when the ledger has not caught up yet: the
  // row can own focus for a frame after a pointer/Alt+Enter activation. Treat
  // that as active so the repair does not drop the user's focus on <body>.
  const wasActive =
    focusPath !== null ||
    activeRow === previous ||
    previous.classList.contains(CONST.CLASSES.FOCUSED);
  // Removing a node in front of the cursor shifts every later position down;
  // a stale `activeIdx` would make the reconcile re-home onto its neighbor.
  // The comparison must happen while both nodes are still connected.
  const shiftsActive = activeRow
    ? (previous.compareDocumentPosition(activeRow) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
      0
    : false;

  finishSlidersIn(previous);
  previous.remove();

  if (wasActive) {
    survivor.classList.add(CONST.CLASSES.FOCUSED);
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(survivor);
    if (focusPath) {
      restoreFocusAfterDuplicate(ui, survivor, focusPath, focusFallback);
    }
  } else if (shiftsActive) {
    // Re-resolve rather than decrement: same node, one lookup away, and it
    // cannot drift when the repair itself moves the survivor.
    ui.listPanel.activeIdx = getNavigableItems(ui).indexOf(activeRow as HTMLElement);
  }
};

/** Align the panel's rows with the registry order in one in-place pass —
 *  the incremental counterpart of {@link rebuildList} for reorder signals,
 *  where membership is unchanged and only positions shift.
 *
 *  The target sequence is exactly what `renderInitialList` would emit: each
 *  role's toggle-all anchor ahead of that role's first row, rows in
 *  registry order. A row already sitting behind its predecessor is left
 *  alone (`previousElementSibling` check — no write, no reflow), so a
 *  typical moveLayerUp/Down relocates one node and an in-order list costs
 *  nothing. The pass is not minimum-write for every permutation: a long
 *  forward move (first row to last) relocates every displaced sibling on
 *  the way, up to N−1 writes — still one in-place pass and no rebuild, but
 *  the minimum-write reconcile (single direct placement of the moved row,
 *  or an LIS-based pass) is a known follow-up, not what this does. Row
 *  content is untouched: a pure reorder changes no count, checkbox or
 *  tri-state, so the rows already agree with the registry by construction.
 *  `data-ready` never comes down — the list stays complete and readable
 *  throughout.
 *
 *  The reconcile is one pass over `container.children`, not a
 *  `querySelector` per row: the panel's row set is exactly the registry's
 *  (rows are added/removed only by insertLayerItem / retireEntry), so the
 *  ids found in this scan are the ids the registry walk below will ask
 *  for. A persistent id → row index was considered and rejected: it would
 *  have to be maintained at every write site across two modules, and a
 *  missed rebuild would hand out detached nodes — for no gain over this
 *  single scan.
 *
 *  Focus travels with the nodes: an in-place `insertBefore` keeps DOM focus
 *  on the moved row's focused descendant (checkbox, ⋮ button, a panel
 *  control) in every engine implementing the spec's focus-fixing steps, so
 *  the reconcile never re-aims focus itself. The one exception is honored
 *  exactly: if something did drop it, it goes back to the *exact*
 *  descendant — a native <select> popup or a menu's keyboard chain depends
 *  on that precision — never to the row. */
const syncRowOrder = (ui: LayerUI): void => {
  const container = ui.uiContainer;
  if (!container) return;
  const rows = new Map<string, HTMLElement>();
  const anchors = new Map<string, HTMLElement>();
  const folderRows = new Map<string, HTMLElement>();
  for (const child of Array.from(container.children)) {
    const el = child as HTMLElement;
    const folderKey = el.getAttribute(CONST.DATA.FOLDER_KEY);
    if (folderKey) {
      folderRows.set(folderKey, el);
      continue;
    }
    const id = el.getAttribute(CONST.DATA.LAYER_ID);
    if (id) {
      // A duplicate id means two write paths raced or one leaked. The later
      // node wins — it is what the newest insert mounted — so the earlier
      // duplicate is removed here rather than left to intercept the clicks,
      // focus and drags aimed at the live row. A warn alone left both nodes
      // in the DOM and the Map silently answering with the last one.
      const previous = rows.get(id);
      if (previous) {
        ui.log?.warn(`syncRowOrder: duplicate row for layer "${id}"`);
        removeDuplicateNode(ui, previous, el, () => el);
      }
      rows.set(id, el);
    } else if (el.classList.contains(CONST.CLASSES.TOGGLE_ALL)) {
      const role = el.getAttribute("data-role");
      if (role) {
        const previous = anchors.get(role);
        if (previous) {
          // Same repair rule as rows: the later anchor is the one the newest
          // pass mounted, so the earlier duplicate must not stay behind to
          // intercept clicks. The shared helper moves the cursor when the
          // anchor was active and returns focus to the same fold control.
          ui.log?.warn(`syncRowOrder: duplicate toggle-all anchor for "${role}"`);
          removeDuplicateNode(ui, previous, el, () =>
            el.querySelector<HTMLElement>("input, button, [tabindex]"),
          );
        }
        anchors.set(role, el);
      }
    }
  }

  const targets: HTMLElement[] = [];
  // The target sequence is the BLOCK order, not the registry order: a folder
  // row is a block header, and a root layer can sit between two folder blocks.
  // Walking the registry alone left every folder row out of `targets`, so the
  // moves below pushed them to the end of the panel.
  const anchorSeen = new Set<string>();
  const pushRole = (role: string): void => {
    if (anchorSeen.has(role) || !rolesWithHeader(ui, role)) return;
    anchorSeen.add(role);
    const anchor = anchors.get(role);
    if (anchor) targets.push(anchor);
    else ui.log?.warn("syncRowOrder: role rows present, anchor missing");
    // A stub surface (tests, a panel built before the layout exists) has no
    // block order to walk: the registry order is the whole sequence.
    if (!ui.c.folderLayoutView) {
      for (const layerInfo of ui.c.layers) {
        if (layerInfo.role !== role) continue;
        const row = rows.get(layerInfo.id);
        if (row) targets.push(row);
      }
      return;
    }
    for (const block of displayBlocks(ui, role)) {
      if (block.kind === "folder") {
        const row = folderRows.get(block.key);
        if (row) targets.push(row);
        // The block's members follow its header — a folder row without them
        // would leave every member row behind at the panel's tail.
        for (const member of block.block.members) {
          const memberRow = rows.get(member.id);
          if (memberRow) targets.push(memberRow);
        }
      } else {
        const row = rows.get(block.layer.id);
        if (row) targets.push(row);
      }
    }
  };
  for (const layerInfo of ui.c.layers) pushRole(layerInfo.role);
  for (const role of [ROLE.OVERLAY, ROLE.BASE]) pushRole(role);
  // The length check is the cheap side of the panel-matches-registry
  // invariant; only when it breaks is the diff computed and named, so the
  // hot path never pays for the diagnostics. One warn names both sides of
  // the drift — an empty list reads as "[ ]", which is itself the answer.
  if (
    rows.size !==
    targets.filter(t => t.getAttribute(CONST.DATA.LAYER_ID) !== null).length
  ) {
    const missing = ui.c.layers.filter(l => !rows.has(l.id)).map(l => l.id);
    const known = new Set(ui.c.layers.map(l => l.id));
    const unknown = [...rows.keys()].filter(id => !known.has(id));
    ui.log?.warn(
      `syncRowOrder: panel/registry drift — rows without entries [${unknown.join(", ")}], entries without rows [${missing.join(", ")}]`,
    );
  }
  if (targets.length === 0) return;

  // The cursor is captured by identity before any move: activeIdx is a
  // position, and positions are exactly what is about to change.
  const ref = cursorRef(ui);
  const active = document.activeElement as HTMLElement | null;
  let settled: HTMLElement | null = null;
  for (const node of targets) {
    if (settled) {
      if (node.previousElementSibling !== settled) {
        container.insertBefore(node, settled.nextSibling);
      }
    } else if (container.firstElementChild !== node) {
      container.insertBefore(node, container.firstElementChild);
    }
    settled = node;
  }

  // Rows moved: the cursor metadata follows by identity — the roving tab
  // stop repaints, activeIdx re-homes, and DOM focus is left where the
  // move carried it (see the function header for the exact-descendant
  // guarantee).
  reconcileCursorByIdentity(ui, ref);
  if (
    active &&
    active !== document.body &&
    active.isConnected &&
    document.activeElement !== active
  ) {
    active.focus();
  }
  // The rows moved, so the ├/└ connectors they carry may no longer match the
  // block they sit in.
  refreshTreeConnectors(ui);
};

/** Re-derive each member row's tree connector (├ vs └) from the layout.
 *
 *  The class is written at render time, but syncRowOrder moves rows without
 *  re-rendering them: a member that became its block's last kept its ├ and the
 *  stem ran past the block, and one that stopped being last kept its └ and
 *  broke the line. Repeated drags accumulated both. One pass over the rows is
 *  cheap and self-healing. */
const refreshTreeConnectors = (ui: LayerUI): void => {
  const container = ui.uiContainer;
  if (!container) return;
  const layout = ui.c.folderLayoutView;
  // One block map per role, built once. memberInfo() rebuilds the whole role's
  // block map per row, which made every reorder O(rows × registry) — the one
  // path that runs on every drag, not just on a full rebuild.
  const blocksByRole = new Map<string, ReturnType<typeof groupByFolder>>();
  const blocksFor = (role: string) => {
    let blocks = blocksByRole.get(role);
    if (!blocks) {
      blocks = groupByFolder(ui.c.layers, role as LayerRole, layout);
      blocksByRole.set(role, blocks);
    }
    return blocks;
  };
  for (const row of container.querySelectorAll<HTMLElement>(CONST.SEL.LAYER_ITEM)) {
    const tree = row.querySelector<HTMLElement>(CONST.SEL.FOLD_TREE);
    if (!tree) continue;
    const id = row.getAttribute(CONST.DATA.LAYER_ID);
    const info = id ? ui.c.layerRegistry.get(id) : undefined;
    if (!info) continue;
    const folderKey = folderOf(layout, info);
    const block = folderKey ? blocksFor(info.role).get(folderKey) : undefined;
    // Only a member row carries a tree guide, so a missing block means "not a
    // member" and the connector is irrelevant.
    const isLast = block
      ? block.members[block.members.length - 1]?.id === info.id
      : false;
    tree.classList.toggle(CONST.CLASSES.FOLD_TREE_LAST, isLast);
    tree.classList.toggle(CONST.CLASSES.FOLD_TREE_MID, !isLast);
  }
};

/** Whether the given role should render its toggle-all header row.
 *  Shared by renderInitialList, syncRowOrder, insertLayerItem and retireRow so
 *  the four cannot drift apart (builder-4 ②③④). A role keeps its header
 *  while it owns at least one live layer OR at least one folder key in the
 *  persisted order — the latter keeps the empty-folder cleanup button reachable
 *  after the role's layers are gone (hard constraint 1).
 *  @param {LayerUI} ui - The control surface.
 *  @param {string} role - A LayerRole ("overlay" | "base").
 *  @returns {boolean} True when the header must be rendered. */
const rolesWithHeader = (ui: LayerUI, role: string): boolean => {
  if (ui.c.layers.some(l => l.role === role)) return true;
  // A stub surface may carry no layout at all; an absent layout owns no keys.
  const layout = ui.c.folderLayoutView;
  const keys = layout?.order[role as keyof typeof layout.order];
  return Boolean(keys && keys.length > 0);
};

/** True when the panel owns at least one folder key (any role). The
 *  conditional-render gate: no folders → the rail slot stays exactly as
 *  today (byte-identical); at least one folder → every row adds its rail
 *  content and the role row gains divider/count/type-icon/more. */
const hasAnyFolder = (ui: LayerUI): boolean => {
  const layout = ui.c.folderLayoutView;
  // A folder exists if a role holds an ordered block key, OR any live member
  // is assigned to a folder. Declared-only grouping (no persisted order yet)
  // materialises the folder row from the member assignments, so the gate must
  // read members too — checking only `order` leaves a declared folder invisible
  // until the first user action freezes the order.
  return (
    (layout.order[ROLE.OVERLAY]?.length ?? 0) > 0 ||
    (layout.order[ROLE.BASE]?.length ?? 0) > 0 ||
    Object.values(layout.members).some(m => m.folder !== "")
  );
};

/** The panel's row sequence for one role: the shared block sequence, projected
 *  into the shape the renderer walks. The ORDER lives in `roleBlocks` — the
 *  same function the stacking order uses — so a row can never paint in one
 *  place and stack in another. */
const displayBlocks = (
  ui: LayerUI,
  role: string,
): Array<
  | { kind: "folder"; key: string; name: string; block: { members: LayerInfo[] } }
  | { kind: "layer"; layer: LayerInfo }
> =>
  roleBlocks(role as LayerRole, ui.c.layers, ui.c.folderLayoutView).map(block =>
    block.kind === "folder"
      ? {
          kind: "folder" as const,
          key: block.key,
          name: block.displayName,
          block: { members: block.members },
        }
      : { kind: "layer" as const, layer: block.info },
  );
const renderInitialList = (ui: LayerUI) => {
  // Take the container once: nothing below notifies, so this local stays the
  // live panel for the whole pass.
  const container = ui.uiContainer;
  if (!container) return;
  // Remember the cursor by identity — the item elements are rebuilt below,
  // so an element reference would dangle. Layer rows key on data-layer-id,
  // toggle-all rows on data-role (they have no layer id). The identity also
  // tracks the row through a reorder. Null means the cursor was never
  // established or Escape cleared it, and either way it should stay cleared.
  const ref = cursorRef(ui);
  const frag = document.createDocumentFragment();
  // Headers follow the layer order: a role's header is appended the first
  // time the loop sees one of its rows, so a two-role panel keeps
  // [overlay header][overlay rows][base header][base rows] (the ordering the
  // layer sequence already establishes). A role that owns only an empty
  // folder key — no live rows — gets its header after the loop, keeping the
  // empty-folder cleanup button reachable (hard constraint 1 / builder-4 ②).
  const headerSeen = new Set<string>();
  // Folder-aware row order: for each role with a header, emit the role row,
  // then each folder block (folder row + members) and the role's root layers
  // in the exact `roleOrder` sequence (folderLayout.ts).
  const roleLabel = (role: string) =>
    role === ROLE.BASE ? "base_map_label" : "data_layer_label";
  const emitRole = (role: string) => {
    if (headerSeen.has(role) || !rolesWithHeader(ui, role)) return;
    headerSeen.add(role);
    // One aggregate pass per role, shared by the role header and every folder
    // row of the role: the header used to compute its own copy, so a single
    // render walked the registry twice per role.
    const aggregates = roleAggregates(ui, role);
    frag.appendChild(renderToggleAllRow(ui, role, roleLabel(role), aggregates));
    const roleFolded = effectiveRoleFolded(
      ui.listPanel.foldedRoles,
      ui.listPanel.authorDefaultFoldedRoles,
      role,
    );
    for (const block of displayBlocks(ui, role)) {
      if (block.kind === "folder") {
        const row = renderFolderRow(
          ui,
          role,
          block.key,
          block.name,
          aggregates.folders.get(block.key) ?? { total: 0, on: 0 },
        );
        const folderFolded = effectiveFolderFolded(
          ui.listPanel.authorFoldedFolders,
          ui.listPanel.foldedFolders,
          role,
          block.key,
        );
        // The row paints its own fold state (renderFolderRow). A folded ROLE
        // hides the whole block, header included — otherwise folding a role
        // left its folder rows on screen and only their members went away.
        // The folder's own fold state is untouched, so unfolding the role
        // restores exactly the view the user had.
        if (roleFolded) row.classList.add(CONST.CLASSES.GROUP_FOLDED);
        frag.appendChild(row);
        for (const member of block.block.members) {
          const item = renderLayerItem(ui, member);
          if (roleFolded || folderFolded) {
            item.classList.add(CONST.CLASSES.GROUP_FOLDED);
          }
          frag.appendChild(item);
        }
      } else {
        const item = renderLayerItem(ui, block.layer);
        if (roleFolded) {
          item.classList.add(CONST.CLASSES.GROUP_FOLDED);
        }
        frag.appendChild(item);
      }
    }
  };
  // Roles in the order the layer sequence introduces them (overlay then base
  // for a two-role panel), then any role that owns only an empty folder key.
  const seenRoleOrder: string[] = [];
  for (const layerInfo of ui.c.layers) {
    if (!seenRoleOrder.includes(layerInfo.role)) {
      seenRoleOrder.push(layerInfo.role);
      emitRole(layerInfo.role);
    }
  }
  for (const role of [ROLE.OVERLAY, ROLE.BASE]) {
    if (!headerSeen.has(role)) emitRole(role);
  }

  // The rebuild drops every row (and any style panel anchored in one). A drag
  // that is still live has already produced a value; finish it before the DOM
  // goes, or its change event is lost with the node.
  finishSlidersIn(container);
  // Close the row panels the rows carry BEFORE they are detached: the style
  // panel owns a scheme picker (a portaled dropdown plus its document
  // listeners), and dropping the card with innerHTML would leave that picker
  // alive against a trigger that no longer exists. The narrow closes keep the
  // focus spotlight and the menu untouched — folding a role or reordering the
  // list is not a reason to clear the map highlight.
  closeStylePanel(ui, false);
  closeAttrsPanel(ui, false);
  container.innerHTML = "";
  container.appendChild(frag);

  // ARIA + roving tabindex on the rebuilt rows. setIndex follows activeIdx
  // without painting the cursor class — restoreCursor() owns that visual.
  syncListCursor(ui);

  // Re-home the cursor on the rebuilt element and restore DOM focus. The
  // rebuild destroys the previously focused node, dropping focus to <body>;
  // the keyboard shortcuts are dispatched by a document-level listener whose
  // container guard requires focus inside the panel, so without this the
  // cursor dies the moment the list is rebuilt (e.g. after a fold click).
  restoreCursor(ui, ref);
};

/** Ensure the shared ListCursor and re-apply ARIA / roving tabindex.
 *  setIndex, not adopt: callers that already painted FOCUSED (keyboard /
 *  restoreCursor) must keep it; only the pointer path adopts (strips). */

const insertLayerItem = (ui: LayerUI, layerInfo: LayerInfo) => {
  const idx = ui.c.layerRegistry.indexOf(layerInfo);
  if (idx === -1) return;
  const container = ui.uiContainer;
  if (!container) {
    // Only reachable when a teardown retired the control between the signal
    // and this pass — the row simply has nowhere to go. Debug level: a normal
    // teardown no-ops here, and the trace is for "why did my row not appear".
    ui.log.debug(`insertLayerItem: panel is gone, dropping row "${layerInfo.id}"`);
    return;
  }
  // Capture the cursor by identity before the row lands: a late
  // registration can slot in ahead of the active row, and a positional
  // ledger would hand the cursor, marker and tab stop to the newcomer while
  // DOM focus stayed on the row the user is actually in.
  const ref = cursorRef(ui);
  const role = layerInfo.role;

  // `firstOfGroup` anchors the INSERT position: the first ROW of this role,
  // not the role header. The header is checked separately so a late row
  // lands at its registry depth (beside its role's other rows) instead of
  // being wedged above the header — the TOGGLE_ALL match must not become an
  // insertion anchor, so the header stays adjacent to its rows.
  const firstRowSel =
    role === ROLE.BASE
      ? `${CONST.SEL.LEAF_ITEM}[data-layer-type="${ROLE.BASE}"]`
      : `${CONST.SEL.LEAF_ITEM}:not([data-layer-type="${ROLE.BASE}"])`;
  const firstOfGroup = container.querySelector(firstRowSel);
  const header = container.querySelector(
    `${CONST.SEL.TOGGLE_ALL}[data-role="${role}"]`,
  );

  const frag = document.createDocumentFragment();
  if (!header) {
    frag.appendChild(
      renderToggleAllRow(
        ui,
        role,
        role === ROLE.BASE ? "base_map_label" : "data_layer_label",
      ),
    );
  }
  const item = renderLayerItem(ui, layerInfo);
  if (
    effectiveRoleFolded(
      ui.listPanel.foldedRoles,
      ui.listPanel.authorDefaultFoldedRoles,
      role,
    )
  ) {
    item.classList.add(CONST.CLASSES.GROUP_FOLDED);
  }
  frag.appendChild(item);

  // A folder member joins its folder block (renderInitialList's placement
  // rule), not the role's root-layer stream: the row is a flat sibling right
  // after the folder row, at its rank among the block's members. The
  // registry-depth anchor below would land it beside the root layers instead,
  // so a late-registered member declared into a folder shows fallen to root on
  // refresh. The folder row is already on the panel whenever the folder owns
  // an order key or a live member (the block sequence), so the member-position
  // insert is the normal path; a folder row that is not on the panel yet falls
  // through to the registry-depth anchor.
  //
  // The registry-depth anchor is NOT a fallback for a folder member: anchoring
  // a late member on its registry neighbour (the row above in ui.c.layers)
  // lands it before the folder header once the neighbour is a root layer — the
  // bug #1361 fixed for the initial render, re-introduced here if the anchor
  // were used. The member-position path above is the only correct placement
  // for a declared folder member; the registry-depth branch runs only for a
  // layer that is not a folder member (root layer or a brand-new folder with
  // no row yet).
  const memberFolderKey = folderOf(ui.c.folderLayoutView, layerInfo);
  const folderRow = memberFolderKey
    ? container.querySelector<HTMLElement>(
        `[${CONST.DATA.FOLDER_KEY}="${CSS.escape(memberFolderKey)}"]`,
      )
    : null;
  if (folderRow) {
    const block = displayBlocks(ui, role).find(
      (b): b is Extract<NonNullable<typeof b>, { kind: "folder" }> =>
        b.kind === "folder" && b.key === memberFolderKey,
    );
    // Invariant: the folder row came from roleBlocks, and displayBlocks is
    // roleBlocks projected — a folder row on the panel means the block IS in
    // the sequence with kind "folder". The block therefore always exists and
    // is always a folder block; the non-null assertion pins that invariant
    // (the old ?: [] fallback was a dead branch codecov could never see run).
    const members = block!.block.members;
    const memberIdx = members.findIndex(m => m.id === layerInfo.id);
    let anchor: HTMLElement = folderRow;
    // Rows are added/removed only by insertLayerItem / retireRow, and retireRow
    // also drops the member from the block — so every prior member's row is on
    // the panel when this loop runs. The row lookup is a defensive check, not a
    // reachable branch; the anchor stays the folder row only if it ever misses.
    for (let i = 0; i < memberIdx; i++) {
      const memberRow = container.querySelector<HTMLElement>(
        `[${CONST.DATA.LAYER_ID}="${CSS.escape(members[i].id)}"]`,
      );
      if (memberRow) anchor = memberRow;
    }
    anchor.after(frag);
  } else if (!firstOfGroup) {
    // BASE inserts before the first base row (end of the base role).
    // OVERLAY inserts before the first base row; when none exists, append at
    // the end.
    const nextAnchor = container.querySelector(
      `${CONST.SEL.LAYER_ITEM}[data-layer-type="${ROLE.BASE}"]`,
    );
    if (nextAnchor) container.insertBefore(frag, nextAnchor);
    else container.appendChild(frag);
  } else {
    // The row lands where the registry put the layer, not at the role's top: a
    // late registration replayed onto a stored slot must sit at that depth in
    // the panel too, so the panel's visual order matches the drawn z-order.
    // The neighbor above is used rather than the one below so the last row of
    // a role has something to anchor on at all.
    const above = idx > 0 ? ui.c.layers[idx - 1] : null;
    const anchor =
      above?.role === layerInfo.role
        ? container.querySelector(`[${CONST.DATA.LAYER_ID}="${CSS.escape(above.id)}"]`)
        : null;
    if (anchor) anchor.after(frag);
    else container.insertBefore(frag, firstOfGroup);
  }

  // Late registration — seed the author's default here, once per id.
  // Initial layers were already seeded in `LayerUI`'s constructor; a
  // late-registered layer has no data[] entry, so folium's default applies.
  // The setter is idempotent (overwrites the same value), so re-registration
  // is harmless.
  seedAuthorVisible(ui, layerInfo);
  // The stored-state projection is NOT run here: the registration entry
  // (registerLayer) owns that pass and its notify, so a subscriber sees the
  // finished row, count and order before any CHANGE — and this insertion is
  // also one half of the attach-time pending drain, whose other half (the
  // full `applyUserState` sweep) covers the same ids.
  // The new row joins the roving tabindex / ARIA set, and the cursor ledger
  // re-homes by identity: syncListCursor alone would repaint from the stale
  // numeric index, which now names a different row.
  syncListCursor(ui);
  reconcileCursorByIdentity(ui, ref);
};

const updateLayerItemLabel = (ui: LayerUI, layerInfo: LayerInfo) => {
  const item = ui.uiContainer?.querySelector(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerInfo.id)}"]`,
  ) as HTMLElement | null;
  if (!item) return;
  // updateItemLabel writes the row label, its resident full-name tooltip and
  // the checkbox's aria-label, so a re-registration refreshes the hover name
  // too; the row's own tooltip stays the feature count + type.
  updateItemLabel(item, displayName(ui, layerInfo.id));
};

/** Count the role's empty folder keys (key present, zero live members).
 *  A key is empty when no live layer in the role has normalize(folder)===key.
 *  Called on every render — never cached (hard constraint 3). */
const emptyFolderKeys = (ui: LayerUI, role: string): string[] => {
  const layout = ui.c.folderLayoutView;
  // Only folder keys are candidates: the block order also carries root-layer
  // entries ("layer:<id>"), and a root layer has no folder, so treating those
  // as folder keys would report every root layer as an empty folder.
  const keys = folderEntries(layout.order[role as keyof typeof layout.order] ?? []);
  if (keys.length === 0) return [];
  return keys.filter(
    k =>
      !ui.c.layers.some(l => {
        const info = ui.c.layerRegistry.get(l.id);
        return info !== undefined && folderOf(layout, info) === k;
      }),
  );
};

const renderToggleAllRow = (
  ui: LayerUI,
  role: string,
  labelKey: string,
  aggregates?: RoleAggregates,
) => {
  const isFolded = effectiveRoleFolded(
    ui.listPanel.foldedRoles,
    ui.listPanel.authorDefaultFoldedRoles,
    role,
  );
  // Role-level count: aggregated with the same source as the checkbox
  // (role count and checkbox state come from one aggregator). A caller that
  // already holds the role's table passes it in; the insert path (a late
  // registration) has none and computes one.
  const vis = aggregates ?? roleAggregates(ui, role);
  const countText = roleCountText(vis.total, vis.on);
  const children: HTMLElement[] = [
    dom.el(
      "button",
      {
        class: CONST.CLASSES.FOLD_BTN,
        // The arrow's direction is driven by this attribute alone: row.css turns
        // the svg on [aria-expanded="true"], reading the angle out of token.css, so
        // a folder row or a container row (#1276) that reuses this button gets the
        // same turn. Same isFolded that picks the FOLDED class and the title
        // above - one state, three projections.
        "aria-expanded": isFolded ? "false" : "true",
        // Same contract as the folder row's chevron: the state is
        // aria-expanded and the accessible name is the row's own label, so a
        // screen reader announces "数据图层, collapsed, button" instead of an
        // unnamed button.
        "aria-label": ui.T(labelKey),
      },
      { html: SVGs.ICON_FOLD },
    ),
    // Shared tri-state primitive: the aggregate { total, on } maps to a state
    // and the primitive paints checked/indeterminate/aria-checked together.
    createCheckbox({
      triState: triStateOf(vis.total, vis.on),
      attributes: {
        "data-role": CONST.TOGGLE_ALL_ROLE,
        title: ui.T("toggle_all_deselect_tooltip"),
      },
    }).host,
    // The label and the divider share one flex cell: as two grid items in the
    // same column they overlapped, and the divider's left fade started under
    // the name instead of after it.
    dom.el(
      "span",
      { class: CONST.CLASSES.ROLE_HEAD },
      dom.el("span", { class: CONST.CLASSES.SEPARATOR_LABEL }, ui.T(labelKey)),
      (() => {
        const divider = sectionDivider("div");
        divider.classList.add(CONST.CLASSES.ROLE_DIVIDER);
        return divider;
      })(),
    ),
  ];
  // The role row always carries the divider (before count), the layer-count
  // (role layer count, not feature count), the role-level type icon and a
  // row-level ⋮ (independent of the panel-header ⋮). The ⋮ is the only entry
  // to "New Folder", so gating these cells on "a folder already exists" made
  // the first folder unreachable from the UI.
  //
  // Same paint recipe as the shared section divider (soft gradient at both
  // ends); only the span differs, because the role row owns the count / icon /
  // more cells the pre-folder divider used to run through. A second hand-rolled
  // line here is what made the two role sections look different from main.
  children.push(
    dom.el(
      "span",
      {
        class: CONST.CLASSES.COUNT_COL,
        [CONST.DATA.ROLE]: role,
        title: countTooltip(ui, "layers_count_tooltip", vis.on, vis.total),
      },
      countText,
    ),
  );
  children.push(
    dom.el(
      "div",
      {
        class: CONST.CLASSES.TYPE_ICON_COL,
        // Same sentence shape as a layer row's type cell: the count, then the
        // word for what the row is.
        title: countLabelTitle(countText, ui.T(labelKey)),
      },
      { html: role === ROLE.BASE ? ICON_GLOBE : SVGs.ICON_LAYERS },
    ),
  );
  children.push(
    dom.el(
      "button",
      {
        class: CONST.CLASSES.MORE_BTN,
        type: "button",
        title: withNoun(ui, "more_tooltip", ROW_NOUN.ROLE),
        "aria-label": withNoun(ui, "more_tooltip", ROW_NOUN.ROLE),
      },
      { html: SVGs.ICON_MORE },
    ),
  );
  return dom.el(
    "div",
    {
      // The role row deliberately does NOT carry LAYER_ITEM: that class means
      // "a layer row" to the panel's own selectors and to the browser tests,
      // and a role header matching it made every leaf-row lookup resolve to
      // the header. The shared cell paint reaches it by selector instead (see
      // the "Shared row cells" block in row.css).
      // ACTIVE is the icon wake: a group row whose members are on reads as
      // active exactly like a checked layer row.
      class: `${CONST.CLASSES.ROW} ${CONST.CLASSES.FOLD_BTN_CTR} ${CONST.CLASSES.TOGGLE_ALL} ${CONST.CLASSES.ROLE_ROW}${isFolded ? ` ${CONST.CLASSES.FOLDED}` : ""}${vis.on > 0 ? ` ${CONST.CLASSES.ACTIVE}` : ""}`,
      tabindex: "0",
      "data-role": role,
      title: ui.T(isFolded ? "unfold_tooltip" : "fold_tooltip"),
    },
    ...children,
  );
};

/** Render a folder row (a user-created group inside a role).
 *  Structure:
 *  [fold-btn][checkbox (tri-state)][label--folder][count(data-folder-key)]
 *  [type-icon-col (folder icon, fixed)][more-btn].
 *  The whole row is clickable (fold toggle, reusing the role handler path);
 *  the checkbox and more button stopPropagation in lifecycle. */
const renderFolderRow = (
  ui: LayerUI,
  role: string,
  folderKey: string,
  folderName: string,
  vis: { total: number; on: number },
) => {
  const folded = effectiveFolderFolded(
    ui.listPanel.authorFoldedFolders,
    ui.listPanel.foldedFolders,
    role,
    folderKey,
  );
  const countText = roleCountText(vis.total, vis.on);
  return dom.el(
    "div",
    {
      // FOLDED is the row's own state (chevron direction, accent rail);
      // GROUP_FOLDED means "hidden because my group is folded" and belongs to
      // the members only — putting it here hid the header itself, which is the
      // only way back to the members.
      class: `${CONST.CLASSES.ROW} ${CONST.CLASSES.LAYER_ITEM} ${CONST.CLASSES.FOLDER_ROW}${folded ? ` ${CONST.CLASSES.FOLDED}` : ""}${vis.on > 0 ? ` ${CONST.CLASSES.ACTIVE}` : ""}`,
      tabindex: "0",
      [CONST.DATA.ROLE]: role,
      [CONST.DATA.FOLDER_KEY]: folderKey,
      [CONST.DATA.FOLDER_NAME]: folderName,
      "aria-expanded": folded ? "false" : "true",
      draggable: "true",
    },
    dom.el(
      "button",
      {
        class: CONST.CLASSES.FOLD_BTN,
        "aria-expanded": folded ? "false" : "true",
        // The folder name is the accessible name; the state is aria-expanded.
        "aria-label": folderName,
        title: ui.T(folded ? "unfold_tooltip" : "fold_tooltip"),
      },
      { html: SVGs.ICON_FOLD },
    ),
    // Shared tri-state primitive (same paint as the role header above).
    createCheckbox({
      triState: triStateOf(vis.total, vis.on),
      ariaLabel: folderName,
      attributes: { title: ui.T(vis.on > 0 ? "deselect_tooltip" : "select_tooltip") },
    }).host,
    dom.el(
      "label",
      {
        class: `${CONST.CLASSES.LAYER_LABEL} ${CONST.CLASSES.FOLDER_LABEL}`,
        // The full name, like a layer row's label: the cell clips long names.
        title: folderName,
      },
      folderName,
    ),
    dom.el(
      "span",
      {
        class: CONST.CLASSES.COUNT_COL,
        [CONST.DATA.FOLDER_KEY]: folderKey,
        title: countTooltip(ui, "layers_count_tooltip", vis.on, vis.total),
      },
      countText,
    ),
    dom.el(
      "div",
      {
        class: CONST.CLASSES.TYPE_ICON_COL,
        title: countLabelTitle(countText, ui.T("noun_folder")),
      },
      { html: SVGs.ICON_FOLDER },
    ),
    dom.el(
      "button",
      {
        class: CONST.CLASSES.MORE_BTN,
        type: "button",
        title: withNoun(ui, "more_tooltip", ROW_NOUN.FOLDER),
        "aria-label": withNoun(ui, "more_tooltip", ROW_NOUN.FOLDER),
      },
      { html: SVGs.ICON_MORE },
    ),
  );
};

/** Whether a layer is a folder member and, if so, whether it is the last one
 *  in its folder (drives the └ vs ├ tree connector). */
const memberInfo = (
  ui: LayerUI,
  layerInfo: LayerInfo,
): { isMember: boolean; isLast: boolean } => {
  const layout = ui.c.folderLayoutView;
  const folderKey = folderOf(layout, layerInfo);
  if (!folderKey) return { isMember: false, isLast: false };
  const block = groupByFolder(ui.c.layers, layerInfo.role, layout).get(folderKey);
  if (!block) return { isMember: false, isLast: false };
  const idx = block.members.findIndex(m => m.id === layerInfo.id);
  return { isMember: true, isLast: idx === block.members.length - 1 };
};

/** Render a single layer row.
 *  Structure: [drag-handle][checkbox][label (flex)] [count][type-icon-col].
 *  The count column is inserted immediately before the type-icon column so
 *  the two right-side decorations stay visually grouped.  The count value
 *  is populated lazily by initLayerItem (layer may not be resolved yet at
 *  render time) and refreshed by onLayerItemCountChange.
 *  @param {LayerInfo} layerInfo - Layer metadata.
 *  @returns {HTMLElement} The row element. */
const renderLayerItem = (ui: LayerUI, layerInfo: LayerInfo) => {
  const name = displayName(ui, layerInfo.id);

  const typeIconEl = dom.el("div", { class: CONST.CLASSES.TYPE_ICON_COL });
  if (layerInfo.iconSvg) typeIconEl.innerHTML = layerInfo.iconSvg;

  const moreBtn = dom.el(
    "button",
    {
      class: CONST.CLASSES.MORE_BTN,
      type: "button",
      // A container row is corrected to the group noun by applyRowView, which
      // is the first point that knows the layer resolved to a group.
      title: withNoun(ui, "more_tooltip", ROW_NOUN.LAYER),
      "aria-label": withNoun(ui, "more_tooltip", ROW_NOUN.LAYER),
    },
    { html: SVGs.ICON_MORE },
  );
  // All layers get the "more" button — data layers can focus + rename, base
  // maps can rename (focus on a base map is a harmless full-world fitBounds).

  const withFolders = hasAnyFolder(ui);
  const railChildren: HTMLElement[] = [];
  if (withFolders) {
    // v3.6: with folders the rail slot is the tree-line (member) or empty
    // (root) at rest, and the drag grip appears on hover. The grip element is
    // always present (existing drag-probe readers query it); the tree node is
    // the sibling the hover swap toggles. At rest the grip is opacity 0
    // (existing recipe) and the tree is the visible occupant.
    const mem = memberInfo(ui, layerInfo);
    if (mem.isMember) {
      railChildren.push(
        dom.el("span", {
          class: `${CONST.CLASSES.FOLD_TREE}${
            mem.isLast
              ? ` ${CONST.CLASSES.FOLD_TREE_LAST}`
              : ` ${CONST.CLASSES.FOLD_TREE_MID}`
          }`,
          title: ui.T("drag_tooltip"),
        }),
      );
    }
  }
  const railCell = dom.el(
    "span",
    { class: CONST.CLASSES.RAIL_CELL, title: ui.T("drag_tooltip") },
    ...railChildren,
  );
  railCell.insertAdjacentHTML("beforeend", SVGs.ICON_DRAG_HANDLE);
  const children: HTMLElement[] = [
    railCell,
    // Shared checkbox primitive; a layer row's own box is always binary.
    // The name reaches assistive tech via aria-label. `title` is the
    // Select/Deselect slot — initLayerItem sets it per checked state before
    // this row can be hovered, so leave it unseeded rather than flashing the
    // layer name.
    createCheckbox({ checked: true, ariaLabel: name }).host,
    dom.el("label", { class: CONST.CLASSES.LAYER_LABEL }, name),
    dom.el("span", {
      class: CONST.CLASSES.COUNT_COL,
      [CONST.DATA.LAYER_ID]: layerInfo.id,
    }),
    typeIconEl,
    moreBtn,
  ];

  return dom.el(
    "div",
    {
      class: `${CONST.CLASSES.ROW} ${CONST.CLASSES.LAYER_ITEM}`,
      draggable: "true",
      tabindex: "0",
      [CONST.DATA.LAYER_ID]: layerInfo.id,
      "data-layer-type": layerInfo.role,
    },
    ...children,
  );
};

/** Current display name for the virtual color basemap: persisted rename if
 *  present, else the locale label. Name is persisted rename or locale label. */
const colorLayerName = (ui: LayerUI): string => {
  return displayName(ui, CONST.SOLID_BASEMAP_ID);
};

/** Initialize one layer row's checkbox + type icon (incremental path).
 *  @returns {boolean} true when the row is a visible base layer. */
const initLayerItem = (ui: LayerUI, layerInfo: LayerInfo): boolean => {
  if (!ui.c.layerRegistry.has(layerInfo.id)) return false;
  const container = ui.uiContainer;
  if (!container) {
    // Normal-teardown no-op (the panel is gone); debug trace for the case
    // that is not normal.
    ui.log.debug(`initLayerItem: panel is gone, row "${layerInfo.id}" unpainted`);
    return false;
  }
  const cell = buildRowCell(ui, layerInfo);
  // Resolve the row by data-layer-id: a late registration lands where its
  // stored slot puts it, so the DOM order can diverge from the registry — an
  // index-based lookup would write the checkbox and type column into a
  // neighbor's row.
  const item = container.querySelector(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerInfo.id)}"]`,
  ) as HTMLElement | null;
  if (!item) return false;

  applyRowView(ui, item, cell);
  // Map membership was already written by the executor's projection sweep
  // that runs before this row lands, so the visible mirror here matches
  // what the map actually shows.

  return cell.shown && layerInfo.role === ROLE.BASE;
};

/**
 * Keyboard event handler for layer navigation and interaction.
 * Only responds when focus is within the layer panel.
 *
 * Supported shortcuts:
 *   ArrowUp / ArrowDown - Navigate between layer items
 *   ArrowLeft / ArrowRight / Space / Enter - Toggle visibility of focused layer
 *   Ctrl+ArrowUp / Ctrl+ArrowDown - Move focused layer up/down in z-order
 *   Escape - Cancel: inline rename, overflow menu, the attributes panel,
 *     the layer focus overlay, or the row keyboard cursor
 */

export {
  displayBlocks,
  emptyFolderKeys,
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
  refreshTreeConnectors,
};

// LayerControl UI — Layer row structure / list layout / insert / reindex.
import { GROUP } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import * as SVGs from "#foliplus/LayerControl/icon.js";
import { finishSlidersIn } from "#foliplus/LayerControl/slider.js";
import { dom, updateItemLabel } from "#common/dom.js";
import { type ProjectionBatch, notifyDeltas } from "../apply.js";
import { getColorSurface } from "../color.js";
import { seedAuthorVisible } from "../intent.js";
import { closeAttrsPanel } from "../overlayPanel/attr.js";
import { closeStylePanel } from "../style/index.js";
import type { LayerUI } from "../surface.js";
import {
  cursorRef,
  getNavigableItems,
  reconcileCursorByIdentity,
  restoreCursor,
  syncListCursor,
} from "./cursor.js";
import { applyRowView, buildRowCell, displayName } from "./rowView.js";
import { syncNoBasemap, syncToggleAll } from "./visibility.js";

/** Full re-scan of every row (used on attach/fold-toggle). Idempotent —
 *  re-run on each CONTROL_ATTACHED so late-registering components are
 *  folded in.
 *
 *  Returns the round its replay produced instead of announcing it: the callers
 *  that own the panel — attach, the init timer, the control-attached re-run and
 *  `rebuildList` — finish their own rows, counts and readiness first, and only
 *  they know when that is done. */
const initTypesAndVisibility = (ui: LayerUI): ProjectionBatch => {
  // The color basemap is a first-class base-group layer: `getColorSurface`
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
  const moved = ui.applyUserState();

  // First-load visibility is the author's `show=`: no code fallback for
  // "no basemap visible" — the A′ hatch (see paintNoBasemapHatch) is the
  // honest empty state. Adding a color layer here would violate the
  // intent-only invariant: derived state may suppress display but never
  // authorize it.
  for (let i = 0; i < ui.c.layers.length; i++) {
    initLayerItem(ui, ui.c.layers[i]);
  }
  ui.c.enforceOrder();
  syncToggleAll(ui, GROUP.OVERLAY);
  syncToggleAll(ui, GROUP.BASE);
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
  // survivor is not rendered — a duplicate inside a folded group, where the
  // engine refuses focus on a `display: none` subtree. jsdom applies no
  // stylesheet, so the suite stages that refusal with an inline style
  // ("walks to a visible neighbour when the surviving duplicate is folded"),
  // which exercises the walk end to end. The forward/backward exits depend on
  // which neighbours refuse focus — a browser-only distribution the suite
  // cannot faithfully stage — and the container last resort additionally
  // needs every navigable item to refuse focus, so the tail stays exempt from
  // the branch gate rather than deleted: folding the wrong row must not
  // strand keyboard focus on <body>.
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
 *  group), so the cursor can move to the survivor without re-resolving an
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
 *  group's toggle-all anchor ahead of that group's first row, rows in
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
  for (const child of Array.from(container.children)) {
    const el = child as HTMLElement;
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
      const group = el.getAttribute("data-group");
      if (group) {
        const previous = anchors.get(group);
        if (previous) {
          // Same repair rule as rows: the later anchor is the one the newest
          // pass mounted, so the earlier duplicate must not stay behind to
          // intercept clicks. The shared helper moves the cursor when the
          // anchor was active and returns focus to the same fold control.
          ui.log?.warn(`syncRowOrder: duplicate toggle-all anchor for "${group}"`);
          removeDuplicateNode(ui, previous, el, () =>
            el.querySelector<HTMLElement>("input, button, [tabindex]"),
          );
        }
        anchors.set(group, el);
      }
    }
  }

  const targets: HTMLElement[] = [];
  let hasBaseMaps = false;
  let hasOverlays = false;
  for (const layerInfo of ui.c.layers) {
    // Anchor names follow renderInitialList's grouping: every non-base
    // group rides the OVERLAY anchor, so base maps stay a trailing section.
    if (layerInfo.group !== GROUP.BASE && !hasOverlays) {
      hasOverlays = true;
      const anchor = anchors.get(GROUP.OVERLAY);
      if (anchor) targets.push(anchor);
      else ui.log?.warn("syncRowOrder: overlay rows present, anchor missing");
    }
    if (layerInfo.group === GROUP.BASE && !hasBaseMaps) {
      hasBaseMaps = true;
      const anchor = anchors.get(GROUP.BASE);
      if (anchor) targets.push(anchor);
      else ui.log?.warn("syncRowOrder: base rows present, anchor missing");
    }
    const row = rows.get(layerInfo.id);
    if (row) targets.push(row);
  }
  // The length check is the cheap side of the panel-matches-registry
  // invariant; only when it breaks is the diff computed and named, so the
  // hot path never pays for the diagnostics. One warn names both sides of
  // the drift — an empty list reads as "[ ]", which is itself the answer.
  if (
    rows.size !==
    targets.filter(t => !t.classList.contains(CONST.CLASSES.TOGGLE_ALL)).length
  ) {
    const missing = ui.c.layers.filter(l => !rows.has(l.id)).map(l => l.id);
    const known = new Set(ui.c.layers.map(l => l.id));
    const unknown = [...rows.keys()].filter(id => !known.has(id));
    ui.log?.warn(
      `syncRowOrder: panel/registry drift — rows without entries ` +
        `[${unknown.join(", ")}], entries without rows [${missing.join(", ")}]`,
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
};

const renderInitialList = (ui: LayerUI) => {
  // Take the container once: nothing below notifies, so this local stays the
  // live panel for the whole pass.
  const container = ui.uiContainer;
  if (!container) return;
  // Remember the cursor by identity — the item elements are rebuilt below,
  // so an element reference would dangle. Layer rows key on data-layer-id,
  // toggle-all rows on data-group (they have no layer id). The identity also
  // tracks the row through a reorder. Null means the cursor was never
  // established or Escape cleared it, and either way it should stay cleared.
  const ref = cursorRef(ui);
  const frag = document.createDocumentFragment();
  let hasBaseMaps = false;
  let hasOverlays = false;

  for (const layerInfo of ui.c.layers) {
    if (layerInfo.group !== GROUP.BASE && !hasOverlays) {
      hasOverlays = true;
      frag.appendChild(renderToggleAllRow(ui, GROUP.OVERLAY, "data_layer_label"));
    }
    if (layerInfo.group === GROUP.BASE && !hasBaseMaps) {
      hasBaseMaps = true;
      frag.appendChild(renderToggleAllRow(ui, GROUP.BASE, "base_map_label"));
    }
    const group = layerInfo.group;
    const item = renderLayerItem(ui, layerInfo);
    if (ui.listPanel.foldedGroups.has(group)) {
      item.classList.add(CONST.CLASSES.GROUP_FOLDED);
    }
    frag.appendChild(item);
  }

  // The rebuild drops every row (and any style panel anchored in one). A drag
  // that is still live has already produced a value; finish it before the DOM
  // goes, or its change event is lost with the node.
  finishSlidersIn(container);
  // Close the row panels the rows carry BEFORE they are detached: the style
  // panel owns a scheme picker (a portaled dropdown plus its document
  // listeners), and dropping the card with innerHTML would leave that picker
  // alive against a trigger that no longer exists. The narrow closes keep the
  // focus spotlight and the menu untouched — folding a group or reordering the
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
  const group = layerInfo.group;

  const anchorSel =
    group === GROUP.BASE
      ? `${CONST.SEL.LAYER_ITEM}[data-layer-type="${GROUP.BASE}"]`
      : `${CONST.SEL.LAYER_ITEM}:not([data-layer-type="${GROUP.BASE}"])`;
  const firstOfGroup = container.querySelector(anchorSel);

  const frag = document.createDocumentFragment();
  if (!firstOfGroup) {
    frag.appendChild(
      renderToggleAllRow(
        ui,
        group,
        group === GROUP.BASE ? "base_map_label" : "data_layer_label",
      ),
    );
  }
  const item = renderLayerItem(ui, layerInfo);
  if (ui.listPanel.foldedGroups.has(group)) {
    item.classList.add(CONST.CLASSES.GROUP_FOLDED);
  }
  frag.appendChild(item);

  if (!firstOfGroup) {
    // BASE inserts before the first base row (end of the base section).
    // OVERLAY inserts before the first base row; when none exists, append at
    // the end.
    const nextAnchor = container.querySelector(
      `${CONST.SEL.LAYER_ITEM}[data-layer-type="${GROUP.BASE}"]`,
    );
    if (nextAnchor) container.insertBefore(frag, nextAnchor);
    else container.appendChild(frag);
  } else {
    // The row lands where the registry put the layer, not at the group's top: a
    // late registration replayed onto a stored slot must sit at that depth in
    // the panel too, so the panel's visual order matches the drawn z-order.
    // The neighbor above is used rather than the one below so the last row of
    // a group has something to anchor on at all.
    const above = idx > 0 ? ui.c.layers[idx - 1] : null;
    const anchor =
      above?.group === layerInfo.group
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

const renderToggleAllRow = (ui: LayerUI, group: string, labelKey: string) => {
  const isFolded = ui.listPanel.foldedGroups.has(group);
  return dom.el(
    "div",
    {
      class:
        `${CONST.CLASSES.FOLD_BTN_CTR} ${CONST.CLASSES.TOGGLE_ALL}` +
        (isFolded ? ` ${CONST.CLASSES.FOLDED}` : ""),
      tabindex: "0",
      "data-group": group,
      title: ui.T(isFolded ? "unfold_tooltip" : "fold_tooltip"),
    },
    dom.el(
      "button",
      {
        class: CONST.CLASSES.FOLD_BTN,
      },
      { html: SVGs.ICON_FOLD },
    ),
    dom.el(
      "div",
      { class: CONST.CLASSES.CHECKBOX },
      dom.el("input", {
        type: "checkbox",
        "data-role": "toggle-all",
        checked: "",
        title: ui.T("toggle_all_deselect_tooltip"),
      }),
    ),
    dom.el("span", { class: CONST.CLASSES.SEPARATOR_LABEL }, ui.T(labelKey)),
    dom.el("div", { class: "foliplus-section-divider" }),
  );
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
      title: ui.T("more_tooltip"),
      "aria-label": ui.T("more_tooltip"),
    },
    { html: SVGs.ICON_MORE },
  );
  // All layers get the "more" button — data layers can focus + rename, base
  // maps can rename (focus on a base map is a harmless full-world fitBounds).

  const children: HTMLElement[] = [
    dom.el(
      "span",
      { class: CONST.CLASSES.DRAG_CELL, title: ui.T("drag_tooltip") },
      { html: SVGs.ICON_DRAG_HANDLE },
    ),
    dom.el(
      "div",
      { class: CONST.CLASSES.CHECKBOX },
      dom.el("input", {
        type: "checkbox",
        checked: "",
        // The name reaches assistive tech via aria-label. `title` is the
        // Select/Deselect slot — initLayerItem sets it per checked state
        // before this row can be hovered, so leave it unseeded rather than
        // flashing the layer name.
        "aria-label": name,
      }),
    ),
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
      class: CONST.CLASSES.LAYER_ITEM,
      draggable: "true",
      tabindex: "0",
      [CONST.DATA.LAYER_ID]: layerInfo.id,
      "data-layer-type": layerInfo.group,
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

  return cell.shown && layerInfo.group === GROUP.BASE;
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

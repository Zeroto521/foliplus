// LayerControl UI — Layer row structure / list layout / insert / reindex.
import { GROUP } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import * as SVGs from "#foliplus/LayerControl/icon.js";
import { finishSlidersIn } from "#foliplus/LayerControl/slider.js";
import { dom, updateItemLabel } from "#common/dom.js";
import { type ProjectionBatch, notifyDeltas } from "../apply.js";
import { getColorSurface } from "../color.js";
import { seedAuthorVisible } from "../intent.js";
import type { LayerUI } from "../surface.js";
import { cursorRef, restoreCursor, syncListCursor } from "./cursor.js";
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

/** Align the panel's rows with the registry order by moving the fewest DOM
 *  nodes — the incremental counterpart of {@link rebuildList} for reorder
 *  signals, where membership is unchanged and only positions shift.
 *
 *  The target sequence is exactly what `renderInitialList` would emit: each
 *  group's toggle-all anchor ahead of that group's first row, rows in
 *  registry order. A row already sitting behind its predecessor is left
 *  alone (`previousElementSibling` check — no write, no reflow), so a
 *  typical moveLayerUp/Down relocates one node and an in-order list costs
 *  nothing. Row content is untouched: a pure reorder changes no count,
 *  checkbox or tri-state, so the rows already agree with the registry by
 *  construction. `data-ready` never comes down — the list stays complete
 *  and readable throughout.
 *
 *  The reconcile is one pass over `container.children`, not a
 *  `querySelector` per row: the panel's row set is exactly the registry's
 *  (rows are added/removed only by insertLayerItem / retireEntry), so the
 *  ids found in this scan are the ids the registry walk below will ask
 *  for. A persistent id→row index was considered and rejected: it would
 *  have to be maintained at every write site across two modules, and a
 *  missed rebuild would hand out detached nodes — for no gain over this
 *  single scan. */
const syncRowOrder = (ui: LayerUI): void => {
  const container = ui.uiContainer;
  if (!container) return;
  const rows = new Map<string, HTMLElement>();
  const anchors = new Map<string, HTMLElement>();
  for (const child of Array.from(container.children)) {
    const el = child as HTMLElement;
    const id = el.getAttribute(CONST.DATA.LAYER_ID);
    if (id) rows.set(id, el);
    else if (el.classList.contains(CONST.CLASSES.TOGGLE_ALL)) {
      const group = el.getAttribute("data-group");
      if (group) anchors.set(group, el);
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
    }
    if (layerInfo.group === GROUP.BASE && !hasBaseMaps) {
      hasBaseMaps = true;
      const anchor = anchors.get(GROUP.BASE);
      if (anchor) targets.push(anchor);
    }
    const row = rows.get(layerInfo.id);
    if (row) targets.push(row);
  }
  if (targets.length === 0) return;

  // The cursor is captured by identity before any move: activeIdx is a
  // position, and positions are exactly what is about to change.
  const ref = cursorRef(ui);
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

  // Rows moved: re-home the roving tabindex by identity, the same pair
  // renderInitialList runs after its rebuild.
  syncListCursor(ui);
  restoreCursor(ui, ref);
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
  // New row must join the roving tabindex / ARIA set.
  syncListCursor(ui);
};

const updateLayerItemLabel = (ui: LayerUI, layerInfo: LayerInfo) => {
  const item = ui.uiContainer?.querySelector(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerInfo.id)}"]`,
  ) as HTMLElement | null;
  if (!item) return;
  // updateItemLabel sets both the row label and the checkbox's aria-label,
  // so the name reaches assistive tech here without touching `title` — the
  // row's tooltip slot keeps the feature count + type.
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

// LayerControl UI — Layer row structure / list layout / insert / reindex.
import { GROUP } from "#core/layer/index.js";
import { ListCursor } from "#core/listCursor.js";
import { dom, updateItemLabel } from "#common/dom.js";
import * as CONST from "../const.js";
import * as SVGs from "../icon.js";
import { getColorSurface } from "./color.js";
import type { LayerUI } from "./index.js";
import { cursorRef, restoreCursor } from "./keyboard.js";
import { syncListCursor } from "./keyboard.js";
import type { ListPanel } from "./listPanel.js";
import {
  applyRowView,
  buildRowCell,
  displayName,
  snapshotAuthorVisible,
} from "./rowView.js";
import { applyUserState } from "./state.js";
import { syncNoBasemap, syncToggleAll } from "./visibility.js";

/** Full re-scan of every row (used on attach/fold-toggle). Idempotent —
 *  re-run on each CONTROL_ATTACHED so late-registering components are
 *  folded in. Marks the panel ready for tests/consumers. */
const initTypesAndVisibility = (lp: ListPanel, ui: LayerUI) => {
  // The colour basemap is a first-class base-group layer: `getColorSurface`
  // runs `surface.register()`, which inserts its LayerInfo through the
  // standard registerLayer path. All visibility / zoom / order machinery
  // then treats it identically to a tile basemap. `surface.register()` is
  // idempotent, so a re-run of this pass is a no-op on the registry side.
  getColorSurface(ui);
  const colorLi = ui.m.layerRegistry.get(CONST.SOLID_BASEMAP_ID);
  if (colorLi) {
    // The colour basemap starts unchecked (hidden) by default.
    ui.runtimeStore.setAuthorVisible(CONST.SOLID_BASEMAP_ID, false);
  }

  // Snapshot the author default before the sweep below moves any layer: it
  // re-adds a stored-shown layer and removes a stored-hidden one, so a
  // snapshot taken afterwards would record a policy decision as the author's.
  for (let i = 0; i < ui.m.layers.length; i++) {
    snapshotAuthorVisible(ui, ui.m.layers[i]);
  }

  // Apply persisted hidden state first so initLayerItem reads the corrected
  // map state: folium adds every layer before the control IIFE runs, so on
  // reload hidden layers are back on the map. An id that is not in the
  // registry is skipped by the sweep, not dropped from the record —
  // stored
  // state is erased only by an explicit delete.
  ui.applyUserState();

  // First-load visibility is the author's `show=`: no code fallback for
  // "no basemap visible" — the A′ hatch (see paintNoBasemapHatch) is the
  // honest empty state. Adding a colour layer here would violate the
  // intent-only invariant: derived state may suppress display but never
  // authorise it.
  for (let i = 0; i < ui.m.layers.length; i++) {
    initLayerItem(ui, ui.m.layers[i]);
  }
  ui.m.enforceOrder();
  syncToggleAll(lp, ui, GROUP.OVERLAY);
  syncToggleAll(lp, ui, GROUP.BASE);
  syncNoBasemap(ui);
  // enforceOrder may have moved rows; keep roving tabindex aligned.
  syncListCursor(ui.listPanel, ui);
  // Ready signal for tests: checkbox titles / .foliplus-active / counts are final
  // for the current layer set (late components re-trigger this pass and
  // re-set the attribute, so "ready" always reflects the latest pass).
  ui.uiContainer?.setAttribute("data-ready", "true");
};

const renderInitialList = (lp: ListPanel, ui: LayerUI) => {
  // Remember the cursor by identity — the item elements are rebuilt below,
  // so an element reference would dangle. Layer rows key on data-layer-id,
  // toggle-all rows on data-group (they have no layer id). The identity also
  // tracks the row through a reorder. Null means the cursor was never
  // established or Escape cleared it, and either way it should stay cleared.
  const ref = cursorRef(lp, ui);
  const frag = document.createDocumentFragment();
  let hasBaseMaps = false;
  let hasOverlays = false;

  for (const layerInfo of ui.m.layers) {
    if (layerInfo.group !== GROUP.BASE && !hasOverlays) {
      hasOverlays = true;
      frag.appendChild(renderToggleAllRow(lp, GROUP.OVERLAY, "data_layer_label"));
    }
    if (layerInfo.group === GROUP.BASE && !hasBaseMaps) {
      hasBaseMaps = true;
      frag.appendChild(renderToggleAllRow(lp, GROUP.BASE, "base_map_label"));
    }
    const group = layerInfo.group;
    const item = renderLayerItem(ui, layerInfo);
    if (lp.foldedGroups.has(group)) item.classList.add(CONST.CLASSES.GROUP_FOLDED);
    frag.appendChild(item);
  }

  ui.uiContainer.innerHTML = "";
  ui.uiContainer.appendChild(frag);

  // ARIA + roving tabindex on the rebuilt rows. setIndex follows activeIdx
  // without painting the cursor class — restoreCursor() owns that visual.
  syncListCursor(ui.listPanel, ui);

  // Re-home the cursor on the rebuilt element and restore DOM focus. The
  // rebuild destroys the previously focused node, dropping focus to <body>;
  // the keyboard shortcuts are dispatched by a document-level listener whose
  // container guard requires focus inside the panel, so without this the
  // cursor dies the moment the list is rebuilt (e.g. after a fold click).
  restoreCursor(ui.listPanel, ui, ref);
};

/** Ensure the shared ListCursor and re-apply ARIA / roving tabindex.
 *  setIndex, not adopt: callers that already painted FOCUSED (keyboard /
 *  restoreCursor) must keep it; only the pointer path adopts (strips). */

const insertLayerItem = (lp: ListPanel, ui: LayerUI, layerInfo: LayerInfo) => {
  const idx = ui.m.layerRegistry.indexOf(layerInfo);
  if (idx === -1) return;
  const container = ui.uiContainer;
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
        lp,
        group,
        group === GROUP.BASE ? "base_map_label" : "data_layer_label",
      ),
    );
  }
  const item = renderLayerItem(ui, layerInfo);
  if (lp.foldedGroups.has(group)) item.classList.add(CONST.CLASSES.GROUP_FOLDED);
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
    const above = idx > 0 ? ui.m.layers[idx - 1] : null;
    const anchor =
      above && above.group === layerInfo.group
        ? container.querySelector(`[${CONST.DATA.LAYER_ID}="${CSS.escape(above.id)}"]`)
        : null;
    if (anchor) anchor.after(frag);
    else container.insertBefore(frag, firstOfGroup);
  }

  // insertLayerItem is where a late-registered (third-party) layer first
  // shows up, so the author default is snapshotted here as well —
  // before the
  // apply below, which is the other path that moves this layer. Only this
  // layer's id is applied: a full sweep would re-rewrite every renamed row
  // on each registration.
  snapshotAuthorVisible(ui, layerInfo);
  ui.applyUserState(layerInfo.id);
  // New row must join the roving tabindex / ARIA set.
  syncListCursor(ui.listPanel, ui);
};

const updateLayerItem = (ui: LayerUI, layerInfo: LayerInfo) => {
  const item = ui.uiContainer.querySelector(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerInfo.id)}"]`,
  ) as HTMLElement | null;
  if (!item) return;
  // updateItemLabel sets both the row label and the checkbox's aria-label,
  // so the name reaches assistive tech here without touching `title` — the
  // row's tooltip slot keeps the feature count + type.
  updateItemLabel(item, displayName(ui, layerInfo.id));
};

const renderToggleAllRow = (lp: ListPanel, group: string, labelKey: string) => {
  const isFolded = lp.foldedGroups.has(group);
  return dom.el(
    "div",
    {
      class:
        `${CONST.CLASSES.FOLD_BTN_CTR} ${CONST.CLASSES.TOGGLE_ALL}` +
        (isFolded ? ` ${CONST.CLASSES.FOLDED}` : ""),
      tabindex: "0",
      "data-group": group,
      title: lp.T(isFolded ? "unfold_tooltip" : "fold_tooltip"),
    },
    dom.el(
      "button",
      {
        class: CONST.CLASSES.FOLD_BTN,
      },
      { html: SVGs.FOLD },
    ),
    dom.el(
      "div",
      { class: CONST.CLASSES.CHECKBOX },
      dom.el("input", {
        type: "checkbox",
        "data-role": "toggle-all",
        checked: "",
        title: lp.T("toggle_all_deselect_tooltip"),
      }),
    ),
    dom.el("span", { class: CONST.CLASSES.SEPARATOR_LABEL }, lp.T(labelKey)),
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
    { html: SVGs.MORE },
  );
  // All layers get the "more" button — data layers can focus + rename, base
  // maps can rename (focus on a base map is a harmless full-world fitBounds).

  const children: HTMLElement[] = [
    dom.el(
      "span",
      { class: CONST.CLASSES.DRAG_CELL, title: ui.T("drag_tooltip") },
      { html: SVGs.DRAG_HANDLE },
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
  if (!ui.m.layerRegistry.has(layerInfo.id)) return false;
  const cell = buildRowCell(ui, layerInfo);
  // Resolve the row by data-layer-id: a late registration lands where its
  // stored slot puts it, so the DOM order can diverge from the registry — an
  // index-based lookup would write the checkbox and type column into a
  // neighbor's row.
  const item = ui.uiContainer.querySelector(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerInfo.id)}"]`,
  ) as HTMLElement | null;
  if (!item) return false;

  applyRowView(ui, item, cell);
  // Map membership was already written by the executor's projection sweep
  // that runs before this row lands, so the visible mirror here matches
  // what the map actually shows.

  return cell.shown && layerInfo.group === GROUP.BASE;
};

/** Reindex all layer items after a move, preserving the active focus position.
 *  renderInitialList already re-homes the cursor and restores DOM focus, so
 *  no additional focus work is needed here. */
const reindexAfterMove = (lp: ListPanel, ui: LayerUI): void => {
  renderInitialList(lp, ui);
  initTypesAndVisibility(lp, ui);
  ui.refreshAllCounts();
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
  renderInitialList,
  insertLayerItem,
  updateLayerItem,
  renderToggleAllRow,
  renderLayerItem,
  colorLayerName,
  initLayerItem,
  reindexAfterMove,
};

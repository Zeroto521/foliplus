// LayerControl UI —Layer row render / insert / reindex.
import { GEOM_TYPE } from "#core/layer/index.js";
import { getGeometryType } from "#core/layer/index.js";
import { ListCursor } from "#core/listCursor.js";
import { dom, updateItemLabel } from "#common/dom.js";
import { formatNumber } from "#common/format.js";
import * as Icons from "#common/icon.js";
import * as CONST from "../const.js";
import * as SVGs from "../icon.js";
import * as Util from "../util.js";
import { showColorLayer } from "./color.js";
import { T } from "./context.js";
import type { LayerUI } from "./index.js";
import { cursorRef, restoreCursor } from "./keyboard.js";
import { syncListCursor } from "./keyboard.js";
import { reconcileHiddenIds } from "./state.js";
import { applyUserState } from "./state.js";
import { syncToggleAll, syncVisibility } from "./visibility.js";

/** Full re-scan of every row (used on attach/fold-toggle). Idempotent — *  re-run on each CONTROL_ATTACHED so late-registering components are
 *  folded in. Marks the panel ready for tests/consumers. */
const initTypesAndVisibility = (ui: LayerUI) => {
  // Apply persisted hidden state first so initLayerItem reads the corrected
  // map state: folium adds every layer before the control IIFE runs, so on
  // reload hidden layers are back on the map. Hidden ids no longer in the
  // registry are dropped (their layer was removed).
  applyUserState(ui);

  let anyBaseVisible = false;
  for (let i = 0; i < ui.m.layers.length; i++) {
    if (initLayerItem(ui, ui.m.layers[i])) anyBaseVisible = true;
  }
  // Once the pass above has written each checkbox from the map's real
  // membership, the rows hold the truth. Reconcile hiddenIds against them
  // exactly once so the persisted set becomes absolute. It must come after
  // initLayerItem, not in attachUI: rows render checked by default and
  // initLayerItem is what corrects them from map.hasLayer(). It also waits
  // until every layer resolves —on the first pass (setTimeout 0) folium
  // layers may not be linked into the registry yet, and reconciling then
  // would read a visible layer as hidden and persist that (corrupting the
  // local storage for every later test/load). The re-run triggered by
  // CONTROL_ATTACHED converges here.
  if (!ui.isHiddenReconciled && ui.allLayersResolved()) {
    ui.isHiddenReconciled = true;
    reconcileHiddenIds(ui);
  }
  // "All bases hidden" (not "any layer hidden") —hiding an overlay on a
  // base-less map must not suppress the color-layer background.
  const baseIds = [...ui.m.layers].filter(li => li.isBase).map(li => li.id);
  const allBasesHidden =
    baseIds.length > 0 && baseIds.every(id => ui.hiddenIds.has(id));

  // Only fall back to the color layer when there are no visible base layers
  // *and* the user never intentionally hid every base. Otherwise the
  // fallback would undo an explicit "hide all bases" choice.
  if (!anyBaseVisible && !allBasesHidden) showColorLayer(ui, ui.currentColor);
  ui.m.enforceOrder();
  syncToggleAll(ui, CONST.GROUP.OVERLAY);
  syncToggleAll(ui, CONST.GROUP.BASE);
  // enforceOrder may have moved rows; keep roving tabindex aligned.
  syncListCursor(ui);
  // Ready signal for tests: checkbox titles / .active / counts are final
  // for the current layer set (late components re-trigger this pass and
  // re-set the attribute, so "ready" always reflects the latest pass).
  ui.uiContainer?.setAttribute("data-ready", "true");
};

const renderInitialList = (ui: LayerUI) => {
  // Remember the cursor by identity —the item elements are rebuilt below,
  // so an element reference would dangle. Layer rows key on data-layer-id,
  // toggle-all rows on data-group (they have no layer id). The identity also
  // tracks the row through a reorder. Null means the cursor was never
  // established or Escape cleared it, and either way it should stay cleared.
  const ref = cursorRef(ui);
  const frag = document.createDocumentFragment();
  let hasBaseMaps = false;
  let hasOverlays = false;

  for (let i = 0; i < ui.m.layers.length; i++) {
    const layerInfo = ui.m.layers[i];
    if (!layerInfo.isBase && !hasOverlays) {
      hasOverlays = true;
      frag.appendChild(renderToggleAllRow(ui, CONST.GROUP.OVERLAY, "data_layer_label"));
    }
    if (layerInfo.isBase && !hasBaseMaps) {
      hasBaseMaps = true;
      frag.appendChild(renderToggleAllRow(ui, CONST.GROUP.BASE, "base_map_label"));
    }
    const group = layerInfo.isBase ? CONST.GROUP.BASE : CONST.GROUP.OVERLAY;
    const item = renderLayerItem(ui, layerInfo, i);
    if (ui.foldedGroups.has(group)) item.classList.add(CONST.CLASSES.GROUP_FOLDED);
    frag.appendChild(item);
  }

  const colorItem = renderColorLayerItem(ui);
  if (ui.foldedGroups.has(CONST.GROUP.BASE)) {
    colorItem.classList.add(CONST.CLASSES.GROUP_FOLDED);
  }
  frag.appendChild(colorItem);

  ui.uiContainer.innerHTML = "";
  ui.uiContainer.appendChild(frag);

  // ARIA + roving tabindex on the rebuilt rows. setIndex follows activeIdx
  // without painting the cursor class —restoreCursor() owns that visual.
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

const insertLayerItem = (
  ui: LayerUI,
  layerInfo: LayerInfo,
  { reindex = true }: { reindex?: boolean } = {},
) => {
  const idx = ui.m.layerRegistry.indexOf(layerInfo);
  if (idx === -1) return;
  const container = ui.uiContainer;
  const group = layerInfo.isBase ? CONST.GROUP.BASE : CONST.GROUP.OVERLAY;

  const anchorSel =
    group === CONST.GROUP.BASE
      ? `${CONST.SEL.LAYER_ITEM}[data-layer-type="${CONST.GROUP.BASE}"]`
      : `${CONST.SEL.LAYER_ITEM}:not([data-layer-type="${CONST.GROUP.BASE}"]):not(${CONST.SEL.COLOR_ITEM})`;
  const firstOfGroup = container.querySelector(anchorSel);

  const frag = document.createDocumentFragment();
  if (!firstOfGroup) {
    frag.appendChild(
      renderToggleAllRow(
        ui,
        group,
        group === CONST.GROUP.BASE ? "base_map_label" : "data_layer_label",
      ),
    );
  }
  const item = renderLayerItem(ui, layerInfo, idx);
  if (ui.foldedGroups.has(group)) item.classList.add(CONST.CLASSES.GROUP_FOLDED);
  frag.appendChild(item);

  if (!firstOfGroup) {
    const nextGroupSel =
      group === CONST.GROUP.BASE
        ? CONST.SEL.COLOR_ITEM
        : `${CONST.SEL.LAYER_ITEM}[data-layer-type="${CONST.GROUP.BASE}"]`;
    const nextAnchor = container.querySelector(nextGroupSel);
    if (nextAnchor) container.insertBefore(frag, nextAnchor);
    else container.appendChild(frag);
  } else container.insertBefore(frag, firstOfGroup);

  if (reindex) reindexItems(ui);
  // insertLayerItem is where a late-registered (third-party) layer first
  // shows up, so the user's name and visibility land with the row instead
  // of waiting for a later pass. Only this layer's id is applied —a full
  // sweep would re-rewrite every renamed row on each registration.
  applyUserState(ui, layerInfo.id);
  // New row must join the roving tabindex / ARIA set.
  syncListCursor(ui);
};

const updateLayerItem = (ui: LayerUI, layerInfo: LayerInfo, idx: number) => {
  const item = ui.uiContainer.querySelector(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerInfo.id)}"]`,
  ) as HTMLElement | null;
  if (!item) return;
  item.dataset.index = String(idx);
  // updateItemLabel sets both the row label and the checkbox's aria-label,
  // so the name reaches assistive tech here without touching `title` —the
  // row's tooltip slot keeps the feature count + type.
  updateItemLabel(item, displayName(ui, layerInfo.id));
  const checkbox = item.querySelector(
    'input[type="checkbox"]',
  ) as HTMLInputElement | null;
  if (checkbox) checkbox.dataset.index = String(idx);
};

/**
 * Effective panel display name for a layer: the user-assigned rename wins,
 * falling back to the registry name, then to the locale label for the
 * virtual color basemap —the only row with no registry entry.
 *
 * Every render path resolves names through here so a registry mutation
 * (re-registration, type refresh) can no longer resurrect the original
 * third-party name over a rename.
 */
const displayName = (ui: LayerUI, id: string): string => {
  return (
    ui.renamedNames[id] ??
    ui.m.layerRegistry.get(id)?.name ??
    (id === CONST.COLOR.MAP_ID ? T("color_map_label") : "")
  );
};

const renderToggleAllRow = (ui: LayerUI, group: string, labelKey: string) => {
  const isFolded = ui.foldedGroups.has(group);
  return dom.el(
    "div",
    {
      class:
        `${CONST.CLASSES.FOLD_BTN_CTR} ${CONST.CLASSES.TOGGLE_ALL}` +
        (isFolded ? ` ${CONST.CLASSES.FOLDED}` : ""),
      tabindex: "0",
      "data-group": group,
      title: T(isFolded ? "unfold_tooltip" : "fold_tooltip"),
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
        title: T("toggle_all_deselect_tooltip"),
      }),
    ),
    dom.el("span", { class: CONST.CLASSES.SEP_LABEL }, T(labelKey)),
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
 *  @param {number} idx - Position in the ordered registry.
 *  @returns {HTMLElement} The row element. */
const renderLayerItem = (ui: LayerUI, layerInfo: LayerInfo, idx: number) => {
  const name = displayName(ui, layerInfo.id);

  const typeIconEl = dom.el("div", { class: CONST.CLASSES.TYPE_ICON_COL });
  if (layerInfo.iconSvg) typeIconEl.innerHTML = layerInfo.iconSvg;

  const moreBtn = dom.el(
    "button",
    {
      class: CONST.CLASSES.MORE_BTN,
      type: "button",
      title: T("more_tooltip"),
      "aria-label": T("more_tooltip"),
    },
    { html: SVGs.MORE },
  );
  // All layers get the "more" button —data layers can focus + rename, base
  // maps can rename (focus on a base map is a harmless full-world fitBounds).

  const children: HTMLElement[] = [
    dom.el(
      "span",
      { class: CONST.CLASSES.DRAG_CELL, title: T("drag_tooltip") },
      { html: SVGs.DRAG_HANDLE },
    ),
    dom.el(
      "div",
      { class: CONST.CLASSES.CHECKBOX },
      dom.el("input", {
        type: "checkbox",
        checked: "",
        [CONST.DATA.INDEX]: String(idx),
        // The name reaches assistive tech via aria-label. `title` is the
        // Select/Deselect slot —initLayerItem sets it per checked state
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
      [CONST.DATA.INDEX]: String(idx),
      [CONST.DATA.LAYER_ID]: layerInfo.id,
      "data-layer-type": layerInfo.isBase ? CONST.GROUP.BASE : CONST.GROUP.OVERLAY,
    },
    ...children,
  );
};

/** Current display name for the virtual color basemap: persisted rename if
 *  present, else the locale label. The color layer has no registry entry. */
const colorLayerName = (ui: LayerUI): string => {
  return displayName(ui, CONST.COLOR.MAP_ID);
};

const renderColorLayerItem = (ui: LayerUI) => {
  // The input announces the same name as the row's label cell below, so a
  // rename reaches assistive tech on both —not just the visible text.
  const colorName = colorLayerName(ui);
  const colorInput = dom.el("input", {
    type: "color",
    class: CONST.CLASSES.COLOR_INPUT,
    value: ui.currentColor,
    "aria-label": colorName,
  });

  // Color layer lives outside layerRegistry —rename is the only overflow
  // action (no focus on a basemap without bounds).
  const moreBtn = dom.el(
    "button",
    {
      class: CONST.CLASSES.MORE_BTN,
      type: "button",
      title: T("more_tooltip"),
      "aria-label": T("more_tooltip"),
    },
    { html: SVGs.MORE },
  );

  // The color basemap's hover tooltip is its TYPE label (like every other
  // row, which shows "count 路 type"); the layer name lives in the label
  // cell, not the tooltip. Persist the type label in data-item-title so a
  // rebuild can restore it; this must be the constant T("type_color_map"),
  // NOT colorLayerName() —a rename must not change the tooltip.
  const colorType = T("type_color_map");
  return dom.el(
    "div",
    {
      class: `${CONST.CLASSES.LAYER_ITEM} ${CONST.CLASSES.COLOR_ITEM}`,
      draggable: "false",
      [CONST.DATA.LAYER_ID]: CONST.COLOR.MAP_ID,
      [CONST.DATA.TITLE]: colorType,
      title: colorType,
    },
    dom.el("span", { class: CONST.CLASSES.DRAG_CELL }, { html: SVGs.DRAG_HANDLE }),
    dom.el("div", { class: CONST.CLASSES.CHECKBOX }, colorInput),
    dom.el("label", { class: CONST.CLASSES.LAYER_LABEL }, colorLayerName(ui)),
    // count column is empty (color layers have no feature count).
    dom.el("span", { class: CONST.CLASSES.COUNT_COL }),
    dom.el("div", { class: CONST.CLASSES.TYPE_ICON_COL, innerHTML: SVGs.COLOR }),
    moreBtn,
  );
};

/** Initialize one layer row's checkbox + type icon (incremental path).
 *  @returns {boolean} true when the row is a visible base layer. */
const initLayerItem = (ui: LayerUI, layerInfo: LayerInfo): boolean => {
  const idx = ui.m.layerRegistry.indexOf(layerInfo);
  if (idx === -1) return false;
  const name = displayName(ui, layerInfo.id);
  const inputs = ui.uiContainer.querySelectorAll(
    `${CONST.SEL.LAYER_ITEM} input[type="checkbox"], ${CONST.SEL.LAYER_ITEM} input[type="radio"]`,
  ) as NodeListOf<HTMLInputElement>;
  const typeCols = ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.TYPE_ICON_COL}`);
  const input = inputs[idx];
  const typeCol = typeCols[idx];
  const layer = ui.m.findLayer(layerInfo);
  let baseVisible = false;

  if (input) {
    const hasLayer = layer != null;
    const isCallbackOnly = !hasLayer && layerInfo.onToggle;
    if (isCallbackOnly) input.checked = layerInfo.visible !== false;
    else input.checked = hasLayer && ui.m.map.hasLayer(layer);
    syncVisibility(ui, layerInfo, layer, input.checked);

    input.title = T(input.checked ? "deselect_tooltip" : "select_tooltip");

    const item = input.closest(CONST.SEL.LAYER_ITEM);
    if (item) {
      if (input.checked) item.classList.add(CONST.CLASSES.ACTIVE);
      else item.classList.remove(CONST.CLASSES.ACTIVE);
      // The rename must survive a full init pass —initLayerItem is the
      // only incremental path that refreshes a row without re-rendering it.
      // aria-label carries the name; the title slot stays Select/Deselect
      // as set above.
      input.setAttribute("aria-label", name);
    }
  }

  if (typeCol) {
    let typeKey: string;
    let type: string | null = null;
    if (layerInfo.isBase) {
      typeCol.innerHTML = Icons.GLOBE;
      typeKey = T("type_base");
      type = CONST.GROUP.BASE;
      layerInfo.type = type;
      if (input?.checked) baseVisible = true;
    } else if (layerInfo.iconSvg) {
      typeCol.innerHTML = layerInfo.iconSvg;
      typeKey = T("type_custom");
      type = GEOM_TYPE.CUSTOM;
      layerInfo.type = type;
    } else if (layer) {
      const gtype = getGeometryType(layer);
      typeCol.innerHTML = Util.getTypeSVG(layer, gtype);
      typeKey = T(`type_${gtype}`);
      type = gtype;
      layerInfo.type = type;
    } else {
      typeKey = T("type_unknown");
      type = GEOM_TYPE.UNKNOWN;
      layerInfo.type = type;
    }

    const item = input
      ? (input.closest(CONST.SEL.LAYER_ITEM) as HTMLElement | undefined)
      : (typeCol.closest(CONST.SEL.LAYER_ITEM) as HTMLElement | undefined);
    if (item) {
      const count = ui.mgmt.getFeatureCount(layerInfo.id);
      // Update count column (right-aligned, adjacent to type icon).
      const countCol = item.querySelector(CONST.SEL.COUNT_COL) as HTMLElement | null;
      if (countCol) {
        if (count !== null && count !== undefined) {
          countCol.textContent = formatNumber(count, "auto", CONF.locale_code);
        } else countCol.textContent = "";
      }
      // Hover tooltip shows count + type label together.
      const typeLabel = typeKey;
      // Persist the type label so onLayerItemCountChange can rebuild the
      // 'count + type' tooltip without re-running type detection.
      item.setAttribute(CONST.DATA.TITLE, typeLabel);
      item.title =
        count !== null && count !== undefined
          ? `${formatNumber(count, "auto", CONF.locale_code)} ${typeLabel}`
          : typeLabel;
    }
  }

  return baseVisible;
};

const reindexItems = (ui: LayerUI) => {
  const items = ui.uiContainer.querySelectorAll(
    `${CONST.SEL.LAYER_ITEM}:not(${CONST.SEL.COLOR_ITEM})`,
  ) as NodeListOf<HTMLElement>;
  for (let i = 0; i < items.length; i++) {
    items[i].dataset.index = String(i);
    const checkbox = items[i].querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;
    if (checkbox) checkbox.dataset.index = String(i);
  }
};

/** Reindex all layer items after a move, preserving the active focus position.
 *  renderInitialList already re-homes the cursor and restores DOM focus, so
 *  no additional focus work is needed here. */
const reindexAfterMove = (ui: LayerUI): void => {
  renderInitialList(ui);
  initTypesAndVisibility(ui);
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
  displayName,
  renderToggleAllRow,
  renderLayerItem,
  colorLayerName,
  renderColorLayerItem,
  initLayerItem,
  reindexItems,
  reindexAfterMove,
};

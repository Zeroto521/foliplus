// LayerControl UI — group (layer group) expand: child rows.
//
// A group row (LayerGroup / FeatureGroup) carries a chevron. Expanding it
// renders one row per DIRECT child, keyed by parentId + '::' + L.stamp(child);
// collapsing removes them. Child rows are not registry rows — they have no
// LayerInfo, so their checkbox talks to the map directly (addLayer /
// removeLayer) and their count is never a role count. The group row's own
// count column stays the direct-child count, so expanding never changes it.
//
// State: expandedGroups: Record<parentLayerId, boolean> on ui.listPanel,
// default false (groups start collapsed). Persisted through the same
// channel as the fold state (see ../state.js saveFoldState).
import {
  computeLayerBounds,
  drawFocusMask,
  drawFocusRect,
  highlightFocusedRow,
  registerAutoCancel,
  showFocusDisabledHint,
} from "../focus/index.js";
import { hideOtherLayers } from "../focus/pane.js";
import { saveFoldState } from "../state.js";
import type { LayerUI } from "../surface.js";
import { closeOverlays } from "../teardown.js";
import { childDisplayName, childRowId, resolveChild } from "./childRow.js";
import {
  buildCheckbox,
  buildCountCol,
  buildMoreBtn,
  buildRailCell,
  buildTypeIconCol,
} from "./rowCells.js";
import { countLabelTitle, countTooltip, roleCountText } from "./rowView.js";
import {
  childrenOf,
  countFeatureGeometry,
  getGeometryType,
  isGroupLayer,
} from "#core/layer/index.js";
import { ensureModes, guardBlocked } from "#core/lifecycle/index.js";
import { dom } from "#platform/dom.js";
import * as CONST from "#control/LayerControl/const.js";
import { getTypeSVG } from "#control/LayerControl/util.js";

/** How many child rows render before the "show all" prompt. v1 lazy ceiling:
 *  a huge group must not paint hundreds of rows on one expand. */
const CHILD_RENDER_CAP = 50;

/** Whether one group is currently expanded (default false = collapsed). */
const isGroupExpanded = (ui: LayerUI, parentId: string): boolean =>
  Boolean(ui.listPanel.expandedGroups[parentId]);

/** The group layer's direct children, in Leaflet's own order. */
const groupChildren = (ui: LayerUI, parentId: string): L.Layer[] => {
  const layerInfo = ui.c.layerRegistry.get(parentId);
  if (!layerInfo) return [];
  const layer = ui.c.findLayer(layerInfo) ?? layerInfo.layer;
  if (!layer || !isGroupLayer(layer)) return [];
  return childrenOf(layer);
};

/** Build one child row element (checkbox + label + type icon + more button),
 *  isomorphic to a leaf row but not a registry row. */
/** Render one child row of an expanded group.
 *  v1 scope (lead decision): checkbox (map directly) + label + type icon only.
 *  The ⋮ menu (focus / rename / delete) is deferred to a later PR — a dead
 *  moreBtn would be a UX lie, so it is deliberately not rendered here. */
const renderChildItem = (
  ui: LayerUI,
  parentId: string,
  child: L.Layer,
): HTMLElement => {
  const id = childRowId(parentId, child);
  const name = childDisplayName(child);
  const onMap = ui.c.map.hasLayer(child);

  // Tree connector line (item ④ decision B): a child row is never draggable —
  // child order is Leaflet's own, so the rail carries only the tree line.
  const railCell = buildRailCell(
    [dom.el("span", { class: CONST.CLASSES.FOLD_TREE })],
    ui.T("drag_tooltip"),
  );

  // Count (shared roleCountText rule): a child's unit is its own geometry
  // feature count. A child on the map shows the bare count; a hidden child
  // shows 0/total through the same rule the group row uses.
  const total = countFeatureGeometry(child);
  const on = onMap ? total : 0;
  const countText = roleCountText(total, on);

  // Type icon (shared getGeometryType → getTypeSVG rule).
  const gtype = getGeometryType(child);
  const typeIconEl = buildTypeIconCol(
    countLabelTitle(countText, ui.T(`type_${gtype}`)),
    getTypeSVG(gtype),
  );

  // ⋮ menu button: identical chrome to a member row's. Click is routed by
  // handleMoreClick → openMoreMenu, which detects the child row and opens
  // the child menu (focus / remove).
  const moreBtn = buildMoreBtn(ui.T("more_tooltip"));

  return dom.el(
    "div",
    {
      class: `${CONST.CLASSES.LAYER_ITEM} ${CONST.CLASSES.CHILD_ROW}`,
      draggable: "false",
      tabindex: "0",
      [CONST.DATA.LAYER_ID]: id,
    },
    railCell,
    buildCheckbox({
      checked: onMap ? "" : undefined,
      "aria-label": name,
    }).cell,
    dom.el("label", { class: CONST.CLASSES.LAYER_LABEL }, name),
    buildCountCol(
      {
        [CONST.DATA.LAYER_ID]: id,
        title: countTooltip(ui, "sub_layers_count_tooltip", on, total),
      },
      countText,
    ),
    typeIconEl,
    moreBtn,
  );
};

/** Insert (or refresh) a group's child rows immediately after its own row.
 *  Local DOM edit — no full rebuild, so a drag/interaction in progress is not
 *  interrupted. Removes stale child rows first (idempotent). */
const renderGroupChildren = (
  ui: LayerUI,
  parentId: string,
  groupRow: HTMLElement,
): void => {
  removeGroupChildren(ui, parentId);
  const children = groupChildren(ui, parentId).slice(0, CHILD_RENDER_CAP);
  if (children.length === 0) return;
  const frag = document.createDocumentFragment();
  for (const child of children) {
    frag.appendChild(renderChildItem(ui, parentId, child));
  }
  groupRow.after(frag);
};

/** Remove every child row of a group (contiguous after its row). */
const removeGroupChildren = (ui: LayerUI, parentId: string): void => {
  const sep = `${parentId}::`;
  const container = ui.uiContainer;
  if (!container) return;
  for (const row of container.querySelectorAll(
    `${CONST.SEL.LAYER_ITEM}[${CONST.DATA.LAYER_ID}^="${sep}"]`,
  )) {
    row.remove();
  }
};

/** Toggle a group's expand state and patch the DOM locally. */
const toggleGroupExpand = (ui: LayerUI, parentId: string): void => {
  const expanded = !isGroupExpanded(ui, parentId);
  ui.listPanel.expandedGroups[parentId] = expanded;
  const container = ui.uiContainer;
  if (!container) return;
  const row = container.querySelector<HTMLElement>(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(parentId)}"]`,
  );
  if (row) {
    const foldBtn = row.querySelector<HTMLElement>(`.${CONST.CLASSES.FOLD_BTN}`);
    if (foldBtn) {
      foldBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
      foldBtn.title = ui.T(expanded ? "fold_tooltip" : "unfold_tooltip");
    }
    if (expanded) {
      renderGroupChildren(ui, parentId, row);
    } else {
      removeGroupChildren(ui, parentId);
    }
  }
  saveFoldState(ui);
};

/** Focus the map on one child of a group. The child is not a registry row
 *  (no LayerInfo), so the shared focusLayer cannot resolve it; this path
 *  resolves the Leaflet child directly, fits the map to its bounds and
 *  highlights its row. The child's pane lift is skipped (it has no surface
 *  entry), but the zoom + mask + rect + row highlight are the same. */
const focusChildLayer = (ui: LayerUI, parentId: string, childId: string): void => {
  if (guardBlocked(ui.c.map, ui.config.name, ui.T("blocked"))) return;
  const child = resolveChild(ui, parentId, childId);
  if (!child) return;
  if (!ui.c.map.hasLayer(child)) {
    showFocusDisabledHint(ui, "hidden");
    return;
  }
  const bounds = computeLayerBounds(child);
  if (!bounds?.isValid()) {
    showFocusDisabledHint(ui, "no_bounds");
    return;
  }
  closeOverlays(ui);
  hideOtherLayers(ui);
  ui.c.label.setFocusFilter(childId);
  const itemEl =
    ui.uiContainer?.querySelector<HTMLElement>(
      `[${CONST.DATA.LAYER_ID}="${CSS.escape(childId)}"]`,
    ) ?? null;
  const modes = ensureModes(ui.c.map);
  modes.setMode(ui.config.name, "focusing");
  ui.focusController.focusingLayerId = childId;
  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();
  const area =
    Math.abs(northEast.lat - southWest.lat) * Math.abs(northEast.lng - southWest.lng);
  if (area < CONST.FOCUS.MIN_BOUNDS_AREA) {
    const center = bounds.getCenter();
    const maxZoom = Math.min(
      ui.c.map.getMaxZoom(),
      ui.c.map.getZoom() + CONST.FOCUS.MAX_ZOOM_STEP,
    );
    ui.c.map.flyTo(center, maxZoom, { duration: CONST.FOCUS.FIT_DURATION });
    if (itemEl) highlightFocusedRow(ui, itemEl, childId);
    registerAutoCancel(ui, childId);
    return;
  }
  drawFocusMask(ui, bounds);
  drawFocusRect(ui, bounds);
  if (itemEl) highlightFocusedRow(ui, itemEl, childId);
  ui.c.map.fitBounds(bounds, {
    animate: true,
    duration: CONST.FOCUS.FIT_DURATION,
    padding: CONST.FOCUS.PADDING,
    maxZoom: Math.min(
      ui.c.map.getMaxZoom(),
      ui.c.map.getZoom() + CONST.FOCUS.MAX_ZOOM_STEP,
    ),
  });
  const ref = ui.focusController.focusRect;
  setTimeout(() => {
    if (ui.focusController.focusRect === ref) {
      // Local import avoided: dismissFocus is exported by focus/index but not
      // re-exported here; call through the focus controller's public teardown.
      ui.c.map.foliplus?.showHint?.(ui.config.name, "", 0);
    }
  }, CONST.FOCUS.RECT_DURATION_MS);
  registerAutoCancel(ui, childId);
};

/** Remove one child from its group: map.removeLayer + drop the row. The group
 *  row's count and the role aggregates refresh on the next rebuild (a
 *  LAYER_ROLE_COUNT_CHANGED is emitted by the group's own lifecycle when the
 *  map membership changes). */
const removeChildLayer = (ui: LayerUI, parentId: string, childId: string): void => {
  const child = resolveChild(ui, parentId, childId);
  if (!child) return;
  if (ui.c.map.hasLayer(child)) ui.c.map.removeLayer(child);
  const container = ui.uiContainer;
  if (container) {
    const row = container.querySelector<HTMLElement>(
      `[${CONST.DATA.LAYER_ID}="${CSS.escape(childId)}"]`,
    );
    row?.remove();
  }
};

export {
  isGroupExpanded,
  childRowId,
  childDisplayName,
  resolveChild,
  groupChildren,
  renderChildItem,
  removeGroupChildren,
  toggleGroupExpand,
  focusChildLayer,
  removeChildLayer,
};

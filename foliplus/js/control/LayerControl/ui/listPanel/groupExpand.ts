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
import { INTENT, getIntent } from "../intent.js";
import { saveFoldState } from "../state.js";
import type { LayerUI } from "../surface.js";
import { childDisplayName, childRowId, resolveChild } from "./childRow.js";
import {
  buildCheckbox,
  buildCountCol,
  buildMoreBtn,
  buildRailCell,
  buildTypeIconCol,
} from "./rowCell.js";
import {
  countLabelTitle,
  countTooltip,
  roleCountText,
  writeRoleCount,
  writeRowChecked,
} from "./rowView.js";
import {
  childrenOf,
  countFeatureGeometry,
  getGeometryType,
  isGroupLayer,
} from "#core/layer/index.js";
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

/** Register one rendered child row as a registry-only LayerInfo (see
 *  RegisterLayerOpts.child). Idempotent: a rebuild re-registers the same
 *  parentId::stamp id, which the registry upserts in place. */
const registerChildEntry = (
  ui: LayerUI,
  parentId: string,
  child: L.Layer,
  id: string,
  name: string,
): void => {
  const parent = ui.c.layerRegistry.get(parentId);
  ui.c.registerLayer({
    id,
    name,
    layer: child,
    role: parent?.role,
    child: true,
    parentId,
  });
};

/** One child row's count figures. A child's unit is its own geometry feature
 *  count; a hidden child reads 0/total through the same `roleCountText` rule the
 *  group row uses. Shared by the initial render and the post-visibility
 *  refresh, so the two cannot drift. */
const childRowCounts = (child: L.Layer, onMap: boolean) => {
  const total = countFeatureGeometry(child);
  const on = onMap ? total : 0;
  return { total, on, countText: roleCountText(total, on) };
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
  // A renamed child keeps its name across collapse/expand: the session intent is
  // the source of truth (child names are not persisted — see saveNamesState).
  const name =
    (getIntent(ui, id, INTENT.NAME) as string | undefined) ?? childDisplayName(child);
  // The child row is the registry entry's lifetime: registering here (and
  // unregistering wherever the row goes) keeps "entry exists iff row is
  // rendered" true. The entry is registry-only — it carries the LayerInfo the
  // style and filter panels resolve, never a panel row of its own.
  registerChildEntry(ui, parentId, child, id, name);
  const onMap = ui.c.map.hasLayer(child);

  // Tree connector line (item ④ decision B): a child row is never draggable —
  // child order is Leaflet's own, so the rail carries only the tree line.
  const railCell = buildRailCell(
    [dom.el("span", { class: CONST.CLASSES.FOLD_TREE })],
    ui.T("drag_tooltip"),
  );

  const { total, on, countText } = childRowCounts(child, onMap);

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
  // Children leave the registry with their rows: drop the registry-only
  // entries first, so the DOM removal below is the visual half of one event.
  for (const child of groupChildren(ui, parentId)) {
    ui.c.unregisterLayer(childRowId(parentId, child));
  }
  const sep = `${parentId}::`;
  const container = ui.uiContainer;
  if (!container) return;
  for (const row of container.querySelectorAll(
    `${CONST.SEL.LAYER_ITEM}[${CONST.DATA.LAYER_ID}^="${sep}"]`,
  )) {
    row.remove();
  }
};

/** Repaint one group's rendered child rows from the map membership fact.
 *
 *  Child rows are not registry rows, so a projection pass never visits them: a
 *  container-wide visibility change (the group's own checkbox, a folder header,
 *  the role toggle-all, a zoom-range sweep) adds/removes the children with the
 *  group, and the rows' checkboxes and counts must follow that fact. */
const refreshChildRows = (ui: LayerUI, parentId: string): void => {
  if (!isGroupExpanded(ui, parentId)) return;
  const container = ui.uiContainer;
  if (!container) return;
  const sep = `${parentId}::`;
  for (const row of container.querySelectorAll<HTMLElement>(
    `${CONST.SEL.LAYER_ITEM}[${CONST.DATA.LAYER_ID}^="${sep}"]`,
  )) {
    const id = row.getAttribute(CONST.DATA.LAYER_ID);
    if (!id) continue;
    const child = resolveChild(ui, parentId, id);
    if (!child) continue;
    const onMap = ui.c.map.hasLayer(child);
    const box = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (box) writeRowChecked(box, onMap);
    const { total, on } = childRowCounts(child, onMap);
    writeRoleCount(
      row,
      total,
      on,
      countTooltip(ui, "sub_layers_count_tooltip", on, total),
    );
  }
};

/** Repaint the child rows of every expanded group of one role (or of every
 *  expanded group when the role is omitted). The bulk visibility paths change
 *  many groups at once, so they call this once after their projection pass
 *  instead of per layer. */
const refreshAllChildRows = (ui: LayerUI, role?: string): void => {
  for (const [parentId, expanded] of Object.entries(ui.listPanel.expandedGroups)) {
    if (!expanded) continue;
    if (role !== undefined) {
      const parent = ui.c.layerRegistry.get(parentId);
      if (parent?.role !== role) continue;
    }
    refreshChildRows(ui, parentId);
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

/** Remove one child from its group: map.removeLayer + drop the row. The group
 *  row's count and the role aggregates refresh on the next rebuild (a
 *  LAYER_ROLE_COUNT_CHANGED is emitted by the group's own lifecycle when the
 *  map membership changes). */
const removeChildLayer = (ui: LayerUI, parentId: string, childId: string): void => {
  const child = resolveChild(ui, parentId, childId);
  if (!child) return;
  // The registry entry goes with the row it was created for; the group's own
  // membership change then announces the count move.
  ui.c.unregisterLayer(childId);
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
  refreshChildRows,
  refreshAllChildRows,
  removeChildLayer,
};

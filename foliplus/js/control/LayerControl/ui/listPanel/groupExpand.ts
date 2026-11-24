// LayerControl UI — group (layer group) expand: child rows.
//
// A group row (LayerGroup / FeatureGroup) carries a chevron. Expanding it
// renders one row per child, keyed by parentId + '::' + L.stamp(child); a child
// that is itself a group carries its own chevron and expands in place, so the
// id is a chain (outer::inner::leaf). Collapsing removes the whole block. Each
// rendered child row owns a registry-only LayerInfo (see RegisterLayerOpts
// .child) so the style / filter panels resolve it; its checkbox talks to the
// map directly and its count is the container aggregate of its own children.
//
// State: expandedGroups: Record<parentLayerId, boolean> on ui.listPanel,
// default false (groups start collapsed). Persisted through the same
// channel as the fold state (see ../state.js saveFoldState).
import { INTENT, getIntent } from "../intent.js";
import { saveFoldState } from "../state.js";
import type { LayerUI } from "../surface.js";
import {
  childDisplayName,
  childParentId,
  childRowId,
  resolveChild,
} from "./childRow.js";
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
import * as SVGs from "#control/LayerControl/icon.js";
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

  // Rail: a child row is never draggable — child order is Leaflet's own — so
  // the rail carries the tree line, plus the chevron when this child is itself
  // a group (nested expand). The chevron is the same shared FOLD_BTN element,
  // so row.css turns it and the delegated click routes it by the row id.
  const childIsGroup = isGroupLayer(child);
  const expanded = childIsGroup && isGroupExpanded(ui, id);
  const railChildren: HTMLElement[] = [];
  if (childIsGroup) {
    railChildren.push(
      dom.el(
        "button",
        {
          class: CONST.CLASSES.FOLD_BTN,
          "aria-expanded": expanded ? "true" : "false",
          "aria-label": name,
          title: ui.T(expanded ? "fold_tooltip" : "unfold_tooltip"),
        },
        { html: SVGs.ICON_FOLD },
      ),
    );
  }
  railChildren.push(dom.el("span", { class: CONST.CLASSES.FOLD_TREE }));
  const railCell = buildRailCell(railChildren, ui.T("drag_tooltip"));

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
  const all = groupChildren(ui, parentId);
  const limit = ui.listPanel.childLimits[parentId] ?? CHILD_RENDER_CAP;
  const children = all.slice(0, limit);
  if (children.length === 0) return;
  const frag = document.createDocumentFragment();
  for (const child of children) {
    for (const row of renderChildBlock(ui, parentId, child)) frag.appendChild(row);
  }
  // The cap must never drop children silently: a row states how many are left
  // and asks for them. Its id carries the :: prefix, so removeGroupChildren's
  // prefix sweep takes it down with the block.
  const hidden = all.length - children.length;
  if (hidden > 0) frag.appendChild(renderMoreRow(ui, parentId, hidden));
  groupRow.after(frag);
};

/** A child row plus, when that child is an expanded group, its own block:
 *  depth-first, so DOM order is the visible tree order and every nested row
 *  sits immediately after its parent row. */
const renderChildBlock = (
  ui: LayerUI,
  parentId: string,
  child: L.Layer,
): HTMLElement[] => {
  const rows = [renderChildItem(ui, parentId, child)];
  const id = childRowId(parentId, child);
  if (!isGroupLayer(child) || !isGroupExpanded(ui, id)) return rows;
  const all = groupChildren(ui, id);
  const shown = all.slice(0, ui.listPanel.childLimits[id] ?? CHILD_RENDER_CAP);
  for (const grand of shown) rows.push(...renderChildBlock(ui, id, grand));
  const hidden = all.length - shown.length;
  if (hidden > 0) rows.push(renderMoreRow(ui, id, hidden));
  return rows;
};

/** The "N more" row: the group's remaining children are one click away
 *  instead of silently missing. Rendered like a child row (same block rhythm)
 *  with a single button, and keyed by `<parentId>::more` so the block sweep
 *  removes it with the rest. */
const renderMoreRow = (ui: LayerUI, parentId: string, hidden: number): HTMLElement => {
  const text = ui.T("child_more").replace("{count}", String(hidden));
  const tip = ui.T("child_more_tooltip").replace("{count}", String(hidden));
  return dom.el(
    "div",
    {
      class: `${CONST.CLASSES.LAYER_ITEM} ${CONST.CLASSES.CHILD_ROW} ${CONST.CLASSES.CHILD_MORE}`,
      [CONST.DATA.LAYER_ID]: `${parentId}::more`,
    },
    dom.el(
      "button",
      {
        type: "button",
        class: CONST.CLASSES.CHILD_MORE_BTN,
        "aria-label": tip,
        title: tip,
      },
      text,
    ),
  );
};

/** Raise one group's render cap to its full child count and repaint the block.
 *  Session-only: a reload collapses the group anyway. */
const expandChildCap = (ui: LayerUI, parentId: string): void => {
  ui.listPanel.childLimits[parentId] = groupChildren(ui, parentId).length;
  const row = ui.uiContainer?.querySelector<HTMLElement>(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(parentId)}"]`,
  );
  if (row && isGroupExpanded(ui, parentId)) renderGroupChildren(ui, parentId, row);
};

/** Remove every child row of a group (contiguous after its row). */
const removeGroupChildren = (ui: LayerUI, parentId: string): void => {
  // Children leave the registry with their rows: drop the registry-only
  // entries first, so the DOM removal below is the visual half of one event.
  // The id prefix makes this the whole subtree — a nested expanded group's
  // descendants go with their ancestor's block.
  for (const child of ui.c.childEntriesOf(parentId)) {
    ui.c.unregisterLayer(child.id);
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
    // Nested rows are refreshed by the same pass: their immediate parent is the
    // id's last segment, not the group this sweep started from.
    const child = resolveChild(ui, childParentId(id), id);
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
  renderChildBlock,
  removeGroupChildren,
  toggleGroupExpand,
  refreshChildRows,
  refreshAllChildRows,
  removeChildLayer,
  expandChildCap,
};

// LayerControl UI — container (layer group) expand: child rows.
//
// A container row (LayerGroup / FeatureGroup) carries a chevron. Expanding it
// renders one row per DIRECT child, keyed by parentId + '::' + L.stamp(child);
// collapsing removes them. Child rows are not registry rows — they have no
// LayerInfo, so their checkbox talks to the map directly (addLayer /
// removeLayer) and their count is never a role count. The container row's own
// count column stays the direct-child count, so expanding never changes it.
//
// State: expandedContainers: Record<parentLayerId, boolean> on ui.listPanel,
// default false (containers start collapsed). Persisted through the same
// channel as the fold state (see ../state.js saveFoldState).
import { saveFoldState } from "../state.js";
import type { LayerUI } from "../surface.js";
import { childrenOf, isContainerLayer } from "#core/layer/index.js";
import { dom } from "#platform/dom.js";
import * as CONST from "#control/LayerControl/const.js";
import * as SVGs from "#control/LayerControl/icon.js";

/** How many child rows render before the "show all" prompt. v1 lazy ceiling:
 *  a huge group must not paint hundreds of rows on one expand. */
const CHILD_RENDER_CAP = 50;

/** Whether one container is currently expanded (default false = collapsed). */
const isContainerExpanded = (ui: LayerUI, parentId: string): boolean =>
  Boolean(ui.listPanel.expandedContainers[parentId]);

/** The DOM identity of a child row: parentId + '::' + L.stamp(child). The
 *  stamp is stable for a layer's lifetime on one page, so a child row re-resolves
 *  to the same child across a rebuild; it is NOT persisted (only the parent's
 *  expanded flag is), so a reload collapses every container. */
const childRowId = (parentId: string, child: unknown): string =>
  `${parentId}::${L.stamp(child)}`;

/** A child layer's display name. Leaflet layers carry no canonical name; the
 *  GeoJSON feature name is the common source, then a layer's options.name,
 *  then a generic fallback. */
const childDisplayName = (child: unknown): string => {
  const feature = (child as { feature?: { properties?: Record<string, unknown> } })
    ?.feature;
  if (feature?.properties && typeof feature.properties.name === "string") {
    return feature.properties.name;
  }
  const options = (child as { options?: Record<string, unknown> })?.options;
  if (options && typeof options.name === "string" && options.name) {
    return options.name;
  }
  return "Layer";
};

/** Resolve a child row's layer object from its data-layer-id. Returns null
 *  when the id does not parse or the parent no longer holds that child. */
const resolveChild = (
  ui: LayerUI,
  parentId: string,
  childId: string,
): L.Layer | null => {
  const sep = `${parentId}::`;
  if (!childId.startsWith(sep)) return null;
  const stamp = Number(childId.slice(sep.length));
  if (!Number.isFinite(stamp)) return null;
  const layerInfo = ui.c.layerRegistry.get(parentId);
  if (!layerInfo) return null;
  const layer = ui.c.findLayer(layerInfo) ?? layerInfo.layer;
  if (!layer || !isContainerLayer(layer)) return null;
  for (const child of childrenOf(layer)) {
    if (L.stamp(child) === stamp) return child;
  }
  return null;
};

/** The container layer's direct children, in Leaflet's own order. */
const containerChildren = (ui: LayerUI, parentId: string): L.Layer[] => {
  const layerInfo = ui.c.layerRegistry.get(parentId);
  if (!layerInfo) return [];
  const layer = ui.c.findLayer(layerInfo) ?? layerInfo.layer;
  if (!layer || !isContainerLayer(layer)) return [];
  return childrenOf(layer);
};

/** Build one child row element (checkbox + label + type icon + more button),
 *  isomorphic to a leaf row but not a registry row. */
/** Render one child row of an expanded container.
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

  const railCell = dom.el("span", {
    class: CONST.CLASSES.RAIL_CELL,
    title: ui.T("drag_tooltip"),
  });
  railCell.insertAdjacentHTML("beforeend", SVGs.ICON_DRAG_HANDLE);

  return dom.el(
    "div",
    {
      class: `${CONST.CLASSES.LAYER_ITEM} ${CONST.CLASSES.CHILD_ROW}`,
      draggable: "false",
      tabindex: "0",
      [CONST.DATA.LAYER_ID]: id,
    },
    railCell,
    dom.el(
      "div",
      { class: CONST.CLASSES.CHECKBOX },
      dom.el("input", {
        type: "checkbox",
        checked: onMap ? "" : undefined,
        "aria-label": name,
      }),
    ),
    dom.el("label", { class: CONST.CLASSES.LAYER_LABEL }, name),
    dom.el("span", { class: CONST.CLASSES.COUNT_COL, [CONST.DATA.LAYER_ID]: id }),
    dom.el("div", { class: CONST.CLASSES.TYPE_ICON_COL }),
  );
};

/** Insert (or refresh) a container's child rows immediately after its own row.
 *  Local DOM edit — no full rebuild, so a drag/interaction in progress is not
 *  interrupted. Removes stale child rows first (idempotent). */
const renderContainerChildren = (
  ui: LayerUI,
  parentId: string,
  containerRow: HTMLElement,
): void => {
  removeContainerChildren(ui, parentId);
  const children = containerChildren(ui, parentId);
  if (children.length === 0) return;
  const frag = document.createDocumentFragment();
  for (const child of children) {
    frag.appendChild(renderChildItem(ui, parentId, child));
  }
  containerRow.after(frag);
};

/** Remove every child row of a container (contiguous after its row). */
const removeContainerChildren = (
  ui: LayerUI,
  parentId: string,
): void => {
  const sep = `${parentId}::`;
  const container = ui.uiContainer;
  if (!container) return;
  for (const row of container.querySelectorAll(
    `${CONST.SEL.LAYER_ITEM}[${CONST.DATA.LAYER_ID}^="${sep}"]`,
  )) {
    row.remove();
  }
};

/** Toggle a container's expand state and patch the DOM locally. */
const toggleContainerExpand = (
  ui: LayerUI,
  parentId: string,
): void => {
  const expanded = !isContainerExpanded(ui, parentId);
  ui.listPanel.expandedContainers[parentId] = expanded;
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
      renderContainerChildren(ui, parentId, row);
    } else {
      removeContainerChildren(ui, parentId);
    }
  }
  saveFoldState(ui);
};

export {
  isContainerExpanded,
  childRowId,
  childDisplayName,
  resolveChild,
  containerChildren,
  renderChildItem,
  removeContainerChildren,
  toggleContainerExpand,
};

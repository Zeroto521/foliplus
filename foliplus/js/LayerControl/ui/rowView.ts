// LayerControl UI — Row projection: intent + derived state → the row's visual.
//
// The layer row used to be both painter and reconciler. This file takes the
// painting half and makes it a projection, so `LayerUI` is left with painting
// only.
//
// Nothing here writes to the map, the registry, or the persisted record. The
// map writes stay in state.ts, and the row renders from whatever intent and
// derived state that pipeline has already established: rendering is a function
// of state, not a sweep that mutates the world.
//
// Two pieces:
//   rowChecked / inZoomRange / rowView — the projection (read-only + pure)
//   buildRowCell / applyRowView        — gather the cell, then paint the row
import { GEOM_TYPE } from "#core/layer/index.js";
import { formatNumber } from "#common/format.js";
import * as Icons from "#common/icon.js";
import * as CONST from "../const.js";
import * as SVGs from "../icon.js";
import * as Util from "../util.js";
import type { LayerUI } from "./index.js";
import { projectLayer } from "./store.js";

/** One layer's inputs to the row visual. Nothing here is written back. */
interface RowCell {
  id: string;
  /** Display name: rename → registry → locale fallback. */
  name: string;
  /** The checkbox state — intent, never the map membership. */
  checked: boolean;
  /**
   * Whether the policy has the layer painted right now (intent ∧ policy). The
   * map-membership fact, not the row's decoration — `list` reads it to decide
   * whether a base layer counts as visible for the color-basemap fallback.
   * Nothing paints it; see `rowView`.
   */
  shown: boolean;
  /** Formatted feature count, or "" when the layer publishes none. */
  countText: string;
  /** The type icon's markup, or "" when nothing should be painted. */
  typeSvg: string;
  typeLabel: string;
}

/** What one row element should look like. */
interface RowView {
  checked: boolean;
  active: boolean;
  checkboxTitle: string;
  countText: string;
  typeSvg: string;
  typeLabel: string;
  /** The row's hover tooltip: "count  type". */
  title: string;
}

/** The two localized checkbox tooltips the projection picks between. */
interface RowLabels {
  select: string;
  deselect: string;
}

/**
 * The checkbox state — the user's own choice when they made one, else the
 * author's declared default.
 *
 *  The map membership must never carry this slot. `layerInfo.visible` is a
 *  real-time mirror that the policy writes, so reading it here would read
 *  `false` for a layer the policy is hiding and un-check a box the user never
 *  touched: a stored zoom range hides the layer, and the row would claim the
 *  user hid it — while un-checking is exactly what the policy was doing.
 *
 *  `userOverrides` records that the `visible` dimension was ever set, which is
 *  the user-intent test; `hiddenIds` holds the current value. Neither is
 *  derived from the map, so the row cannot drift away from the user's choice
 *  while a policy is hiding the layer.
 */
const rowChecked = (ui: LayerUI, layerInfo: LayerInfo): boolean => {
  // Same rule as `projectLayer.intent`: the `visible` provenance marker or
  // membership in `hiddenIds` — either alone is the user's own choice.
  const hidden = ui.hiddenIds?.has(layerInfo.id) ?? false;
  if (ui.userOverrides?.[layerInfo.id]?.includes("visible") || hidden) {
    return !hidden;
  }
  return ui.authorVisible.get(layerInfo.id) ?? true;
};

/**
 * Whether the stored range covers the map's current zoom.
 *
 *  The map's range can be narrower than the user's stored endpoints (a basemap
 *  switch), so the endpoints are clamped here while the *stored* values stay
 *  untouched — reversibility: switching the basemap back must restore the
 *  original choice. If both endpoints clamp past each other the whole
 *  range is outside the map and no zoom can land inside it.
 */
const inZoomRange = (ui: LayerUI, layerInfo: LayerInfo): boolean => {
  const range = ui.zoomRangeMap?.[layerInfo.id];
  if (!range) return true;
  const min = Math.max(range[0], ui.m.map.getMinZoom());
  const max = Math.min(range[1], ui.m.map.getMaxZoom());
  if (min > max) return false;
  const zoom = ui.m.map.getZoom();
  return zoom >= min && zoom <= max;
};

/**
 * The row visual as a pure function of the cell.
 *
 *  No DOM, no registry, no map: the same cell always gives the same row. The
 *  two rules worth naming — `active = checked` and `title = "count  type"` —
 *  live here and nowhere else.
 *
 *  `active` is `checked` and nothing else. The highlight is the checkbox's own
 *  decoration, so a row the policy is hiding (outside its stored zoom range)
 *  still reads as checked. Gating it on `shown` lost the highlight whenever the
 *  range excluded the current zoom, so a checked row looked unchecked — as if
 *  the user had hidden it, which the policy alone was doing. The range's own
 *  state is signalled in the style panel, not on the row; the policy fact still
 *  reaches the panel logic as `cell.shown`.
 */
const rowView = (cell: RowCell, labels: RowLabels): RowView => ({
  checked: cell.checked,
  active: cell.checked,
  checkboxTitle: cell.checked ? labels.deselect : labels.select,
  countText: cell.countText,
  typeSvg: cell.typeSvg,
  typeLabel: cell.typeLabel,
  title: cell.countText ? `${cell.countText} ${cell.typeLabel}` : cell.typeLabel,
});

/**
 * Effective panel display name for a layer: the user-assigned rename wins,
 * falling back to the registry name, then to the locale label for the
 * virtual color basemap —the only row with no registry entry.
 *
 *  Every render path resolves names through here so a registry mutation
 *  (re-registration, type refresh) can no longer resurrect the original
 *  third-party name over a rename.
 */
const displayName = (ui: LayerUI, id: string): string => {
  return (
    ui.renamedNames[id] ??
    ui.m.layerRegistry.get(id)?.name ??
    (id === CONST.COLOR.MAP_ID ? ui.T("color_map_label") : "")
  );
};

/**
 * Snapshot the author's declared default once per layer id, from the map
 * membership the layer was registered with.
 *
 *  Folium ships the layer list without a visibility field, so the author's
 *  `show=` default reaches the panel only as the map state left behind at
 *  boot. It must be read before the first policy sweep: applyUserState
 *  re-adds a stored-shown layer and removes a stored-hidden one, so a
 *  snapshot taken afterwards would record a policy decision as the author's.
 *
 *  Once per id — the repeat is a no-op, which is what keeps the value stable
 *  across initTypesAndVisibility's idempotent re-runs. Because the value is
 *  latched, it may only be taken from an *observed* map state: a folium
 *  layer's JS global is emitted after the control's IIFE, so at attach the
 *  layer is not resolvable yet and the only honest answer is "not yet
 *  known". Latching `layerInfo.visible !== false` there would record `true`
 *  for an author `show=False` layer and, the snapshot being idempotent,
 *  keep the later correct reading out for good — which is how a `show=False`
 *  layer came back onto the map on the first zoom sweep.
 *
 *  A canvas-only layer is the exception: it has no Leaflet layer to observe
 *  at any point, so its declared `visible` is the ground truth.
 */
const snapshotAuthorVisible = (ui: LayerUI, layerInfo: LayerInfo): void => {
  if (ui.authorVisible.has(layerInfo.id)) return;
  const layer = ui.m.findLayer(layerInfo);
  if (!layer && !layerInfo.canvas) return; // not linked yet — leave unknown
  ui.authorVisible.set(
    layerInfo.id,
    layer ? ui.m.map.hasLayer(layer) : layerInfo.visible !== false,
  );
};

/**
 * The type icon and its label for one layer, plus the snapshot sync they come
 * with.
 *
 *  `layerInfo.type` is a snapshot of the surface's probe result: writing it
 *  here is the snapshot sync for render use, not a second probe. The
 *  authority for geometry-type detection lives on the surface.
 */
const rowType = (
  ui: LayerUI,
  layerInfo: LayerInfo,
  layer: L.Layer | null,
): { svg: string; key: string } => {
  if (layerInfo.isBase) {
    layerInfo.type = CONST.GROUP.BASE;
    return { svg: Icons.GLOBE, key: "type_base" };
  }
  if (layerInfo.iconSvg) {
    layerInfo.type = GEOM_TYPE.CUSTOM;
    return { svg: layerInfo.iconSvg, key: "type_custom" };
  }
  if (layer) {
    const gtype = ui.m.surfaceFor(layerInfo).geometryType();
    layerInfo.type = gtype;
    return { svg: Util.getTypeSVG(layer, gtype), key: `type_${gtype}` };
  }
  layerInfo.type = GEOM_TYPE.UNKNOWN;
  return { svg: SVGs.UNKNOWN, key: "type_unknown" };
};

/**
 * One layer's inputs to the row visual: the projection input builder.
 *
 *  Everything the row shows is read here and nothing is written except the
 *  type snapshot above, so the row cannot read a stale decoration and looking
 *  at a layer cannot move the map.
 */
const buildRowCell = (ui: LayerUI, layerInfo: LayerInfo): RowCell => {
  const layer = ui.m.findLayer(layerInfo);
  const checked = rowChecked(ui, layerInfo);
  const type = rowType(ui, layerInfo, layer);
  const count = ui.mgmt.getFeatureCount(layerInfo.id);
  return {
    id: layerInfo.id,
    name: displayName(ui, layerInfo.id),
    checked,
    // Read the projection: focus overrides the range, the range never
    // overrides the intent. Focus dims the other rows visually without
    // removing them from the map, so while it holds every checked layer is
    // on screen regardless of its range. The policy write side reads the
    // same projection, so the formula has one home.
    shown: projectLayer(ui, layerInfo).effectiveShown,
    countText: count != null ? formatNumber(count, "auto", ui.conf.locale_code) : "",
    typeSvg: type.svg,
    typeLabel: ui.T(type.key),
  };
};

/**
 * The single DOM write point for a layer row: every site that paints a row's
 * checkbox, highlight, count, type icon, or tooltip goes through here instead
 * of writing fields by hand.
 *
 *  Each field is guarded independently, so a row missing one decoration
 *  updates the rest rather than being skipped. An empty `typeSvg` leaves the
 *  icon column as it is — nothing to paint is not the same as a blank.
 */
const applyRowView = (ui: LayerUI, item: HTMLElement, cell: RowCell): void => {
  const view = rowView(cell, {
    select: ui.T("select_tooltip"),
    deselect: ui.T("deselect_tooltip"),
  });

  const input = item.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (input) {
    input.checked = view.checked;
    input.title = view.checkboxTitle;
    // The name reaches assistive tech via aria-label. `title` is the
    // Select/Deselect slot, so the two do not compete for the same attribute.
    input.setAttribute("aria-label", cell.name);
  }
  item.classList.toggle(CONST.CLASSES.ACTIVE, view.active);

  const countCol = item.querySelector<HTMLElement>(CONST.SEL.COUNT_COL);
  if (countCol) countCol.textContent = view.countText;
  if (view.typeSvg) {
    const typeCol = item.querySelector<HTMLElement>(`.${CONST.CLASSES.TYPE_ICON_COL}`);
    if (typeCol) typeCol.innerHTML = view.typeSvg;
  }
  // Persist the type label so a count-only refresh can rebuild the tooltip
  // without re-running type detection.
  item.setAttribute(CONST.DATA.TITLE, view.typeLabel);
  item.title = view.title;
};

export {
  applyRowView,
  buildRowCell,
  displayName,
  inZoomRange,
  rowChecked,
  rowView,
  snapshotAuthorVisible,
  type RowCell,
  type RowLabels,
  type RowView,
};

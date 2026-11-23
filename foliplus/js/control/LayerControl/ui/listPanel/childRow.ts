// listPanel/childRow — child-row identity helpers for expanded groups.
// Pure leaf module: no DOM, no list rebuild, no focus/pane dependency. Both
// groupExpand (the row renderer) and visibility (the child checkbox) consume
// it, so neither pulls the other through it — this module is the acyclic
// boundary between the row renderer and the focus subsystem.
import type { LayerUI } from "../surface.js";
import { childrenOf, isGroupLayer } from "#core/layer/index.js";

/** The DOM identity of a child row: parentId + '::' + L.stamp(child). The
 *  stamp is stable for a layer's lifetime on one page, so a child row re-resolves
 *  to the same child across a rebuild; it is NOT persisted (only the parent's
 *  expanded flag is), so a reload collapses every group. */
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
 *  when the id is not a child of the parent, the parent is not a group, or the
 *  child has left the group since the row was rendered. */
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
  if (!layer || !isGroupLayer(layer)) return null;
  for (const child of childrenOf(layer)) {
    if (L.stamp(child) === stamp) return child;
  }
  return null;
};

export { childRowId, childDisplayName, resolveChild };

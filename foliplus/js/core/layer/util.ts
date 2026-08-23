// core layer-traversal utilities — pure functions, no DOM / CONF.
import * as CONST from "./const.js";
import type { LabelAwareLayer } from "./type.js";

/** Resolve a layer from the map's internal registry or a window global.
 *  @param {Object} map - Leaflet map.
 *  @param {string} id - Layer id.
 *  @returns {Object|null} Leaflet layer. */
const findLayer = (map: L.Map, id: string): L.Layer | null => {
  if (typeof window === "undefined") return null;
  return ((map._layers && map._layers[id]) ||
    Reflect.get(window, id) ||
    null) as L.Layer | null;
};

/** Depth-limited walk over a layer tree, invoking fn per visited node.
 *  Prefer eachLayer (Leaflet's own recursion) over _layers — that keeps
 *  nested groups like mainLayer → [graph, label] traversed correctly.
 *  The _layers branch is a fallback for non-Leaflet containers (window
 *  globals and ad-hoc registry wrappers) that don't implement eachLayer.
 */
const traverse = (
  layer: L.Layer,
  fn: (layer: L.Layer) => void,
  depth = 0,
  leafOnly = false,
) => {
  if (!layer || depth > CONST.RECURSION.LAYER_DEPTH) return;
  const container = layer as L.LayerGroup;
  const isContainer = typeof container.eachLayer === "function";
  if (!leafOnly) fn(layer);
  if (isContainer) container.eachLayer(c => traverse(c, fn, depth + 1, leafOnly));
  else if (container._layers) {
    for (const k in container._layers) {
      if (Object.hasOwn(container._layers, k))
        traverse(container._layers[k], fn, depth + 1, leafOnly);
    }
  } else if (leafOnly) fn(layer);
};

/** Iterate every leaf node (no intermediate containers) of a layer tree. */
const forEachLeaf = (layer: L.Layer, fn: (layer: L.Layer) => void, depth = 0) => {
  traverse(layer, fn, depth, true);
};

/** Iterate every node (containers + leaves) of a layer tree. */
const forEachLayer = (layer: L.Layer, fn: (layer: L.Layer) => void, depth = 0) => {
  traverse(layer, fn, depth, false);
};

/** Detect the geometry type of a layer tree.
 *  Ignores isLabel leaves — type represents the data geometry, never labels.
 *  @param {Object} layer - Leaflet layer.
 *  @returns {string} Geometry type constant from GEOM_TYPE. */
const getGeometryType = (layer: L.Layer): string => {
  const leaves: L.Layer[] = [];
  forEachLeaf(layer, l => leaves.push(l));

  let hasData = false; // any non-label leaf — labels are not data geometry
  let hasPoly = false,
    hasLine = false,
    hasPoint = false;
  for (const leaf of leaves) {
    // Labels are non-geometry nodes — same rule as countFeatureGeometry.
    if ((leaf as LabelAwareLayer).isLabel) continue;
    hasData = true;
    if (leaf instanceof L.Polygon) hasPoly = true;
    else if (leaf instanceof L.Polyline) hasLine = true;
    else if (leaf instanceof L.CircleMarker) hasPoint = true;
    else if (leaf instanceof L.Marker && leaf.feature) hasPoint = true;
  }
  // Empty container or all-label layer → no data geometry.
  if (!hasData) return CONST.GEOM_TYPE.EMPTY;
  if (!hasPoly && !hasLine && !hasPoint) return CONST.GEOM_TYPE.UNKNOWN;
  const typeCount = Number(hasPoly) + Number(hasLine) + Number(hasPoint);
  if (typeCount > 1) return CONST.GEOM_TYPE.UNKNOWN;
  return hasPoly
    ? CONST.GEOM_TYPE.POLYGON
    : hasLine
      ? CONST.GEOM_TYPE.LINE
      : CONST.GEOM_TYPE.POINT;
};

/** Count geometric features in a layer tree.
 *  Only counts geometry-producing leaves (Polygon / Polyline / CircleMarker / Markers with feature).
 *  Excludes label layers and non-geometric nodes.
 *  @param {Object} layer - Leaflet layer (container or leaf).
 *  @returns {number} Number of geometric features. */
const countFeatureGeometry = (layer: L.Layer): number => {
  let count = 0;
  forEachLeaf(layer, (leaf: L.Layer) => {
    if ((leaf as LabelAwareLayer).isLabel) return;
    if (leaf instanceof L.Polygon) count++;
    else if (leaf instanceof L.Polyline) count++;
    else if (leaf instanceof L.CircleMarker) count++;
    else if (leaf instanceof L.Marker && leaf.feature) count++;
  });
  return count;
};

export { findLayer, forEachLayer, forEachLeaf, getGeometryType, countFeatureGeometry };

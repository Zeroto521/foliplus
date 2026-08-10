/** Utility functions for LayerControl. */
import { escapeHTML } from "#common/dom.js";
import * as CONST from "./LayerControl.const.js";
import * as SVGs from "./LayerControl.icon.js";

/** Detect the geometry type of a layer tree.
 *  @param {Object} layer - Leaflet layer.
 *  @returns {string} Geometry type constant from GEOM_TYPE. */
const getGeometryType = (layer: any) => {
  const leaves: any[] = [];
  forEachLeaf(layer, (l: any) => leaves.push(l));
  if (leaves.length === 0) return CONST.GEOM_TYPE.EMPTY;

  let hasPoly = false,
    hasLine = false,
    hasPoint = false;
  for (const leaf of leaves) {
    if (leaf instanceof L.Polygon) hasPoly = true;
    else if (leaf instanceof L.Polyline) hasLine = true;
    else if (leaf instanceof L.CircleMarker) hasPoint = true;
    else if (leaf instanceof L.Marker && leaf.feature) hasPoint = true;
  }
  if (!hasPoly && !hasLine && !hasPoint) return CONST.GEOM_TYPE.UNKNOWN;
  const typeCount = Number(hasPoly) + Number(hasLine) + Number(hasPoint);
  if (typeCount > 1) return CONST.GEOM_TYPE.UNKNOWN;
  return hasPoly
    ? CONST.GEOM_TYPE.POLYGON
    : hasLine
      ? CONST.GEOM_TYPE.LINE
      : CONST.GEOM_TYPE.POINT;
};

/** Get the SVG icon for a layer's geometry type.
 *  @param {Object} layer - Leaflet layer.
 *  @returns {string} SVG HTML string. */
const getTypeSVG = (layer: any) => {
  const type = getGeometryType(layer);
  if (type === CONST.GEOM_TYPE.POLYGON) return SVGs.POLYGON;
  if (type === CONST.GEOM_TYPE.LINE) return SVGs.LINE;
  if (type === CONST.GEOM_TYPE.POINT) return SVGs.POINT;
  if (type === CONST.GEOM_TYPE.EMPTY) return SVGs.EMPTY;
  return SVGs.UNKNOWN;
};

/** Resolve a layer by id from map._layers or window.
 *  @param {Object} map - Leaflet map.
 *  @param {string} id - Layer ID.
 *  @returns {Object|null} Leaflet layer or null. */
const findLayer = (map: any, id: string) => {
  return (map._layers && map._layers[id]) || (window as any)[id] || null;
};

/**
 * Internal: walk a layer tree, optionally calling fn on containers.
 * @param {Object} layer - Leaflet layer.
 * @param {function} fn - Called for each visited node.
 * @param {number} depth - Internal recursion depth.
 * @param {boolean} leafOnly - If true, only call fn on non-container layers.
 */
const traverse = (layer: any, fn: any, depth = 0, leafOnly = false) => {
  if (!layer || depth > CONST.RECURSION.LAYER_DEPTH) return;
  const isContainer = typeof layer.eachLayer === "function";
  if (!leafOnly) fn(layer);
  if (isContainer) layer.eachLayer((c: any) => traverse(c, fn, depth + 1, leafOnly));
  else if (layer._layers) {
    for (const k in layer._layers) {
      if (Object.hasOwn(layer._layers, k))
        traverse(layer._layers[k], fn, depth + 1, leafOnly);
    }
  } else if (leafOnly) fn(layer);
};

/**
 * Walk every leaf (non-container) layer in a tree.
 * @param {Object} layer - Leaflet layer.
 * @param {function} fn - Called for each leaf with (leafLayer).
 * @param {number} [depth=0] - Internal recursion depth.
 */
const forEachLeaf = (layer: any, fn: any, depth = 0) => {
  traverse(layer, fn, depth, true);
};

/**
 * Walk all layers (including containers) in a tree, visiting each node.
 * @param {Object} layer - Leaflet layer.
 * @param {function} fn - Called for each node (container or leaf) with (nodeLayer).
 * @param {number} [depth=0] - Internal recursion depth.
 */
const forEachLayer = (layer: any, fn: any, depth = 0) => {
  traverse(layer, fn, depth, false);
};

export {
  escapeHTML,
  getGeometryType,
  getTypeSVG,
  findLayer,
  forEachLeaf,
  forEachLayer,
};

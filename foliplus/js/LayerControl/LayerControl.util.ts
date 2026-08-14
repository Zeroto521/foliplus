/** Utility functions for LayerControl. */
import { escapeHTML } from "#common/dom.js";
import * as CONST from "./LayerControl.const.js";
import * as SVGs from "./LayerControl.icon.js";

/** Detect the geometry type of a layer tree.
 *  @param {Object} layer - Leaflet layer.
 *  @returns {string} Geometry type constant from GEOM_TYPE. */
const getGeometryType = (layer: L.Layer): string => {
  const leaves: L.Layer[] = [];
  forEachLeaf(layer, l => leaves.push(l));
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

const getTypeSVG = (layer: L.Layer): string => {
  const type = getGeometryType(layer);
  if (type === CONST.GEOM_TYPE.POLYGON) return SVGs.POLYGON;
  if (type === CONST.GEOM_TYPE.LINE) return SVGs.LINE;
  if (type === CONST.GEOM_TYPE.POINT) return SVGs.POINT;
  if (type === CONST.GEOM_TYPE.EMPTY) return SVGs.EMPTY;
  return SVGs.UNKNOWN;
};

const findLayer = (map: L.Map, id: string): L.Layer | null => {
  return (map._layers && map._layers[id]) || (window as any)[id] || null;
};

const traverse = (
  layer: L.Layer,
  fn: (layer: L.Layer) => void,
  depth = 0,
  leafOnly = false,
) => {
  if (!layer || depth > CONST.RECURSION.LAYER_DEPTH) return;
  const isContainer = typeof (layer as any).eachLayer === "function";
  if (!leafOnly) fn(layer);
  if (isContainer)
    (layer as any).eachLayer((c: L.Layer) => traverse(c, fn, depth + 1, leafOnly));
  else if ((layer as any)._layers) {
    for (const k in (layer as any)._layers) {
      if (Object.hasOwn((layer as any)._layers, k))
        traverse((layer as any)._layers[k], fn, depth + 1, leafOnly);
    }
  } else if (leafOnly) fn(layer);
};

const forEachLeaf = (layer: L.Layer, fn: (layer: L.Layer) => void, depth = 0) => {
  traverse(layer, fn, depth, true);
};

const forEachLayer = (layer: L.Layer, fn: (layer: L.Layer) => void, depth = 0) => {
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

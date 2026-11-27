// core/layer/geometry — the geometry type and the feature count of a layer tree.
//
// Both read the same leaf walk: the type is the single geometry family the
// tree renders, the count is how many geometry-producing leaves it holds.
import * as CONST from "./const.js";
import type { LabelAwareLayer } from "./type.js";
import { walkLeaf } from "./walkLeaf.js";

const getGeometryType = (layer: L.Layer): string => {
  const leaves: L.Layer[] = [];
  walkLeaf(layer, l => leaves.push(l));

  let hasData = false; // any non-label leaf — labels are not data geometry
  let hasPoly = false;
  let hasLine = false;
  let hasPoint = false;
  for (const leaf of leaves) {
    // Labels are non-geometry nodes — same rule as countFeatureGeometry.
    if ((leaf as LabelAwareLayer).isLabel) continue;
    hasData = true;
    if (leaf instanceof L.Polygon) hasPoly = true;
    else if (leaf instanceof L.Polyline) hasLine = true;
    // Marker / CircleMarker need a .feature envelope to be "structured,
    // downstream-consumable point data" (extractPoints / Heatmap / export
    // all gate on .feature). A plain folium.Marker() is a geometric point —
    // countFeatureGeometry counts it — but without that envelope it is not
    // consumable point data, so we don't mark it as point here.
    else if (leaf instanceof L.CircleMarker || leaf instanceof L.Marker) {
      if (leaf.feature) hasPoint = true;
    }
  }
  // Empty group or all-label layer → no data geometry.
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

/** The structural shape a group exposes: a child registry (Leaflet's
 *  `_layers` object, read through the adapter's own `internalLayers`) or the
 *  add/remove pair a group owns. */

const countFeatureGeometry = (layer: L.Layer): number => {
  let count = 0;
  walkLeaf(layer, (leaf: L.Layer) => {
    if ((leaf as LabelAwareLayer).isLabel) return;
    if (leaf instanceof L.Polygon) count++;
    else if (leaf instanceof L.Polyline) count++;
    else if (leaf instanceof L.CircleMarker) count++;
    else if (leaf instanceof L.Marker) count++;
  });
  return count;
};

export { countFeatureGeometry, getGeometryType };

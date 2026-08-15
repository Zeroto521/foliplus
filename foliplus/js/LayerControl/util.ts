/** Utility functions for LayerControl (UI-specific).
 *  Layer traversal/detection logic lives in core/layer; this module only
 *  keeps UI concerns (SVG icons). */
import { GEOM_TYPE } from "#core/layer/const.js";
import { getGeometryType } from "#core/layer/util.js";
import * as SVGs from "./icon.js";

/** Geometry-type SVG icon (UI concern; type detection lives in core/layer). */
const getTypeSVG = (layer: L.Layer): string => {
  const type = getGeometryType(layer);
  if (type === GEOM_TYPE.POLYGON) return SVGs.POLYGON;
  if (type === GEOM_TYPE.LINE) return SVGs.LINE;
  if (type === GEOM_TYPE.POINT) return SVGs.POINT;
  if (type === GEOM_TYPE.EMPTY) return SVGs.EMPTY;
  return SVGs.UNKNOWN;
};

export { getTypeSVG };

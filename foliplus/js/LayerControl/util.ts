/** Utility functions for LayerControl (UI-specific).
 *  Layer traversal/detection logic lives in core/layer; this module only
 *  keeps UI concerns (SVG icons) and re-exports the shared helpers. */
import { escapeHTML } from "#common/dom.js";
import {
  findLayer,
  forEachLayer,
  forEachLeaf,
  getGeometryType,
} from "#core/layer/util.js";
import * as CONST from "./const.js";
import * as SVGs from "./icon.js";

/** Geometry-type SVG icon (UI concern; type detection lives in core/layer). */
const getTypeSVG = (layer: L.Layer): string => {
  const type = getGeometryType(layer);
  if (type === CONST.GEOM_TYPE.POLYGON) return SVGs.POLYGON;
  if (type === CONST.GEOM_TYPE.LINE) return SVGs.LINE;
  if (type === CONST.GEOM_TYPE.POINT) return SVGs.POINT;
  if (type === CONST.GEOM_TYPE.EMPTY) return SVGs.EMPTY;
  return SVGs.UNKNOWN;
};

export {
  escapeHTML,
  findLayer,
  forEachLayer,
  forEachLeaf,
  getGeometryType,
  getTypeSVG,
};

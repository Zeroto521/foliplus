/** Utility functions for LayerControl (UI-specific).
 *  Layer traversal/detection logic lives in core/layer; this module only
 *  keeps UI concerns (SVG icons). */
import { GEOM_TYPE } from "#core/layer/index.js";
import * as SVGs from "./icon.js";

/** Geometry-type SVG icon (UI concern; type detection lives in core/layer).
 *  @param {string|null} type - Geometry type from GEOM_TYPE, resolved by the
 *    layer's surface. */
const getTypeSVG = (type: string | null): string => {
  if (type === GEOM_TYPE.POINT) return SVGs.ICON_POINT;
  else if (type === GEOM_TYPE.LINE) return SVGs.ICON_LINE;
  else if (type === GEOM_TYPE.POLYGON) return SVGs.ICON_POLYGON;
  else if (type === GEOM_TYPE.EMPTY) return SVGs.ICON_EMPTY;
  return SVGs.ICON_UNKNOWN;
};

export { getTypeSVG };

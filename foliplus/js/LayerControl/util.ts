/** Utility functions for LayerControl (UI-specific).
 *  Layer traversal/detection logic lives in core/layer; this module only
 *  keeps UI concerns (SVG icons). */
import { GEOM_TYPE, getGeometryType } from "#core/layer/index.js";
import * as SVGs from "./icon.js";

/** Geometry-type SVG icon (UI concern; type detection lives in core/layer).
 *  If type is provided, it's used directly (avoids re-running getGeometryType).
 *  @param {Object} layer - Leaflet layer.
 *  @param {string|null} [type] - Pre-computed geometry type, from GEOM_TYPE. */
const getTypeSVG = (layer: L.Layer, type?: string | null): string => {
  const gtype = type ?? getGeometryType(layer);
  if (gtype === GEOM_TYPE.POINT) return SVGs.POINT;
  else if (gtype === GEOM_TYPE.LINE) return SVGs.LINE;
  else if (gtype === GEOM_TYPE.POLYGON) return SVGs.POLYGON;
  else if (gtype === GEOM_TYPE.EMPTY) return SVGs.EMPTY;
  else return SVGs.UNKNOWN;
};

export { getTypeSVG };

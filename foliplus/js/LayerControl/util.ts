/** Utility functions for LayerControl (UI-specific).
 *  Layer traversal/detection logic lives in core/layer; this module only
 *  keeps UI concerns (SVG icons). */
import { GEOM_TYPE, getGeometryType } from "#core/layer/index.js";
import { formatNumber } from "#common/format.js";
import * as CONST from "./const.js";
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
  return SVGs.UNKNOWN;
};

/** Row count column: once the value outgrows the column's digit budget
 *  (COUNT.MAX_DIGITS) it is compacted, so a 12,000-feature layer reads
 *  "12K" instead of a number the 38px track would clip. Below the budget
 *  the count stays exact; only the attribute panel carries the full value.
 *  The locale is optional because an empty locale_code means
 *  auto-detect-at-runtime; formatNumber's "en" default is the same
 *  fallback resolveLocaleCode lands on. */
const formatCount = (count: number, locale?: string): string => {
  return count >= 10 ** CONST.COUNT.MAX_DIGITS
    ? formatNumber(count, "auto", locale ?? "en")
    : formatNumber(count, "int", locale ?? "en");
};

export { formatCount, getTypeSVG };

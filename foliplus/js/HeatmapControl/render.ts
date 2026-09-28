// HeatmapControl canvas rendering — pure draw helpers for hexagon fill/stroke
// and value labels. No `this` dependency: map and style values are passed
// in explicitly.
import {
  type CanvasLabelStyle,
  drawCanvasLabel,
  prepareCanvasLabel,
  resolveCanvasLabelStyle,
} from "#common/canvasLabel.js";
import { type NumberStyle, formatLabelNumber } from "#common/format.js";
import * as CONST from "./const.js";
import type { HexFeature } from "./type.js";

/** Draw a single hexagon polygon (fill + stroke). */
const drawHexagon = (
  ctx: CanvasRenderingContext2D,
  feat: HexFeature,
  map: L.Map,
  borderWeight: number,
  borderColor: string,
) => {
  const pts = feat.geometry.coordinates[0].map(p =>
    map.latLngToContainerPoint(L.latLng(p[1], p[0])),
  );
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = feat.properties.fillColor || CONST.GRAY;
  ctx.globalAlpha = CONF.fill_opacity ?? 1;
  ctx.fill();
  ctx.globalAlpha = 1;

  if (borderWeight > 0 && (CONF.border_opacity ?? 0) > 0) {
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = borderWeight;
    ctx.globalAlpha = CONF.border_opacity ?? 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
};

/** Resolve label styling from the shared --label-* tokens. Runtime
 *  size/color override the token defaults so the panel and drawer can
 *  restyle hex labels without a CSS override. */
const resolveLabelStyle = (
  ctrl: HTMLElement,
  currentLabelSize: number,
  currentLabelColor: string,
): CanvasLabelStyle => {
  const base = resolveCanvasLabelStyle(ctrl);
  return {
    ...base,
    fontSize: currentLabelSize,
    font: `${base.fontWeight} ${currentLabelSize}px ${base.fontFamily}`,
    color: currentLabelColor,
  };
};

/** Draw a formatted value label centered on the hexagon. */
const drawHexLabel = (
  ctx: CanvasRenderingContext2D,
  feat: HexFeature,
  style: CanvasLabelStyle,
  map: L.Map,
  currentLabelFormat: NumberStyle,
) => {
  const centroid = feat.properties.centroid;
  if (!centroid) return;
  const pt = map.latLngToContainerPoint(L.latLng(centroid[0], centroid[1]));
  const text = formatLabelNumber(
    feat.properties.value ?? 0,
    currentLabelFormat,
    CONF.locale_code,
  );
  prepareCanvasLabel(ctx, style);
  drawCanvasLabel(ctx, text, pt.x, pt.y, style);
};

export { drawHexagon, drawHexLabel, resolveLabelStyle };

// common/canvasLabel — the one recipe for canvas-drawn map labels.
//
// HeatmapControl's hex values and LayerControl's annotation labels both draw
// text with a halo on a canvas, and both take their typography from the shared
// --foliplus-label-* tokens. One resolver and one drawer, so the two can never drift:
// same font, same fill, same halo — an annotation label and a hex value over
// the same feature read as one language.
import { cssVar } from "./cssvar.js";
import type { CanvasLabelStyle } from "./type.js";

/** Resolve the canvas label style from the --foliplus-label-* tokens on `root` — the one
 *  place a page restyles map-label typography, for the heatmap's hex values and
 *  LayerControl's annotation labels alike. */
const resolveCanvasLabelStyle = (root: HTMLElement): CanvasLabelStyle => {
  const fontFamily = cssVar(root, "--foliplus-label-font-family", "sans-serif");
  const fontSize = parseFloat(cssVar(root, "--foliplus-label-font-size", "12")) || 12;
  const fontWeight = cssVar(root, "--foliplus-label-font-weight", "bold");
  return {
    fontFamily,
    fontSize,
    fontWeight,
    font: `${fontWeight} ${fontSize}px ${fontFamily}`,
    color: cssVar(root, "--foliplus-label-color", "#fff"),
    haloColor: cssVar(root, "--foliplus-label-halo-color", "rgba(0, 0, 0, 0.75)"),
    haloWidth: parseFloat(cssVar(root, "--foliplus-label-halo-width", "3")) || 3,
  };
};

/** Overlay runtime color/size on a resolved style. Shared by HeatmapControl
 *  and LayerControl annotation so both recompute `font` the same way. */
const withLabelPaint = (
  base: CanvasLabelStyle,
  opts: { color?: string; size?: number },
): CanvasLabelStyle => {
  const fontSize = opts.size ?? base.fontSize;
  return {
    ...base,
    fontSize,
    font: `${base.fontWeight} ${fontSize}px ${base.fontFamily}`,
    color: opts.color ?? base.color,
  };
};

/** Apply the shared font and metrics to a context once per frame. The font is
 *  assigned only when it changed: a canvas context re-parses the font string on
 *  every assignment, and the heatmap runs this once per hexagon per frame. */
const prepareCanvasLabel = (
  ctx: CanvasRenderingContext2D,
  style: CanvasLabelStyle,
): void => {
  if (ctx.font !== style.font) ctx.font = style.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
};

/** Draw one text label with its halo (stroke, then fill) at (x, y). */
const drawCanvasLabel = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  style: CanvasLabelStyle,
): void => {
  ctx.strokeStyle = style.haloColor;
  ctx.lineWidth = style.haloWidth;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = style.color;
  ctx.fillText(text, x, y);
};

export { drawCanvasLabel, prepareCanvasLabel, resolveCanvasLabelStyle, withLabelPaint };

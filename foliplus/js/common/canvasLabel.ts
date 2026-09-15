// common/canvasLabel — the one recipe for canvas-drawn map labels.
//
// HeatmapControl's hex values and LayerControl's annotation labels both draw
// text with a halo on a canvas, and both take their typography from the shared
// --label-* tokens. One resolver and one drawer, so the two can never drift:
// same font, same fill, same halo — an annotation label and a hex value over
// the same feature read as one language.
import { cssVar } from "./cssvar.js";

/** Everything drawing a canvas label needs, resolved from the tokens. */
interface CanvasLabelStyle {
  /** Ready for `ctx.font`. */
  font: string;
  color: string;
  haloColor: string;
  haloWidth: number;
}

/** Resolve the canvas label style from the --label-* tokens on `root`. The
 *  heatmap aliases its own --heatmap-label-* tokens to these, so both
 *  components read the same values. */
const resolveCanvasLabelStyle = (root: HTMLElement): CanvasLabelStyle => {
  const fontFamily = cssVar(root, "--label-font-family", "sans-serif");
  const fontSize = parseFloat(cssVar(root, "--label-font-size", "12")) || 12;
  const fontWeight = cssVar(root, "--label-font-weight", "bold");
  return {
    font: `${fontWeight} ${fontSize}px ${fontFamily}`,
    color: cssVar(root, "--label-color", "#fff"),
    haloColor: cssVar(root, "--label-halo-color", "rgba(0, 0, 0, 0.75)"),
    haloWidth: parseFloat(cssVar(root, "--label-halo-width", "3")) || 3,
  };
};

/** Apply the shared font and metrics to a context once per frame. */
const prepareCanvasLabel = (
  ctx: CanvasRenderingContext2D,
  style: CanvasLabelStyle,
): void => {
  ctx.font = style.font;
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

export {
  drawCanvasLabel,
  prepareCanvasLabel,
  resolveCanvasLabelStyle,
  type CanvasLabelStyle,
};

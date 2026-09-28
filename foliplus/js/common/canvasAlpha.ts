// Shared layer-alpha bake for self-drawn canvases (R11).
//
// One convention for every canvas drawer (heatmap, annotation, color face,
// future custom): multiply the *drawn* alpha by the layer's opacity slider
// value instead of writing CSS `opacity` on the canvas element. CSS forces a
// GPU composite buffer on a large canvas; baking keeps the pixels honest and
// costs nothing on pan/zoom redraws that already paint.
//
// The slider itself may still take a CSS path for carriers whose full redraw
// is expensive (decision is per carrier — see apply.ts). When baking, the
// drawer must use these helpers so declared body alpha (fill/border) and the
// layer alpha stack multiplicatively and never fight each other.
//
// Storage is a WeakMap keyed by the canvas element: the opacity executor
// (LayerControl apply) writes the value, drawers read it at paint time. No
// drawer-private copy of "what is the layer opacity".

/** layerAlpha per canvas element. Default when absent is 1 (fully opaque). */
const layerAlphas = new WeakMap<HTMLCanvasElement, number>();

/** Record the layer opacity a canvas should bake into its next paint.
 *  Values are clamped to [0, 1]; non-finite input is treated as 1. */
const setLayerAlpha = (canvas: HTMLCanvasElement, alpha: number): void => {
  const v = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
  layerAlphas.set(canvas, v);
};

/** The layer alpha currently baked for this canvas. `null`/`undefined`
 *  canvas (not yet built) reads as 1 — draw at full strength, the carrier
 *  will pick up the value on the next commit. */
const getLayerAlpha = (
  canvas: HTMLCanvasElement | null | undefined,
): number => (canvas ? (layerAlphas.get(canvas) ?? 1) : 1);

/** Effective stroke/fill alpha: declared body alpha × layer alpha.
 *  Both inputs are clamped to [0, 1]; the product is clamped again so a
 *  floating-point edge cannot push `globalAlpha` out of range. */
const drawAlpha = (declared: number, layerAlpha: number): number => {
  const d = Number.isFinite(declared) ? Math.max(0, Math.min(1, declared)) : 1;
  const l = Number.isFinite(layerAlpha)
    ? Math.max(0, Math.min(1, layerAlpha))
    : 1;
  return Math.max(0, Math.min(1, d * l));
};

/** Run `draw` under `ctx.globalAlpha = drawAlpha(ctx.globalAlpha, layerAlpha)`,
 *  restoring the previous `globalAlpha` afterwards. Use this when a whole
 *  paint pass is one layer (annotation labels, color fill). Prefer
 *  `drawAlpha(declared, layerAlpha)` for per-shape declared alphas that must
 *  stack with the layer (heatmap fill/border). */
const withLayerAlpha = (
  ctx: CanvasRenderingContext2D,
  layerAlpha: number,
  draw: () => void,
): void => {
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = drawAlpha(prev, layerAlpha);
  try {
    draw();
  } finally {
    ctx.globalAlpha = prev;
  }
};

/** `withLayerAlpha` reading the alpha already stored on `ctx.canvas`. */
const withCanvasLayerAlpha = (
  ctx: CanvasRenderingContext2D,
  draw: () => void,
): void => {
  withLayerAlpha(ctx, getLayerAlpha(ctx.canvas), draw);
};

export {
  drawAlpha,
  getLayerAlpha,
  setLayerAlpha,
  withCanvasLayerAlpha,
  withLayerAlpha,
};

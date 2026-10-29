// Canvas-element rendering: a standalone element (e.g. HeatmapControl) and
// the canvases living inside a pane.
// Moved from renderer.ts — renderCanvasElement, renderPaneCanvas.
import * as CONST from "../const.js";
import type { RenderCtx } from "../type.js";
import { isExportExcluded, isVisible, loadImage } from "../util.js";
import { effectiveOpacity, withAlpha } from "./util.js";

/** Render a standalone canvas element (e.g. HeatmapControl). */
const renderCanvasElement = async (
  container: HTMLElement,
  rc: RenderCtx,
  ce: HTMLCanvasElement,
): Promise<void> => {
  const { ctx, rect, scale, contRect, cw, ch } = rc;
  const r = ce.getBoundingClientRect();
  const l = r.left - contRect.left;
  const t = r.top - contRect.top;
  const w = r.width;
  const h = r.height;
  if (w < 1 || h < 1) return;
  const dx = (l - rect.left) * scale;
  const dy = (t - rect.top) * scale;
  const dw = w * scale;
  const dh = h * scale;
  if (!isVisible(dx, dy, dw, dh, cw, ch)) return;
  const dataUrl = ce.toDataURL(CONST.MIME_LOSSLESS);
  let img: HTMLImageElement | null = null;
  try {
    img = (await loadImage(dataUrl)) as HTMLImageElement;
    withAlpha(ctx, effectiveOpacity(container, ce), () => {
      ctx.drawImage(img!, dx, dy, dw, dh);
    });
  } catch {
    /* skip */
  }
};

/** Render canvas elements from a pane — or the container, for canvases that
 *  live in a pane the per-layer walk never visits (annotation labels).
 *
 *  Returns how many canvases it actually serialized, so a caller that expects
 *  one (the annotation pass) can tell "drew it" from "the pane was empty" —
 *  the difference between a complete export and a silently label-free one. */
const renderPaneCanvas = async (
  container: HTMLElement,
  rc: RenderCtx,
  pane: HTMLElement,
  selector: string = CONST.SEL.CANVAS,
): Promise<number> => {
  const { ctx, rect, scale, contRect, cw, ch } = rc;
  let serialized = 0;
  for (const ce of pane.querySelectorAll(selector)) {
    // SKIP_EXPORT: self or ancestor (chrome host). Registered canvas layers
    // paint via `layerInfo.canvas` and never reach this pane walk.
    if (isExportExcluded(ce)) continue;
    try {
      const r = ce.getBoundingClientRect();
      const l = r.left - contRect.left;
      const t = r.top - contRect.top;
      const w = r.width;
      const h = r.height;
      if (w < 1 || h < 1) continue;
      const dx = (l - rect.left) * scale;
      const dy = (t - rect.top) * scale;
      const dw = w * scale;
      const dh = h * scale;
      if (!isVisible(dx, dy, dw, dh, cw, ch)) continue;
      const dataUrl = (ce as HTMLCanvasElement).toDataURL(CONST.MIME_LOSSLESS);
      serialized++;
      let img: HTMLImageElement | null = null;
      try {
        img = (await loadImage(dataUrl)) as HTMLImageElement;
        withAlpha(ctx, effectiveOpacity(container, ce as HTMLElement), () => {
          ctx.drawImage(img!, dx, dy, dw, dh);
        });
      } catch {
        /* skip */
      }
    } catch {
      /* skip */
    }
  }
  return serialized;
};

export { renderCanvasElement, renderPaneCanvas };

// Canvas-element rendering: a standalone element (e.g. HeatmapControl) and
// the canvases living inside a pane.
// Moved from renderer.ts — renderCanvasElement, renderPaneCanvas.
import * as CONST from "../const.js";
import { isVisible, loadImage } from "../util.js";
import { type RenderCtx, effectiveOpacity, withAlpha } from "./util.js";

/** True when the node itself is export-excluded, or sits under a marked
 *  ancestor (chrome host trees). Pane-canvas pass — see SEL.SKIP_EXPORT. */
const isExportExcluded = (el: Element): boolean =>
  el.matches(CONST.SEL.SKIP_EXPORT) || el.closest(CONST.SEL.SKIP_EXPORT) != null;

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
 *  live in a pane the per-layer walk never visits (annotation labels). */
const renderPaneCanvas = async (
  container: HTMLElement,
  rc: RenderCtx,
  pane: HTMLElement,
  selector: string = CONST.SEL.CANVAS,
): Promise<void> => {
  const { ctx, rect, scale, contRect, cw, ch } = rc;
  for (const ce of pane.querySelectorAll(selector)) {
    // SKIP_EXPORT: self or ancestor (chrome host). Registered canvas layers
    // paint via `li.canvas` and never reach this pane walk.
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
};

export { renderCanvasElement, renderPaneCanvas };

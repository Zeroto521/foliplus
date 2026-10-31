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

/** One label canvas frozen at the moment the export started.
 *
 *  The annotation labels live in a pane the per-layer walk never visits, and
 *  the label pass used to read them with a live `toDataURL()` at pass time.
 *  But between `render()`'s synchronous snapshot and that pass there is an
 *  async window — the tile wait (seconds on a loaded machine) and the
 *  `nextFrame()` — and an annotation refresh in that window (a field replay,
 *  a LAYER_CHANGE, an unregister→re-register that drops and recreates the
 *  canvas) leaves the pass reading a blank canvas. The export comes back
 *  without the labels and without a word.
 *
 *  Freezing the pixels here — before the first await — makes the export
 *  answer one question: the labels the user saw when they pressed Export.
 *  `dataUrl` is the already-serialized image (the `toDataURL` the live path
 *  would have paid anyway, just paid earlier); the geometry is captured at
 *  the same instant, so a later grow/setView on the enlarged path cannot
 *  move the label out from under the pixels. */
export type CanvasSnapshot = {
  dataUrl: string;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  opacity: number;
};

/** Capture every canvas a pane currently holds, as an immutable snapshot.
 *
 *  Synchronous and side-effect-free apart from the `toDataURL` reads: it runs
 *  at the very top of `render()`, before any await, so what it captures is
 *  exactly the label pixels that were on screen when the export started. A
 *  canvas the pane does not currently hold (e.g. one torn down and recreated
 *  later) is simply not in the snapshot — that is the loss the caller reports. */
export type PaneSnapshot = {
  /** The canvases that were serialized and will be drawn. */
  snaps: CanvasSnapshot[];
  /** The pane held at least one canvas (even if none serialized). */
  sawCanvas: boolean;
};

export const snapshotPaneCanvases = (
  container: HTMLElement,
  rc: RenderCtx,
  pane: HTMLElement,
  selector: string = CONST.SEL.CANVAS,
): PaneSnapshot => {
  const { rect, scale, contRect, cw, ch } = rc;
  const out: CanvasSnapshot[] = [];
  let sawCanvas = false;
  for (const ce of pane.querySelectorAll(selector)) {
    if (isExportExcluded(ce)) continue;
    sawCanvas = true;
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
      out.push({
        dataUrl: (ce as HTMLCanvasElement).toDataURL(CONST.MIME_LOSSLESS),
        dx,
        dy,
        dw,
        dh,
        opacity: effectiveOpacity(container, ce as HTMLElement),
      });
    } catch {
      /* skip */
    }
  }
  return { snaps: out, sawCanvas };
};

/** Draw a frozen canvas snapshot. Never touches the live canvas — it draws
 *  the pixels captured when the export started, so a refresh that happened in
 *  the async window cannot blank the labels. */
export const renderCanvasSnapshot = async (
  rc: RenderCtx,
  snap: CanvasSnapshot,
): Promise<void> => {
  let img: HTMLImageElement | null = null;
  try {
    img = (await loadImage(snap.dataUrl)) as HTMLImageElement;
    withAlpha(rc.ctx, snap.opacity, () => {
      rc.ctx.drawImage(img!, snap.dx, snap.dy, snap.dw, snap.dh);
    });
  } catch {
    /* skip */
  }
};

export { renderCanvasElement, renderPaneCanvas };

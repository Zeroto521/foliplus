import { createScopedTranslator } from "#common/locale.js";
import * as CONST from "./const.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const T = createScopedTranslator(CONF);

/** Test whether a rectangle intersects the visible crop area. */
const isVisible = (
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  cw: number,
  ch: number,
) => !(dx + dw < 0 || dy + dh < 0 || dx > cw || dy > ch);

/** Fetch a remote image as an ImageBitmap (CORS mode), used once then closed.
 *  Tiles are drawn once and discarded; sprites are deduped per-render in
 *  renderer.ts via a local map.  A bitmap created on the failure path is
 *  closed before returning so nothing is ever leaked. */
const loadImageBitmap = async (url: string) => {
  let bitmap: ImageBitmap | null = null;
  try {
    const resp = await fetch(url, {
      mode: "cors",
      cache: "force-cache",
      signal: AbortSignal.timeout(CONST.TIMING.TIMEOUT as number),
    });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    bitmap = await createImageBitmap(blob);
    return bitmap;
  } catch {
    if (bitmap) {
      try {
        bitmap.close();
      } catch {
        /* already closed */
      }
    }
    return null;
  }
};

/** Load an HTMLImageElement from a URL (or data URI).  Detaches
 *  event handlers on both success and error so the Image can be GC'd.
 *  If `src` is an object URL, revokes it on error to free the blob. */
const loadImage = (src: string, crossOrigin?: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    if (crossOrigin) i.crossOrigin = crossOrigin;
    i.onload = () => {
      i.onload = null;
      i.onerror = null;
      resolve(i);
    };
    i.onerror = () => {
      i.onload = null;
      i.onerror = null;
      if (src.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(src);
        } catch {
          /* ignore */
        }
      }
      reject(new Error(T("err_image_load")));
    };
    i.src = src;
  });

/** Wait for a font spec to be ready for canvas text rendering. */
const ensureFont = async (fontSpec: string) => {
  try {
    await document.fonts.load(fontSpec);
  } catch {
    /* try anyway */
  }
  if (!document.fonts.check(fontSpec)) {
    try {
      await document.fonts.ready;
    } catch {
      /* skip */
    }
  }
};

// ============================================================================
// File download — the single place in the codebase that owns a download
// anchor. Export producers hand over only the blob and filename: ExportControl
// images (this file's callers) and MeasureControl GeoJSON/CSV. Centralising the
// anchor lifecycle here means revoke policy cannot drift between components.
// ============================================================================

/** Milliseconds to keep an object URL alive after the download is triggered.
 *  A delay is required — an anchor clicked from a detached element can be
 *  aborted if the URL is revoked in the same tick. Exported artifacts are
 *  large (HD maps, GeoTIFFs), so this is generous rather than minimal. */
const DEFAULT_REVOKE_DELAY = 10000;

/**
 * Download `blob` as a file named `filename`.
 * @param blob The bytes to download; its `type` is the MIME type.
 * @param filename File name including extension.
 * @param revokeDelayMs How long to keep the object URL before releasing it.
 *   Default {@link DEFAULT_REVOKE_DELAY}.
 */
const download = (
  blob: Blob,
  filename: string,
  revokeDelayMs = DEFAULT_REVOKE_DELAY,
) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), revokeDelayMs);
};

export {
  isVisible,
  loadImageBitmap,
  loadImage,
  ensureFont,
  download,
  DEFAULT_REVOKE_DELAY,
};

import { createTranslator } from "#common/locale.js";
import * as CONST from "./const.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const _ = createTranslator(CONF);

/** Test whether a rectangle intersects the visible crop area. */
const isVisible = (
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  cw: number,
  ch: number,
) => !(dx + dw < 0 || dy + dh < 0 || dx > cw || dy > ch);

/** Bitmap cache (LRU, capped at 500 entries).  Shared by tile
 *  bitmap loading and sprite (background-image) loading so that
 *  identical URLs are fetched and decoded only once. */
const bitmapCache = new Map<string, ImageBitmap>();

/** Release all cached ImageBitmap resources.  Call this when the
 *  rendering session is over or memory pressure requires cleanup. */
const clearBitmapCache = () => {
  for (const bitmap of bitmapCache.values()) {
    try {
      bitmap.close();
    } catch {
      /* already closed */
    }
  }
  bitmapCache.clear();
};

/** Fetch a remote image as an ImageBitmap (CORS mode), cached in memory.
 *  Uses try/finally to guarantee bitmap.close() on any error path.
 *  Reuses blob from browser's HTTP cache when possible. */
const loadImageBitmap = async (url: string) => {
  const cached = bitmapCache.get(url);
  if (cached) return cached;

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
    bitmapCache.set(url, bitmap);
    if (bitmapCache.size > CONST.CACHE.TILE_MAX) {
      const firstKey = bitmapCache.keys().next().value;
      const evicted = bitmapCache.get(firstKey);
      if (evicted) evicted.close();
      bitmapCache.delete(firstKey);
    }
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
      // Revoke object URL to release the underlying blob
      if (src.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(src);
        } catch {
          /* ignore */
        }
      }
      reject(new Error(_(`${CONF.name}.err_image_load`)));
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

export { isVisible, loadImageBitmap, loadImage, ensureFont, clearBitmapCache };

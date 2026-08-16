import { Cache } from "#common/cache.js";
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

/** Bitmap cache shared by tile loading and sprite (background-image) loading so
 *  identical URLs are fetched and decoded only once.  Bounded by TILE_MAX with
 *  FIFO eviction; evicted or cleared bitmaps are closed to release GPU memory. */
const bitmapCache = new Cache<string, ImageBitmap>(CONST.CACHE.TILE_MAX, 0, bitmap => {
  try {
    bitmap.close();
  } catch {
    /* already closed */
  }
});

/** Release all cached ImageBitmap resources.  Call this when the
 *  rendering session is over or memory pressure requires cleanup. */
const clearBitmapCache = () => {
  bitmapCache.clear();
};

/** Fetch a remote image as an ImageBitmap (CORS mode), cached in memory.
 *  A bitmap created on the failure path is closed before returning; capacity
 *  eviction and full clear are handled by the cache's eviction hook. */
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

/** Generate a GeoTIFF world file (.jgw/.tfw) for the given geo bounds.
 *  Converts NW/SE lat-lng points + pixel dimensions into the 6-line format:
 *  px_width, px_rotation, row_rotation, px_height, x_origin, y_origin.
 *  @param nw - North-west corner.
 *  @param se - South-east corner.
 *  @param width - Raster width in pixels.
 *  @param height - Raster height in pixels.
 *  @returns {string} Newline-terminated world-file text. */
const generateWorldFile = (
  nw: { lat: number; lng: number },
  se: { lat: number; lng: number },
  width: number,
  height: number,
): string => {
  const pxW = (se.lng - nw.lng) / width;
  const pxH = (se.lat - nw.lat) / height;
  return [pxW, 0, 0, pxH, nw.lng, se.lat].join("\n") + "\n";
};

export { isVisible, loadImageBitmap, loadImage, ensureFont, clearBitmapCache, generateWorldFile };

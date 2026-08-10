import { createTranslator } from "../common/locale.js";
import * as CONST from "./ExportControl.const.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const _ = createTranslator(CONF);

/** Test whether a rectangle intersects the visible crop area. */
const isVisible = (dx, dy, dw, dh, cw, ch) =>
  !(dx + dw < 0 || dy + dh < 0 || dx > cw || dy > ch);

/** Bitmap cache (LRU, capped at 500 entries).  Shared by tile
 *  bitmap loading and sprite (background-image) loading so that
 *  identical URLs are fetched and decoded only once. */
const bitmapCache = new Map();

/** Fetch a remote image as an ImageBitmap (CORS mode), cached in memory.
 *  Reuses blob from browser's HTTP cache when possible. */
const loadImageBitmap = async url => {
  const cached = bitmapCache.get(url);
  if (cached) return cached;
  const resp = await fetch(url, {
    mode: "cors",
    cache: "force-cache",
    signal: AbortSignal.timeout(CONST.TIMING.TIMEOUT),
  });
  if (!resp.ok) return null;
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);
  bitmapCache.set(url, bitmap);
  if (bitmapCache.size > CONST.CACHE.TILE_MAX) {
    const firstKey = bitmapCache.keys().next().value;
    const evicted = bitmapCache.get(firstKey);
    if (evicted) evicted.close();
    bitmapCache.delete(firstKey);
  }
  return bitmap;
};

/** Load an HTMLImageElement from a URL (or data URI). */
const loadImage = (src, crossOrigin) =>
  new Promise((resolve, reject) => {
    const i = new Image();
    if (crossOrigin) i.crossOrigin = crossOrigin;
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error(_(`${CONF.name}.err_image_load`)));
    i.src = src;
  });

/** Wait for a font spec to be ready for canvas text rendering. */
const ensureFont = async fontSpec => {
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

export { isVisible, loadImageBitmap, loadImage, ensureFont };

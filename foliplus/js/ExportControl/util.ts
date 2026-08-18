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
      reject(new Error(_(`${CONF.name}.err_image_load`)));
    };
    i.src = src;
  });

type LatLngPoint = { lat: number; lng: number };

/**
 * Compute a six-line World File (`.pgw` / `.tfw`) for a raster image whose
 * pixel grid maps onto a geographic bounding box.
 *
 * World File format (per ESRI spec):
 *   Line 1: pixel size in x (east-west, can be negative)
 *   Line 2: row rotation term (usually 0)
 *   Line 3: column rotation term (usually 0)
 *   Line 4: pixel size in y (north-south, usually negative — image y is top-down)
 *   Line 5: x coordinate of the CENTER of the top-left pixel
 *   Line 6: y coordinate of the CENTER of the top-left pixel
 *
 * Coordinates are expressed in the same units as `nw` / `se` (typically
 * WGS84 degrees from `map.getBounds()`, but also works for projected CRS
 * like EPSG:3857 meters — consumers infer the CRS from an accompanying
 * `.prj` file or default to WGS84).
 */
const generateWorldFile = (
  nw: LatLngPoint,
  se: LatLngPoint,
  width: number,
  height: number,
): string => {
  // ESRI World File spec requires valid numeric values; reject zero dims.
  if (width <= 0 || height <= 0) return "";

  const pixelWidth = (se.lng - nw.lng) / width;
  const pixelHeight = (se.lat - nw.lat) / height;

  // Center of the top-left pixel (image (0,0) sits on the NW corner of the
  // bounding box; pixel center is half a pixel offset from the corner).
  const ulx = nw.lng + pixelWidth / 2;
  const uly = nw.lat + pixelHeight / 2;

  return [
    pixelWidth.toPrecision(12),
    "0",
    "0",
    pixelHeight.toPrecision(12),
    ulx.toPrecision(15),
    uly.toPrecision(15),
    "",
  ].join("\n");
};

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

export { isVisible, loadImageBitmap, loadImage, ensureFont, generateWorldFile };

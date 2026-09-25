// Tile-coordinate maths and the concurrent tile draw pass.
// Moved from renderer.ts — calcTiles, tilePositions, renderTileLayer.
import { layerUrl } from "#core/leafletAdapter.js";
import * as CONST from "../const.js";
import { isVisible, loadImageBitmap } from "../util.js";
import type { RenderCtx, TileDesc, TileLoadStats } from "./util.js";

/** Calculate tile coordinates covering geo bounds at a given zoom. */
const calcTiles = (
  map: L.Map,
  tileLayer: L.TileLayer,
  bounds: { nw: { lat: number; lng: number }; se: { lat: number; lng: number } },
  zoom: number,
  scaleVal: number,
): TileDesc[] => {
  const crs = map.options.crs || L.CRS.EPSG3857;
  const opts = tileLayer.options as L.TileLayerOptions;
  const tileSize = typeof opts.tileSize === "number" ? opts.tileSize : 256;
  const subdomains = opts.subdomains || "abc";
  // Leaflet keeps the tile URL template off its public interface; the adapter
  // probe is the one route to it.
  const urlTemplate = layerUrl(tileLayer) || "";

  // Get bounds in EPSG:3857
  const nw = crs.latLngToPoint(L.latLng(bounds.nw.lat, bounds.nw.lng), zoom);
  const se = crs.latLngToPoint(L.latLng(bounds.se.lat, bounds.se.lng), zoom);

  // Tile coordinates (Leaflet origin is top-left, tiles start at 0,0)
  const minTx = Math.floor(nw.x / tileSize);
  const maxTx = Math.ceil(se.x / tileSize) - 1;
  const minTy = Math.floor(nw.y / tileSize);
  const maxTy = Math.ceil(se.y / tileSize) - 1;

  const tiles: TileDesc[] = [];
  const maxTile = crs.infinite ? Infinity : Math.pow(2, zoom);

  for (let tx = minTx; tx <= maxTx; tx++) {
    for (let ty = minTy; ty <= maxTy; ty++) {
      if (tx < 0 || ty < 0 || tx >= maxTile || ty >= maxTile) continue;
      // Build URL
      let url = urlTemplate;
      const subIdx =
        (tx + ty) % (typeof subdomains === "string" ? subdomains.length : 1);
      const sub = typeof subdomains === "string" ? subdomains[subIdx] : subdomains[0];
      url = url
        .replace("{s}", sub)
        .replace("{x}", tx.toString())
        .replace("{y}", ty.toString())
        .replace("{z}", zoom.toString())
        // Use export scale for {r} (retina @2x) — screen DPR is irrelevant
        .replace("{r}", scaleVal > 1 ? "@2x" : "");
      const fallback =
        scaleVal > 1 && urlTemplate.includes("{r}")
          ? url.replace("@2x", "")
          : undefined;
      tiles.push({
        x: tx,
        y: ty,
        z: zoom,
        url,
        // Sources without retina tiles 404 every {r} tile; keep the 1x URL
        // so the draw pass can fall back instead of blanking the layer.
        ...(fallback !== undefined && fallback !== url ? { fallback } : {}),
        // Tile pixel position within the container viewport at this zoom
        left: tx * tileSize,
        top: ty * tileSize,
        size: tileSize,
      });
    }
  }
  return tiles;
};

/**
 * Compute each tile's destination rectangle within the crop area and keep
 * only the ones the export will actually draw.
 *
 * render() calls this once per layer to size the progress denominator,
 * threads the result into renderTileLayer, and that pass draws exactly it.
 * The list is a value computed here rather than a stateful read of the
 * map, so the denominator is the same set the drawing pass iterates even
 * though it runs a frame later.
 */
const tilePositions = (map: L.Map, rc: RenderCtx, tiles: TileDesc[]): TileDesc[] => {
  const { rect, scale, contRect, cw, ch } = rc;
  const zoom = map.getZoom();
  const crs = map.options.crs || L.CRS.EPSG3857;
  const viewportCenter = crs.latLngToPoint(map.getCenter(), zoom);
  const vpLeft = viewportCenter.x - contRect.width / 2;
  const vpTop = viewportCenter.y - contRect.height / 2;

  const visibleTiles: TileDesc[] = [];
  for (const tile of tiles) {
    const tileVpX = tile.left - vpLeft;
    const tileVpY = tile.top - vpTop;
    const dx = (tileVpX - rect.left) * scale;
    const dy = (tileVpY - rect.top) * scale;
    const dw = tile.size * scale;
    const dh = tile.size * scale;
    if (!isVisible(dx, dy, dw, dh, cw, ch)) continue;
    visibleTiles.push({ ...tile, dx, dy, dw, dh });
  }
  return visibleTiles;
};

/** Render a single tile layer from geo bounds with concurrent tile loading.
 *  onProgress reports the cumulative tiles actually drawn for this layer
 *  (not a percentage, and not tiles merely fetched), so the caller can
 *  accumulate a share of the whole export instead of re-basing the bar at
 *  the start of every layer.  Failing tiles do not advance it: they are
 *  still missing from the picture, which is what the bar is for. */
const renderTileLayer = async (
  tileFailures: TileLoadStats[],
  rc: RenderCtx,
  visibleTiles: TileDesc[],
  layer: L.TileLayer,
  onProgress?: (tilesDrawn: number) => void,
): Promise<void> => {
  const { ctx, cw, ch } = rc;
  if (visibleTiles.length === 0) return;

  // Native carrier (§20 ③): GridLayer's `options.opacity` is not captured by
  // `toDataURL` — it lives on the element's style, applied at compositing time.
  // Reading the base from `nativeBase` would require a second WeakMap; instead
  // read the effective value directly. The LayerControl slider stores the
  // multiplier in `layerInfo.opacity`; the absolute value is what `options.opacity`
  // holds, so this is already the composed result.
  const alpha = typeof layer.options.opacity === "number" ? layer.options.opacity : 1;
  ctx.globalAlpha = alpha;
  let drawn = 0;
  try {
    // Load and draw tiles in concurrent batches to avoid overwhelming the
    // browser connection limit (~6 per domain) while still parallelizing.
    const concurrency = CONST.TILE_CONCURRENCY;
    for (let i = 0; i < visibleTiles.length; i += concurrency) {
      const batch = visibleTiles.slice(i, i + concurrency);
      const bitmaps = await Promise.all(
        batch.map(async t => {
          let bitmap = await loadImageBitmap(t.url).catch(() => null);
          // Retina-less source: fall back to the 1x tile so the layer still
          // paints (at nominal resolution) instead of disappearing.
          if (!bitmap && t.fallback) {
            bitmap = await loadImageBitmap(t.fallback).catch(() => null);
          }
          return bitmap;
        }),
      );

      for (let j = 0; j < batch.length; j++) {
        const bitmap = bitmaps[j];
        if (!bitmap) continue;
        const t = batch[j];
        try {
          ctx.drawImage(bitmap, t.dx!, t.dy!, t.dw!, t.dh!);
          drawn++;
        } catch {
          /* skip tile on draw error */
        } finally {
          // Bitmap is drawn once and never needed again; close to free GPU memory.
          try {
            bitmap.close();
          } catch {
            /* already closed */
          }
        }
      }

      // Report the tiles painted this batch so the caller can accumulate a
      // share of the whole export instead of re-basing per layer.  Counting
      // the batch position would credit tiles whose download failed.
      if (onProgress) onProgress(drawn);
    }
  } finally {
    ctx.globalAlpha = 1;
  }

  // Record what this layer's fetch actually achieved.  `drawn` counts tiles
  // whose bitmap painted, so failures are the remaining ones — including
  // drawImage errors, which leave the same hole as a failed fetch.
  tileFailures.push({
    total: visibleTiles.length,
    failed: visibleTiles.length - drawn,
  });
};

export { calcTiles, tilePositions, renderTileLayer };

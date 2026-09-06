// ExportControl mixed-mode renderer — orchestrates independent rendering passes.
import { createScopedTranslator } from "#common/locale.js";
import * as CONST from "./const.js";
import { ensureFont, isVisible, loadImage, loadImageBitmap } from "./util.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const T = createScopedTranslator(CONF);

/** Render context threaded through all rendering passes. */
interface RenderCtx {
  ctx: CanvasRenderingContext2D;
  rect: { left: number; top: number; width: number; height: number };
  scale: number;
  contRect: DOMRect;
  cw: number;
  ch: number;
  sw: number;
  sh: number;
  /** Reports how far the render has progressed, 0..90.  Never decreases. */
  onProgress?: (percent: number) => void;
}

/** A tile descriptor computed by calcTiles. */
interface TileDesc {
  x: number;
  y: number;
  z: number;
  url: string;
  left: number;
  top: number;
  size: number;
  dx?: number;
  dy?: number;
  dw?: number;
  dh?: number;
}

// ==================== ExportRenderer ====================
// Mixed-mode renderer with independent rendering passes.
// render() orchestrates the passes in painter's-algorithm order:
//   1. tiles → 2. SVG → 3. canvas → 4. markers (sprites) → 5. FontAwesome →
//   6. text labels → 7. remaining (img, inline SVG, bg-color)
// Load items with a bounded in-flight count (preserves array order on resolve).
const pooledEach = async <T, R>(
  items: T[],
  maxConcurrency: number,
  fn: (item: T, index: number) => Promise<R | null> | R | null,
): Promise<Array<R | null>> => {
  if (items.length === 0) return [];
  const cap = Math.max(1, maxConcurrency);
  const results = new Array<R | null>(items.length);
  let next = 0;
  const enqueue = async (): Promise<void> => {
    const idx = next++;
    if (idx >= items.length) return;
    try {
      const value = await fn(items[idx], idx);
      results[idx] = value ?? null;
    } catch (err) {
      console.warn(err);
      results[idx] = null;
    }
    await enqueue();
  };
  await Promise.all(Array.from({ length: cap }, enqueue));
  return results;
};

class ExportRenderer {
  map: L.Map;
  container: HTMLElement;

  constructor(map: L.Map) {
    this.map = map;
    this.container = map.getContainer();
  }

  /** Calculate tile coordinates covering geo bounds at a given zoom. */
  calcTiles(
    tileLayer: L.TileLayer,
    bounds: { nw: { lat: number; lng: number }; se: { lat: number; lng: number } },
    zoom: number,
    scaleVal: number,
  ): TileDesc[] {
    const crs = this.map.options.crs || L.CRS.EPSG3857;
    const opts = tileLayer.options as L.TileLayerOptions;
    const tileSize = typeof opts.tileSize === "number" ? opts.tileSize : 256;
    const subdomains = opts.subdomains || "abc";
    // Leaflet stores the tile URL template in the private _url — there is no
    // public accessor; the TileLayer augmentation declares it.
    const urlTemplate = tileLayer._url || "";

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
        tiles.push({
          x: tx,
          y: ty,
          z: zoom,
          url,
          // Tile pixel position within the container viewport at this zoom
          left: tx * tileSize,
          top: ty * tileSize,
          size: tileSize,
        });
      }
    }
    return tiles;
  }

  /** Share of the progress range each phase of render() may occupy.
   *
   *  Tiles get the most, since they are the only phase that waits on the
   *  network and therefore dominates real export time; the vector/marker
   *  passes are fast but still happen before the canvas is done.  The top
   *  10 points are deliberately unused here — they belong to the manager,
   *  which owns the blob encoding.  That way 100 means the download has
   *  started, not that tiles have finished loading, which is when the
   *  download was previously reported as complete. */
  private static readonly PHASES = {
    tiles: [0, 70],
    layers: [71, 90],
  } as const;

  /** Map a [0,1] fraction to the given percent range, monotonically. */
  private static mapPhase(fraction: number, [lo, hi]: readonly [number, number]) {
    return Math.min(hi, lo + Math.round(fraction * (hi - lo)));
  }

  /** Orchestrate all rendering passes in painter's-algorithm order.
   *  Passes: tiles → SVG → canvas → markers → FA → text → remaining.
   *  Overlay layers iterate via `api.layers` (read-only view of
   *  LayerRegistry's ordered array) bottom-to-top so cross-technology
   *  z-ordering is preserved per layer.
   *
   *  onProgress reports 0..90 over those passes, monotonically.  It never
   *  reports 100: the canvas still has to be encoded before it can be
   *  saved, and that belongs to the caller.  ExportRenderer does not
   *  interpret the value — it forwards it so the caller can format it
   *  (e.g. with locale text) however it likes. */
  async render(
    rect: { left: number; top: number; width: number; height: number },
    scale: number,
    bg: string | undefined,
    geoBounds:
      | { nw: { lat: number; lng: number }; se: { lat: number; lng: number } }
      | undefined,
    onProgress?: (percent: number) => void,
  ): Promise<HTMLCanvasElement> {
    const sw = Math.round(rect.width * scale);
    const sh = Math.round(rect.height * scale);
    if (sw < 1 || sh < 1) throw new Error(T("err_crop_too_small"));

    // Progress must be reportable from the moment the canvas is created, so it
    // lives here rather than on the render context: the background fill below
    // is the first step that costs anything, and no layers can be sized yet.
    let lastPercent = 0;
    const reportProgress = (percent: number) => {
      // Only ever move forward: reporting a lower value than one already
      // shown would make the bar look stuck and regress.
      if (percent <= lastPercent) return;
      lastPercent = percent;
      onProgress?.(percent);
    };

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d")!;

    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, sw, sh);
    }

    // Shared render context threaded through all passes.
    const rc: RenderCtx = {
      ctx,
      rect,
      scale,
      contRect: this.container.getBoundingClientRect(),
      // Derived values used by every pass.
      cw: rect.width * scale,
      ch: rect.height * scale,
      sw,
      sh,
      onProgress: reportProgress,
    };

    // 2. All layers — iterate in LayerControl API order bottom-to-top.
    // Each layer may contain Tile, SVG, Canvas, and/or Marker elements, so we
    // render all passes per-layer to preserve cross-technology z-order.
    // Uses api.layers (read-only view of LayerRegistry's ordered array).
    const api = map.foliplus!.LayerAPI;
    const layers = api?.layers;
    if (layers) {
      // Progress is reported as a share of every tile across all visible tile
      // layers, not per layer: with several visible TileLayers each of a
      // different tile count, per-layer percentages would restart at 0 and the
      // indicator would jump backwards.
      //
      // The denominator is the tiles renderTileLayer is actually going to
      // draw — its pre-filtered, viewport-clip list — not the raw calcTiles
      // extent.  Using the extent would make the numerator and denominator
      // disagree: a clipped layer draws fewer tiles than it enumerated, so the
      // running total could never reach tilesTotal and the last batch would
      // report 80-95% instead of 100.  Each layer is therefore sized (which
      // does the same filtering as the draw pass) and counted, and its own
      // total is reported against the running cross-layer sum.
      if (geoBounds && geoBounds.nw) {
        // Size every tile layer up front: the sum is the progress denominator
        // and the surviving entries are the layers that get drawn, so the
        // numerator and denominator describe the same set of tiles.
        const zoom = this.map.getZoom();
        const sizedTiles: Array<{ tiles: TileDesc[]; count: number }> = [];
        for (const li of layers) {
          if (!li.visible || !(li.layer instanceof L.TileLayer) || !li.layer._url)
            continue;
          const tiles = this.tilePositions(
            rc,
            this.calcTiles(li.layer, geoBounds, zoom, scale),
          );
          if (tiles.length > 0) sizedTiles.push({ tiles, count: tiles.length });
        }
        const grandTotal = sizedTiles.reduce((sum, li) => sum + li.count, 0);

        if (grandTotal > 0) {
          let tilesDone = 0;
          for (const { tiles } of sizedTiles) {
            await this.renderTileLayer(rc, tiles, handled => {
              tilesDone += handled;
              rc.onProgress?.(
                ExportRenderer.mapPhase(
                  tilesDone / grandTotal,
                  ExportRenderer.PHASES.tiles,
                ),
              );
            });
          }
        } else {
          // No tiles to download, so the remaining phases start from the top
          // of their range instead of from 0.
          rc.onProgress?.(ExportRenderer.PHASES.layers[0]);
        }
      }

      // Only layers that can actually paint are in the denominator: an entry
      // with no layer and no canvas contributes nothing, and counting it would
      // leave the layer range permanently short of its top.  The filter must
      // stay in step with what the loop body consumes, since every surviving
      // entry is counted as one unit of progress.
      const passable = layers.filter(
        li =>
          li.visible &&
          (li.canvas ||
            (li.layer && !(li.layer instanceof L.TileLayer && li.layer._url))),
      );
      let done = 0;
      for (let i = passable.length - 1; i >= 0; i--) {
        const li = passable[i];

        // Callback-only layers (e.g. HeatmapControl canvas) — render via stored canvas
        if (li.canvas) {
          await this.renderCanvasElement(rc, li.canvas);
          done++;
        } else if (li.layer) {
          // SVG paths, Canvas elements, and Markers in this layer's panes
          const panes = api.getLayerPanes(li.layer);
          for (const paneName of panes) {
            const pane = this.map.getPane(paneName);
            if (!pane) continue;
            await this.renderPaneSVG(rc, pane);
            await this.renderPaneCanvas(rc, pane);
          }

          // Markers and divIcons in this layer
          const markerRoots = this.collectLayerMarkers(li.layer);
          if (markerRoots.length) {
            await this.renderMarkers(rc, markerRoots);
            await this.renderFontAwesome(rc, markerRoots);
            await this.renderTextLabels(rc, markerRoots);
            await this.renderRemaining(rc, markerRoots);
          }
        }
        done++;
        rc.onProgress?.(
          ExportRenderer.mapPhase(done / passable.length, ExportRenderer.PHASES.layers),
        );
      }
    }

    return canvas;
  }

  /** Render a standalone canvas element (e.g. HeatmapControl). */
  async renderCanvasElement(rc: RenderCtx, ce: HTMLCanvasElement) {
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
      ctx.drawImage(img, dx, dy, dw, dh);
    } catch {
      /* skip */
    }
  }

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
  private tilePositions(rc: RenderCtx, tiles: TileDesc[]): TileDesc[] {
    const { rect, scale, contRect, cw, ch } = rc;
    const zoom = this.map.getZoom();
    const crs = this.map.options.crs || L.CRS.EPSG3857;
    const viewportCenter = crs.latLngToPoint(this.map.getCenter(), zoom);
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
      if (tileVpX + tile.size < rect.left || tileVpY + tile.size < rect.top) continue;
      if (tileVpX > rect.left + rect.width || tileVpY > rect.top + rect.height)
        continue;
      visibleTiles.push({ ...tile, dx, dy, dw, dh });
    }
    return visibleTiles;
  }

  /** Render a single tile layer from geo bounds with concurrent tile loading.
   *  onProgress reports the cumulative tiles actually drawn for this layer
   *  (not a percentage, and not tiles merely fetched), so the caller can
   *  accumulate a share of the whole export instead of re-basing the bar at
   *  the start of every layer.  Failing tiles do not advance it: they are
   *  still missing from the picture, which is what the bar is for. */
  async renderTileLayer(
    rc: RenderCtx,
    visibleTiles: TileDesc[],
    onProgress?: (tilesDrawn: number) => void,
  ) {
    const ctx = rc.ctx;
    if (visibleTiles.length === 0) return;

    let drawn = 0;
    // Load and draw tiles in concurrent batches to avoid overwhelming the
    // browser connection limit (~6 per domain) while still parallelizing.
    const concurrency = CONST.TILE_CONCURRENCY;
    for (let i = 0; i < visibleTiles.length; i += concurrency) {
      const batch = visibleTiles.slice(i, i + concurrency);
      const bitmaps = await Promise.all(
        batch.map(t => loadImageBitmap(t.url).catch(() => null)),
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
  }

  /** Render SVG content from a single pane. */
  async renderPaneSVG(rc: RenderCtx, pane: HTMLElement) {
    const { ctx, rect, scale, contRect, sw, sh } = rc;
    const props = [
      "fill",
      "stroke",
      "stroke-width",
      "stroke-dasharray",
      "stroke-linecap",
      "stroke-linejoin",
      "opacity",
      "fill-opacity",
      "stroke-opacity",
      "visibility",
      "display",
    ];
    for (const svgEl of pane.querySelectorAll("svg")) {
      const svgG = svgEl.querySelector("g");
      const hasContent =
        (svgG && svgG.children.length > 0) ||
        svgEl.querySelector(
          "path, polygon, polyline, circle, rect, ellipse, line, text",
        );
      if (!hasContent) continue;

      const svgRect = svgEl.getBoundingClientRect();
      const svgL = svgRect.left - contRect.left;
      const svgT = svgRect.top - contRect.top;
      if (svgRect.width < 1 || svgRect.height < 1) continue;

      const clone = svgEl.cloneNode(true) as SVGElement;
      clone.removeAttribute("style");
      clone.setAttribute("width", String(svgRect.width));
      clone.setAttribute("height", String(svgRect.height));

      const allEls = clone.querySelectorAll("*");
      const originals = svgEl.querySelectorAll("*");
      for (let i = 0; i < allEls.length && i < originals.length; i++) {
        const cs = window.getComputedStyle(originals[i]);
        const inline = allEls[i] as HTMLElement;
        for (const p of props) {
          const v = cs.getPropertyValue(p);
          if (!v || v === "none") continue;
          if (p === "fill" && v === "rgb(0, 0, 0)") continue;
          if (p === "stroke" && v === "none") continue;
          inline.style.setProperty(p, v);
        }
      }

      let src = new XMLSerializer().serializeToString(clone);
      if (!src.includes(`xmlns="${CONST.SVG_NS}"`))
        src = src.replace("<svg", `<svg xmlns="${CONST.SVG_NS}"`);
      if (src.length < 100) continue;

      const blob = new Blob([src], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      try {
        const svgImg = await loadImage(url);
        ctx.drawImage(
          svgImg as HTMLImageElement,
          rect.left - svgL,
          rect.top - svgT,
          rect.width,
          rect.height,
          0,
          0,
          sw,
          sh,
        );
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }

  /** Render canvas elements from a single pane. */
  async renderPaneCanvas(rc: RenderCtx, pane: HTMLElement) {
    const { ctx, rect, scale, contRect, cw, ch } = rc;
    for (const ce of pane.querySelectorAll(CONST.SEL.CANVAS)) {
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
          ctx.drawImage(img, dx, dy, dw, dh);
        } catch {
          /* skip */
        } finally {
          if (img) {
            // Data-URL images have no explicit close; detaching handlers
            // (done inside loadImage) allows the Image to be GC'd.
          }
        }
      } catch {
        /* skip */
      }
    }
  }

  /** Collect markers belonging to a specific layer's panes. */
  collectLayerMarkers(layer: L.Layer): HTMLElement[] {
    const panes = map.foliplus!.LayerAPI!.getLayerPanes(layer);
    const roots: HTMLElement[] = [];
    const seen = new Set<HTMLElement>();
    for (const paneName of panes) {
      const pane = this.map.getPane(paneName);
      if (!pane) continue;
      for (let i = 0; i < pane.children.length; i++) {
        const el = pane.children[i] as HTMLElement;
        // Skip canvas and SVG — handled by dedicated render passes
        if (
          el.tagName === "CANVAS" ||
          el.tagName === "SVG" ||
          el.matches(CONST.SEL.SKIP_EXPORT) ||
          el.querySelector(CONST.SEL.SKIP_EXPORT)
        )
          continue;
        if (seen.has(el)) continue;
        seen.add(el);
        roots.push(el);
      }
    }
    return roots;
  }

  /** Render markers with background-image sprites. */
  async renderMarkers(rc: RenderCtx, markerRoots: HTMLElement[]) {
    const { ctx, rect, scale, contRect, cw, ch } = rc;
    const drawableEls: HTMLElement[] = [];
    for (const root of markerRoots) {
      drawableEls.push(root);
      for (const sub of root.querySelectorAll("*")) {
        const scs = window.getComputedStyle(sub);
        if (
          scs.backgroundImage &&
          scs.backgroundImage.includes("url(") &&
          scs.backgroundImage !== "none"
        )
          drawableEls.push(sub as HTMLElement);
      }
    }

    // Load unique sprites (once per URL) directly into a local map
    const spriteUrls = new Set<string>();
    for (const el of drawableEls) {
      const cs = window.getComputedStyle(el);
      const bg = cs.backgroundImage;
      if (!bg || bg === "none") continue;
      const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (m && !m[1].startsWith("data:")) spriteUrls.add(m[1]);
    }
    const spriteMap = new Map<string, ImageBitmap>();
    await pooledEach<string, ImageBitmap>(
      [...spriteUrls],
      CONST.TILE_CONCURRENCY,
      async url => {
        const bitmap = await loadImageBitmap(url);
        if (bitmap) spriteMap.set(url, bitmap);
        return null;
      },
    );

    // Draw sprites; release their bitmaps even if drawing throws.
    try {
      for (const el of drawableEls) {
        const r = el.getBoundingClientRect();
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
        const cs = window.getComputedStyle(el);
        const bg = cs.backgroundImage;
        if (!bg || bg === "none") continue;
        const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
        if (!m) continue;
        const sprite = spriteMap.get(m[1]);
        if (!sprite) continue;
        const bgs = cs.backgroundSize || "auto";
        const bgsParts = bgs.trim().split(/\s+/);
        let cssBgW: number, cssBgH: number;
        if (bgs === "auto" || bgs === "auto auto") {
          cssBgW = sprite.width / (window.devicePixelRatio || 1);
          cssBgH = sprite.height / (window.devicePixelRatio || 1);
        } else if (bgs.includes("%")) {
          cssBgW = (w * (parseFloat(bgsParts[0]) || 100)) / 100;
          cssBgH = (h * (parseFloat(bgsParts[1] || bgsParts[0]) || 100)) / 100;
        } else {
          cssBgW = parseFloat(bgsParts[0]) || sprite.width;
          cssBgH = parseFloat(bgsParts[1] || bgsParts[0]) || sprite.height;
        }
        const ratioX = sprite.width / cssBgW;
        const ratioY = sprite.height / cssBgH;
        const bp = cs.backgroundPosition || "0 0";
        const bpParts = bp.trim().split(/\s+/);
        const sx = Math.abs(parseFloat(bpParts[0]) || 0) * ratioX;
        const sy = Math.abs(parseFloat(bpParts[1]) || 0) * ratioY;
        const sw = w * ratioX;
        const sh = h * ratioY;
        if (sx + sw > sprite.width || sy + sh > sprite.height) continue;
        try {
          ctx.drawImage(sprite, sx, sy, sw, sh, dx, dy, dw, dh);
        } catch {
          /* skip */
        }
      }
    } finally {
      // All sprites have been drawn (or aborted); release their bitmaps.
      for (const bitmap of spriteMap.values()) {
        try {
          bitmap.close();
        } catch {
          /* already closed */
        }
      }
    }
    return markerRoots;
  }

  /** Render FontAwesome icons from ::before pseudo-element content. */
  async renderFontAwesome(rc: RenderCtx, markerRoots: HTMLElement[]) {
    const { ctx, rect, scale, contRect, cw, ch } = rc;

    for (const root of markerRoots) {
      const r = root.getBoundingClientRect();
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

      const iconEl = root.querySelector("i");
      if (!iconEl) continue;
      const before = window.getComputedStyle(iconEl, "::before");
      const content = before.content;
      let iconText = "";
      if (content && content !== "none") {
        const raw = content.replace(/['"]/g, "");
        if (raw.length === 1) iconText = raw;
        const match = raw.match(/^\\([0-9a-fA-F]+)/);
        if (match) iconText = String.fromCharCode(parseInt(match[1], 16));
        const match2 = raw.match(/^\\\\f([0-9a-fA-F]+)/);
        if (match2) iconText = String.fromCharCode(parseInt("f" + match2[1], 16));
      }

      const iconCS = window.getComputedStyle(iconEl);
      let fontSize = parseFloat(iconCS.fontSize) || 14;
      const fontFamily = iconCS.fontFamily || "FontAwesome";
      const color = iconCS.color || "#fff";
      let fontWeight = before.fontWeight || iconCS.fontWeight || "900";
      if (fontWeight === "normal") fontWeight = "400";
      if (fontWeight === "bold") fontWeight = "700";
      let iconDX = dx,
        iconDY = dy,
        iconDW = dw,
        iconDH = dh;
      const ir = iconEl.getBoundingClientRect();
      const il = ir.left - contRect.left;
      const it = ir.top - contRect.top;
      if (ir.width > 0 && ir.height > 0) {
        iconDX = (il - rect.left) * scale;
        iconDY = (it - rect.top) * scale;
        iconDW = ir.width * scale;
        iconDH = ir.height * scale;
      }
      fontSize *= scale;
      const fontSpec = `${fontWeight} ${fontSize}px ${fontFamily}`;
      await ensureFont(fontSpec);
      ctx.save();
      ctx.font = fontSpec;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = color;
      ctx.fillText(iconText, iconDX + iconDW / 2, iconDY + iconDH / 2);
      ctx.restore();
    }
  }

  /** Render plain text labels (e.g. MeasureControl distance labels) with background. */
  async renderTextLabels(rc: RenderCtx, markerRoots: HTMLElement[]) {
    const { ctx, rect, scale, contRect, cw, ch } = rc;

    for (const root of markerRoots) {
      const textEl = root.querySelector(CONST.SEL.LABEL) || root;
      const text = textEl.textContent || "";
      if (!text.trim()) continue;
      if (root.querySelector("i")) continue;
      const rootCS = window.getComputedStyle(root);
      if (
        rootCS.backgroundImage &&
        rootCS.backgroundImage !== "none" &&
        rootCS.backgroundImage.includes("url(")
      )
        continue;

      const textCS = window.getComputedStyle(textEl);
      const tr = textEl.getBoundingClientRect();
      const w = tr.width;
      const h = tr.height;
      if (w < 1 || h < 1) continue;
      const dx = (tr.left - contRect.left - rect.left) * scale;
      const dy = (tr.top - contRect.top - rect.top) * scale;
      const dw = w * scale;
      const dh = h * scale;
      if (!isVisible(dx, dy, dw, dh, cw, ch)) continue;

      // Draw background from textEl's computed style.
      // backdrop-filter: blur() is a browser-only visual effect that cannot
      // be replicated on canvas.  Use the specified color as-is so the
      // export is deterministic and faithful to the CSS value.
      const bg = textCS.backgroundColor;
      if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") {
        ctx.save();
        ctx.fillStyle = bg;
        const br = parseFloat(textCS.borderRadius) || 0;
        if (br > 0) {
          ctx.beginPath();
          ctx.roundRect(dx, dy, dw, dh, br * scale);
          ctx.fill();
        } else ctx.fillRect(dx, dy, dw, dh);

        const bw = parseFloat(textCS.borderWidth) || 0;
        if (bw > 0 && textCS.borderStyle !== "none") {
          ctx.strokeStyle = textCS.borderColor || bg;
          ctx.lineWidth = bw * scale;
          if (br > 0) {
            ctx.beginPath();
            ctx.roundRect(dx, dy, dw, dh, br * scale);
            ctx.stroke();
          } else ctx.strokeRect(dx, dy, dw, dh);
        }
        ctx.restore();
      }

      let fontSize = parseFloat(textCS.fontSize) || 14;
      const fontFamily = textCS.fontFamily || "sans-serif";
      const color = textCS.color || "#000";
      let fontWeight = textCS.fontWeight || "400";
      if (fontWeight === "normal") fontWeight = "400";
      if (fontWeight === "bold") fontWeight = "700";
      fontSize *= scale;
      const fontSpec = `${fontWeight} ${fontSize}px ${fontFamily}`;
      await ensureFont(fontSpec);
      ctx.save();
      ctx.font = fontSpec;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = color;
      const cx = dx + dw / 2;
      const cy = dy + dh / 2;
      const lines = text.trim().split("\n");
      const lineHeight = fontSize * 1.2;
      const startY = cy - ((lines.length - 1) * lineHeight) / 2;
      for (let i = 0; i < lines.length; i++)
        ctx.fillText(lines[i].trim(), cx, startY + i * lineHeight);

      ctx.restore();
    }
  }

  /** Render remaining icon types not handled by other passes:
   *  <img> → fallback sprite → inline SVG → background-color fill. */
  async renderRemaining(rc: RenderCtx, markerRoots: HTMLElement[]) {
    const { ctx, rect, scale, contRect, cw, ch } = rc;

    for (const root of markerRoots) {
      const r = root.getBoundingClientRect();
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

      // 1. <img> elements (default Leaflet markers)
      const imgEl =
        root.tagName === "IMG" ? (root as HTMLImageElement) : root.querySelector("img");
      if (imgEl && imgEl.src) {
        let img: HTMLImageElement | null = null;
        try {
          img = (await loadImage(imgEl.src, "anonymous")) as HTMLImageElement;
          ctx.drawImage(img, dx, dy, dw, dh);
          continue;
        } catch {
          /* fall through */
        } finally {
          if (img) {
            // Image loaded from a regular URL; event handlers detached inside
            // loadImage() so the Image element can be GC'd.
          }
        }
      }

      // 2. Elements with inline SVG (divIcon with html: '<svg>...</svg>')
      const svgEl = root.querySelector("svg");
      if (svgEl) {
        try {
          const clone = svgEl.cloneNode(true) as SVGElement;
          clone.removeAttribute("style");
          const sr = svgEl.getBoundingClientRect();
          clone.setAttribute("width", String(sr.width || 24));
          clone.setAttribute("height", String(sr.height || 24));
          const colorParent = svgEl.parentElement;
          const rootColor = colorParent
            ? window.getComputedStyle(colorParent).color
            : "";
          if (rootColor && rootColor !== "rgb(0, 0, 0)")
            clone.setAttribute("color", rootColor);
          let src = new XMLSerializer().serializeToString(clone);
          if (!src.includes(`xmlns="${CONST.SVG_NS}"`))
            src = src.replace("<svg", `<svg xmlns="${CONST.SVG_NS}"`);
          const blob = new Blob([src], { type: "image/svg+xml;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          try {
            const img = (await loadImage(url)) as HTMLImageElement;
            ctx.drawImage(img, dx, dy, dw, dh);
          } finally {
            URL.revokeObjectURL(url);
          }
          continue;
        } catch {
          /* fall through */
        }
      }

      // 3. Elements with background-color but no background-image url (center dot)
      if (root.matches(CONST.SEL.LABEL)) continue;
      const rootCS = window.getComputedStyle(root);
      const bgImg = rootCS.backgroundImage;
      const hasSprite = bgImg && bgImg !== "none" && bgImg.includes("url(");
      const bgColor = rootCS.backgroundColor;
      const hasBgColor =
        bgColor && bgColor !== "transparent" && bgColor !== "rgba(0, 0, 0, 0)";
      if (hasBgColor && !hasSprite && !root.querySelector(CONST.SEL.LABEL)) {
        ctx.save();
        ctx.fillStyle = bgColor;
        const br = parseFloat(rootCS.borderRadius) || 0;
        if (br > 0) {
          ctx.beginPath();
          ctx.roundRect(dx, dy, dw, dh, br * scale);
          ctx.fill();
        } else ctx.fillRect(dx, dy, dw, dh);

        const bw = parseFloat(rootCS.borderWidth) || 0;
        if (bw > 0 && rootCS.borderStyle !== "none" && rootCS.borderColor) {
          ctx.strokeStyle = rootCS.borderColor;
          ctx.lineWidth = bw * scale;
          if (br > 0) {
            ctx.beginPath();
            ctx.roundRect(dx, dy, dw, dh, br * scale);
            ctx.stroke();
          } else ctx.strokeRect(dx, dy, dw, dh);
        }
        ctx.restore();
      }
    }
  }
}

export { pooledEach, ExportRenderer };

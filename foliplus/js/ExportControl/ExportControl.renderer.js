import { createTranslator } from "../shared/locale.js";
import * as CONST from "./ExportControl.const.js";
import {
  ensureFont,
  isVisible,
  loadImage,
  loadImageBitmap,
} from "./ExportControl.helpers.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).

const foliplus = window.foliplus;
const _ = createTranslator(CONF);

// ==================== ExportRenderer ====================
// Mixed-mode renderer with independent rendering passes.
// render() orchestrates the passes in painter's-algorithm order:
//   1. tiles → 2. SVG → 3. canvas → 4. markers (sprites) → 5. FontAwesome →
//   6. text labels → 7. remaining (img, inline SVG, bg-color)
class ExportRenderer {
  constructor(map) {
    this.map = map;
    this.container = map.getContainer();
  }

  // ── Setup helpers ──

  /** Calculate tile coordinates covering geo bounds at a given zoom.
   *  Returns [{x, y, z, url, left, top, size}]. */
  calcTiles(tileLayer, bounds, zoom, scaleVal) {
    const crs = this.map.options.crs || L.CRS.EPSG3857;
    const tileSize = tileLayer.options.tileSize || 256;
    const subdomains = tileLayer.options.subdomains || "abc";
    const urlTemplate = tileLayer._url || "";

    // Get bounds in EPSG:3857
    const nw = crs.latLngToPoint(L.latLng(bounds.nw.lat, bounds.nw.lng), zoom);
    const se = crs.latLngToPoint(L.latLng(bounds.se.lat, bounds.se.lng), zoom);

    // Tile coordinates (Leaflet origin is top-left, tiles start at 0,0)
    const minTx = Math.floor(nw.x / tileSize);
    const maxTx = Math.ceil(se.x / tileSize) - 1;
    const minTy = Math.floor(nw.y / tileSize);
    const maxTy = Math.ceil(se.y / tileSize) - 1;

    const tiles = [];
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
          .replace("{x}", tx)
          .replace("{y}", ty)
          .replace("{z}", zoom)
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

  /** Orchestrate all rendering passes in painter's-algorithm order.
   *  Passes: tiles → SVG → canvas → markers → FA → text → remaining.
   *  Overlay layers iterate via `api.layers` (read-only view of
   *  LayerRegistry's ordered array) bottom-to-top so cross-technology
   *  z-ordering is preserved per layer. */
  async render(rect, scale, bg, geoBounds) {
    const sw = Math.round(rect.width * scale);
    const sh = Math.round(rect.height * scale);
    if (sw < 1 || sh < 1) throw new Error(_(`${CONF.name}.err_crop_too_small`));

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");

    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, sw, sh);
    }

    // Shared render context threaded through all passes.
    const rc = {
      ctx,
      rect,
      scale,
      contRect: this.container.getBoundingClientRect(),
      // Derived values used by every pass.
      cw: rect.width * scale,
      ch: rect.height * scale,
      sw,
      sh,
    };

    // 2. All layers — iterate in LayerControl API order bottom-to-top.
    // Each layer may contain Tile, SVG, Canvas, and/or Marker elements, so we
    // render all passes per-layer to preserve cross-technology z-order.
    // Uses api.layers (read-only view of LayerRegistry's ordered array).
    const api = foliplus.LayerAPI;
    const layers = api?.layers;
    if (layers) {
      for (let i = layers.length - 1; i >= 0; i--) {
        const li = layers[i];
        if (!li.visible) continue;

        // Tile layers (e.g. basemaps) — render tiles via geo bounds.
        // Only TileLayer subclasses have _url; other GridLayer types
        // (e.g. L.ImageOverlay) are skipped here.
        if (li.layer instanceof L.GridLayer && li.layer._url) {
          if (geoBounds && geoBounds.nw) {
            await this.renderTileLayer(rc, geoBounds, li.layer);
          }
          continue;
        }

        // Callback-only layers (e.g. HeatmapControl canvas) — render via stored canvas
        if (li.canvas) {
          await this.renderCanvasElement(rc, li.canvas);
          continue;
        }
        // Use the layer reference from layerInfo (resolved at init or register)
        if (!li.layer) continue;

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
    }

    return canvas;
  }

  /** Render a standalone canvas element (e.g. HeatmapControl) with lifecycle hooks. */
  async renderCanvasElement(rc, ce) {
    const { ctx, rect, scale, contRect, cw, ch } = rc;
    if (ce.hooks) ce.hooks.before.forEach((fn) => fn());
    try {
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
      const mimeType = CONST.MIME[CONF.format] || CONST.MIME.DEFAULT;
      const dataUrl = ce.toDataURL(mimeType);
      const img = await loadImage(dataUrl);
      ctx.drawImage(img, dx, dy, dw, dh);
    } catch {
      /* skip */
    } finally {
      if (ce.hooks) ce.hooks.after.forEach((fn) => fn());
    }
  }

  /** Render a single tile layer from geo bounds with concurrent tile loading. */
  async renderTileLayer(rc, geoBounds, tileLayer) {
    const { ctx, rect, scale, contRect, cw, ch } = rc;
    const contW = contRect.width;
    const contH = contRect.height;

    if (!geoBounds || !geoBounds.nw) return;
    const zoom = this.map.getZoom();
    const tiles = this.calcTiles(tileLayer, geoBounds, zoom, scale);
    const crs = this.map.options.crs || L.CRS.EPSG3857;
    const viewportCenter = crs.latLngToPoint(this.map.getCenter(), zoom);
    const halfVpW = contW / 2;
    const halfVpH = contH / 2;
    const vpLeft = viewportCenter.x - halfVpW;
    const vpTop = viewportCenter.y - halfVpH;

    // Pre-filter visible tiles and compute their draw positions once.
    const visibleTiles = [];
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

    // Load and draw tiles in concurrent batches to avoid overwhelming the
    // browser connection limit (~6 per domain) while still parallelizing.
    const concurrency = CONST.TILE_CONCURRENCY;
    for (let i = 0; i < visibleTiles.length; i += concurrency) {
      const batch = visibleTiles.slice(i, i + concurrency);
      const bitmaps = await Promise.all(
        batch.map((t) => loadImageBitmap(t.url).catch(() => null)),
      );
      for (let j = 0; j < batch.length; j++) {
        const bitmap = bitmaps[j];
        if (!bitmap) continue;
        const t = batch[j];
        ctx.drawImage(bitmap, t.dx, t.dy, t.dw, t.dh);
      }
    }
  }

  /** Render SVG content from a single pane. */
  async renderPaneSVG(rc, pane) {
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

      const clone = svgEl.cloneNode(true);
      clone.removeAttribute("style");
      clone.setAttribute("width", String(svgRect.width));
      clone.setAttribute("height", String(svgRect.height));

      const allEls = clone.querySelectorAll("*");
      const originals = svgEl.querySelectorAll("*");
      for (let i = 0; i < allEls.length && i < originals.length; i++) {
        const cs = window.getComputedStyle(originals[i]);
        const inline = allEls[i];
        for (const p of props) {
          const v = cs.getPropertyValue(p);
          if (!v || v === "none") continue;
          if (p === "fill" && v === "rgb(0, 0, 0)") continue;
          if (p === "stroke" && v === "none") continue;
          inline.style[p] = v;
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
          svgImg,
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
  async renderPaneCanvas(rc, pane) {
    const { ctx, rect, scale, contRect, cw, ch } = rc;
    for (const ce of pane.querySelectorAll(CONST.SEL.CANVAS)) {
      if (ce.hooks) ce.hooks.before.forEach((fn) => fn());
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
        const mimeType = CONST.MIME[CONF.format] || CONST.MIME.DEFAULT;
        const dataUrl = ce.toDataURL(mimeType);
        const img = await loadImage(dataUrl);
        ctx.drawImage(img, dx, dy, dw, dh);
      } catch {
        /* skip */
      } finally {
        if (ce.hooks) ce.hooks.after.forEach((fn) => fn());
      }
    }
  }

  /** Collect markers belonging to a specific layer's panes.
   *  Uses `api.getLayerPanes` to discover all panes a layer's content
   *  lives in (including auto-created fallback panes from migrateLayers).
   *
   *  Collects ALL direct children of each pane — no CSS class predicate —
   *  so any Leaflet plugin's markers are automatically included without
   *  maintaining a whitelist.  Elements that should be excluded can opt
   *  out via the `data-foliplus-export` attribute.
   *
   *  SVG elements and canvas elements are skipped: they have their own
   *  dedicated rendering passes (renderPaneSVG / renderPaneCanvas). */
  collectLayerMarkers(layer) {
    const panes = foliplus.LayerAPI.getLayerPanes(layer);
    const roots = [];
    const seen = new Set();
    for (const paneName of panes) {
      const pane = this.map.getPane(paneName);
      if (!pane) continue;
      for (let i = 0; i < pane.children.length; i++) {
        const el = pane.children[i];
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
  async renderMarkers(rc, markerRoots) {
    const { ctx, rect, scale, contRect, cw, ch } = rc;
    const drawableEls = [];
    for (const root of markerRoots) {
      drawableEls.push(root);
      for (const sub of root.querySelectorAll("*")) {
        const scs = window.getComputedStyle(sub);
        if (
          scs.backgroundImage &&
          scs.backgroundImage.includes("url(") &&
          scs.backgroundImage !== "none"
        )
          drawableEls.push(sub);
      }
    }

    // Load unique sprites via shared bitmap cache
    const spriteMap = new Map();
    for (const el of drawableEls) {
      const cs = window.getComputedStyle(el);
      const bg = cs.backgroundImage;
      if (!bg || bg === "none") continue;
      const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (m && !m[1].startsWith("data:") && !spriteMap.has(m[1])) {
        spriteMap.set(m[1], null);
        loadImageBitmap(m[1])
          .then((bmp) => spriteMap.set(m[1], bmp))
          .catch(() => {});
      }
    }
    // Wait for all in-flight loads to settle
    await Promise.all(
      [...spriteMap.keys()].map((url) => loadImageBitmap(url).catch(() => {})),
    );

    // Draw sprites
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
      let cssBgW, cssBgH;
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
    return markerRoots;
  }

  /** Render FontAwesome icons from ::before pseudo-element content. */
  async renderFontAwesome(rc, markerRoots) {
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
  async renderTextLabels(rc, markerRoots) {
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
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i].trim(), cx, startY + i * lineHeight);
      }
      ctx.restore();
    }
  }

  /** Render remaining icon types not handled by other passes:
   *  <img> → fallback sprite → inline SVG → background-color fill. */
  async renderRemaining(rc, markerRoots) {
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
      const imgEl = root.tagName === "IMG" ? root : root.querySelector("img");
      if (imgEl && imgEl.src) {
        try {
          const img = await loadImage(imgEl.src, "anonymous");
          ctx.drawImage(img, dx, dy, dw, dh);
          continue;
        } catch {
          /* fall through */
        }
      }

      // 2. Elements with inline SVG (divIcon with html: '<svg>...</svg>')
      const svgEl = root.querySelector("svg");
      if (svgEl) {
        try {
          const clone = svgEl.cloneNode(true);
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
            const img = await loadImage(url);
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

export { ExportRenderer };

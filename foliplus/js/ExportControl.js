(function () {
  // ==================== Constants ====================
  const CONST = {
    name: "ExportControl",
    position: "{{ this.position }}",
    CROP: {
      MIN_SIZE: 40,
      PADDING_RATIO: 0.25,
      CONTAINER_PADDING: 200,
    },
    STORAGE: {
      KEY: "foliplus_export_rect",
    },
    TIMING: {
      URL_REVOKE_DELAY: 10000,
      TIMEOUT: {{ this.timeout }},
      PREVIEW_REMOVE: 3000,
      RENDER_DELAY: 1500,
      RESTORE_DELAY: 200,
    },
    SCALE: {{ this.scale }},
    BACKGROUND: {{ '"' + this.background + '"' if this.background else "null" }},
    FILENAME: "{{ this.filename }}",
    CLASSES: {
      COLLAPSED: "collapsed",
      EXPANDED: "expanded",
      TOOL_BTN: "foliplus-tool-btn",
      EXPORT_MODE: "foliplus-export-mode",
      EXPORT_OVERLAY: "foliplus-export-overlay",
      EXPORT_BOX: "foliplus-export-box",
      EXPORT_HANDLE: "foliplus-export-handle",
      EXPORT_CENTER: "foliplus-export-center",
      ACTIONS: "foliplus-export-actions",
      PREVIEW: "foliplus-export-preview",
      HIDDEN: "foliplus-export-hidden",
      LOCKED: "locked",
      ACTIVE: "active",
      CONFIRM: "confirm",
      CANCEL: "cancel",
    },
    SEL: {
      HANDLE: ".foliplus-export-handle",
      CENTER: ".foliplus-export-center",
      BOX: ".foliplus-export-box",
      CONFIRM: ".foliplus-export-actions .confirm",
      CANCEL: ".foliplus-export-actions .cancel",
      CANVAS: ".leaflet-map-pane canvas.foliplus-heatmap-canvas",
      CONTROL: ".leaflet-control-container, .foliplus-export-ctrl",
      PANE: '.leaflet-map-pane [class*="pane"]',
      MARKER: '.awesome-marker, .leaflet-marker-icon, .marker-icon, [class*="marker"]',
      LABEL: ".foliplus-measure-label, .leaflet-div-icon",
    },
  };

  // ==================== Runtime Guard ====================
  const foliplus = window.foliplus || {};
  if (!foliplus || !foliplus.SVGs) {
    console.error(`[${CONST.name}] foliplus runtime not found, plugin disabled.`);
    return;
  }

  // ==================== Dependencies ====================
  const map = {{ this._parent.get_name() }};
  const _ = (k) => (foliplus.gt ? foliplus.gt(k) : k);

  // ==================== SVG Icons ====================
  const SVGS = {
    CAMERA: `
      <svg viewBox="0 0 24 24">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>`,
    CHECK: `
      <svg viewBox="0 0 24 24" stroke-width="2.8">
        <polyline points="20 6 9 17 4 12"/>
      </svg>`,
    DOWNLOAD: `
      <svg viewBox="0 0 24 24" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>`,
  };

  foliplus.registerHintIcon(CONST.name, SVGS.CAMERA);

  // ==================== CORS Pre-setup ====================
  // Set crossOrigin on ALL existing TileLayers so tiles load with CORS
  // from the start. This is THE KEY to avoiding canvas taint — if tiles
  // are loaded without CORS, drawImage will taint the canvas and
  // toBlob() will return null (blank image).
  //
  // We also intercept future layer additions to set crossOrigin.
  map.eachLayer((layer) => {
    if (layer instanceof L.TileLayer && !layer.options.crossOrigin) {
      layer.options.crossOrigin = "anonymous";
      if (map.hasLayer(layer)) {
        map.removeLayer(layer);
        map.addLayer(layer);
      }
    }
  });
  map.on("layeradd", (e) => {
    if (e.layer instanceof L.TileLayer && !e.layer.options.crossOrigin) {
      e.layer.options.crossOrigin = "anonymous";
    }
  });

  // ==================== LeafletRenderer ====================
  // Mixed-mode renderer inspired by html2canvas.
  //
  // Layer 1 (Tiles): new Image() + crossOrigin='anonymous' + original URL.
  //   Same approach as html2canvas useCORS mode. No cache-busting —
  //   the browser reuses the cached CORS response.
  //   If CORS fails, tile is skipped (canvas stays clean).
  //
  // Layer 2 (SVG overlay): serialize Leaflet's <svg> → Blob URL → Image.
  //   Leaflet paths have inline styles (fill, stroke, etc.) so no
  //   external CSS is needed. This preserves all vector layers.
  //
  // Layer 3 (Markers): same as tiles — new Image() + crossOrigin.
  class LeafletRenderer {
    constructor(map) {
      this.map = map;
      this.container = map.getContainer();
    }

    // Get the first active TileLayer on the map
    getTileLayer() {
      let tileLayer = null;
      this.map.eachLayer((l) => {
        if (l instanceof L.TileLayer && this.map.hasLayer(l)) tileLayer = l;
      });
      return tileLayer;
    }

    // Calculate all tile coordinates that cover the given geo bounds at the given zoom.
    // Returns [{x, y, url}]
    calcTiles(tileLayer, bounds, zoom) {
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
      const globalTileSize = crs.infinite ? tileSize : 256;
      const maxTile = crs.infinite ? Infinity : Math.pow(2, zoom);

      for (let tx = minTx; tx <= maxTx; tx++) {
        for (let ty = minTy; ty <= maxTy; ty++) {
          if (tx < 0 || ty < 0 || tx >= maxTile || ty >= maxTile) continue;
          // Build URL
          let url = urlTemplate;
          const subIdx =
            (tx + ty) % (typeof subdomains === "string" ? subdomains.length : 1);
          const sub =
            typeof subdomains === "string" ? subdomains[subIdx] : subdomains[0];
          url = url
            .replace("{s}", sub)
            .replace("{x}", tx)
            .replace("{y}", ty)
            .replace("{z}", zoom);
          // Also handle {r} for retina — Leaflet replaces with @2x on retina
          const isRetina = window.devicePixelRatio > 1;
          url = url.replace("{r}", isRetina ? "@2x" : "");
          // Tile pixel position within the container viewport at this zoom
          const tileLeft = tx * tileSize;
          const tileTop = ty * tileSize;
          tiles.push({
            x: tx,
            y: ty,
            z: zoom,
            url,
            left: tileLeft,
            top: tileTop,
            size: tileSize,
          });
        }
      }
      return tiles;
    }

    async render(rect, scale, bg, geoBounds) {
      const sw = Math.round(rect.width * scale);
      const sh = Math.round(rect.height * scale);
      if (sw < 1 || sh < 1) throw new Error(_(`${CONST.name}.err_crop_too_small`));

      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d");

      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, sw, sh);
      }

      const cw = rect.width * scale;
      const ch = rect.height * scale;
      const contRect = this.container.getBoundingClientRect();
      const contW = contRect.width;
      const contH = contRect.height;

      // Layer 1: Tiles — If geo bounds are available, compute tile
      // coordinates ourselves so we can export areas beyond the viewport.
      // Otherwise fall back to DOM images.
      let imgOk = 0,
        imgFail = 0;

      if (geoBounds && geoBounds.nw) {
        const tileLayer = this.getTileLayer();
        if (tileLayer) {
          const zoom = this.map.getZoom();
          const tiles = this.calcTiles(tileLayer, geoBounds, zoom);
          // Viewport offset: pixel position of the viewport origin
          // in the CRS pixel space at the current zoom
          const crs = this.map.options.crs || L.CRS.EPSG3857;
          const viewportCenter = crs.latLngToPoint(this.map.getCenter(), zoom);
          const halfVpW = contW / 2;
          const halfVpH = contH / 2;
          const vpLeft = viewportCenter.x - halfVpW;
          const vpTop = viewportCenter.y - halfVpH;

          // Calculate the pixel origin of the crop area within the viewport
          // (same as before: rect.left/rect.top are viewport-relative)
          for (const tile of tiles) {
            // Tile position in viewport pixels
            const tileVpX = tile.left - vpLeft;
            const tileVpY = tile.top - vpTop;
            const dx = (tileVpX - rect.left) * scale;
            const dy = (tileVpY - rect.top) * scale;
            const dw = tile.size * scale;
            const dh = tile.size * scale;
            if (dx + dw < 0 || dy + dh < 0 || dx > cw || dy > ch) continue;
            // Also skip tiles far outside the export area
            if (tileVpX + tile.size < rect.left || tileVpY + tile.size < rect.top)
              continue;
            if (tileVpX > rect.left + rect.width || tileVpY > rect.top + rect.height)
              continue;

            try {
              const resp = await fetch(tile.url, {
                mode: "cors",
                cache: "force-cache",
              });
              if (!resp.ok) {
                imgFail++;
                continue;
              }
              const blob = await resp.blob();
              const bitmap = await createImageBitmap(blob);
              ctx.drawImage(bitmap, dx, dy, dw, dh);
              bitmap.close();
              imgOk++;
            } catch {
              imgFail++;
            }
          }
        }
      } else {
        // Fallback: use DOM images (original approach)
        const uniqueSrc = new Set();
        for (const img of this.container.querySelectorAll("img"))
          if (img.src && img.complete && img.naturalWidth) uniqueSrc.add(img.src);

        for (const src of uniqueSrc) {
          const el = [...this.container.querySelectorAll("img")].find(
            (i) => i.src === src && i.complete && i.naturalWidth,
          );
          if (!el) {
            imgFail++;
            continue;
          }
          const r = el.getBoundingClientRect();
          const l = r.left - contRect.left;
          const t = r.top - contRect.top;
          const w = el.naturalWidth || r.width || 256;
          const h = el.naturalHeight || r.height || 256;
          if (w < 1 || h < 1) {
            imgFail++;
            continue;
          }
          const dx = (l - rect.left) * scale;
          const dy = (t - rect.top) * scale;
          const dw = (r.width || w) * scale;
          const dh = (r.height || h) * scale;
          if (dx + dw < 0 || dy + dh < 0 || dx > cw || dy > ch) {
            imgFail++;
            continue;
          }
          try {
            const resp = await fetch(src, { mode: "cors", cache: "force-cache" });
            if (!resp.ok) {
              imgFail++;
              continue;
            }
            const blob = await resp.blob();
            const bitmap = await createImageBitmap(blob);
            ctx.drawImage(bitmap, dx, dy, dw, dh);
            bitmap.close();
            imgOk++;
          } catch {
            imgFail++;
          }
        }
      }

      // Layer 2: SVG overlay — serialize Leaflet's <svg> → Blob URL → Image.
      // Leaflet's SVG layers have viewBox = "0 0 <w> <h>" and paths
      // are positioned in container-relative pixel coordinates.
      // We serialize each SVG, set explicit width/height (keeping viewBox),
      // then crop to the export area.
      const panes = this.container.querySelectorAll(
        '.leaflet-map-pane [class*="pane"]',
      );
      let svgCount = 0;
      for (const pane of panes) {
        const svgEl = pane.querySelector("svg");
        if (!svgEl) continue;
        const svgRect = svgEl.getBoundingClientRect();
        const svgL = svgRect.left - contRect.left;
        const svgT = svgRect.top - contRect.top;
        if (svgRect.width < 1 || svgRect.height < 1) continue;

        const clone = svgEl.cloneNode(true);
        clone.removeAttribute("style");
        // Keep viewBox, set width/height to actual display size
        clone.setAttribute("width", String(svgRect.width));
        clone.setAttribute("height", String(svgRect.height));

        let src = new XMLSerializer().serializeToString(clone);
        const xmlns = 'xmlns="http://www.w3.org/2000/svg"';
        if (!src.includes(xmlns)) src = src.replace("<svg", `<svg ${xmlns}`);
        if (src.length < 100) continue;

        const blob = new Blob([src], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        try {
          const svgImg = await new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error(_(`${CONST.name}.err_svg_load`)));
            i.src = url;
          });
          // Crop to export rect in the SVG's coordinate space:
          // The SVG is positioned at (svgL, svgT) within the container.
          // We want to extract (rect.left - svgL, rect.top - svgT, rect.w, rect.h).
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
          svgCount++;
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      // Layer 3: Canvas — capture managed canvas elements (e.g. HeatmapControl
      // hexbin canvas) that live in .leaflet-map-pane with position offset.
      // These are positioned via left/top to cancel the mapPane CSS transform,
      // so getBoundingClientRect gives us the correct viewport-relative position.
      const canvasEls = this.container.querySelectorAll(CONST.SEL.CANVAS);
      // Trigger lifecycle hooks (e.g. disable viewport culling) before capture
      for (const ce of canvasEls) if (ce._hooks) ce._hooks.before.forEach((fn) => fn());

      let canvasCount = 0;
      for (const ce of canvasEls) {
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
        if (dx + dw < 0 || dy + dh < 0 || dx > cw || dy > ch) continue;
        try {
          // Canvas is same-origin, toDataURL is safe
          const dataUrl = ce.toDataURL("image/png");
          const img = await new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error(_(`${CONST.name}.err_canvas_load`)));
            i.src = dataUrl;
          });
          ctx.drawImage(img, dx, dy, dw, dh);
          canvasCount++;
        } catch {
          // Canvas may be tainted; skip silently
        }
      }
      // Restore lifecycle hooks after capture
      for (const ce of canvasEls) if (ce._hooks) ce._hooks.after.forEach((fn) => fn());

      // Layer 4: Markers — draw each element with background-image or plain image.
      // Search ALL panes for marker elements, since LayerControl moves markers
      // to per-layer fallback panes.
      const drawableEls = [];
      const allPanes = this.container.querySelectorAll(CONST.SEL.PANE);
      let markerRoots = [];
      for (const pane of allPanes) {
        const found = pane.querySelectorAll(CONST.SEL.MARKER);
        if (found.length) markerRoots = [...markerRoots, ...found];
      }
      // Also capture MeasureControl divIcon labels (but NOT del-icon buttons)
      for (const pane of allPanes) {
        const labels = pane.querySelectorAll(CONST.SEL.LABEL);
        if (labels.length) markerRoots = [...markerRoots, ...labels];
      }
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
      // First pass: load unique sprites
      const spriteMap = new Map();
      const loadQueue = [];
      for (const el of drawableEls) {
        const cs = window.getComputedStyle(el);
        const bg = cs.backgroundImage;
        if (!bg || bg === "none") continue;
        const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
        if (m && !m[1].startsWith("data:") && !spriteMap.has(m[1])) {
          const url = m[1];
          spriteMap.set(url, null);
          loadQueue.push(
            fetch(url, { mode: "cors", cache: "force-cache" })
              .then((r) => (r.ok ? r.blob() : null))
              .then((blob) => (blob ? createImageBitmap(blob) : null))
              .then((bmp) => spriteMap.set(url, bmp))
              .catch(() => {}),
          );
        }
      }
      await Promise.all(loadQueue);
      // Second pass: draw sprite backgrounds
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
        if (dx + dw < 0 || dy + dh < 0 || dx > cw || dy > ch) continue;
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
          const dpr = window.devicePixelRatio || 1;
          cssBgW = sprite.width / dpr;
          cssBgH = sprite.height / dpr;
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

      // FontAwesome icons — draw ::before pseudo-element text
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
        if (dx + dw < 0 || dy + dh < 0 || dx > cw || dy > ch) continue;
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
        const fontSpec = fontWeight + " " + fontSize + "px " + fontFamily;
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
        ctx.save();
        ctx.font = fontSpec;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = color;
        ctx.fillText(iconText, iconDX + iconDW / 2, iconDY + iconDH / 2);
        ctx.restore();
      }
      return canvas;
    }
  }

  // ==================== ExportManager ====================
  class ExportManager {
    constructor(mapInstance) {
      this.map = mapInstance;
      this.mapContainer = this.map.getContainer();

      this.cropState = null;
      this.exportCtrl = null;
      this.exportToolBar = null;
      this.isExporting = false;
      this.lastScreenRect = null;
      this.savedBounds = null;
      this.loadSavedBounds();

      this.dragState = {
        dragging: false,
        dragType: null,
        startX: 0,
        startY: 0,
        startRect: null,
      };

      this.onMouseDown = this.onMouseDown.bind(this);
      this.onMouseMove = this.onMouseMove.bind(this);
      this.onMouseUp = this.onMouseUp.bind(this);
      this.onKeyDown = this.onKeyDown.bind(this);
      this.onMapChange = foliplus.debounce(this.onMapChange.bind(this), 50);
    }

    attachUI(ctrl, toolBar) {
      this.exportCtrl = ctrl;
      this.exportToolBar = toolBar;
    }

    loadSavedBounds() {
      try {
        const data = localStorage.getItem(CONST.STORAGE.KEY);
        if (!data) return;
        const saved = JSON.parse(data);
        if (!saved || !saved.nw || !saved.se) return;
        const nw = saved.nw,
          se = saved.se;
        const validLat = nw.lat >= -90 && nw.lat <= 90 && se.lat >= -90 && se.lat <= 90;
        const validLng =
          nw.lng >= -180 && nw.lng <= 180 && se.lng >= -180 && se.lng <= 180;
        if (!validLat || !validLng) return;
        const mapB = this.map.getBounds();
        const overlap =
          nw.lat >= mapB.getSouth() &&
          se.lat <= mapB.getNorth() &&
          nw.lng <= mapB.getEast() &&
          se.lng >= mapB.getWest();
        if (!overlap) return;
        this.savedBounds = saved;
      } catch (e) {
        console.warn(`[${CONST.name}] ${_(`${CONST.name}.err_load_bounds`)}:`, e);
      }
    }

    saveBounds(bounds) {
      try {
        localStorage.setItem(
          CONST.STORAGE.KEY,
          JSON.stringify({
            nw: { lat: bounds.nw.lat, lng: bounds.nw.lng },
            se: { lat: bounds.se.lat, lng: bounds.se.lng },
          }),
        );
      } catch (e) {
        console.warn(`[${CONST.name}] ${_(`${CONST.name}.err_save_bounds`)}:`, e);
      }
    }

    showGlobalHint(text, duration, withLoadingIcon) {
      const loading = withLoadingIcon ? foliplus.SVGs.LOADING + " " : "";
      foliplus.showHint(
        CONST.name,
        loading + text,
        duration || foliplus.HINT_DURATION.PERSIST,
      );
    }

    showHintWithInfo(r, instruction) {
      foliplus.showHint(
        CONST.name,
        `${_(`${CONST.name}.label_size_prefix`)}${Math.round(r.width)} × ${Math.round(r.height)} ` +
          `${_(`${CONST.name}.label_size_suffix`)}${instruction ? ` — ${instruction}` : ""}`,
        foliplus.HINT_DURATION.PERSIST,
      );
    }

    updateBoxStyle(el, r) {
      el.style.left = r.left + "px";
      el.style.top = r.top + "px";
      el.style.width = r.width + "px";
      el.style.height = r.height + "px";
    }

    showCropBox() {
      if (this.cropState) return;
      const mapRect = this.mapContainer.getBoundingClientRect();
      let box;

      if (this.savedBounds) {
        // Restore from saved geo bounds.  Do NOT clamp — the rect may
        // extend beyond the viewport if the user zoomed in.  The locked
        // state will use the original geoBounds directly.
        const nw = this.map.latLngToContainerPoint(
          L.latLng(this.savedBounds.nw.lat, this.savedBounds.nw.lng),
        );
        const se = this.map.latLngToContainerPoint(
          L.latLng(this.savedBounds.se.lat, this.savedBounds.se.lng),
        );
        box = {
          left: Math.min(nw.x, se.x),
          top: Math.min(nw.y, se.y),
          width: Math.max(1, Math.abs(se.x - nw.x)),
          height: Math.max(1, Math.abs(se.y - nw.y)),
        };
      } else if (this.lastScreenRect) {
        box = {
          left: Math.max(
            0,
            Math.min(this.lastScreenRect.left, mapRect.width - CONST.CROP.MIN_SIZE),
          ),
          top: Math.max(
            0,
            Math.min(this.lastScreenRect.top, mapRect.height - CONST.CROP.MIN_SIZE),
          ),
          width: this.lastScreenRect.width,
          height: this.lastScreenRect.height,
        };
        box.width = Math.max(
          CONST.CROP.MIN_SIZE,
          Math.min(box.width, mapRect.width - box.left),
        );
        box.height = Math.max(
          CONST.CROP.MIN_SIZE,
          Math.min(box.height, mapRect.height - box.top),
        );
      } else {
        const padW = mapRect.width * CONST.CROP.PADDING_RATIO;
        const padH = mapRect.height * CONST.CROP.PADDING_RATIO;
        box = {
          left: padW,
          top: padH,
          width: mapRect.width - padW * 2,
          height: mapRect.height - padH * 2,
        };
      }

      const overlay = foliplus.dom.el("div", {
        class: `${CONST.CLASSES.EXPORT_OVERLAY} active`,
        parent: this.mapContainer,
      });
      this.mapContainer.classList.add(CONST.CLASSES.EXPORT_MODE);
      document.body.classList.add(CONST.CLASSES.EXPORT_MODE);

      const cropBox = foliplus.dom.el("div", {
        class: CONST.CLASSES.EXPORT_BOX,
        parent: this.mapContainer,
      });

      ["tl", "tr", "bl", "br", "t", "b", "l", "r"].forEach((pos) => {
        foliplus.dom.el("div", {
          class: `${CONST.CLASSES.EXPORT_HANDLE} ${pos}`,
          parent: cropBox,
          "data-pos": pos,
        });
      });

      foliplus.dom.el("div", {
        class: CONST.CLASSES.EXPORT_CENTER,
        parent: cropBox,
      });

      this.exportToolBar.innerHTML = "";
      foliplus.dom.el(
        "button",
        {
          class: `${CONST.CLASSES.TOOL_BTN} ${CONST.CLASSES.CONFIRM}`,
          title: _(`${CONST.name}.btn_confirm`),
          parent: this.exportToolBar,
        },
        { html: SVGS.CHECK },
      );
      foliplus.dom.el(
        "button",
        {
          class: `${CONST.CLASSES.TOOL_BTN} ${CONST.CLASSES.CANCEL}`,
          title: _(`${CONST.name}.btn_cancel`),
          parent: this.exportToolBar,
        },
        { html: foliplus.SVGs.CLOSE },
      );
      this.exportCtrl.classList.remove(CONST.CLASSES.COLLAPSED);
      this.exportCtrl.classList.add(CONST.CLASSES.EXPANDED);

      this.cropState = {
        overlay,
        box: cropBox,
        rect: box,
        locked: false,
        actions: this.exportToolBar,
      };
      this.updateBoxStyle(cropBox, box);
      this.showHintWithInfo(box, _(`${CONST.name}.hint_unlocked`));
      cropBox.addEventListener("mousedown", this.onMouseDown);
      this.exportToolBar.querySelector(".cancel").onclick = (e) => {
        e.stopPropagation();
        this.removeCropBox();
      };
      this.exportToolBar.querySelector(".confirm").onclick = (e) => {
        e.stopPropagation();
        this.lockCropBox();
      };
      document.addEventListener("keydown", this.onKeyDown);
    }

    lockCropBox(skipHint) {
      if (!this.cropState || this.cropState.locked) return;
      this.cropState.locked = true;
      this.cropState.box.classList.add("locked");
      const r = this.cropState.rect;
      // Always recalculate geoBounds from the current screen rect, so user's
      // adjustments after unlock → re-lock are not lost.
      this.cropState._savedGeoBounds = {
        nw: this.map.containerPointToLatLng(L.point(r.left, r.top)),
        se: this.map.containerPointToLatLng(
          L.point(r.left + r.width, r.top + r.height),
        ),
      };
      this.cropState.geoBounds = this.cropState._savedGeoBounds;
      this.cropState.actions.innerHTML = "";
      foliplus.dom.el(
        "button",
        {
          class: `${CONST.CLASSES.TOOL_BTN} ${CONST.CLASSES.CONFIRM}`,
          title: _(`${CONST.name}.btn_export`),
          parent: this.cropState.actions,
        },
        { html: SVGS.DOWNLOAD },
      );
      foliplus.dom.el(
        "button",
        {
          class: `${CONST.CLASSES.TOOL_BTN} ${CONST.CLASSES.CANCEL}`,
          title: _(`${CONST.name}.btn_cancel`),
          parent: this.cropState.actions,
        },
        { html: foliplus.SVGs.CLOSE },
      );
      this.cropState.actions.querySelector(`.${CONST.CLASSES.CANCEL}`).onclick = (
        e,
      ) => {
        e.stopPropagation();
        this.unlockCropBox();
      };
      this.cropState.actions.querySelector(`.${CONST.CLASSES.CONFIRM}`).onclick = (
        e,
      ) => {
        e.stopPropagation();
        this.doExport();
      };
      this.map.on("move zoom", this.onMapChange);
      this.onMapChange(skipHint);
      if (!skipHint) this.showHintWithInfo(r, _(`${CONST.name}.hint_locked`));
    }

    unlockCropBox() {
      if (!this.cropState || !this.cropState.locked) return;
      this.cropState.locked = false;
      this.cropState.box.classList.remove("locked");
      this.map.off("move zoom", this.onMapChange);
      this.cropState.actions.innerHTML = "";
      foliplus.dom.el(
        "button",
        {
          class: `${CONST.CLASSES.TOOL_BTN} ${CONST.CLASSES.CONFIRM}`,
          title: _(`${CONST.name}.btn_confirm`),
          parent: this.cropState.actions,
        },
        { html: SVGS.CHECK },
      );
      foliplus.dom.el(
        "button",
        {
          class: `${CONST.CLASSES.TOOL_BTN} ${CONST.CLASSES.CANCEL}`,
          title: _(`${CONST.name}.btn_cancel`),
          parent: this.cropState.actions,
        },
        { html: foliplus.SVGs.CLOSE },
      );
      this.cropState.actions.querySelector(`.${CONST.CLASSES.CANCEL}`).onclick = (
        e,
      ) => {
        e.stopPropagation();
        this.removeCropBox();
      };
      this.cropState.actions.querySelector(`.${CONST.CLASSES.CONFIRM}`).onclick = (
        e,
      ) => {
        e.stopPropagation();
        this.lockCropBox();
      };
      this.updateBoxStyle(this.cropState.box, this.cropState.rect);
      this.showHintWithInfo(this.cropState.rect, _(`${CONST.name}.hint_unlocked`));
    }

    removeCropBox() {
      if (!this.cropState) return;
      this.lastScreenRect = Object.assign({}, this.cropState.rect);
      this.mapContainer.classList.remove(CONST.CLASSES.EXPORT_MODE);
      document.body.classList.remove(CONST.CLASSES.EXPORT_MODE);
      document.removeEventListener("keydown", this.onKeyDown);
      this.map.off("move zoom", this.onMapChange);
      if (this.cropState.box)
        this.cropState.box.removeEventListener("mousedown", this.onMouseDown);
      if (this.cropState.overlay?.parentNode) this.cropState.overlay.remove();
      if (this.cropState.box?.parentNode) this.cropState.box.remove();
      if (this.cropState.actions) this.cropState.actions.innerHTML = "";
      if (this.exportCtrl) {
        this.exportCtrl.classList.remove(CONST.CLASSES.EXPANDED);
        this.exportCtrl.classList.add(CONST.CLASSES.COLLAPSED);
      }
      this.cropState = null;
      foliplus.hideHint(CONST.name);
    }

    onMouseDown(e) {
      if (this.cropState.locked) return;
      e.preventDefault();
      e.stopPropagation();
      const target = e.target;
      if (target.classList.contains("foliplus-export-handle")) {
        this.dragState.dragType = target.dataset.pos;
      } else if (
        target.classList.contains(CONST.CLASSES.EXPORT_CENTER) ||
        target.classList.contains(CONST.CLASSES.EXPORT_BOX)
      ) {
        this.dragState.dragType = "move";
      } else return;
      this.dragState.dragging = true;
      this.dragState.startX = e.clientX;
      this.dragState.startY = e.clientY;
      this.dragState.startRect = Object.assign({}, this.cropState.rect);
      document.addEventListener("mousemove", this.onMouseMove);
      document.addEventListener("mouseup", this.onMouseUp);
    }

    onMouseMove(e) {
      if (!this.dragState.dragging) return;
      const dx = e.clientX - this.dragState.startX;
      const dy = e.clientY - this.dragState.startY;
      const mapRect = this.mapContainer.getBoundingClientRect();
      const startRect = this.dragState.startRect;
      const r = Object.assign({}, startRect);
      const type = this.dragState.dragType;
      if (type === "move") {
        r.left = Math.max(0, Math.min(mapRect.width - r.width, startRect.left + dx));
        r.top = Math.max(0, Math.min(mapRect.height - r.height, startRect.top + dy));
      } else {
        if (["tl", "l", "bl"].includes(type)) {
          const maxDx = startRect.width - CONST.CROP.MIN_SIZE;
          const a = Math.max(-startRect.left, Math.min(dx, maxDx));
          r.left = startRect.left + a;
          r.width = startRect.width - a;
        }
        if (["tr", "r", "br"].includes(type)) {
          const maxDx = mapRect.width - (startRect.left + startRect.width);
          const minDx = CONST.CROP.MIN_SIZE - startRect.width;
          const a = Math.max(minDx, Math.min(dx, maxDx));
          r.width = startRect.width + a;
        }
        if (["tl", "t", "tr"].includes(type)) {
          const maxDy = startRect.height - CONST.CROP.MIN_SIZE;
          const a = Math.max(-startRect.top, Math.min(dy, maxDy));
          r.top = startRect.top + a;
          r.height = startRect.height - a;
        }
        if (["bl", "b", "br"].includes(type)) {
          const maxDy = mapRect.height - (startRect.top + startRect.height);
          const minDy = CONST.CROP.MIN_SIZE - startRect.height;
          const a = Math.max(minDy, Math.min(dy, maxDy));
          r.height = startRect.height + a;
        }
      }
      this.cropState.rect = r;
      this.updateBoxStyle(this.cropState.box, r);
      this.showHintWithInfo(r, _(`${CONST.name}.hint_unlocked`));
    }

    onMouseUp() {
      this.dragState.dragging = false;
      this.dragState.dragType = null;
      document.removeEventListener("mousemove", this.onMouseMove);
      document.removeEventListener("mouseup", this.onMouseUp);
    }

    onKeyDown(e) {
      if (e.key === "Escape") {
        if (this.cropState?.locked) this.unlockCropBox();
        else this.removeCropBox();
      } else if (e.key === "Enter") {
        if (this.cropState && !this.cropState.locked) this.lockCropBox();
        else if (this.cropState?.locked) this.doExport();
      }
    }

    onMapChange(skipHint) {
      if (!this.cropState || !this.cropState.locked) return;
      const nw = this.cropState.geoBounds.nw;
      const se = this.cropState.geoBounds.se;
      const tl = this.map.latLngToContainerPoint(L.latLng(nw.lat, nw.lng));
      const br = this.map.latLngToContainerPoint(L.latLng(se.lat, se.lng));
      const newRect = {
        left: tl.x,
        top: tl.y,
        width: Math.abs(br.x - tl.x),
        height: Math.abs(br.y - tl.y),
      };
      this.cropState.rect = newRect;
      this.updateBoxStyle(this.cropState.box, newRect);
      if (!skipHint) this.showHintWithInfo(newRect, _(`${CONST.name}.hint_locked`));
    }

    doExport() {
      if (this.isExporting || !this.cropState) return;
      this.isExporting = true;
      const r = Object.assign({}, this.cropState.rect);
      const geoBounds = this.cropState.geoBounds;
      // Save bounds on successful export so next click goes directly to download
      if (geoBounds) {
        this.saveBounds(geoBounds);
        this.savedBounds = geoBounds;
      }
      this.removeCropBox();

      let scaleValue = CONST.SCALE;
      if (typeof scaleValue !== "number" || isNaN(scaleValue))
        scaleValue = window.devicePixelRatio || 1;
      const bg = CONST.BACKGROUND;

      this.showGlobalHint(
        _(`${CONST.name}.status_exporting`),
        foliplus.HINT_DURATION.PERSIST,
        true,
      );

      // Detect if crop area extends beyond the viewport.
      // Only enlarge container when absolutely necessary (crop > viewport).
      const vpW = this.mapContainer.clientWidth;
      const vpH = this.mapContainer.clientHeight;
      const needsBigger =
        r.width > vpW * 1.02 ||
        r.height > vpH * 1.02 ||
        r.left < -vpW * 0.02 ||
        r.top < -vpH * 0.02 ||
        r.left + r.width > vpW * 1.02 ||
        r.top + r.height > vpH * 1.02;

      const doRender = () => {
        const hideEls = this.mapContainer.querySelectorAll(CONST.SEL.CONTROL);
        hideEls.forEach((el) => {
          el.classList.add("foliplus-export-hidden");
        });

        if (geoBounds && geoBounds.nw) {
          const nw = this.map.latLngToContainerPoint(
            L.latLng(geoBounds.nw.lat, geoBounds.nw.lng),
          );
          const se = this.map.latLngToContainerPoint(
            L.latLng(geoBounds.se.lat, geoBounds.se.lng),
          );
          r.left = Math.min(nw.x, se.x);
          r.top = Math.min(nw.y, se.y);
          r.width = Math.abs(se.x - nw.x);
          r.height = Math.abs(se.y - nw.y);
        }

        new LeafletRenderer(this.map)
          .render(r, scaleValue, bg || undefined, geoBounds)
          .then((canvas) => {
            hideEls.forEach((el) => {
              el.classList.remove("foliplus-export-hidden");
            });
            const prevImg = document.createElement("img");
            prevImg.src = canvas.toDataURL("image/png");
            prevImg.className = CONST.CLASSES.PREVIEW;
            document.body.appendChild(prevImg);
            setTimeout(() => prevImg.remove(), foliplus.HINT_DURATION.SHORT);
            canvas.toBlob((blob) => {
              if (!blob) {
                this.showGlobalHint(
                  _(`${CONST.name}.status_fail`) + _(`${CONST.name}.err_gen_fail`),
                  foliplus.HINT_DURATION.LONG,
                  false,
                );
                this.isExporting = false;
                return;
              }
              const link = document.createElement("a");
              const url = URL.createObjectURL(blob);
              link.download = CONST.FILENAME;
              link.href = url;
              link.rel = "noopener";
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              setTimeout(() => URL.revokeObjectURL(url), CONST.URL_REVOKE_DELAY);
              this.showGlobalHint(
                _(`${CONST.name}.status_success`),
                foliplus.HINT_DURATION.LONG,
                false,
              );
              this.isExporting = false;
            }, "image/png");
          })
          .catch((err) => {
            hideEls.forEach((el) => {
              el.classList.remove("foliplus-export-hidden");
            });
            console.error(`[${CONST.name}] ${_(`${CONST.name}.err_render`)}:`, err);
            this.showGlobalHint(
              _(`${CONST.name}.status_fail`) + (err.message || ""),
              foliplus.HINT_DURATION.LONG,
              false,
            );
            this.isExporting = false;
          });
      };

      if (needsBigger && geoBounds && geoBounds.nw) {
        const cropBounds = L.latLngBounds(
          L.latLng(geoBounds.nw.lat, geoBounds.nw.lng),
          L.latLng(geoBounds.se.lat, geoBounds.se.lng),
        );
        const savedStyles = {};
        ["width", "height", "minHeight", "maxHeight", "overflow"].forEach((p) => {
          savedStyles[p] = this.mapContainer.style[p];
        });
        const savedCenter = this.map.getCenter();
        const savedZoom = this.map.getZoom();
        const savedAnim = this.map.options.zoomAnimation;
        this.map.options.zoomAnimation = false;

        const bigW = Math.max(vpW, r.left + r.width) + CONST.CROP.CONTAINER_PADDING;
        const bigH = Math.max(vpH, r.top + r.height) + CONST.CROP.CONTAINER_PADDING;
        this.mapContainer.style.width = `${Math.ceil(bigW)}px`;
        this.mapContainer.style.height = `${Math.ceil(bigH)}px`;
        this.mapContainer.style.minHeight = `${Math.ceil(bigH)}px`;
        this.mapContainer.style.overflow = "hidden";

        const cropCenter = cropBounds.getCenter();
        this.map.invalidateSize(false);
        this.map.once("moveend", () => {
          setTimeout(() => {
            doRender();
            setTimeout(() => {
              this.map.options.zoomAnimation = savedAnim;
              Object.keys(savedStyles).forEach((p) => {
                this.mapContainer.style[p] = savedStyles[p];
              });
              this.map.invalidateSize(false);
              this.map.setView(savedCenter, savedZoom, { animate: false });
            }, CONST.TIMING.RESTORE_DELAY);
          }, CONST.TIMING.RENDER_DELAY);
        });
        this.map.setView(cropCenter, savedZoom, { animate: false });
        return;
      }

      doRender();
    }
  }

  // ==================== Leaflet Control ====================
  const exportManager = new ExportManager(map);

  class ExportControl extends L.Control {
    onAdd() {
      const { container, ctrl, toolBar, toggleBtn } = foliplus.createFoldControl({
        cssClass: `foliplus-export-ctrl`,
        toggleTitle: _(`${CONST.name}.btn_title`),
        toggleSvg: SVGS.CAMERA,
        isLeft: CONST.position.indexOf("left") >= 0,
      });
      toolBar.classList.add(CONST.CLASSES.ACTIONS);
      exportManager.attachUI(ctrl, toolBar);
      toggleBtn.onclick = () => {
        if (exportManager.cropState) {
          exportManager.removeCropBox();
        } else if (exportManager.savedBounds) {
          exportManager.showCropBox();
          requestAnimationFrame(() => {
            if (exportManager.cropState && !exportManager.cropState.locked) {
              exportManager.cropState._savedGeoBounds = {
                nw: {
                  lat: exportManager.savedBounds.nw.lat,
                  lng: exportManager.savedBounds.nw.lng,
                },
                se: {
                  lat: exportManager.savedBounds.se.lat,
                  lng: exportManager.savedBounds.se.lng,
                },
              };
              exportManager.lockCropBox(true);
              foliplus.showHint(
                CONST.name,
                _(`${CONST.name}.hint_restore`),
                foliplus.HINT_DURATION.MEDIUM,
                true,
              );
            }
          });
        } else exportManager.showCropBox();
      };
      return container;
    }
    onRemove() {
      if (exportManager.cropState) exportManager.removeCropBox();
      document.removeEventListener("keydown", exportManager.onKeyDown);
    }
  }

  new ExportControl({ position: CONST.position }).addTo(map);
})();

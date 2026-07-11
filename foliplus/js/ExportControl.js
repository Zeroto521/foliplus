(function() {
  // ==================== Runtime Guard ====================
  if (!window.foliplus || !window.foliplus.SVGs) {
    console.error('[ExportControl] foliplus runtime not found, plugin disabled.');
    return;
  }

  // ==================== Constants ====================
  const CONST = {
    CROP_MIN_SIZE: 40,
    HINT_ERROR_DURATION: 5000,
    HINT_SUCCESS_DURATION: 4000,
    URL_REVOKE_DELAY: 10000,
    DEFAULT_SCALE: window.devicePixelRatio || 1,
    STORAGE_KEY: '_export_crop_rect',
    CROP_PADDING_RATIO: 0.25,
  };

  // ==================== Dependencies ====================
  const map = {{ this._parent.get_name() }};
  const _ = (k) => (window.foliplus && window.foliplus.gt) ? window.foliplus.gt(k) : k;

  const SVGS = {
    CAMERA: `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>`,
    CHECK: `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2.8"
        stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>`,
    DOWNLOAD: `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>`
  };

  window.foliplus.registerHintIcon('export', SVGS.CAMERA);

  // ==================== CORS Pre-setup ====================
  // Set crossOrigin on ALL existing TileLayers so tiles load with CORS
  // from the start. This is THE KEY to avoiding canvas taint — if tiles
  // are loaded without CORS, drawImage will taint the canvas and
  // toBlob() will return null (blank image).
  //
  // We also intercept future layer additions to set crossOrigin.
  map.eachLayer(layer => {
    if (layer instanceof L.TileLayer && !layer.options.crossOrigin) {
      layer.options.crossOrigin = 'anonymous';
      if (map.hasLayer(layer)) {
        map.removeLayer(layer);
        map.addLayer(layer);
      }
    }
  });
  map.on('layeradd', e => {
    if (e.layer instanceof L.TileLayer && !e.layer.options.crossOrigin) {
      e.layer.options.crossOrigin = 'anonymous';
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
    _getTileLayer() {
      let tileLayer = null;
      this.map.eachLayer(l => {
        if (l instanceof L.TileLayer && this.map.hasLayer(l)) tileLayer = l;
      });
      return tileLayer;
    }

    // Calculate all tile coordinates that cover the given geo bounds at the given zoom.
    // Returns [{x, y, url}]
    _calcTiles(tileLayer, bounds, zoom) {
      const crs = this.map.options.crs || L.CRS.EPSG3857;
      const tileSize = tileLayer.options.tileSize || 256;
      const subdomains = tileLayer.options.subdomains || 'abc';
      const urlTemplate = tileLayer._url || '';

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
          const subIdx = ((tx + ty) % (typeof subdomains === 'string' ? subdomains.length : 1));
          const sub = typeof subdomains === 'string' ? subdomains[subIdx] : subdomains[0];
          url = url.replace('{s}', sub).replace('{x}', tx).replace('{y}', ty).replace('{z}', zoom);
          // Also handle {r} for retina — Leaflet replaces with @2x on retina
          const isRetina = window.devicePixelRatio > 1;
          url = url.replace('{r}', isRetina ? '@2x' : '');
          // Tile pixel position within the container viewport at this zoom
          const tileLeft = tx * tileSize;
          const tileTop = ty * tileSize;
          tiles.push({ x: tx, y: ty, z: zoom, url, left: tileLeft, top: tileTop, size: tileSize });
        }
      }
      return tiles;
    }

    async render(rect, scale, bg, geoBounds) {
      const sw = Math.round(rect.width * scale);
      const sh = Math.round(rect.height * scale);
      if (sw < 1 || sh < 1) throw new Error('Crop area too small');

      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');

      if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, sw, sh); }

      const cw = rect.width * scale;
      const ch = rect.height * scale;
      const contRect = this.container.getBoundingClientRect();
      const contW = contRect.width;
      const contH = contRect.height;

      // Layer 1: Tiles — If geo bounds are available, compute tile
      // coordinates ourselves so we can export areas beyond the viewport.
      // Otherwise fall back to DOM images.
      let imgOk = 0, imgFail = 0;


      if (geoBounds && geoBounds.nw) {
        const tileLayer = this._getTileLayer();
        if (tileLayer) {
          const zoom = this.map.getZoom();
          const tiles = this._calcTiles(tileLayer, geoBounds, zoom);
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
            if (tileVpX + tile.size < rect.left || tileVpY + tile.size < rect.top) continue;
            if (tileVpX > rect.left + rect.width || tileVpY > rect.top + rect.height) continue;

            try {
              const resp = await fetch(tile.url, { mode: 'cors', cache: 'force-cache' });
              if (!resp.ok) { imgFail++; continue; }
              const blob = await resp.blob();
              const bitmap = await createImageBitmap(blob);
              ctx.drawImage(bitmap, dx, dy, dw, dh);
              bitmap.close();
              imgOk++;
            } catch { imgFail++; }
          }
        }
      } else {
        // Fallback: use DOM images (original approach)
        const uniqueSrc = new Set();
        for (const img of this.container.querySelectorAll('img')) {
          if (img.src && img.complete && img.naturalWidth) uniqueSrc.add(img.src);
        }
        for (const src of uniqueSrc) {
          const el = [...this.container.querySelectorAll('img')].find(
            i => i.src === src && i.complete && i.naturalWidth);
          if (!el) { imgFail++; continue; }
          const r = el.getBoundingClientRect();
          const l = r.left - contRect.left;
          const t = r.top - contRect.top;
          const w = el.naturalWidth || r.width || 256;
          const h = el.naturalHeight || r.height || 256;
          if (w < 1 || h < 1) { imgFail++; continue; }
          const dx = (l - rect.left) * scale;
          const dy = (t - rect.top) * scale;
          const dw = (r.width || w) * scale;
          const dh = (r.height || h) * scale;
          if (dx + dw < 0 || dy + dh < 0 || dx > cw || dy > ch) { imgFail++; continue; }
          try {
            const resp = await fetch(src, { mode: 'cors', cache: 'force-cache' });
            if (!resp.ok) { imgFail++; continue; }
            const blob = await resp.blob();
            const bitmap = await createImageBitmap(blob);
            ctx.drawImage(bitmap, dx, dy, dw, dh);
            bitmap.close();
            imgOk++;
          } catch { imgFail++; }
        }
      }

      console.log('[Export] images drawn:', imgOk, 'fail:', imgFail);

      // Layer 2: SVG overlay — search ALL panes for SVG elements.
      // Leaflet's SVG layers have viewBox = "0 0 <w> <h>" and paths
      // are positioned in container-relative pixel coordinates.
      // We serialize each SVG, set explicit width/height (keeping viewBox),
      // then crop to the export area.
      const panes = this.container.querySelectorAll('.leaflet-map-pane [class*="pane"]');
      let svgCount = 0;
      for (const pane of panes) {
        const svgEl = pane.querySelector('svg');
        if (!svgEl) continue;
        const svgRect = svgEl.getBoundingClientRect();
        const svgL = svgRect.left - contRect.left;
        const svgT = svgRect.top - contRect.top;
        if (svgRect.width < 1 || svgRect.height < 1) continue;

        const clone = svgEl.cloneNode(true);
        clone.removeAttribute('style');
        // Keep viewBox, set width/height to actual display size
        clone.setAttribute('width', String(svgRect.width));
        clone.setAttribute('height', String(svgRect.height));

        let src = new XMLSerializer().serializeToString(clone);
        if (!src.includes('xmlns="http://www.w3.org/2000/svg"')) {
          src = src.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
        }
        console.log('[Export] SVG pane:', pane.className, 'len:', src.length);
        if (src.length < 100) continue;

        const blob = new Blob([src], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        try {
          const svgImg = await new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error('SVG load failed'));
            i.src = url;
          });
          // Crop to export rect in the SVG's coordinate space:
          // The SVG is positioned at (svgL, svgT) within the container.
          // We want to extract (rect.left - svgL, rect.top - svgT, rect.w, rect.h).
          ctx.drawImage(svgImg,
            rect.left - svgL, rect.top - svgT, rect.width, rect.height,
            0, 0, sw, sh);
          svgCount++;
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      console.log('[Export] SVGs drawn:', svgCount);

      // Layer 3: Markers — draw each element with background-image
      // direct sprite cropping via createImageBitmap (always origin-clean).
      //
      // Formula:
      //   spriteCSS_W = background-size CSS pixel width (natural if 'auto')
      //   ratio = spriteNaturalWidth / spriteCSS_W
      //   sourceX = abs(background-position-x) * ratio
      //   sourceY = abs(background-position-y) * ratio
      //   sourceW = renderWidth * ratio
      //   sourceH = renderHeight * ratio
      //
      // Collect drawable marker elements (roots + sub-elements with bg)
      const drawableEls = [];
      const mp = this.container.querySelector('.leaflet-marker-pane');
      console.log('[Export] marker-pane found:', !!mp, '| container:', this.container.className);
      const markerRoots = mp
        ? mp.querySelectorAll('.awesome-marker, .leaflet-marker-icon, .marker-icon, [class*="marker"]')
        : this.container.querySelectorAll('.awesome-marker, .leaflet-marker-icon, .marker-icon, [class*="marker"]');
      console.log('[Export] marker roots found:', markerRoots.length);
      for (const root of markerRoots) {
        drawableEls.push(root);
        for (const sub of root.querySelectorAll('*')) {
          const scs = window.getComputedStyle(sub);
          if (scs.backgroundImage && scs.backgroundImage.includes('url(') && scs.backgroundImage !== 'none') {
            drawableEls.push(sub);
          }
        }
      }
      console.log('[Export] total drawable marker elements:', drawableEls.length);
      // First pass: load unique sprites
      const spriteMap = new Map();
      const loadQueue = [];
      for (const el of drawableEls) {
        const cs = window.getComputedStyle(el);
        const bg = cs.backgroundImage;
        if (!bg || bg === 'none') continue;
        const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
        if (m && !m[1].startsWith('data:') && !spriteMap.has(m[1])) {
          const url = m[1];
          spriteMap.set(url, null);
          loadQueue.push(
            fetch(url, { mode: 'cors', cache: 'force-cache' })
              .then(r => r.ok ? r.blob() : null)
              .then(blob => blob ? createImageBitmap(blob) : null)
              .then(bmp => spriteMap.set(url, bmp))
              .catch(() => {})
          );
        }
      }
      await Promise.all(loadQueue);
      // Second pass: draw sprite backgrounds
      let markerOk = 0, markerFail = 0;
      // Store drawn marker root positions for FontAwesome overlay
      const drawnMarkers = []; // {dx, dy, dw, dh, root}
      for (const el of drawableEls) {
        const r = el.getBoundingClientRect();
        const l = r.left - contRect.left;
        const t = r.top - contRect.top;
        const w = r.width; const h = r.height;
        if (w < 1 || h < 1) continue;
        const dx = (l - rect.left) * scale;
        const dy = (t - rect.top) * scale;
        const dw = w * scale; const dh = h * scale;
        if (dx + dw < 0 || dy + dh < 0 || dx > cw || dy > ch) continue;
        const cs = window.getComputedStyle(el);
        const bg = cs.backgroundImage;
        if (!bg || bg === 'none') continue;
        const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
        if (!m) continue;
        const sprite = spriteMap.get(m[1]);
        if (!sprite) { markerFail++; continue; }
        const bgs = cs.backgroundSize || 'auto';
        const bgsParts = bgs.trim().split(/\s+/);
        let cssBgW, cssBgH;
        if (bgs === 'auto' || bgs === 'auto auto') {
          const dpr = window.devicePixelRatio || 1;
          cssBgW = sprite.width / dpr;
          cssBgH = sprite.height / dpr;
        } else if (bgs.includes('%')) {
          cssBgW = w * (parseFloat(bgsParts[0]) || 100) / 100;
          cssBgH = h * (parseFloat(bgsParts[1] || bgsParts[0]) || 100) / 100;
        } else {
          cssBgW = parseFloat(bgsParts[0]) || sprite.width;
          cssBgH = parseFloat(bgsParts[1] || bgsParts[0]) || sprite.height;
        }
        const ratioX = sprite.width / cssBgW;
        const ratioY = sprite.height / cssBgH;
        const bp = cs.backgroundPosition || '0 0';
        const bpParts = bp.trim().split(/\s+/);
        const sx = Math.abs(parseFloat(bpParts[0]) || 0) * ratioX;
        const sy = Math.abs(parseFloat(bpParts[1]) || 0) * ratioY;
        const sw = w * ratioX;
        const sh = h * ratioY;
        if (sx + sw > sprite.width || sy + sh > sprite.height) { markerFail++; continue; }
        try {
          ctx.drawImage(sprite, sx, sy, sw, sh, dx, dy, dw, dh);
          markerOk++;
        } catch { markerFail++; }
      }

      // Layer 3b: FontAwesome icons — draw ::before pseudo-element text
      // for each marker root's <i> element (the icon inside the pin).
      let faCount = 0;
      for (const root of markerRoots) {
        const r = root.getBoundingClientRect();
        const l = r.left - contRect.left;
        const t = r.top - contRect.top;
        const w = r.width; const h = r.height;
        if (w < 1 || h < 1) continue;
        const dx = (l - rect.left) * scale;
        const dy = (t - rect.top) * scale;
        const dw = w * scale; const dh = h * scale;
        if (dx + dw < 0 || dy + dh < 0 || dx > cw || dy > ch) continue;

        // Find the <i> icon element inside the marker
        const iconEl = root.querySelector('i');
        if (!iconEl) continue;

        // Read ::before pseudo-element styles
        const before = window.getComputedStyle(iconEl, '::before');
        const content = before.content;
        console.log('[Export] FA icon:', iconEl.className, 'content:', content,
          'fontFamily:', before.fontFamily,
          'fontSize:', before.fontSize,
          'color:', before.color);

        // FontAwesome uses CSS content like "\f276" for glyph codepoints.
        // Browser returns content as '"\\f276"' (quoted + escaped).
        let iconText = '';
        if (content && content !== 'none') {
          const raw = content.replace(/['"]/g, '');  // "\\f276" -> \\f276
          // Try direct unicode (FontAwesome 5+ ligature mode)
          if (raw.length === 1) {
            iconText = raw;
          }
          // Try escaped codepoint (FontAwesome 4.7 style)
          const match = raw.match(/^\\([0-9a-fA-F]+)/);
          if (match) {
            iconText = String.fromCharCode(parseInt(match[1], 16));
          }
          // Try '\\XXXX' (double-escaped from getComputedStyle)
          const match2 = raw.match(/^\\\\f([0-9a-fA-F]+)/);
          if (match2) {
            iconText = String.fromCharCode(parseInt('f' + match2[1], 16));
          }
        }
        console.log('[Export] FA parsed iconText:', JSON.stringify(iconText), 'length:', iconText.length);

        // Get icon styles from the <i> element (font-family, size, color)
        const iconCS = window.getComputedStyle(iconEl);
        let fontSize = parseFloat(iconCS.fontSize) || 14;
        let fontFamily = iconCS.fontFamily || 'FontAwesome';
        const color = iconCS.color || '#fff';
        // FontAwesome 6 Solid requires weight 900; get it from ::before
        let fontWeight = before.fontWeight || iconCS.fontWeight || '900';
        if (fontWeight === 'normal') fontWeight = '400';
        if (fontWeight === 'bold') fontWeight = '700';

        // getComputedStyle already returns the font-family as a CSS-safe value
        // (may include quotes for names with spaces). Do NOT add extra quotes.

        // Center the icon within the marker
        let iconDX = dx;
        let iconDY = dy;
        let iconDW = dw;
        let iconDH = dh;

        // If the <i> has its own positioning, use the iconEl's rect
        const ir = iconEl.getBoundingClientRect();
        const il = ir.left - contRect.left;
        const it = ir.top - contRect.top;
        if (ir.width > 0 && ir.height > 0) {
          iconDX = (il - rect.left) * scale;
          iconDY = (it - rect.top) * scale;
          iconDW = ir.width * scale;
          iconDH = ir.height * scale;
        }

        // Scale font size for high-DPI
        fontSize = fontSize * scale;

        // Ensure font is loaded in canvas context before drawing.
        // FontAwesome loads asynchronously via @font-face; without this
        // wait, canvas fillText may render a blank/tofu glyph.
        const fontSpec = fontWeight + ' ' + fontSize + 'px ' + fontFamily;
        try {
          await document.fonts.load(fontSpec);
        } catch { /* font may not load, try drawing anyway */ }
        // If still not loaded, wait for ready
        if (!document.fonts.check(fontSpec)) {
          try { await document.fonts.ready; } catch {}
        }

        ctx.save();
        ctx.font = fontSpec;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = color;

        // Center text in the icon area
        const cx = iconDX + iconDW / 2;
        const cy = iconDY + iconDH / 2;
        ctx.fillText(iconText, cx, cy);
        ctx.restore();
        faCount++;
      }
      console.log('[Export] FontAwesome icons drawn:', faCount);

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
      this._loadSavedBounds();

      this.dragState = {
        dragging: false, dragType: null,
        startX: 0, startY: 0, startRect: null
      };

      this._onMouseDown = this._onMouseDown.bind(this);
      this._onMouseMove = this._onMouseMove.bind(this);
      this._onMouseUp = this._onMouseUp.bind(this);
      this._onKeyDown = this._onKeyDown.bind(this);
      this._onMapChange = this._onMapChange.bind(this);
    }

    attachUI(ctrl, toolBar) {
      this.exportCtrl = ctrl;
      this.exportToolBar = toolBar;
    }

    _loadSavedBounds() {
      try {
        const data = localStorage.getItem(CONST.STORAGE_KEY);
        if (!data) return;
        const saved = JSON.parse(data);
        if (!saved || !saved.nw || !saved.se) return;
        const nw = saved.nw, se = saved.se;
        const validLat = nw.lat >= -90 && nw.lat <= 90 && se.lat >= -90 && se.lat <= 90;
        const validLng = nw.lng >= -180 && nw.lng <= 180 && se.lng >= -180 && se.lng <= 180;
        if (!validLat || !validLng) return;
        const mapB = this.map.getBounds();
        const overlap =
          nw.lat >= mapB.getSouth() && se.lat <= mapB.getNorth() &&
          nw.lng <= mapB.getEast() && se.lng >= mapB.getWest();
        if (!overlap) return;
        this.savedBounds = saved;
      } catch (e) {
        console.warn('[ExportControl] failed to load export bounds:', e);
      }
    }

    _saveBounds(bounds) {
      try {
        localStorage.setItem(CONST.STORAGE_KEY, JSON.stringify({
          nw: { lat: bounds.nw.lat, lng: bounds.nw.lng },
          se: { lat: bounds.se.lat, lng: bounds.se.lng },
        }));
      } catch (e) {
        console.warn('[ExportControl] failed to save export bounds:', e);
      }
    }

    _showGlobalHint(text, duration, withLoadingIcon) {
      const loading = withLoadingIcon && window.foliplus.SVGs
        ? (window.foliplus.SVGs.LOADING + ' ') : '';
      window.foliplus.showHint('export', loading + text, duration || 0);
    }

    _showHintWithInfo(r, instruction) {
      window.foliplus.showHint(
        'export',
        `${_('export.label_size_prefix')}${Math.round(r.width)} × ${Math.round(r.height)} `
        + `${_('export.label_size_suffix')}${instruction ? ` — ${instruction}` : ''}`,
        0
      );
    }

    _updateBoxStyle(el, r) {
      el.style.left = r.left + 'px';
      el.style.top = r.top + 'px';
      el.style.width = r.width + 'px';
      el.style.height = r.height + 'px';
      if (this.cropState && this.cropState.overlay) {
        this.cropState.overlay.style.left = '0';
        this.cropState.overlay.style.top = '0';
        this.cropState.overlay.style.width = this.mapContainer.clientWidth + 'px';
        this.cropState.overlay.style.height = this.mapContainer.clientHeight + 'px';
      }
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
          L.latLng(this.savedBounds.nw.lat, this.savedBounds.nw.lng));
        const se = this.map.latLngToContainerPoint(
          L.latLng(this.savedBounds.se.lat, this.savedBounds.se.lng));
        box = {
          left: Math.min(nw.x, se.x),
          top: Math.min(nw.y, se.y),
          width: Math.max(1, Math.abs(se.x - nw.x)),
          height: Math.max(1, Math.abs(se.y - nw.y)),
        };
      } else if (this.lastScreenRect) {
        box = {
          left: Math.max(0, Math.min(this.lastScreenRect.left, mapRect.width - CONST.CROP_MIN_SIZE)),
          top: Math.max(0, Math.min(this.lastScreenRect.top, mapRect.height - CONST.CROP_MIN_SIZE)),
          width: this.lastScreenRect.width, height: this.lastScreenRect.height
        };
        box.width = Math.max(CONST.CROP_MIN_SIZE, Math.min(box.width, mapRect.width - box.left));
        box.height = Math.max(CONST.CROP_MIN_SIZE, Math.min(box.height, mapRect.height - box.top));
      } else {
        const padW = mapRect.width * CONST.CROP_PADDING_RATIO;
        const padH = mapRect.height * CONST.CROP_PADDING_RATIO;
        box = { left: padW, top: padH, width: mapRect.width - padW * 2, height: mapRect.height - padH * 2 };
      }

      const overlay = document.createElement('div');
      overlay.className = 'export-crop-overlay active';
      overlay.style.left = '0'; overlay.style.top = '0';
      overlay.style.width = this.mapContainer.clientWidth + 'px';
      overlay.style.height = this.mapContainer.clientHeight + 'px';
      this.mapContainer.appendChild(overlay);
      this.mapContainer.classList.add('has-export-mode');
      document.body.classList.add('has-export-mode');

      const cropBox = document.createElement('div');
      cropBox.className = 'export-crop-box';
      this.mapContainer.appendChild(cropBox);

      ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'].forEach(pos => {
        const h = document.createElement('div');
        h.className = `export-crop-handle ${pos}`;
        h.dataset.pos = pos;
        cropBox.appendChild(h);
      });

      const center = document.createElement('div');
      center.className = 'export-crop-center';
      cropBox.appendChild(center);

      this.exportToolBar.innerHTML = `
        <button class="confirm" title="${_('export.btn_confirm')}">${SVGS.CHECK}</button>
        <button class="cancel" title="${_('export.btn_cancel')}">${window.foliplus.SVGs.CLOSE}</button>`;
      this.exportCtrl.classList.remove('collapsed');
      this.exportCtrl.classList.add('expanded');

      this.cropState = { overlay, box: cropBox, rect: box, locked: false, actions: this.exportToolBar };
      this._updateBoxStyle(cropBox, box);
      this._showHintWithInfo(box, _('export.hint_unlocked'));
      cropBox.addEventListener('mousedown', this._onMouseDown);
      this.exportToolBar.querySelector('.cancel').onclick = e => { e.stopPropagation(); this.removeCropBox(); };
      this.exportToolBar.querySelector('.confirm').onclick = e => { e.stopPropagation(); this.lockCropBox(); };
      document.addEventListener('keydown', this._onKeyDown);
    }

    lockCropBox() {
      if (!this.cropState || this.cropState.locked) return;
      this.cropState.locked = true;
      this.cropState.box.classList.add('locked');
      const r = this.cropState.rect;
      // Save the exact geo bounds at lock time. These are the authoritative
      // coordinates used for export and restoration.
      if (!this.cropState._savedGeoBounds) {
        this.cropState._savedGeoBounds = {
          nw: this.map.containerPointToLatLng(L.point(r.left, r.top)),
          se: this.map.containerPointToLatLng(L.point(r.left + r.width, r.top + r.height)),
        };
      }
      this.cropState.geoBounds = this.cropState._savedGeoBounds;
      this.cropState.actions.innerHTML = `
        <button class="confirm" title="${_('export.btn_export')}">${SVGS.DOWNLOAD}</button>
        <button class="cancel" title="${_('export.btn_cancel')}">${window.foliplus.SVGs.CLOSE}</button>`;
      this.cropState.actions.querySelector('.cancel').onclick = e => { e.stopPropagation(); this.unlockCropBox(); };
      this.cropState.actions.querySelector('.confirm').onclick = e => { e.stopPropagation(); this.doExport(); };
      this.map.on('move zoom', this._onMapChange);
      this._onMapChange();
      this._showHintWithInfo(r, _('export.hint_locked'));
    }

    unlockCropBox() {
      if (!this.cropState || !this.cropState.locked) return;
      this.cropState.locked = false;
      this.cropState.box.classList.remove('locked');
      this.map.off('move zoom', this._onMapChange);
      this.cropState.actions.innerHTML = `
        <button class="confirm" title="${_('export.btn_confirm')}">${SVGS.CHECK}</button>
        <button class="cancel" title="${_('export.btn_cancel')}">${window.foliplus.SVGs.CLOSE}</button>`;
      this.cropState.actions.querySelector('.cancel').onclick = e => { e.stopPropagation(); this.removeCropBox(); };
      this.cropState.actions.querySelector('.confirm').onclick = e => { e.stopPropagation(); this.lockCropBox(); };
      this._updateBoxStyle(this.cropState.box, this.cropState.rect);
      this._showHintWithInfo(this.cropState.rect, _('export.hint_unlocked'));
    }

    removeCropBox() {
      if (!this.cropState) return;
      this.lastScreenRect = Object.assign({}, this.cropState.rect);
      if (this.cropState.geoBounds) {
        this._saveBounds(this.cropState.geoBounds);
        this.savedBounds = this.cropState.geoBounds;
      }
      this.mapContainer.classList.remove('has-export-mode');
      document.body.classList.remove('has-export-mode');
      document.removeEventListener('keydown', this._onKeyDown);
      this.map.off('move zoom', this._onMapChange);
      if (this.cropState.box) this.cropState.box.removeEventListener('mousedown', this._onMouseDown);
      if (this.cropState.overlay?.parentNode) this.cropState.overlay.parentNode.removeChild(this.cropState.overlay);
      if (this.cropState.box?.parentNode) this.cropState.box.parentNode.removeChild(this.cropState.box);
      if (this.cropState.actions) this.cropState.actions.innerHTML = '';
      if (this.exportCtrl) { this.exportCtrl.classList.remove('expanded'); this.exportCtrl.classList.add('collapsed'); }
      this.cropState = null;
      window.foliplus.hideHint('export');
    }

    _onMouseDown(e) {
      if (this.cropState.locked) return;
      e.preventDefault(); e.stopPropagation();
      const target = e.target;
      if (target.classList.contains('export-crop-handle')) {
        this.dragState.dragType = target.dataset.pos;
      } else if (target.classList.contains('export-crop-center') || target.classList.contains('export-crop-box')) {
        this.dragState.dragType = 'move';
      } else return;
      this.dragState.dragging = true;
      this.dragState.startX = e.clientX; this.dragState.startY = e.clientY;
      this.dragState.startRect = Object.assign({}, this.cropState.rect);
      document.addEventListener('mousemove', this._onMouseMove);
      document.addEventListener('mouseup', this._onMouseUp);
    }

    _onMouseMove(e) {
      if (!this.dragState.dragging) return;
      const dx = e.clientX - this.dragState.startX;
      const dy = e.clientY - this.dragState.startY;
      const mapRect = this.mapContainer.getBoundingClientRect();
      const startRect = this.dragState.startRect;
      const r = Object.assign({}, startRect);
      const type = this.dragState.dragType;
      if (type === 'move') {
        r.left = Math.max(0, Math.min(mapRect.width - r.width, startRect.left + dx));
        r.top = Math.max(0, Math.min(mapRect.height - r.height, startRect.top + dy));
      } else {
        if (['tl', 'l', 'bl'].includes(type)) {
          const maxDx = startRect.width - CONST.CROP_MIN_SIZE;
          const a = Math.max(-startRect.left, Math.min(dx, maxDx));
          r.left = startRect.left + a; r.width = startRect.width - a;
        }
        if (['tr', 'r', 'br'].includes(type)) {
          const maxDx = mapRect.width - (startRect.left + startRect.width);
          const minDx = CONST.CROP_MIN_SIZE - startRect.width;
          const a = Math.max(minDx, Math.min(dx, maxDx));
          r.width = startRect.width + a;
        }
        if (['tl', 't', 'tr'].includes(type)) {
          const maxDy = startRect.height - CONST.CROP_MIN_SIZE;
          const a = Math.max(-startRect.top, Math.min(dy, maxDy));
          r.top = startRect.top + a; r.height = startRect.height - a;
        }
        if (['bl', 'b', 'br'].includes(type)) {
          const maxDy = mapRect.height - (startRect.top + startRect.height);
          const minDy = CONST.CROP_MIN_SIZE - startRect.height;
          const a = Math.max(minDy, Math.min(dy, maxDy));
          r.height = startRect.height + a;
        }
      }
      this.cropState.rect = r;
      this._updateBoxStyle(this.cropState.box, r);
      this._showHintWithInfo(r, _('export.hint_unlocked'));
    }

    _onMouseUp() {
      this.dragState.dragging = false;
      this.dragState.dragType = null;
      document.removeEventListener('mousemove', this._onMouseMove);
      document.removeEventListener('mouseup', this._onMouseUp);
    }

    _onKeyDown(e) {
      if (e.key === 'Escape') {
        if (this.cropState?.locked) this.unlockCropBox();
        else this.removeCropBox();
      } else if (e.key === 'Enter') {
        if (this.cropState && !this.cropState.locked) this.lockCropBox();
        else if (this.cropState?.locked) this.doExport();
      }
    }

    _onMapChange() {
      if (!this.cropState || !this.cropState.locked) return;
      const nw = this.cropState.geoBounds.nw;
      const se = this.cropState.geoBounds.se;
      const tl = this.map.latLngToContainerPoint(L.latLng(nw.lat, nw.lng));
      const br = this.map.latLngToContainerPoint(L.latLng(se.lat, se.lng));
      const newRect = { left: tl.x, top: tl.y, width: Math.abs(br.x - tl.x), height: Math.abs(br.y - tl.y) };
      this.cropState.rect = newRect;
      this._updateBoxStyle(this.cropState.box, newRect);
      this._showHintWithInfo(newRect, _('export.hint_locked'));
    }

    doExport() {
      if (this.isExporting || !this.cropState) return;
      this.isExporting = true;
      const r = Object.assign({}, this.cropState.rect);
      const geoBounds = this.cropState.geoBounds;
      this.removeCropBox();

      let scaleValue = {{ this.scale }};
      if (typeof scaleValue !== 'number' || isNaN(scaleValue)) scaleValue = CONST.DEFAULT_SCALE;
      const bg = {{ '"' + this.background + '"' if this.background else "null" }};

      this._showGlobalHint(_('export.status_exporting'), 0, true);

      // Detect if crop area extends beyond the viewport.
      // Only enlarge container when absolutely necessary (crop > viewport).
      const vpW = this.mapContainer.clientWidth;
      const vpH = this.mapContainer.clientHeight;
      const needsBigger = (
        r.width > vpW * 1.02 || r.height > vpH * 1.02 ||
        r.left < -vpW * 0.02 || r.top < -vpH * 0.02 ||
        r.left + r.width > vpW * 1.02 || r.top + r.height > vpH * 1.02
      );

      const doRender = () => {
        const hideEls = this.mapContainer.querySelectorAll('.leaflet-control-container, .export-ctrl');
        hideEls.forEach(el => { el.style.display = 'none'; });

        if (geoBounds && geoBounds.nw) {
          const nw = this.map.latLngToContainerPoint(L.latLng(geoBounds.nw.lat, geoBounds.nw.lng));
          const se = this.map.latLngToContainerPoint(L.latLng(geoBounds.se.lat, geoBounds.se.lng));
          r.left = Math.min(nw.x, se.x);
          r.top = Math.min(nw.y, se.y);
          r.width = Math.abs(se.x - nw.x);
          r.height = Math.abs(se.y - nw.y);
        }

        new LeafletRenderer(this.map).render(r, scaleValue, bg || undefined, geoBounds)
          .then(canvas => {
            hideEls.forEach(el => { el.style.display = ''; });
            const prevImg = document.createElement('img');
            prevImg.src = canvas.toDataURL('image/png');
            prevImg.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:99999;max-width:400px;max-height:300px;border:2px solid red;background:#fff;box-shadow:0 0 20px rgba(0,0,0,.5)';
            document.body.appendChild(prevImg);
            setTimeout(() => prevImg.remove(), 3000);
            canvas.toBlob(blob => {
              if (!blob) {
                this._showGlobalHint(_('export.status_fail') + _('export.err_gen_fail'), CONST.HINT_ERROR_DURATION, false);
                this.isExporting = false; return;
              }
              const link = document.createElement('a');
              const url = URL.createObjectURL(blob);
              link.download = '{{ this.filename }}';
              link.href = url; link.rel = 'noopener';
              document.body.appendChild(link); link.click(); document.body.removeChild(link);
              setTimeout(() => URL.revokeObjectURL(url), CONST.URL_REVOKE_DELAY);
              this._showGlobalHint(_('export.status_success'), CONST.HINT_SUCCESS_DURATION, false);
              this.isExporting = false;
            }, 'image/png');
          })
          .catch(err => {
            hideEls.forEach(el => { el.style.display = ''; });
            console.error('[ExportControl] render failed:', err);
            this._showGlobalHint(_('export.status_fail') + (err.message || ''), CONST.HINT_ERROR_DURATION, false);
            this.isExporting = false;
          });
      };

      if (needsBigger && geoBounds && geoBounds.nw) {
        const cropBounds = L.latLngBounds(
          L.latLng(geoBounds.nw.lat, geoBounds.nw.lng),
          L.latLng(geoBounds.se.lat, geoBounds.se.lng)
        );
        const savedStyles = {};
        ['width','height','minHeight','maxHeight','overflow'].forEach(p => {
          savedStyles[p] = this.mapContainer.style[p];
        });
        const savedCenter = this.map.getCenter();
        const savedZoom = this.map.getZoom();
        const savedAnim = this.map.options.zoomAnimation;
        this.map.options.zoomAnimation = false;

        const bigW = Math.max(vpW, r.left + r.width) + 200;
        const bigH = Math.max(vpH, r.top + r.height) + 200;
        this.mapContainer.style.width = Math.ceil(bigW) + 'px';
        this.mapContainer.style.height = Math.ceil(bigH) + 'px';
        this.mapContainer.style.minHeight = Math.ceil(bigH) + 'px';
        this.mapContainer.style.overflow = 'hidden';

        const cropCenter = cropBounds.getCenter();
        this.map.invalidateSize(false);
        this.map.once('moveend', () => {
          setTimeout(() => {
            doRender();
            setTimeout(() => {
              this.map.options.zoomAnimation = savedAnim;
              Object.keys(savedStyles).forEach(p => {
                this.mapContainer.style[p] = savedStyles[p];
              });
              this.map.invalidateSize(false);
              this.map.setView(savedCenter, savedZoom, { animate: false });
            }, 200);
          }, 1500);
        });
        this.map.setView(cropCenter, savedZoom, { animate: false });
        return;
      }

      doRender();
    }
  }

  // ==================== Instance and Leaflet Control ====================
  const exportManager = new ExportManager(map);

  const ControlClass = L.Control.extend({
    onAdd: function() {
      const pos = '{{ this.position }}';
      const { container, ctrl, toolBar, toggleBtn } = window.foliplus.createFoldControl({
        cssClass: 'export-ctrl',
        toggleTitle: _('export.btn_title'),
        toggleSvg: SVGS.CAMERA,
        isLeft: pos.indexOf('left') >= 0,
      });
      toolBar.className = 'tool-bar export-crop-actions';
      exportManager.attachUI(ctrl, toolBar);
      toggleBtn.onclick = () => {
        if (exportManager.cropState) {
          exportManager.removeCropBox();
        } else if (exportManager.savedBounds) {
          exportManager.showCropBox();
          // Restore exact geo bounds without recalculating from screen rect
          requestAnimationFrame(() => {
            if (exportManager.cropState && !exportManager.cropState.locked) {
              exportManager.cropState._savedGeoBounds = {
                nw: { lat: exportManager.savedBounds.nw.lat, lng: exportManager.savedBounds.nw.lng },
                se: { lat: exportManager.savedBounds.se.lat, lng: exportManager.savedBounds.se.lng },
              };
              exportManager.lockCropBox();
              window.foliplus.showHint('export', _('export.hint_restore'), 3000, document.body, true);
            }
          });
        } else {
          exportManager.showCropBox();
        }
      };
      return container;
    },
    onRemove: function() {
      if (exportManager.cropState) exportManager.removeCropBox();
      if (exportManager._onKeyDown) document.removeEventListener('keydown', exportManager._onKeyDown);
    }
  });

  new ControlClass({ position: '{{ this.position }}' }).addTo(map);
})();

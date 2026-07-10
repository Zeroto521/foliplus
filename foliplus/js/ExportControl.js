(function() {
  // ==================== Runtime Guard ====================
  if (!window.foliplus || !window.foliplus.SVGs) {
    console.error('[ExportControl] foliplus runtime not found — plugin disabled.');
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

    async render(rect, scale, bg) {
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
      const contW = this.container.clientWidth;
      const contH = this.container.clientHeight;

      // Layer 1: Tiles + images — use getBoundingClientRect for absolute position
      // (most reliable regardless of pane nesting)
      let imgOk = 0, imgFail = 0;
      const contRect = this.container.getBoundingClientRect();
      for (const img of this.container.querySelectorAll('img')) {
        if (!img.src || !img.complete || !img.naturalWidth) continue;
        const r = img.getBoundingClientRect();
        const l = r.left - contRect.left;
        const t = r.top - contRect.top;
        const w = img.naturalWidth || r.width || 256;
        const h = img.naturalHeight || r.height || 256;
        if (w < 1 || h < 1) continue;
        const dx = (l - rect.left) * scale;
        const dy = (t - rect.top) * scale;
        const dw = w * scale;
        const dh = h * scale;
        if (dx + dw < 0 || dy + dh < 0 || dx > cw || dy > ch) continue;
        // try original img first (CORS-safe after pre-setup)
        try { ctx.drawImage(img, dx, dy, dw, dh); imgOk++; }
        catch { /* tainted — skip */ }
      }

      // Marker div content — render innerHTML as text (divIcon with icons)
      // df.explore creates L.divIcon with Fa icons as innerHTML
      for (const el of this.container.querySelectorAll('.leaflet-marker-icon')) {
        const bg = el.style.backgroundImage;
        if (bg && bg.includes('url(')) {
          const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
          if (m && m[1]) {
            const r = el.getBoundingClientRect();
            const l = r.left - contRect.left;
            const t = r.top - contRect.top;
            const dx = (l - rect.left) * scale;
            const dy = (t - rect.top) * scale;
            const dw = r.width * scale;
            const dh = r.height * scale;
            if (dx + dw >= 0 && dy + dh >= 0 && dx <= cw && dy <= ch) {
              const ok = await this._loadAndDraw(ctx, m[1], dx, dy, dw, dh);
              if (ok) imgOk++;
            }
          }
        }
        // Draw innerHTML (for divIcon with inline SVG/icons)
        const iconHtml = el.innerHTML;
        if (iconHtml && iconHtml.length > 10) {
          const r = el.getBoundingClientRect();
          // Canvas can't draw HTML — but we can try to draw the <img> or <svg> inside
          for (const innerImg of el.querySelectorAll('img')) {
            if (!innerImg.src || !innerImg.complete) continue;
            const l = r.left - contRect.left;
            const t = r.top - contRect.top;
            const dx = (l - rect.left) * scale;
            const dy = (t - rect.top) * scale;
            const dw = (innerImg.naturalWidth || r.width) * scale;
            const dh = (innerImg.naturalHeight || r.height) * scale;
            if (dx + dw >= 0 && dy + dh >= 0 && dx <= cw && dy <= ch) {
              try { ctx.drawImage(innerImg, dx, dy, dw, dh); imgOk++; } catch {}
            }
          }
        }
      }
      console.log('[Export] images drawn:', imgOk, 'fail:', imgFail);

      // Layer 2: SVG overlay — search ALL panes for SVG elements
      // (LayerControl moves vector layers to custom _lyr_* panes)
      const panes = this.container.querySelectorAll('.leaflet-map-pane [class*="pane"]');
      let svgCount = 0;
      for (const pane of panes) {
        const svgEl = pane.querySelector('svg');
        if (!svgEl) continue;
        const clone = svgEl.cloneNode(true);
        clone.removeAttribute('style');
        clone.setAttribute('width', String(contW));
        clone.setAttribute('height', String(contH));

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
          // SVG matches container dimensions (contW × contH).
          // Crop to rect and scale to output canvas.
          ctx.drawImage(svgImg, rect.left, rect.top, rect.width, rect.height, 0, 0, sw, sh);
          svgCount++;
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      console.log('[Export] SVGs drawn:', svgCount);

      // Layer 3: Markers — already captured in Layer 1 above
      // (all <img> in .leaflet-map-pane are searched, including marker icons)

      return canvas;
    }

    // Load image with CORS (same as html2canvas useCORS mode).
    // Uses original URL — no cache-busting — so browser reuses cached
    // CORS response. If CORS fails, skip (don't taint canvas).
    // Returns true if drawn, false if skipped.
    _loadAndDraw(ctx, src, dx, dy, dw, dh) {
      return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try { ctx.drawImage(img, dx, dy, dw, dh); resolve(true); }
          catch (e) { console.warn('[Export] drawImage error:', e); resolve(false); }
        };
        img.onerror = () => { console.warn('[Export] CORS failed:', src.substring(0, 80)); resolve(false); };
        img.src = src; // original URL, no cache-busting
      });
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
        `${_('export.label_size_prefix')} ${Math.round(r.width)} × ${Math.round(r.height)} `
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
        const nw = this.map.latLngToContainerPoint(
          L.latLng(this.savedBounds.nw.lat, this.savedBounds.nw.lng));
        const se = this.map.latLngToContainerPoint(
          L.latLng(this.savedBounds.se.lat, this.savedBounds.se.lng));
        box = {
          left: Math.max(0, Math.min(nw.x, mapRect.width - CONST.CROP_MIN_SIZE)),
          top: Math.max(0, Math.min(nw.y, mapRect.height - CONST.CROP_MIN_SIZE)),
          width: Math.max(CONST.CROP_MIN_SIZE, Math.abs(se.x - nw.x)),
          height: Math.max(CONST.CROP_MIN_SIZE, Math.abs(se.y - nw.y)),
        };
        box.width = Math.min(box.width, mapRect.width - box.left);
        box.height = Math.min(box.height, mapRect.height - box.top);
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
      this.cropState.geoBounds = {
        nw: this.map.containerPointToLatLng(L.point(r.left, r.top)),
        se: this.map.containerPointToLatLng(L.point(r.left + r.width, r.top + r.height)),
      };
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
      this._showHintWithInfo(newRect, _('export.hint_zoom'));
    }

    _clampRectToViewport(r) {
      const cw = this.mapContainer.clientWidth;
      const ch = this.mapContainer.clientHeight;
      r.left = Math.max(0, Math.min(r.left, cw - CONST.CROP_MIN_SIZE));
      r.top = Math.max(0, Math.min(r.top, ch - CONST.CROP_MIN_SIZE));
      r.width = Math.max(CONST.CROP_MIN_SIZE, Math.min(r.width, cw - r.left));
      r.height = Math.max(CONST.CROP_MIN_SIZE, Math.min(r.height, ch - r.top));
    }

    doExport() {
      if (this.isExporting || !this.cropState) return;
      this.isExporting = true;
      const r = Object.assign({}, this.cropState.rect);
      this._clampRectToViewport(r);
      this.removeCropBox();
      this._showGlobalHint(_('export.status_exporting'), 0, true);

      let scaleValue = {{ this.scale }};
      if (typeof scaleValue !== 'number' || isNaN(scaleValue)) scaleValue = CONST.DEFAULT_SCALE;
      const bg = {{ '"' + this.background + '"' if this.background else "null" }};

      const hideEls = this.mapContainer.querySelectorAll('.leaflet-control-container, .export-ctrl');
      hideEls.forEach(el => { el.style.display = 'none'; });

      new LeafletRenderer(this.map).render(r, scaleValue, bg || undefined)
        .then(canvas => {
          hideEls.forEach(el => { el.style.display = ''; });
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
          // Restore previous selection — show & lock in one step
          exportManager.showCropBox();
          // Wait for crop box to render, then lock immediately
          requestAnimationFrame(() => exportManager.lockCropBox());
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

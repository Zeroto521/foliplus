(function() {
  // ==================== Runtime Guard ====================
  if (!window.foliplus || !window.foliplus.SVGs) {
    console.error('[ExportControl] foliplus runtime not found — component disabled.');
    return;
  }

  // ==================== Constants ====================
  const CONST = {
    CROP_MIN_SIZE: 40,
    TILE_WAIT_EXTRA: 450,
    RESIZE_DELAY: 250,
    URL_REVOKE_DELAY: 10000,
    DEFAULT_SCALE: window.devicePixelRatio || 1,
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

  // ==================== ExportManager ====================
  class ExportManager {
    constructor(mapInstance) {
      this.map = mapInstance;
      this.mapContainer = this.map.getContainer();

      // State management
      this.cropState = null;
      this.exportCtrl = null;
      this.exportToolBar = null;
      this.isExporting = false;
      this.safetyTimeout = null;

      // Memorized crop area
      this.lastScreenRect = null;

      this.dragState = {
        dragging: false,
        dragType: null,
        startX: 0,
        startY: 0,
        startRect: null
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

    _showGlobalHint(text, duration, withLoadingIcon) {
      const loading = withLoadingIcon && window.foliplus.SVGs
        ? (window.foliplus.SVGs.LOADING + ' ')
        : '';
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

    // --- Calcs & Style ---
    _updateBoxStyle(el, r) {
      el.style.left = r.left + 'px';
      el.style.top = r.top + 'px';
      el.style.width = r.width + 'px';
      el.style.height = r.height + 'px';

      if (this.cropState && this.cropState.overlay) {
        this.cropState.overlay.style.left = r.left + 'px';
        this.cropState.overlay.style.top = r.top + 'px';
        this.cropState.overlay.style.width = r.width + 'px';
        this.cropState.overlay.style.height = r.height + 'px';
      }
    }

    _pixelToLatLng(px, py) {
      return this.map.containerPointToLatLng(L.point(px, py));
    }

    _latLngToPixel(latlng) {
      return this.map.latLngToContainerPoint(latlng);
    }

    // --- Crop Box Lifecycle ---
    showCropBox() {
      if (this.cropState) return;

      const mapRect = this.mapContainer.getBoundingClientRect();
      let box;

      // Restore last crop area and apply bounds correction
      if (this.lastScreenRect) {
        box = {
          left: Math.max(
            0,
            Math.min(this.lastScreenRect.left, mapRect.width - CONST.CROP_MIN_SIZE)
          ),
          top: Math.max(
            0,
            Math.min(this.lastScreenRect.top, mapRect.height - CONST.CROP_MIN_SIZE)
          ),
          width: this.lastScreenRect.width,
          height: this.lastScreenRect.height
        };
        // Ensure width/height fits in viewport
        box.width = Math.max(
          CONST.CROP_MIN_SIZE,
          Math.min(box.width, mapRect.width - box.left)
        );
        box.height = Math.max(
          CONST.CROP_MIN_SIZE,
          Math.min(box.height, mapRect.height - box.top)
        );
      } else {
        const paddingW = mapRect.width * 0.25;
        const paddingH = mapRect.height * 0.25;
        box = {
          left: paddingW,
          top: paddingH,
          width: mapRect.width - paddingW * 2,
          height: mapRect.height - paddingH * 2
        };
      }

      const overlay = document.createElement('div');
      overlay.className = 'export-crop-overlay active';
      this.mapContainer.appendChild(overlay);
      this.mapContainer.classList.add('has-export-mode');
      document.body.classList.add('has-export-mode');

      const cropBox = document.createElement('div');
      cropBox.className = 'export-crop-box';
      this.mapContainer.appendChild(cropBox);

      // Add 8-way resize handles
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

      this.cropState = {
        overlay,
        box: cropBox,
        rect: box,
        locked: false,
        actions: this.exportToolBar
      };

      this._updateBoxStyle(cropBox, box);
      this._showHintWithInfo(box, _('export.hint_unlocked'));

      // Event binding
      cropBox.addEventListener('mousedown', this._onMouseDown);

      this.exportToolBar.querySelector('.cancel').onclick = e => {
        e.stopPropagation();
        this.removeCropBox();
      };
      this.exportToolBar.querySelector('.confirm').onclick = e => {
        e.stopPropagation();
        this.lockCropBox();
      };

      document.addEventListener('keydown', this._onKeyDown);
    }

    lockCropBox() {
      if (!this.cropState || this.cropState.locked) return;
      this.cropState.locked = true;
      this.cropState.box.classList.add('locked');

      const r = this.cropState.rect;
      this.cropState.geoBounds = {
        nw: this._pixelToLatLng(r.left, r.top),
        se: this._pixelToLatLng(r.left + r.width, r.top + r.height)
      };

      this.cropState.actions.innerHTML = `
        <button class="confirm" title="${_('export.btn_export')}">${SVGS.DOWNLOAD}</button>
        <button class="cancel" title="${_('export.btn_cancel')}">${window.foliplus.SVGs.CLOSE}</button>`;

      this.cropState.actions.querySelector('.cancel').onclick = e => {
        e.stopPropagation();
        this.unlockCropBox();
      };
      this.cropState.actions.querySelector('.confirm').onclick = e => {
        e.stopPropagation();
        this.doExport();
      };

      this.map.on('move zoom', this._onMapChange);
      this._onMapChange(); // Trigger initial refresh
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

      this.cropState.actions.querySelector('.cancel').onclick = e => {
        e.stopPropagation();
        this.removeCropBox();
      };
      this.cropState.actions.querySelector('.confirm').onclick = e => {
        e.stopPropagation();
        this.lockCropBox();
      };

      this._updateBoxStyle(this.cropState.box, this.cropState.rect);
      this._showHintWithInfo(this.cropState.rect, _('export.hint_unlocked'));
    }

    removeCropBox() {
      if (!this.cropState) return;

      // Core logic: Save current coordinates and size before destroying selection
      this.lastScreenRect = Object.assign({}, this.cropState.rect);

      this.mapContainer.classList.remove('has-export-mode');
      document.body.classList.remove('has-export-mode');

      document.removeEventListener('keydown', this._onKeyDown);
      this.map.off('move zoom', this._onMapChange);

      if (this.cropState.box) {
        this.cropState.box.removeEventListener('mousedown', this._onMouseDown);
      }
      if (this.cropState.overlay && this.cropState.overlay.parentNode) {
        this.cropState.overlay.parentNode.removeChild(this.cropState.overlay);
      }
      if (this.cropState.box && this.cropState.box.parentNode) {
        this.cropState.box.parentNode.removeChild(this.cropState.box);
      }
      if (this.cropState.actions) {
        this.cropState.actions.innerHTML = '';
      }
      if (this.exportCtrl) {
        this.exportCtrl.classList.remove('expanded');
        this.exportCtrl.classList.add('collapsed');
      }

      this.cropState = null;
      window.foliplus.hideHint('export');
    }

    // --- Interaction & Drag Engine ---
    _onMouseDown(e) {
      if (this.cropState.locked) return;
      e.preventDefault();
      e.stopPropagation();

      const target = e.target;
      if (target.classList.contains('export-crop-handle')) {
        this.dragState.dragType = target.dataset.pos;
      } else if (
        target.classList.contains('export-crop-center') ||
        target.classList.contains('export-crop-box')
      ) {
        this.dragState.dragType = 'move';
      } else {
        return;
      }

      this.dragState.dragging = true;
      this.dragState.startX = e.clientX;
      this.dragState.startY = e.clientY;
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
        r.left = Math.max(
          0,
          Math.min(mapRect.width - r.width, startRect.left + dx)
        );
        r.top = Math.max(
          0,
          Math.min(mapRect.height - r.height, startRect.top + dy)
        );
      } else {
        // Feature 1: Advanced 8-way drag-and-resize logic
        if (['tl', 'l', 'bl'].includes(type)) {
          const maxDx = startRect.width - CONST.CROP_MIN_SIZE;
          const actualDx = Math.max(-startRect.left, Math.min(dx, maxDx));
          r.left = startRect.left + actualDx;
          r.width = startRect.width - actualDx;
        }
        if (['tr', 'r', 'br'].includes(type)) {
          const maxDx = mapRect.width - (startRect.left + startRect.width);
          const minDx = CONST.CROP_MIN_SIZE - startRect.width;
          const actualDx = Math.max(minDx, Math.min(dx, maxDx));
          r.width = startRect.width + actualDx;
        }
        if (['tl', 't', 'tr'].includes(type)) {
          const maxDy = startRect.height - CONST.CROP_MIN_SIZE;
          const actualDy = Math.max(-startRect.top, Math.min(dy, maxDy));
          r.top = startRect.top + actualDy;
          r.height = startRect.height - actualDy;
        }
        if (['bl', 'b', 'br'].includes(type)) {
          const maxDy = mapRect.height - (startRect.top + startRect.height);
          const minDy = CONST.CROP_MIN_SIZE - startRect.height;
          const actualDy = Math.max(minDy, Math.min(dy, maxDy));
          r.height = startRect.height + actualDy;
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
        if (this.cropState && this.cropState.locked) this.unlockCropBox();
        else this.removeCropBox();
      } else if (e.key === 'Enter') {
        if (this.cropState && !this.cropState.locked) this.lockCropBox();
        else if (this.cropState && this.cropState.locked) this.doExport();
      }
    }

    _onMapChange() {
      if (!this.cropState || !this.cropState.locked) return;
      const nw = this.cropState.geoBounds.nw;
      const se = this.cropState.geoBounds.se;
      const topLeft = this._latLngToPixel(nw);
      const bottomRight = this._latLngToPixel(se);

      const newRect = {
        left: topLeft.x,
        top: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y
      };

      this.cropState.rect = newRect;
      this._updateBoxStyle(this.cropState.box, newRect);
      this._showHintWithInfo(newRect, _('export.hint_zoom'));
    }

    // --- Final Rendering & Download Engine ---
    doExport() {
      if (this.isExporting || !this.cropState) return;
      this.isExporting = true;

      const geoBounds = this.cropState.geoBounds;
      const r = this.cropState.rect;
      const zoom = this.map.getZoom();
      const cropCenter = L.latLng(
        (geoBounds.nw.lat + geoBounds.se.lat) / 2,
        (geoBounds.nw.lng + geoBounds.se.lng) / 2
      );

      // removeCropBox will save the last rect to lastScreenRect
      this.removeCropBox();
      this._showGlobalHint(_('export.status_exporting'), 0, true);

      // Create a context object for resetting styles
      const ctx = {
        parent: this.mapContainer.parentNode,
        nextSibling: this.mapContainer.nextSibling,
        origStyle: this.mapContainer.style.cssText,
        origCenter: this.map.getCenter(),
        origZoom: this.map.getZoom(),
        hiddenItems: [],
        captureHint: null,
        hintNextSibling: null,
        r: r
      };

      const hideEls = this.mapContainer.querySelectorAll(
        '.leaflet-control-container, .custom-scale-wrap, .export-ctrl, '
        + '.measure-del-icon.visible'
      );

      hideEls.forEach(el => {
        ctx.hiddenItems.push({ el, display: el.style.display });
        el.style.display = 'none';
      });

      this.mapContainer.style.position = 'fixed';
      this.mapContainer.style.left = '0px';
      this.mapContainer.style.top = '0px';
      this.mapContainer.style.width = r.width + 'px';
      this.mapContainer.style.height = r.height + 'px';
      this.mapContainer.style.zIndex = '-999990';
      document.body.appendChild(this.mapContainer);

      this.map.invalidateSize({ animate: false });
      this.map.setView(cropCenter, zoom, { animate: false });

      setTimeout(() => this._checkAndCapture(ctx), CONST.RESIZE_DELAY);
    }

    _checkAndCapture(ctx) {
      const tileLayers = [];
      this.map.eachLayer(layer => {
        if (layer instanceof L.TileLayer) tileLayers.push(layer);
      });

      const pendingLayers = tileLayers.filter(layer => layer._loading);

      if (pendingLayers.length === 0) {
        this._performCapture(ctx);
        return;
      }

      let isFinished = false;
      const onLayerFinish = () => {
        if (isFinished) return;
        const stillLoading = pendingLayers.some(layer => layer._loading);
        if (!stillLoading) {
          isFinished = true;
          clearTimeout(this.safetyTimeout);
          this.safetyTimeout = null;
          setTimeout(() => this._performCapture(ctx), CONST.TILE_WAIT_EXTRA);
        }
      };

      this.safetyTimeout = setTimeout(() => {
        if (!isFinished) {
          isFinished = true;
          pendingLayers.forEach(layer => layer.off('load', onLayerFinish));
          this._performCapture(ctx);
        }
      }, {{ this.timeout }});

      pendingLayers.forEach(layer => layer.once('load', onLayerFinish));
      onLayerFinish();
    }

    _performCapture(ctx) {
      if (typeof html2canvas === 'undefined') {
        console.warn(`[ExportControl] ${_('export.err_no_canvas')}`);
        if (window.foliplus) {
          window.foliplus.showHint('export', _('export.err_no_canvas'), 5000);
        }
        this._cleanup(ctx);
        return;
      }

      let scaleValue = {{ this.scale }};
      if (typeof scaleValue !== 'number' || isNaN(scaleValue)) {
        scaleValue = CONST.DEFAULT_SCALE;
      }

      ctx.captureHint = this.mapContainer.querySelector('.map-hint');
      ctx.hintNextSibling = ctx.captureHint ? ctx.captureHint.nextSibling : null;
      if (ctx.captureHint) ctx.captureHint.remove();

      html2canvas(this.mapContainer, {
        useCORS: true,
        allowTaint: false,
        scale: scaleValue,
        backgroundColor: {{ '"' + this.background + '"' if this.background else "null" }},
        width: ctx.r.width,
        height: ctx.r.height,
        scrollX: 0,
        scrollY: 0,
        onclone: doc => {
          const hints = doc.querySelectorAll('.map-hint');
          for (let i = 0; i < hints.length; i++) hints[i].remove();
        }
      }).then(canvas => {
        if (canvas.toBlob) {
          canvas.toBlob(blob => {
            if (!blob) {
              this._showGlobalHint(_('export.status_fail') + _('export.err_gen_fail'), 5000, false);
              return;
            }
            const link = document.createElement('a');
            const objectUrl = URL.createObjectURL(blob);
            link.download = '{{ this.filename }}';
            link.href = objectUrl;
            link.rel = 'noopener';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(
              () => URL.revokeObjectURL(objectUrl),
              CONST.URL_REVOKE_DELAY
            );
            this._showGlobalHint(_('export.status_success'), 4000, false);
          }, 'image/png');
        } else {
          const fallbackLink = document.createElement('a');
          fallbackLink.download = '{{ this.filename }}';
          fallbackLink.href = canvas.toDataURL('image/png');
          fallbackLink.rel = 'noopener';
          document.body.appendChild(fallbackLink);
          fallbackLink.click();
          document.body.removeChild(fallbackLink);
          this._showGlobalHint(_('export.status_success'), 4000, false);
        }
      }).catch(err => {
        console.error(_('export.status_fail'), err);
        this._showGlobalHint(_('export.status_fail') + err.message, 5000, false);
      }).finally(() => {
        this._cleanup(ctx);
      });
    }

    _cleanup(ctx) {
      if (ctx.captureHint && ctx.hintNextSibling) {
        this.mapContainer.insertBefore(ctx.captureHint, ctx.hintNextSibling);
      } else if (ctx.captureHint) {
        this.mapContainer.appendChild(ctx.captureHint);
      }

      if (this.safetyTimeout) {
        clearTimeout(this.safetyTimeout);
        this.safetyTimeout = null;
      }

      if (ctx.nextSibling) {
        ctx.parent.insertBefore(this.mapContainer, ctx.nextSibling);
      } else {
        ctx.parent.appendChild(this.mapContainer);
      }

      this.mapContainer.style.cssText = ctx.origStyle;

      ctx.hiddenItems.forEach(item => {
        item.el.style.display = item.display;
      });

      this.map.setView(ctx.origCenter, ctx.origZoom, { animate: false });
      this.map.invalidateSize({ animate: false });

      this.isExporting = false;
    }
  }

  // ==================== Instance and Leaflet Control ====================
  const exportManager = new ExportManager(map);

  const ControlClass = L.Control.extend({
    onAdd: function() {
      const pos = '{{ this.position }}';
      const isLeft = pos.indexOf('left') >= 0;
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      const ctrl = L.DomUtil.create(
        'div',
        'export-ctrl ctrl-fold collapsed',
        container
      );

      ctrl.innerHTML = `
        <button class="toggle-btn" title="${_('export.btn_title')}">${SVGS.CAMERA}</button>
        <div class="tool-bar export-crop-actions"></div>`;

      if (!isLeft) ctrl.classList.add('align-right');
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      const toolBar = ctrl.querySelector('.tool-bar');
      exportManager.attachUI(ctrl, toolBar);

      container.querySelector('.toggle-btn').onclick = () => {
        if (exportManager.cropState) exportManager.removeCropBox();
        else exportManager.showCropBox();
      };

      return container;
    }
  });

  new ControlClass({ position: '{{ this.position }}' }).addTo(map);
})();

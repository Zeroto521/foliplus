(function() {
  // ==================== Runtime Guard ====================
  if (!window.foliplus || !window.foliplus.SVGs) {
    console.error('[ExportControl] foliplus runtime not found — plugin disabled.');
    return;
  }

  // ==================== Constants ====================
  const CONST = {
    CROP_MIN_SIZE: 40,
    EXPORT_DELAY: 50,
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
      // Memorized crop area
      this.lastScreenRect = null;
      this.savedBounds = null;
      this._loadSavedBounds();

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

    _loadSavedBounds() {
      try {
        const data = localStorage.getItem(CONST.STORAGE_KEY);
        if (!data) return;
        const saved = JSON.parse(data);
        if (saved && saved.nw && saved.se) {
          this.savedBounds = saved;
        }
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

    // --- Crop Box Lifecycle ---
    showCropBox() {
      if (this.cropState) return;

      const mapRect = this.mapContainer.getBoundingClientRect();
      let box;

      // Restore from saved geoBounds (zoom/pan independent)
      if (this.savedBounds) {
        const nw = this.map.latLngToContainerPoint(
          L.latLng(this.savedBounds.nw.lat, this.savedBounds.nw.lng)
        );
        const se = this.map.latLngToContainerPoint(
          L.latLng(this.savedBounds.se.lat, this.savedBounds.se.lng)
        );
        box = {
          left: Math.max(0, Math.min(nw.x, mapRect.width - CONST.CROP_MIN_SIZE)),
          top: Math.max(0, Math.min(nw.y, mapRect.height - CONST.CROP_MIN_SIZE)),
          width: Math.max(CONST.CROP_MIN_SIZE, Math.abs(se.x - nw.x)),
          height: Math.max(CONST.CROP_MIN_SIZE, Math.abs(se.y - nw.y)),
        };
        // Clamp to viewport
        box.width = Math.min(box.width, mapRect.width - box.left);
        box.height = Math.min(box.height, mapRect.height - box.top);
      } else if (this.lastScreenRect) {
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
        const padding = mapRect.width * CONST.CROP_PADDING_RATIO;
        box = {
          left: padding,
          top: padding,
          width: mapRect.width - padding * 2,
          height: mapRect.height - padding * 2
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
        <button class="confirm" title="${_('export.btn_confirm')}">
          ${SVGS.CHECK}
        </button>
        <button class="cancel" title="${_('export.btn_cancel')}">
          ${window.foliplus.SVGs.CLOSE}
        </button>`;
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
        nw: this.map.containerPointToLatLng(L.point(r.left, r.top)),
        se: this.map.containerPointToLatLng(L.point(r.left + r.width, r.top + r.height)),
      };

      this.cropState.actions.innerHTML = `
        <button class="confirm" title="${_('export.btn_export')}">
          ${SVGS.DOWNLOAD}
        </button>
        <button class="cancel" title="${_('export.btn_cancel')}">
          ${window.foliplus.SVGs.CLOSE}
        </button>`;

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
        <button class="confirm" title="${_('export.btn_confirm')}">
          ${SVGS.CHECK}
        </button>
        <button class="cancel" title="${_('export.btn_cancel')}">
          ${window.foliplus.SVGs.CLOSE}
        </button>`;

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
      // Save geoBounds (zoom-independent) if available
      if (this.cropState.geoBounds) {
        this._saveBounds(this.cropState.geoBounds);
        this.savedBounds = this.cropState.geoBounds;
      }

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
      const topLeft = this.map.latLngToContainerPoint(L.latLng(nw.lat, nw.lng));
      const bottomRight = this.map.latLngToContainerPoint(L.latLng(se.lat, se.lng));

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

    // --- Clamp rect to viewport bounds ---
    _clampRectToViewport(r) {
      const cw = this.mapContainer.clientWidth;
      const ch = this.mapContainer.clientHeight;
      r.left = Math.max(0, Math.min(r.left, cw - CONST.CROP_MIN_SIZE));
      r.top = Math.max(0, Math.min(r.top, ch - CONST.CROP_MIN_SIZE));
      r.width = Math.max(CONST.CROP_MIN_SIZE, Math.min(r.width, cw - r.left));
      r.height = Math.max(CONST.CROP_MIN_SIZE, Math.min(r.height, ch - r.top));
    }

    // --- Export Engine ---
    doExport() {
      if (this.isExporting || !this.cropState) return;
      this.isExporting = true;

      const r = Object.assign({}, this.cropState.rect);
      // After zoom/pan the geoBounds may extend beyond the visible map area,
      // so clamp the crop rect to the viewport before capture.
      this._clampRectToViewport(r);
      this.removeCropBox();
      this._showGlobalHint(_('export.status_exporting'), 0, true);

      let scaleValue = {{ this.scale }};
      if (typeof scaleValue !== 'number' || isNaN(scaleValue)) {
        scaleValue = CONST.DEFAULT_SCALE;
      }
      const bg = {{ '"' + this.background + '"' if this.background else "null" }};
      const capturer = window.modernScreenshot;

      if (!capturer || typeof capturer.domToCanvas !== 'function') {
        this._showGlobalHint(
          _('export.status_fail') + _('export.err_no_canvas'), CONST.HINT_ERROR_DURATION, false
        );
        this.isExporting = false;
        return;
      }

      // Show hint, yield for animation, then capture everything (tiles + overlays)
      // Hide controls during capture
      const hideEls = this.mapContainer.querySelectorAll(
        '.leaflet-control-container, .export-ctrl'
      );
      hideEls.forEach(el => { el.style.display = 'none'; });

      setTimeout(() => {
        capturer.domToCanvas(this.mapContainer, {
          scale: scaleValue,
          backgroundColor: bg || undefined,
          fetch: {
            requestInit: { cache: 'force-cache' },
          },
        }).then(canvas => {
          // Restore hidden controls
          hideEls.forEach(el => { el.style.display = ''; });
          const sx = Math.round(r.left * scaleValue);
          const sy = Math.round(r.top * scaleValue);
          const sw = Math.round(r.width * scaleValue);
          const sh = Math.round(r.height * scaleValue);

          const out = document.createElement('canvas');
          out.width = sw; out.height = sh;
          out.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

          out.toBlob(blob => {
            if (!blob) {
              this._showGlobalHint(
                _('export.status_fail') + _('export.err_gen_fail'), CONST.HINT_ERROR_DURATION, false
              );
              return;
            }
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.download = '{{ this.filename }}';
            link.href = url; link.rel = 'noopener';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), CONST.URL_REVOKE_DELAY);
            this._showGlobalHint(_('export.status_success'), CONST.HINT_SUCCESS_DURATION, false);
            this.isExporting = false;
          }, 'image/png');
        }).catch(err => {
          console.error('[ExportControl] export failed:', err);
          this._showGlobalHint(_('export.status_fail') + (err.message || ''), CONST.HINT_ERROR_DURATION, false);
          this.isExporting = false;
        });
      }, CONST.EXPORT_DELAY);
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
        if (exportManager.cropState) exportManager.removeCropBox();
        else exportManager.showCropBox();
      };

      return container;
    },

    onRemove: function() {
      if (exportManager.cropState) exportManager.removeCropBox();
      if (exportManager._onKeyDown) {
        document.removeEventListener('keydown', exportManager._onKeyDown);
      }
    }
  });

  new ControlClass({ position: '{{ this.position }}' }).addTo(map);
})();

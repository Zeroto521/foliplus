(function() {
  // ==================== Runtime Guard ====================
  if (!window.foliplus || !window.foliplus.SVGs) {
    console.error('[MeasureControl] foliplus runtime not found — component disabled.');
    return;
  }

  // ==================== Private Constants ====================
  const _CONST = {
    COLOR_ACCENT: '#e74c3c',
    LINE_WEIGHT_FINAL: 2.5,
    LINE_WEIGHT_PREVIEW: 1.5,
    DASH_ARRAY_FINAL: '6 4',
    DASH_ARRAY_PREVIEW: '4 4',
    MARKER_RADIUS: 5,
    PREVIEW_NODE_RADIUS: 4,
    FINAL_NODE_RADIUS: 3.5,
    CIRCLE_FILL_OPACITY: 0.25,
    PREVIEW_CIRCLE_FILL_OPACITY: 0.08,
    DEL_ICON_RETRY_LIMIT: 10,
    POPUP_MAX_WIDTH: 260,
    CLICK_COOLDOWN_MS: 300,
    FINALIZE_DELAY_MS: 50,
  };

  // ==================== Globals & Shared Dependencies ====================
  const map = {{ this._parent.get_name() }};
  const _ = (k) => (window.foliplus && window.foliplus.gt) ? window.foliplus.gt(k) : k;

  // ==================== SVG Icons ====================
  const SVG_ICON_ATTRS = `width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="1.8"`;

  const SVGS = {
    RULER: `<svg ${SVG_ICON_ATTRS} stroke-linecap="round"
      stroke-linejoin="round" style="transform:rotate(-45deg)">
      <rect x="1" y="7" width="22" height="9" rx="1"/>
      <path d="M5 7v3M9 7v2M13 7v3M17 7v2"/></svg>`,
    CIRCLE: `<svg ${SVG_ICON_ATTRS}>
      <circle cx="12" cy="12" r="9"/>
      <circle cx="12" cy="12" r="1.5" fill="currentColor"
        stroke="none"/></svg>`,
    TRASH: `<svg ${SVG_ICON_ATTRS} stroke-linecap="round"
      stroke-linejoin="round">
      <path d="M3 6h18"/>
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <line x1="10" y1="11" x2="10" y2="17"/>
      <line x1="14" y1="11" x2="14" y2="17"/></svg>`
  };

  if (window.foliplus) {
    window.foliplus.registerHintIcon('measure', SVGS.RULER);
  }

  // ==================== Utility Classes ====================
  class MeasureUtils {
    static stopEvent(e) {
      const d = e.originalEvent || e;
      d?.stopPropagation?.();
      d?.preventDefault?.();
    }

    static formatDistance(meters) {
      return meters >= 1000
        ? (meters / 1000).toFixed(1) + ' ' + _('measure.unit_km')
        : Math.round(meters) + ' ' + _('measure.unit_m');
    }

    static distance(lat1, lng1, lat2, lng2) {
      return L.latLng(lat1, lng1).distanceTo(L.latLng(lat2, lng2));
    }

    static getXIcon(extraStyle) {
      const s = extraStyle || 'position:absolute;top:-14px;left:5px;right:auto;margin:0;';
      return `<span class="measure-del-icon" style="${s}">✕</span>`;
    }

    static hideAllDelIcons() {
      document.querySelectorAll('.measure-del-icon.visible')
        .forEach(el => el.classList.remove('visible'));
    }

    static calcToggle(curX, curLabels, showX, toggleLbl) {
      const newX = showX !== undefined ? showX : !curX;
      let newL = curLabels;
      if (toggleLbl === true) newL = !curLabels;
      else if (toggleLbl === false) newL = false;
      else if (toggleLbl === 'reset') newL = true;
      return { xVisible: newX, labelsVisible: newL };
    }

    static applyToggle(delMarker, xVisible, labels, labelsVisible, extraLbl) {
      const applyDelIcon = (mkr, show, retries = 0) => {
        if (!mkr) return;
        const el = mkr.getElement();
        if (el) {
          const icon = el.querySelector('.measure-del-icon');
          if (icon) icon.classList.toggle('visible', show);
        } else if (retries < _CONST.DEL_ICON_RETRY_LIMIT) {
          setTimeout(() => applyDelIcon(mkr, show, retries + 1), 50);
        }
      };

      applyDelIcon(delMarker, xVisible);
      const dsp = labelsVisible ? '' : 'none';

      labels.forEach(m => {
        const el = m.getElement();
        if (el) {
          const lbl = el.querySelector('.measure-label');
          if (lbl) lbl.style.display = dsp;
        }
      });

      if (extraLbl) {
        const sEl = extraLbl.getElement();
        if (sEl) {
          const sL = sEl.querySelector('.measure-label');
          if (sL) sL.style.display = dsp;
        }
      }
    }
  }

  // ==================== Core Manager ====================
  class MeasureManager {
    constructor(mapInstance) {
      this.map = mapInstance;
      this.layerGroup = L.layerGroup();
      this.isRegistered = false;
      this.currentMode = null;
      this.cleanupFn = null;
      this.suppressHideDel = false;
      this.toolBtns = [];
      this.MEASURE_ID = '__measure__';

      this._setupLayerOverrides();
      this._bindGlobalEvents();
    }

    _setupLayerOverrides() {
      const origAdd = this.layerGroup.addLayer.bind(this.layerGroup);
      this.layerGroup.addLayer = (layer) => {
        this._registerToLayerControl();
        layer.options.pane = this.MEASURE_ID;

        if (layer instanceof L.Path) {
          const { renderer } = window.foliplus.LayerControlAPI.ensurePane(this.MEASURE_ID);
          layer.options.renderer = renderer;
        }

        return origAdd(layer);
      };
    }

    _registerToLayerControl() {
      if (this.isRegistered) return;
      this.isRegistered = true;
      window.foliplus.LayerControlAPI.registerLayer({
        name: _('measure.tool_toggle'),
        id: this.MEASURE_ID,
        isBase: false,
        layer: this.layerGroup,
        paneName: this.MEASURE_ID,
        iconSvg: SVGS.RULER,
      });
    }

    _unregisterFromLayerControl() {
      const hasContent = Object.keys(this.layerGroup._layers || {}).length > 0;
      if (!hasContent && this.isRegistered) {
        this.isRegistered = false;
        window.foliplus.LayerControlAPI.unregisterLayer(this.MEASURE_ID);
      }
    }

    _bindGlobalEvents() {
      this.map.on('click', (e) => {
        if (this.suppressHideDel) return;
        const t = e.originalEvent?.target;
        if (t?.closest?.('.measure-del-icon')) return;
        MeasureUtils.hideAllDelIcons();
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.currentMode) {
          this.clearActiveMode();
        }
      });

      this.map.on('unload', () => this.clearAll());
    }

    attachUIBtns(btns) {
      this.toolBtns = btns;
    }

    setMode(mode) {
      if (mode === 'clear') {
        this.clearAll();
        return;
      }
      if (this.currentMode === mode) {
        this.clearActiveMode();
        return;
      }

      this._cleanMapEvents();
      this.currentMode = mode;

      this.toolBtns.forEach(btn =>
        btn.classList.toggle('active', btn.dataset.mode === mode)
      );

      this.map.getContainer().style.cursor = 'crosshair';

      if (mode === 'marker') {
        window.foliplus.showHint('measure', _('measure.hint_marker'), 0);
        this._bindMarkerMode();
      } else if (mode === 'distance') {
        window.foliplus.showHint('measure', _('measure.hint_dist_start'), 0);
        this._startDistanceMode();
      } else if (mode === 'circle') {
        window.foliplus.showHint('measure', _('measure.hint_circle_start'), 0);
        this._startCircleMode();
      }
    }

    clearActiveMode() {
      this.currentMode = null;
      this.toolBtns.forEach(btn => btn.classList.remove('active'));
      window.foliplus.hideHint('measure');
      this.map.getContainer().style.cursor = '';
      this._cleanMapEvents();
    }

    clearAll() {
      this.layerGroup.clearLayers();
      this._unregisterFromLayerControl();
      this.clearActiveMode();
    }

    _cleanMapEvents() {
      this.map.off('click', this._onMarkerClickRef);
      if (this.cleanupFn) {
        this.cleanupFn();
        this.cleanupFn = null;
      }
      window.foliplus.hideHint('measure');
    }

    // --- Marker (Locate) Mode ---
    _bindMarkerMode() {
      this._onMarkerClickRef = this._handleMarkerClick.bind(this);
      this.map.on('click', this._onMarkerClickRef);
      this.cleanupFn = () => this.map.off('click', this._onMarkerClickRef);
    }

    async _handleMarkerClick(e) {
      if (this.currentMode !== 'marker') return;
      const lat = e.latlng.lat.toFixed(6);
      const lng = e.latlng.lng.toFixed(6);

      const marker = window.foliplus.createLocationMarker(
        this.map, parseFloat(lat), parseFloat(lng), null, 'measure.popup',
        null, null, this.layerGroup
      );

      let cachedAddr = null;
      setTimeout(() => this._injectDelIcon(marker), 50);

      const addr = await window.foliplus.reverseGeocode(
        this.map, parseFloat(lat), parseFloat(lng)
      );
      cachedAddr = addr;

      if (marker?.getPopup?.()?.isOpen()) {
        marker.setPopupContent(
          window.foliplus.buildPopupHtml(lat, lng, addr, 'measure.popup')
        );
      }

      marker.on('popupopen', () => {
        MeasureUtils.hideAllDelIcons();
        if (cachedAddr !== null) {
          marker.setPopupContent(
            window.foliplus.buildPopupHtml(lat, lng, cachedAddr, 'measure.popup')
          );
        }
        this._injectDelIcon(marker);
        const el = marker.getElement();
        if (el) {
          const icon = el.querySelector('.measure-del-icon');
          if (icon) icon.classList.add('visible');
        }
      });

      marker.on('popupclose', () => {
        const el = marker.getElement();
        if (el) {
          const icon = el.querySelector('.measure-del-icon');
          if (icon) icon.classList.remove('visible');
        }
      });
    }

    _injectDelIcon(marker) {
      const el = marker.getElement();
      if (!el) return;
      if (el.querySelector('.measure-del-icon')) return;

      const iconDiv = el.querySelector('div');
      if (!iconDiv) return;

      const xIcon = document.createElement('span');
      xIcon.className = 'measure-del-icon';
      xIcon.style.cssText = 'position:absolute;top:-6px;left:20px;'
        + 'right:auto;margin:0;';
      xIcon.textContent = '✕';
      iconDiv.appendChild(xIcon);

      L.DomEvent.on(xIcon, 'click', (ev) => {
        MeasureUtils.stopEvent(ev);
        this.layerGroup.removeLayer(marker);
        this._unregisterFromLayerControl();
      });
    }

    // --- Distance Measurement Mode ---
    _startDistanceMode() {
      const pts = [];
      let total = 0;
      const poly = L.polyline([], {
        color: _CONST.COLOR_ACCENT,
        weight: _CONST.LINE_WEIGHT_FINAL,
        dashArray: _CONST.DASH_ARRAY_FINAL
      }).addTo(this.layerGroup);

      const nodeMarkers = [];
      const segLabels = [];
      let startLbl = null;

      const previewLine = L.polyline([], {
        color: _CONST.COLOR_ACCENT,
        weight: _CONST.LINE_WEIGHT_PREVIEW,
        dashArray: _CONST.DASH_ARRAY_PREVIEW,
        opacity: 0.6
      }).addTo(this.layerGroup);

      const cleanupEvents = () => {
        this.map.off('click', onDistClick);
        this.map.off('dblclick', onDistDbl);
        this.map.off('contextmenu', onDistContext);
        this.map.off('mousemove', onDistMove);
        this.layerGroup.removeLayer(previewLine);
      };

      const cancelCleanup = () => {
        cleanupEvents();
        this.layerGroup.removeLayer(poly);
        nodeMarkers.forEach(m => this.layerGroup.removeLayer(m));
        segLabels.forEach(l => this.layerGroup.removeLayer(l));
        if (startLbl) this.layerGroup.removeLayer(startLbl);
        if (previewDistLabel) this.layerGroup.removeLayer(previewDistLabel);
      };

      this.cleanupFn = cancelCleanup;
      let distFinished = false;
      let previewDistLabel = null;

      const finishDist = () => {
        if (distFinished) return;
        if (pts.length < 2) {
          cancelCleanup();
          this.clearActiveMode();
          return;
        }
        distFinished = true;
        this.layerGroup.removeLayer(poly);
        this.layerGroup.removeLayer(previewLine);
        if (previewDistLabel) {
          this.layerGroup.removeLayer(previewDistLabel); previewDistLabel = null;
        }

        const finalPoly = L.polyline(pts, {
          color: _CONST.COLOR_ACCENT,
          weight: _CONST.LINE_WEIGHT_FINAL,
          interactive: true
        }).addTo(this.layerGroup);

        let labelsVisible = true;
        let xVisible = false;
        let lastNodeDelMkr = null;

        const toggleUI = (showX, toggleLabels) => {
          const s = MeasureUtils.calcToggle(
            xVisible, labelsVisible, showX, toggleLabels
          );
          xVisible = s.xVisible;
          labelsVisible = s.labelsVisible;
          MeasureUtils.applyToggle(
            lastNodeDelMkr, xVisible, segLabels, labelsVisible, startLbl
          );
        };

        const handleItemClick = (e) => {
          MeasureUtils.stopEvent(e);
          this.suppressHideDel = true;
          setTimeout(() => { this.suppressHideDel = false; }, 100);
          MeasureUtils.hideAllDelIcons();
          toggleUI(undefined, true);
        };

        finalPoly.on('click', handleItemClick);
        nodeMarkers.forEach(m => m.on('click', handleItemClick));

        toggleUI(false, 'reset');

        const onDistMapClick = () => {
          if (this.suppressHideDel) return;
          if (xVisible) {
            toggleUI(false, false);
          }
        };
        this.map.on('click', onDistMapClick);
        this.cleanupFn = () => this.map.off('click', onDistMapClick);

        if (segLabels.length > 0) {
          const lastLbl = segLabels[segLabels.length - 1];
          lastLbl.setIcon(L.divIcon({
            className: '',
            html: `<div class="measure-label"
              style="transform:translateX(-50%);white-space:nowrap;">
              ${MeasureUtils.formatDistance(total)}</div>`,
            iconSize: [0, 0],
            iconAnchor: [0, -10],
          }));
        }

        const deleteMeasurement = () => {
          this.layerGroup.removeLayer(finalPoly);
          nodeMarkers.forEach(m => this.layerGroup.removeLayer(m));
          segLabels.forEach(l => this.layerGroup.removeLayer(l));
          if (startLbl) this.layerGroup.removeLayer(startLbl);
          if (lastNodeDelMkr) this.layerGroup.removeLayer(lastNodeDelMkr);
          this.map.off('click', onDistMapClick);
        };

        if (nodeMarkers.length > 0) {
          const lastNode = nodeMarkers[nodeMarkers.length - 1];
          lastNodeDelMkr = L.marker(lastNode.getLatLng(), {
            icon: L.divIcon({
              className: '',
              html: `<div style="position:relative;width:0;height:0;">
                ${MeasureUtils.getXIcon()}</div>`,
              iconSize: [0, 0],
              iconAnchor: [0, 0],
            }),
            interactive: true,
          }).addTo(this.layerGroup);

          setTimeout(() => {
            const el = lastNodeDelMkr.getElement();
            if (el) {
              const btn = el.querySelector('.measure-del-icon');
              if (btn) {
                L.DomEvent.on(btn, 'click', (ev) => {
                  MeasureUtils.stopEvent(ev);
                  deleteMeasurement();
                });
              }
            }
          }, 50);

          lastNodeDelMkr.on('click', (e) => {
            const t = e.originalEvent?.target;
            if (t?.classList?.contains('measure-del-icon')) return;
            handleItemClick(e);
          });
        }

        // Re-sort layer ordering
        nodeMarkers.forEach(m => this.layerGroup.removeLayer(m));
        if (lastNodeDelMkr) this.layerGroup.removeLayer(lastNodeDelMkr);
        segLabels.forEach(l => this.layerGroup.removeLayer(l));
        if (startLbl) this.layerGroup.removeLayer(startLbl);

        nodeMarkers.forEach(m => m.addTo(this.layerGroup));
        if (lastNodeDelMkr) lastNodeDelMkr.addTo(this.layerGroup);
        segLabels.forEach(l => l.addTo(this.layerGroup));
        if (startLbl) startLbl.addTo(this.layerGroup);

        cleanupEvents();
        this.clearActiveMode();
      };

      const onDistMove = (e) => {
        if (pts.length === 0) return;
        previewLine.setLatLngs([pts[pts.length - 1], e.latlng]);
        const seg = MeasureUtils.distance(
          pts[pts.length - 1].lat, pts[pts.length - 1].lng,
          e.latlng.lat, e.latlng.lng
        );
        const showDist = total + seg;
        if (!previewDistLabel) {
          previewDistLabel = L.marker(e.latlng, {
            icon: L.divIcon({
              className: '',
              html: `<div class="measure-label">
              ${MeasureUtils.formatDistance(showDist)}</div>`,
              iconSize: [0, 0],
              iconAnchor: [0, -10],
            }),
            interactive: false,
          }).addTo(this.layerGroup);
        } else {
          previewDistLabel.setLatLng(e.latlng);
          const el = previewDistLabel.getElement();
          if (el) {
            const div = el.querySelector('.measure-label');
            if (div) div.textContent = MeasureUtils.formatDistance(showDist);
          }
        }
      };

      const onDistClick = (e) => {
        if (this.currentMode !== 'distance') return;
        pts.push(e.latlng);
        poly.addLatLng(e.latlng);
        if (previewDistLabel) {
          this.layerGroup.removeLayer(previewDistLabel); previewDistLabel = null;
        }

        const mkr = L.circleMarker(e.latlng, {
          radius: _CONST.MARKER_RADIUS,
          color: _CONST.COLOR_ACCENT,
          fillColor: '#fff',
          fillOpacity: 1,
          weight: _CONST.LINE_WEIGHT_FINAL,
        }).addTo(this.layerGroup);
        mkr.bringToFront();
        nodeMarkers.push(mkr);

        if (pts.length === 1) {
          startLbl = L.marker(e.latlng, {
            icon: L.divIcon({
              className: '',
              html: `<div class="measure-label">${_('measure.dist_origin')}</div>`,
              iconSize: [0, 0],
              iconAnchor: [0, -10],
            }),
          }).addTo(this.layerGroup);
        }

        mkr.on('click', () => {
          if (pts.length < 2) return;
          if (mkr === nodeMarkers[nodeMarkers.length - 1]) finishDist();
        });

        if (pts.length > 1) {
          const seg = MeasureUtils.distance(
            pts[pts.length - 2].lat, pts[pts.length - 2].lng,
            pts[pts.length - 1].lat, pts[pts.length - 1].lng
          );
          total += seg;

          if (segLabels.length > 0) {
            const prevLbl = segLabels[segLabels.length - 1];
            const prevSeg = MeasureUtils.distance(
              pts[pts.length - 3].lat, pts[pts.length - 3].lng,
              pts[pts.length - 2].lat, pts[pts.length - 2].lng
            );
            prevLbl.setIcon(L.divIcon({
              className: '',
              html: `<div class="measure-label">
                ${MeasureUtils.formatDistance(prevSeg)}</div>`,
              iconSize: [0, 0],
              iconAnchor: [0, -10],
            }));
          }

          const lbl = L.marker(pts[pts.length - 1], {
            icon: L.divIcon({
              className: '',
              html: `<div class="measure-label">
                ${MeasureUtils.formatDistance(total)}</div>`,
              iconSize: [0, 0],
              iconAnchor: [0, -10],
            }),
          }).addTo(this.layerGroup);
          segLabels.push(lbl);
        }
      };

      const onDistDbl = (e) => {
        MeasureUtils.stopEvent(e);
        finishDist();
      };
      const onDistContext = (e) => {
        MeasureUtils.stopEvent(e);
        finishDist();
      };

      this.map.on('click', onDistClick);
      this.map.on('dblclick', onDistDbl);
      this.map.on('contextmenu', onDistContext);
      this.map.on('mousemove', onDistMove);
    }

    // --- Circle Drawing Mode ---
    _startCircleMode() {
      let center = null;
      let state = 0;
      let lastFinishTime = 0;
      const previews = {
        center: null, circle: null, line: null, node: null, label: null
      };

      const clearPreviews = () => {
        if (previews.center) this.layerGroup.removeLayer(previews.center);
        if (previews.circle) this.layerGroup.removeLayer(previews.circle);
        if (previews.line) this.layerGroup.removeLayer(previews.line);
        if (previews.node) this.layerGroup.removeLayer(previews.node);
        if (previews.label) this.layerGroup.removeLayer(previews.label);
        previews.center = previews.circle = previews.line =
          previews.node = previews.label = null;
      };

      const onMapClick = (e) => {
        if (this.currentMode !== 'circle' || (state !== 0 && state !== 1)) return;
        const now = Date.now();
        if (now - lastFinishTime < _CONST.CLICK_COOLDOWN_MS) return;

        if (state === 0) {
          center = e.latlng;
          previews.center = L.marker(center, {
            icon: L.divIcon({
              className: '',
              html: '<div style="width:10px;height:10px;background:#e74c3c;'
                + 'border:2px solid #fff;border-radius:50%;"></div>',
              iconSize: [10, 10],
              iconAnchor: [5, 5],
            }),
            zIndexOffset: 1000,
            interactive: false,
          }).addTo(this.layerGroup);
          state = 1;
          window.foliplus.showHint('measure', _('measure.hint_circle_radius'), 0);
        } else if (state === 1) {
          state = 2;
          lastFinishTime = Date.now();
          const r = MeasureUtils.distance(
            center.lat, center.lng, e.latlng.lat, e.latlng.lng
          );
          const savedCenter = center;
          const savedTarget = e.latlng;

          if (this.cleanupFn) this.cleanupFn();
          this.clearActiveMode();
          setTimeout(
            () => finalizeCircle(savedCenter, r, savedTarget),
            _CONST.FINALIZE_DELAY_MS
          );
        }
      };

      const onMouseMove = (e) => {
        if (state !== 1 || !center || this.currentMode !== 'circle') return;
        const r = MeasureUtils.distance(
          center.lat, center.lng, e.latlng.lat, e.latlng.lng
        );

        if (!previews.circle) {
          previews.circle = L.circle(center, {
            radius: r, color: _CONST.COLOR_ACCENT,
            weight: _CONST.LINE_WEIGHT_PREVIEW,
            dashArray: _CONST.DASH_ARRAY_PREVIEW,
            fillColor: _CONST.COLOR_ACCENT,
            fillOpacity: _CONST.PREVIEW_CIRCLE_FILL_OPACITY,
            interactive: false,
          }).addTo(this.layerGroup);
        } else {
          previews.circle.setRadius(r);
        }

        if (!previews.line) {
          previews.line = L.polyline([center, e.latlng], {
            color: _CONST.COLOR_ACCENT,
            weight: _CONST.LINE_WEIGHT_PREVIEW,
            dashArray: _CONST.DASH_ARRAY_PREVIEW,
            opacity: 0.8,
            interactive: false,
          }).addTo(this.layerGroup);
        } else {
          previews.line.setLatLngs([center, e.latlng]);
        }

        if (!previews.node) {
          previews.node = L.circleMarker(e.latlng, {
            radius: _CONST.PREVIEW_NODE_RADIUS,
            color: _CONST.COLOR_ACCENT,
            fillColor: '#fff', fillOpacity: 1,
            weight: 2, interactive: false,
          }).addTo(this.layerGroup);
          previews.node.bringToFront();
        } else {
          previews.node.setLatLng(e.latlng);
        }

        const mid = L.latLng(
          (center.lat + e.latlng.lat) / 2,
          (center.lng + e.latlng.lng) / 2
        );
        if (!previews.label) {
          previews.label = L.marker(mid, {
            interactive: false,
            icon: L.divIcon({
              className: '',
              html: `<div class="measure-label"
                style="transform:translate(-50%,-50%);">
                ${MeasureUtils.formatDistance(r)}</div>`,
              iconSize: [0, 0],
              iconAnchor: [0, 0],
            }),
          }).addTo(this.layerGroup);
        } else {
          previews.label.setLatLng(mid);
          const el = previews.label.getElement();
          if (el) {
            const div = el.querySelector('.measure-label');
            if (div) div.textContent = MeasureUtils.formatDistance(r);
          }
        }
      };

      const onContext = (e) => {
        MeasureUtils.stopEvent(e);
        this.clearActiveMode();
      };

      const finalizeCircle = (centerLatLng, r, targetLatLng) => {
        const finalTargetLatLng = targetLatLng
          || L.CRS.Earth.destination(centerLatLng, r, 90);

        const circle = L.circle(centerLatLng, {
          radius: r, color: _CONST.COLOR_ACCENT, weight: 2,
          fillColor: _CONST.COLOR_ACCENT,
          fillOpacity: _CONST.CIRCLE_FILL_OPACITY,
          interactive: true,
        }).addTo(this.layerGroup);

        const radiusLine = L.polyline([centerLatLng, finalTargetLatLng], {
          color: _CONST.COLOR_ACCENT, weight: 2, dashArray: '6 4',
          interactive: true,
        }).addTo(this.layerGroup);

        const midLat = (centerLatLng.lat + finalTargetLatLng.lat) / 2;
        const midLng = (centerLatLng.lng + finalTargetLatLng.lng) / 2;
        const radiusLabel = L.marker([midLat, midLng], {
          interactive: false,
          icon: L.divIcon({
            className: '',
            html: `<div class="measure-label"
              style="transform:translate(-50%,-50%);white-space:nowrap;">
              ${MeasureUtils.formatDistance(r)}</div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
        }).addTo(this.layerGroup);

        const radiusNode = L.circleMarker(finalTargetLatLng, {
          radius: _CONST.FINAL_NODE_RADIUS, color: _CONST.COLOR_ACCENT,
          fillColor: '#fff', fillOpacity: 1,
          weight: 2, interactive: true,
        }).addTo(this.layerGroup);
        radiusNode.bringToFront();

        let labelsVisible = true;
        let xVisible = false;

        const centerFinal = L.marker(centerLatLng, {
          icon: L.divIcon({
            className: '',
            html: '<div style="width:10px;height:10px;background:#e74c3c;'
              + 'border:2px solid #fff;border-radius:50%;'
              + 'box-shadow:0 0 4px rgba(0,0,0,0.3);"></div>',
            iconSize: [10, 10],
            iconAnchor: [5, 5],
          }),
          zIndexOffset: 1000,
          interactive: true,
        }).addTo(this.layerGroup);

        const delMkr = L.marker(centerLatLng, {
          icon: L.divIcon({
            className: '',
            html: `<div style="position:relative;width:0;height:0;">
              ${MeasureUtils.getXIcon()}</div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
          interactive: true,
          zIndexOffset: 1000,
        }).addTo(this.layerGroup);

        const toggleUI = (showX, toggleLabels) => {
          const s = MeasureUtils.calcToggle(
            xVisible, labelsVisible, showX, toggleLabels
          );
          xVisible = s.xVisible;
          labelsVisible = s.labelsVisible;
          MeasureUtils.applyToggle(
            delMkr, xVisible, [radiusLabel], labelsVisible
          );
          if (radiusLine) {
            radiusLine.setStyle({ opacity: labelsVisible ? 1 : 0 });
          }
          if (radiusNode) {
            radiusNode.setStyle({
              opacity: labelsVisible ? 1 : 0,
              fillOpacity: labelsVisible ? 1 : 0,
            });
          }
          if (delMkr.setZIndexOffset) {
            delMkr.setZIndexOffset(xVisible ? 2000 : 1000);
          }
        };
        toggleUI(false, 'reset');

        let deleted = false;
        const deleteCircle = () => {
          if (deleted) return;
          deleted = true;
          this.layerGroup.removeLayer(delMkr);
          this.layerGroup.removeLayer(circle);
          this.layerGroup.removeLayer(centerFinal);
          if (radiusLine) this.layerGroup.removeLayer(radiusLine);
          if (radiusNode) this.layerGroup.removeLayer(radiusNode);
          if (radiusLabel) this.layerGroup.removeLayer(radiusLabel);
          this.map.off('click', onMapClickActive);
        };

        setTimeout(() => {
          const el = delMkr.getElement();
          if (el) {
            const btn = el.querySelector('.measure-del-icon');
            if (btn) {
              L.DomEvent.on(btn, 'click', (ev) => {
                MeasureUtils.stopEvent(ev);
                deleteCircle();
              });
            }
          }
        }, 50);

        const toggleCircleToggle = () => {
          if (deleted) return;
          this.suppressHideDel = true;
          setTimeout(() => { this.suppressHideDel = false; }, 100);
          MeasureUtils.hideAllDelIcons();
          toggleUI(undefined, true);
        };

        const attachInteraction = (layer) => {
          layer.on('click', (e) => {
            const t = e.originalEvent?.target;
            if (t?.classList?.contains('measure-del-icon')) return;
            MeasureUtils.stopEvent(e);
            toggleCircleToggle();
          });
        };

        attachInteraction(delMkr);
        attachInteraction(circle);
        attachInteraction(radiusLine);
        attachInteraction(radiusNode);
        attachInteraction(centerFinal);

        const onMapClickActive = () => {
          if (this.suppressHideDel || deleted) return;
          if (xVisible) toggleUI(false, false);
        };
        this.map.on('click', onMapClickActive);
      };

      this.map.on('click', onMapClick);
      this.map.on('mousemove', onMouseMove);
      this.map.on('contextmenu', onContext);

      this.cleanupFn = () => {
        this.map.off('click', onMapClick);
        this.map.off('mousemove', onMouseMove);
        this.map.off('contextmenu', onContext);
        clearPreviews();
        window.foliplus.hideHint('measure');
      };
    }
  }

  // ==================== Initialization & Control Construction ====================
  const measureManager = new MeasureManager(map);

  class MeasureControl extends L.Control {
    onAdd() {
      const position = '{{ this.position }}';
      const isLeft = position.indexOf('left') >= 0;

      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      const ctrl = L.DomUtil.create(
        'div', 'measure-ctrl ctrl-fold collapsed', container
      );
      ctrl.id = '{{ this.get_name() }}_ctrl';

      ctrl.innerHTML = `
        <button class="toggle-btn" title="${_('measure.tool_toggle')}">
          ${SVGS.RULER}
        </button>
        <div class="tool-bar">
          <button class="tool-btn" data-mode="marker"
            title="${_('measure.tool_marker')}">${window.foliplus.SVGs.LOCATE}</button>
          <button class="tool-btn" data-mode="distance"
            title="${_('measure.tool_distance')}">${SVGS.RULER}</button>
          <button class="tool-btn" data-mode="circle"
            title="${_('measure.tool_circle')}">${SVGS.CIRCLE}</button>
          <button class="tool-btn" data-mode="clear"
            title="${_('measure.tool_clear')}">${SVGS.TRASH}</button>
        </div>
      `;

      if (!isLeft) ctrl.classList.add('align-right');
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      const toggleBtn = container.querySelector('.toggle-btn');
      const toolBtns = container.querySelectorAll('.tool-btn');

      measureManager.attachUIBtns(toolBtns);

      toggleBtn.onclick = (e) => {
        e.stopPropagation();
        ctrl.classList.toggle('collapsed');
        ctrl.classList.toggle('expanded');
      };

      window.foliplus.bindOutsideCollapse({
        map,
        container: ctrl,
        shouldCollapse: () => !measureManager.currentMode,
        onCollapse: () => measureManager.clearActiveMode(),
      });

      toolBtns.forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          measureManager.setMode(btn.dataset.mode);
        };
      });

      return container;
    }
  }

  new MeasureControl({ position: '{{ this.position }}' }).addTo(map);
})();

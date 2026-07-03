(function() {
  // ==================== Constants ====================
  const _CONST = {
    ZOOM_DEBOUNCE_MS: 200,
    LAYER_SCAN_DEBOUNCE_MS: 200,
    INIT_SCAN_ATTEMPTS: 5,
    INIT_SCAN_INTERVAL_MS: 300,
    SCHEME_DROPDOWN_BLUR_DELAY_MS: 150,
    DEFAULT_GRAY: '#999',
    LABEL_SIZE: [80, 24],
    LABEL_ANCHOR: [40, 12],
    H3_RES_MAP: [
      [2, 0], [3, 1], [4, 1], [5, 2], [6, 3], [7, 3], [8, 4], [9, 5],
      [10, 6], [11, 6], [12, 7], [13, 7], [14, 8], [15, 9], [16, 9],
      [17, 10], [18, 11], [19, 11], [20, 12],
    ],
  };

  // ==================== Dependencies ====================
  const map = {{ this._parent.get_name() }};
  const foliplus = window.foliplus;
  const _ = (key) => (window._LOCALE && window._LOCALE[key]) || key;

  // Hexagon SVG icon
  const SVG_HEX = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
      <polygon points="12 3 20.5 7.5 20.5 16.5 12 21 3.5 16.5 3.5 7.5"/>
      <polygon points="12 7 16 9.5 16 14.5 12 17 8 14.5 8 9.5" opacity="0.5"/>
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>
    </svg>`;

  foliplus.registerHintIcon('heatmap', SVG_HEX);

  // --- Dynamic Dependency Loader ---
  // Loads CDN scripts at runtime via shared foliplus.loadScripts.
  const _DEPS = [
    { name: 'h3', url: 'https://cdn.jsdelivr.net/npm/h3-js@{{ this._h3_version }}/dist/h3-js.umd.js',
      check: () => typeof h3 !== 'undefined' },
    { name: 'ss', url: 'https://cdn.jsdelivr.net/npm/simple-statistics@{{ this._ss_version }}/' +
      'dist/simple-statistics.min.js',
      check: () => typeof ss !== 'undefined' },
    { name: 'chroma', url: 'https://cdn.jsdelivr.net/npm/chroma-js@{{ this._chroma_version }}/chroma.min.js',
      check: () => typeof chroma !== 'undefined' },
  ];

  foliplus.loadScripts(_DEPS, function (ok, failed) {
    if (ok && typeof h3 !== 'undefined' && typeof ss !== 'undefined') {
      return run();
    }
    // Final failure — show hint + console
    const names = (failed || _DEPS.filter(d => !d.check()).map(d => d.name)).join(', ');
    console.error(`[HeatmapControl] ${_('heatmap.no_h3')}`);
    foliplus.showHint('heatmap', _('heatmap.no_h3'), 0); // 0 = persistent until hidden
  }, 2, 3000); // retry 2×, every 3s

  function run() {
    // ==================== Injected Variables ====================
    const AGG_DEFAULT = '{{ this.agg }}';
    const FIELD_DEFAULT = '{{ this.style.field }}';
    const COLOR_SCHEME = '{{ this.color_scheme }}';
    const COLOR_METHOD = '{{ this.method }}';
    const N_CLASSES_DEFAULT = {{ this.n_classes }};
    const BORDER_W_DEFAULT = {{ this.style.border_weight }};
    const BORDER_COLOR_DEFAULT = '{{ this.style.border_color }}';
    const FILL_OP = {{ this.style.fill_opacity }};
    const BORDER_OP = {{ this.style.border_opacity }};
    const LABEL_SHOW = {{ "true" if this.style.label_show else "false" }};
    const LABEL_SIZE = {{ this.style.label_size }};
    const LABEL_COLOR = '{{ this.style.label_color }}';
    const FORMAT = '{{ this.style.label_format }}';
    const SCHEME_NAMES = {{ this.schemes | tojson }};

    // ==================== Core: Data Aggregation & Rendering ====================
    class HeatmapManager {
      constructor(mapInstance) {
        this.map = mapInstance;

        // State management
        this.selectedLayerId = null;
        this.pointLayers = [];
        this.currentAgg = AGG_DEFAULT;
        this.currentField = FIELD_DEFAULT;
        this.BORDER_W = BORDER_W_DEFAULT;
        this.BORDER_COLOR = BORDER_COLOR_DEFAULT;
        this.currentScheme = COLOR_SCHEME;
        this.currentMethod = COLOR_METHOD;
        this.N_CLASSES = N_CLASSES_DEFAULT;
        this.currentLabelShow = LABEL_SHOW;

        this.HEATMAP_ID = '__heatmap__';
        this.LABEL_PANE = '__heatmap_label__';
        this.hexLayerRegistered = false;
        this.ui = null; // Injected UI control panel instance

        this._initLayers();
        this._bindMapEvents();
      }

      _initLayers() {
        this.heatmapLayer = L.layerGroup();
        this.hexLayer = L.geoJSON(null, {
          style: (feat) => ({
            fillColor: feat.properties._fillColor || _CONST.DEFAULT_GRAY,
            fillOpacity: FILL_OP,
            color: this.BORDER_COLOR,
            weight: this.BORDER_W,
            opacity: BORDER_OP,
          }),
          interactive: false,
          pane: this.HEATMAP_ID,
        });
        this.labelLayer = L.layerGroup();

        this.heatmapLayer.addLayer(this.hexLayer);
        this.heatmapLayer.addLayer(this.labelLayer);
      }

      _bindMapEvents() {
        this.zoomTimer = null;
        this.map.on('zoomend', () => {
          if (this.zoomTimer) clearTimeout(this.zoomTimer);
          this.zoomTimer = setTimeout(() => {
            if (this.selectedLayerId) this.renderHexagons();
          }, _CONST.ZOOM_DEBOUNCE_MS);
        });

        this.layerScanTimer = null;
        this.map.on('layeradd layerremove', () => {
          if (this.layerScanTimer) clearTimeout(this.layerScanTimer);
          this.layerScanTimer = setTimeout(() => {
            if (this.ui) {
              this.scanMapLayers();
              this.ui.rebuildLayerDropdown();
            }
          }, _CONST.LAYER_SCAN_DEBOUNCE_MS);
        });
      }

      // --- Data Extraction ---
      scanMapLayers() {
        this.pointLayers = [];
        if (!window.foliplus.LayerControlAPI) return;

        const pointLayersInfo =
          window.foliplus.LayerControlAPI.getLayersByType('point');
        if (!pointLayersInfo.length) return;

        const seenIds = {};
        for (const info of pointLayersInfo) {
          if (seenIds[info.id]) continue;
          seenIds[info.id] = true;
          const layer = this.map._layers[info.id] || window[info.id];
          if (!layer) continue;

          const pts = this.extractPoints(layer);
          if (pts.length === 0) continue;
          this.pointLayers.push({
            id: info.id, name: info.name, layer, count: pts.length
          });
        }
      }

      extractPoints(layer) {
        const pts = [];
        const seen = {};
        const walk = (l) => {
          if (l instanceof L.Marker || l instanceof L.CircleMarker) {
            // Only count markers that have a .feature property — these are
            // actual data markers created by df.explore / GeoJSON. Label/
            // annotation markers (Text, divIcon) lack .feature and are
            // skipped, avoiding double-counting in hexbin aggregation.
            if (!l.feature) return;
            const lid = L.stamp(l);
            if (seen[lid]) return;
            seen[lid] = true;
            const ll = l.getLatLng();
            pts.push({ lat: ll.lat, lng: ll.lng, marker: l });
          } else if (l.getLayers) {
            l.getLayers().forEach(walk);
          }
        };
        walk(layer);
        return pts;
      }

      collectFields(layers) {
        const fields = {};
        layers.forEach((info) => {
          this.extractPoints(info.layer).forEach((pt) => {
            const m = pt.marker;
            if (m._value !== undefined) fields._value = true;
            if (m.options?.value !== undefined) fields['options.value'] = true;
            if (m.feature?.properties) {
              Object.keys(m.feature.properties).forEach((k) => {
                if (typeof m.feature.properties[k] === 'number')
                  fields[`properties.${k}`] = true;
              });
            }
          });
        });
        return Object.keys(fields);
      }

      getPointValue(marker) {
        if (this.currentAgg === 'count') return 1;
        let val;
        if (this.currentField === '_auto') {
          val = marker._value ??
            marker.options?.value ??
            marker.feature?.properties?.value;
        } else if (this.currentField === '_value') {
          val = marker._value;
        } else if (this.currentField === 'options.value') {
          val = marker.options?.value;
        } else if (this.currentField.startsWith('properties.')) {
          const key = this.currentField.substring(11);
          val = marker.feature?.properties?.[key];
        }
        return val !== undefined && !isNaN(val) ? Number(val) : 1;
      }

      collectSelectedPoints() {
        const pts = [];
        if (!this.selectedLayerId) return pts;
        this.pointLayers.forEach((info) => {
          if (info.id === this.selectedLayerId) {
            this.extractPoints(info.layer).forEach((p) => {
              pts.push({
                lat: p.lat,
                lng: p.lng,
                value: this.getPointValue(p.marker),
                marker: p.marker,
              });
            });
          }
        });
        return pts;
      }

      // --- Algorithm Configuration ---
      getH3Res(zoom) {
        const entry = _CONST.H3_RES_MAP.find(([z]) => zoom <= z);
        return entry ? entry[1] : 12;
      }

      getColorScale(name, n) {
        if (typeof chroma !== 'undefined') {
          return chroma.scale(name).mode('lab').colors(n);
        }
        return Array(n).fill(_CONST.DEFAULT_GRAY);
      }

      computeBreaks(data, nClasses, method) {
        if (data.length === 0) return [];
        const sorted = data.slice().sort((a, b) => a - b);
        const n = sorted.length;
        if (n <= 2) return [sorted[0], sorted[n - 1]];
        nClasses = Math.min(nClasses, n);
        if (nClasses < 3) nClasses = Math.min(3, n);

        const lo = sorted[0];
        const hi = sorted[n - 1];

        if (method === 'jenks') {
          try { return ss.jenks(data, nClasses); } catch (e) {}
          return [lo, hi];
        }
        if (method === 'quantile') {
          const b = [lo];
          for (let i = 1; i < nClasses; i++) {
            b.push(ss.quantile(sorted, i / nClasses));
          }
          return b.concat(hi);
        }
        if (method === 'heads') {
          const b = [lo];
          for (let i = 1; i < nClasses; i++) {
            b.push(sorted[Math.min(Math.floor(i * n / nClasses), n - 1)]);
          }
          return b.concat(hi);
        }
        const step = (hi - lo) / nClasses;
        const b = [];
        for (let i = 0; i <= nClasses; i++) {
          b.push(lo + step * i);
        }
        return b;
      }

      // --- Hexagon Rendering ---
      renderHexagons() {
        if (!this.selectedLayerId) {
          this.hexLayer.clearLayers();
          this.labelLayer.clearLayers();
          this.unregisterHexLayer();
          return;
        }
        const pts = this.collectSelectedPoints();
        const zoom = this.map.getZoom();
        const res = this.getH3Res(zoom);
        const hexCells = {};

        pts.forEach((pt) => {
          try {
            const h3Idx = h3.latLngToCell(pt.lat, pt.lng, res);
            if (!hexCells[h3Idx]) {
              hexCells[h3Idx] = {
                sum: 0, count: 0, min: Infinity, max: -Infinity
              };
            }
            const cell = hexCells[h3Idx];
            cell.sum += pt.value;
            cell.count += 1;
            if (pt.value < cell.min) cell.min = pt.value;
            if (pt.value > cell.max) cell.max = pt.value;
          } catch (e) {}
        });

        const getAggValue = (cell) => {
          switch (this.currentAgg) {
            case 'count': return cell.count;
            case 'sum': return cell.sum;
            case 'avg': return cell.count > 0 ? cell.sum / cell.count : 0;
            case 'min': return cell.min;
            case 'max': return cell.max;
            default: return cell.count;
          }
        };

        const allVals = Object.values(hexCells).map(getAggValue);
        if (allVals.length === 0) {
          this.hexLayer.clearLayers();
          this.labelLayer.clearLayers();
          this.unregisterHexLayer();
          return;
        }

        const nClasses = Math.min(this.N_CLASSES, allVals.length);
        const breaks = this.computeBreaks(
          allVals, nClasses, this.currentMethod
        );
        const classColors = this.getColorScale(this.currentScheme, nClasses);

        const valueToClassIdx = (val) => {
          if (breaks.length < 2) return 0;
          for (let i = 1; i < breaks.length; i++) {
            if (val <= breaks[i]) return i - 1;
          }
          return breaks.length - 2;
        };

        const features = [];
        for (const [h3Idx, cell] of Object.entries(hexCells)) {
          const val = getAggValue(cell);
          const classIdx = valueToClassIdx(val);
          const fillColor = classColors[classIdx];
          try {
            const boundary = h3.cellToBoundary(h3Idx);
            const coords = boundary.map((p) => [p[1], p[0]]);
            coords.push(coords[0]);
            features.push({
              type: 'Feature',
              geometry: { type: 'Polygon', coordinates: [coords] },
              properties: {
                _value: val, _classIdx: classIdx,
                _fillColor: fillColor, _h3: h3Idx
              },
            });
          } catch (e) {}
        }

        // Register with LayerControl BEFORE adding data, so enforceOrder()
        // runs while heatmapLayer is empty — avoid removeLayer/addLayer
        // disrupting already-rendered hexagons and labels.
        this.registerHexLayer();

        this.hexLayer.clearLayers();
        if (features.length) {
          this.hexLayer.addData({ type: 'FeatureCollection', features });
        }

        this.labelLayer.clearLayers();

        // Keep label pane at same z-index as hex pane
        // (DOM order ensures labels render above hexagons within same
        // z-index; other interleaved layers manage their own panes)
        let lblPane = this.map.getPane(this.LABEL_PANE);
        let hexPane = this.map.getPane(this.HEATMAP_ID);
        if (lblPane && hexPane) {
          lblPane.style.zIndex = hexPane.style.zIndex || 500;
        }

        if (this.currentLabelShow) {
          features.forEach((feat) => {
            let lat, lng;
            try {
              const centerLatLng = h3.cellToLatLng(feat.properties._h3);
              lat = centerLatLng[0];
              lng = centerLatLng[1];
            } catch (e) {
              const ring = feat.geometry.coordinates[0];
              let cx = 0, cy = 0;
              for (let j = 0; j < ring.length - 1; j++) {
                cx += ring[j][0];
                cy += ring[j][1];
              }
              lng = cx / (ring.length - 1);
              lat = cy / (ring.length - 1);
            }

            const labelStr = foliplus.formatNumber(feat.properties._value, FORMAT);

            L.marker([lat, lng], {
              icon: L.divIcon({
                className: 'leaflet-marker-icon heatmap-label',
                html: `<div class="heatmap-label-inner" style="
                  font-size: ${LABEL_SIZE}px; color: ${LABEL_COLOR};
                ">${labelStr}</div>`,
                iconSize: _CONST.LABEL_SIZE,
                iconAnchor: _CONST.LABEL_ANCHOR,
              }),
              interactive: false,
              pane: this.LABEL_PANE,
            }).addTo(this.labelLayer);
          });
        }
      }

      registerHexLayer() {
        if (this.hexLayerRegistered) return;
        this.hexLayerRegistered = true;
        window.foliplus.LayerControlAPI.registerLayer({
          name: _('heatmap.title'),
          id: this.HEATMAP_ID,
          isBase: false,
          layer: this.heatmapLayer,
          paneName: this.HEATMAP_ID,
          iconSvg: SVG_HEX,
        });
        // Ensure label pane exists at same z-index as hex pane
        let lblPane = this.map.getPane(this.LABEL_PANE);
        if (!lblPane) {
          lblPane = this.map.createPane(this.LABEL_PANE);
        }
        let hexPane = this.map.getPane(this.HEATMAP_ID);
        if (hexPane) {
          lblPane.style.zIndex = hexPane.style.zIndex || 500;
        }
      }

      unregisterHexLayer() {
        if (!this.hexLayerRegistered) return;
        this.hexLayerRegistered = false;
        window.foliplus.LayerControlAPI.unregisterLayer(this.HEATMAP_ID);
      }
    }

    // ==================== View & Control: HeatmapControl ====================
    class HeatmapControl extends L.Control {
      constructor(options, manager) {
        super(options);
        this.manager = manager;
        this.manager.ui = this;

        this.schemeDropdown = null;
        this.expandHookDone = false;
      }

      onAdd() {
        const wrapper = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        this.container = L.DomUtil.create(
          'div',
          'map-panel ctrl-fold heatmap-ctrl collapsed',
          wrapper
        );
        L.DomEvent.disableClickPropagation(wrapper);
        L.DomEvent.disableScrollPropagation(wrapper);

        const toggleBtn = L.DomUtil.create('button', 'toggle-btn', this.container);
        toggleBtn.title = _('heatmap.title');
        toggleBtn.innerHTML = SVG_HEX;

        const panelWrap = L.DomUtil.create('div', 'panel-wrap', this.container);
        const header = L.DomUtil.create('div', 'panel-header', panelWrap);
        header.innerHTML = `
          <span class="header-title">
            <span class="header-icon">${SVG_HEX}</span>
            ${_('heatmap.title')}
          </span>
          <button class="close-btn" title="${_('layer.close_title')}">
            ${foliplus.SVGs.CLOSE}</button>`;

        foliplus.bindPanelToggle({
          container: this.container,
          toggleBtn: '.toggle-btn',
          header: '.panel-header'
        });
        foliplus.bindOutsideCollapse({
          map: this.manager.map, container: this.container
        });

        const content = L.DomUtil.create('div', 'panel-content', panelWrap);
        const configBody = L.DomUtil.create('div', 'config-body', content);
        const dataHeading = L.DomUtil.create('div', 'section-heading', configBody);
        dataHeading.textContent = _('heatmap.section_data');

        const layerRow = L.DomUtil.create('div', 'form-row', configBody);
        const layerRowLabel = L.DomUtil.create('label', 'form-label', layerRow);
        layerRowLabel.textContent = _('heatmap.layer');
        const layerSelectWrap = L.DomUtil.create('div', 'form-control-wrap', layerRow);
        this.layerSelect = L.DomUtil.create('select', 'form-select', layerSelectWrap);
        this.layerSelect.classList.add('layer-select');
        this.buildLayerListItems(this.layerSelect);
        this.extraBody = L.DomUtil.create('div', 'extra-body', configBody);
        this.extraBody.style.display = 'none';

        // Aggregation method
        const aggRow = L.DomUtil.create('div', 'form-row', this.extraBody);
        const aggRowLabel = L.DomUtil.create('label', 'form-label', aggRow);
        aggRowLabel.textContent = _('heatmap.agg_method');
        const aggControlWrap = L.DomUtil.create('div', 'form-control-wrap', aggRow);
        this.aggSelect = L.DomUtil.create('select', 'form-select', aggControlWrap);
        this.aggSelect.innerHTML = `
          <option value="count">${_('heatmap.agg_count')}</option>
          <option value="sum">${_('heatmap.agg_sum')}</option>
          <option value="avg">${_('heatmap.agg_avg')}</option>
          <option value="min">${_('heatmap.agg_min')}</option>
          <option value="max">${_('heatmap.agg_max')}</option>`;
        this.aggSelect.value = this.manager.currentAgg;
        this.aggSelect.onchange = () => {
          this.manager.currentAgg = this.aggSelect.value;
          this.updateFieldSelector();
          this.manager.renderHexagons();
        };

        this.fieldWrap = L.DomUtil.create(
          'div', 'form-row field-wrap hidden', this.extraBody
        );
        const fieldLabel = L.DomUtil.create('label', 'form-label', this.fieldWrap);
        fieldLabel.textContent = _('heatmap.field');
        const fieldControlWrap = L.DomUtil.create(
          'div', 'form-control-wrap', this.fieldWrap
        );
        this.fieldSelect = L.DomUtil.create('select', 'form-select', fieldControlWrap);
        this.fieldSelect.onchange = () => {
          this.manager.currentField = this.fieldSelect.value;
          this.manager.renderHexagons();
        };

        // Style section
        const styleHeading = L.DomUtil.create('div', 'section-heading', this.extraBody);
        styleHeading.textContent = _('heatmap.section_style');
        const styleSection = L.DomUtil.create('div', 'section-block', this.extraBody);

        // Classification method / classes
        const classRow = L.DomUtil.create('div', 'form-row', styleSection);
        const classRowLabel = L.DomUtil.create('label', 'form-label', classRow);
        classRowLabel.textContent = _('heatmap.class_method');
        const classControlWrap = L.DomUtil.create(
          'div', 'form-control-wrap form-control-inline', classRow
        );
        this.methodSelect = L.DomUtil.create('select', 'form-select', classControlWrap);
        this.methodSelect.innerHTML = `
          <option value="jenks">${_('heatmap.jenks')}</option>
          <option value="quantile">${_('heatmap.quantile')}</option>
          <option value="equal">${_('heatmap.equal')}</option>
          <option value="heads">${_('heatmap.heads')}</option>`;
        this.methodSelect.value = this.manager.currentMethod;
        this.methodSelect.onchange = () => {
          this.manager.currentMethod = this.methodSelect.value;
          this.manager.renderHexagons();
        };

        this.classSelect = L.DomUtil.create(
          'select', 'form-select class-count-select', classControlWrap
        );
        for (let ci = 2; ci <= 9; ci++) {
          const co = document.createElement('option');
          co.value = ci;
          co.textContent = ci;
          this.classSelect.appendChild(co);
        }
        this.classSelect.value = this.manager.N_CLASSES;
        this.classSelect.onchange = () => {
          this.manager.N_CLASSES = parseInt(this.classSelect.value, 10);
          this.updateSchemeBar();
          if (this.schemeDropdown) this.refreshSchemeDropdownItems();
          this.manager.renderHexagons();
        };

        // Color scheme
        const schemeRow = L.DomUtil.create('div', 'form-row', styleSection);
        const schemeRowLabel = L.DomUtil.create('label', 'form-label', schemeRow);
        schemeRowLabel.textContent = _('heatmap.scheme');
        this.schemeControlWrap = L.DomUtil.create(
          'div', 'form-control-wrap', schemeRow
        );
        this.schemeBar = L.DomUtil.create('div', 'scheme-bar', this.schemeControlWrap);
        this.schemeBarInner = L.DomUtil.create(
          'div', 'scheme-bar-inner', this.schemeBar);
        this.schemeSelectHidden = L.DomUtil.create(
          'select', 'scheme-select-hidden', this.schemeControlWrap
        );

        SCHEME_NAMES.forEach((name) => {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          this.schemeSelectHidden.appendChild(opt);
        });
        this.schemeSelectHidden.value = this.manager.currentScheme;
        this.schemeSelectHidden.onchange = () => {
          this.manager.currentScheme = this.schemeSelectHidden.value;
          this.updateSchemeBar();
          this.manager.renderHexagons();
        };

        this.updateSchemeBar();

        this.schemeBar.tabIndex = 0;
        this.schemeBar.setAttribute('role', 'combobox');
        this.schemeBar.setAttribute('aria-label', _('heatmap.scheme'));
        this.schemeBar.onclick = (e) => {
          e.stopPropagation();
          this.toggleSchemeDropdown();
        };
        this.schemeBar.onkeydown = (e) => {
          if (['Enter', ' ', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            e.preventDefault();
            this.toggleSchemeDropdown();
          }
        };
        this.schemeBar.onblur = () => {
          setTimeout(() => {
            if (
              this.schemeDropdown &&
              !this.schemeDropdown.contains(document.activeElement)
            ) {
              this.schemeDropdown.remove();
              this.schemeDropdown = null;
            }
          }, _CONST.SCHEME_DROPDOWN_BLUR_DELAY_MS);
        };

        // Border settings
        const borderRow = L.DomUtil.create('div', 'form-row', styleSection);
        const borderRowLabel = L.DomUtil.create('label', 'form-label', borderRow);
        borderRowLabel.textContent = _('heatmap.border');
        const borderControlWrap = L.DomUtil.create(
          'div', 'form-control-wrap form-control-inline', borderRow
        );
        this.borderColorInput = L.DomUtil.create(
          'input', 'border-color-input', borderControlWrap
        );
        this.borderColorInput.type = 'color';
        this.borderColorInput.value = this.manager.BORDER_COLOR;
        this.borderColorInput.onchange = () => {
          this.manager.BORDER_COLOR = this.borderColorInput.value;
          this.manager.renderHexagons();
        };
        this.borderWeightInput = L.DomUtil.create(
          'input', 'border-weight-input', borderControlWrap
        );
        this.borderWeightInput.type = 'number';
        this.borderWeightInput.min = 0;
        this.borderWeightInput.max = 10;
        this.borderWeightInput.step = 0.5;
        this.borderWeightInput.value = this.manager.BORDER_W;
        this.borderWeightInput.onchange = () => {
          this.manager.BORDER_W = parseFloat(this.borderWeightInput.value) || 1;
          this.manager.renderHexagons();
        };

        // Label toggle
        const labelRow = L.DomUtil.create(
          'div', 'form-row section-block-last', styleSection
        );
        const labelRowText = L.DomUtil.create('label', 'form-label', labelRow);
        labelRowText.textContent = _('heatmap.label');
        const labelControlWrap = L.DomUtil.create('div', 'form-control-wrap', labelRow);
        const labelToggle = L.DomUtil.create(
          'label', 'toggle-switch', labelControlWrap);
        this.labelChk = L.DomUtil.create('input', '', labelToggle);
        this.labelChk.type = 'checkbox';
        this.labelChk.checked = this.manager.currentLabelShow;
        this.labelChk.onchange = () => {
          this.manager.currentLabelShow = this.labelChk.checked;
          this.manager.renderHexagons();
        };
        L.DomUtil.create('span', 'toggle-slider', labelToggle);
        L.DomUtil.create('hr', 'section-divider', this.extraBody);

        // Bottom action buttons
        const btnRow = L.DomUtil.create('div', 'btn-row', this.extraBody);
        const clearBtn = L.DomUtil.create('button', 'btn btn-clear', btnRow);
        clearBtn.textContent = _('heatmap.clear');
        clearBtn.onclick = () => {
          this.manager.selectedLayerId = null;
          this.layerSelect.value = '';
          this.manager.currentAgg = AGG_DEFAULT;
          this.aggSelect.value = AGG_DEFAULT;
          this.manager.currentField = FIELD_DEFAULT;
          this.manager.N_CLASSES = N_CLASSES_DEFAULT;
          this.classSelect.value = String(N_CLASSES_DEFAULT);
          this.manager.currentMethod = COLOR_METHOD;
          this.methodSelect.value = COLOR_METHOD;
          this.manager.currentScheme = COLOR_SCHEME;
          this.schemeSelectHidden.value = COLOR_SCHEME;
          this.manager.currentLabelShow = LABEL_SHOW;
          this.labelChk.checked = LABEL_SHOW;
          this.manager.BORDER_W = BORDER_W_DEFAULT;
          this.borderWeightInput.value = BORDER_W_DEFAULT;
          this.manager.BORDER_COLOR = BORDER_COLOR_DEFAULT;
          this.borderColorInput.value = BORDER_COLOR_DEFAULT;

          this.manager.hexLayer.clearLayers();
          this.manager.labelLayer.clearLayers();
          this.manager.unregisterHexLayer();
          this.updateSchemeBar();
          this.updateFieldSelector();
          this.extraBody.style.display = 'none';
          this.container.classList.remove('expanded');
          this.container.classList.add('collapsed');
          if (this.layerSelect.value === '') {
            this.layerSelect.classList.add('is-placeholder');
          } else {
            this.layerSelect.classList.remove('is-placeholder');
          }
        };

        const confirmBtn = L.DomUtil.create('button', 'btn btn-confirm', btnRow);
        confirmBtn.textContent = _('heatmap.confirm');
        confirmBtn.onclick = () => {
          this.manager.renderHexagons();
          this.container.classList.remove('expanded');
          this.container.classList.add('collapsed');
        };

        // Watch panel expand event to refresh dropdown
        this.observer = new MutationObserver(() => {
          if (
            this.container.classList.contains('expanded') &&
            !this.expandHookDone
          ) {
            this.expandHookDone = true;
            this.rebuildLayerDropdown();
          }
          if (this.container.classList.contains('collapsed')) {
            this.expandHookDone = false;
          }
        });
        this.observer.observe(this.container, { attributes: true });

        return wrapper;
      }

      onRemove() {
        // Clean up map event listeners
        if (this.zoomTimer) clearTimeout(this.zoomTimer);
        if (this.layerScanTimer) clearTimeout(this.layerScanTimer);
        this.manager.map.off('zoomend');
        this.manager.map.off('layeradd layerremove');

        // Disconnect MutationObserver
        if (this.observer) this.observer.disconnect();

        // Unregister from LayerControl and remove layers
        this.manager.unregisterHexLayer();
        if (this.manager.heatmapLayer) {
          this.manager.map.removeLayer(this.manager.heatmapLayer);
        }
      }

      // --- UI Logic Methods ---
      buildLayerListItems(sel) {
        this.manager.scanMapLayers();
        sel.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = _('heatmap.layer_placeholder');
        placeholder.disabled = true;
        placeholder.selected = !this.manager.selectedLayerId;
        placeholder.className = 'placeholder-option';
        sel.appendChild(placeholder);

        this.manager.pointLayers.forEach((info) => {
          const opt = document.createElement('option');
          opt.value = info.id;
          opt.textContent = info.name;
          sel.appendChild(opt);
        });

        if (this.manager.selectedLayerId) {
          sel.value = this.manager.selectedLayerId;
        } else {
          sel.selectedIndex = 0;
        }

        sel.onchange = () => {
          this.manager.selectedLayerId = sel.value || null;
          if (this.extraBody) {
            this.extraBody.style.display =
              this.manager.selectedLayerId ? '' : 'none';
          }
          if (sel.value === '') sel.classList.add('is-placeholder');
          else sel.classList.remove('is-placeholder');

          this.updateFieldSelector();
          if (this.manager.selectedLayerId) this.manager.renderHexagons();
          else {
            this.manager.hexLayer.clearLayers();
            this.manager.labelLayer.clearLayers();
            this.manager.unregisterHexLayer();
          }
        };

        if (sel.value === '') sel.classList.add('is-placeholder');
        else sel.classList.remove('is-placeholder');
      }

      rebuildLayerDropdown() {
        if (this.layerSelect) this.buildLayerListItems(this.layerSelect);
      }

      updateFieldSelector() {
        if (!this.fieldWrap || !this.fieldSelect) return;
        if (this.manager.currentAgg === 'count') {
          this.fieldWrap.classList.add('hidden');
          return;
        }
        this.fieldWrap.classList.remove('hidden');

        const selected = this.manager.pointLayers.filter(
          (info) => info.id === this.manager.selectedLayerId
        );
        const fields = this.manager.collectFields(selected);
        const phOpt = document.createElement('option');
        phOpt.value = '_auto';
        phOpt.textContent = _('heatmap.field_auto');
        phOpt.className = 'placeholder-option';

        this.fieldSelect.innerHTML = '';
        this.fieldSelect.appendChild(phOpt);

        fields.forEach((f) => {
          const opt = document.createElement('option');
          opt.value = f;
          opt.textContent = f.startsWith('properties.')
            ? f.substring(11) : f;
          this.fieldSelect.appendChild(opt);
        });

        if (
          fields.includes(this.manager.currentField) ||
          this.manager.currentField === '_auto'
        ) {
          this.fieldSelect.value = this.manager.currentField;
        } else {
          this.manager.currentField = '_auto';
          this.fieldSelect.value = '_auto';
        }

        if (this.fieldSelect.value === '_auto') {
          this.fieldSelect.classList.add('is-placeholder');
        } else {
          this.fieldSelect.classList.remove('is-placeholder');
        }
      }

      /** Render color blocks into a container. */
      _renderColorBar(container, name, nClasses) {
        const colors = this.manager.getColorScale(name, nClasses);
        container.innerHTML = '';
        for (const color of colors) {
          const blk = document.createElement('div');
          blk.className = 'scheme-bar-block';
          blk.style.background = color;
          blk.style.width = `${100 / colors.length}%`;
          container.appendChild(blk);
        }
      }

      updateSchemeBar() {
        this._renderColorBar(this.schemeBarInner,
          this.manager.currentScheme, this.manager.N_CLASSES);
      }

      refreshSchemeDropdownItems() {
        if (!this.schemeDropdown) return;
        const items = this.schemeDropdown.querySelectorAll('.scheme-dropdown-item');
        items.forEach((item) => {
          const name = item.getAttribute('data-scheme-name');
          if (!name) return;
          const bar = item.querySelector('.scheme-dropdown-bar');
          if (bar) this._renderColorBar(bar, name, this.manager.N_CLASSES);
        });
      }

      toggleSchemeDropdown() {
        if (this.schemeDropdown) {
          this.schemeDropdown.remove();
          this.schemeDropdown = null;
          return;
        }
        this.schemeDropdown = L.DomUtil.create(
          'div', 'scheme-dropdown', this.schemeControlWrap
        );
        this.schemeDropdown.setAttribute('role', 'listbox');

        let focusIdx = -1;
        SCHEME_NAMES.forEach((name, idx) => {
          const item = L.DomUtil.create(
            'div', 'scheme-dropdown-item', this.schemeDropdown
          );
          item.setAttribute('role', 'option');
          item.setAttribute('data-scheme-name', name);
          item.tabIndex = -1;
          if (name === this.manager.currentScheme) {
            item.classList.add('active');
            focusIdx = idx;
          }

          const itemBar = L.DomUtil.create('div', 'scheme-dropdown-bar', item);
          this._renderColorBar(itemBar, name, this.manager.N_CLASSES);

          item.onclick = (ev) => {
            ev.stopPropagation();
            this.selectScheme(name);
          };
        });

        const items = this.schemeDropdown.querySelectorAll(
          '.scheme-dropdown-item'
        );
        if (items.length) {
          if (focusIdx >= 0) items[focusIdx].focus();
          else items[0].focus();
        }

        this.schemeDropdown.onkeydown = (e) => {
          const activeIdx = Array.from(items).indexOf(document.activeElement);
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = (activeIdx + 1) % items.length;
            items[next].focus();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = (activeIdx - 1 + items.length) % items.length;
            items[prev].focus();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const active = document.activeElement;
            if (active?.classList.contains('scheme-dropdown-item')) {
              const idx = Array.from(items).indexOf(active);
              this.selectScheme(SCHEME_NAMES[idx]);
            }
          } else if (e.key === 'Escape') {
            this.schemeDropdown.remove();
            this.schemeDropdown = null;
            this.schemeBar.focus();
          }
        };
      }

      selectScheme(name) {
        this.manager.currentScheme = name;
        this.schemeSelectHidden.value = name;
        this.updateSchemeBar();
        if (this.schemeDropdown) {
          this.schemeDropdown.remove();
          this.schemeDropdown = null;
        }
        this.manager.renderHexagons();
        this.schemeBar.focus();
      }

      initScan(attempt) {
        this.manager.scanMapLayers();
        if (this.manager.pointLayers.length === 0 && attempt > 0) {
          setTimeout(() => this.initScan(attempt - 1),
            _CONST.INIT_SCAN_INTERVAL_MS);
        } else if (this.manager.pointLayers.length === 0) {
          foliplus.showHint('heatmap', _('heatmap.no_layer'), 4000);
        }
      }
    }

    // ==================== Instantiation ====================
    // Instantiate manager and control, then add to map
    const heatmapManager = new HeatmapManager(map);
    const heatmapCtrl = new HeatmapControl(
      { position: '{{ this.position }}' }, heatmapManager
    );

    heatmapCtrl.addTo(map);
    heatmapCtrl.initScan(_CONST.INIT_SCAN_ATTEMPTS);
  }
})();

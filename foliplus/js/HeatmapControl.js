(function () {
  // ==================== Constants ====================
  const CONST = {
    name: "HeatmapControl",
    jsdelivr: "https://cdn.jsdelivr.net/npm/",
    ZOOM_DEBOUNCE_MS: 200,
    LAYER_SCAN_DEBOUNCE_MS: 200,
    INIT_SCAN_ATTEMPTS: 8,
    INIT_SCAN_INTERVAL_MS: 300,
    SCHEME_DROPDOWN_BLUR_DELAY_MS: 150,
    LOAD_SCRIPT_RETRIES: 2,
    LOAD_SCRIPT_INTERVAL_MS: 3000,
    DEFAULT_GRAY: "#999",
    H3_RES_MAP: [
      [2, 0],
      [3, 1],
      [4, 1],
      [5, 2],
      [6, 3],
      [7, 4],
      [8, 4],
      [9, 5],
      [10, 6],
      [11, 6],
      [12, 7],
      [13, 7],
      [14, 8],
      [15, 9],
      [16, 9],
      [17, 10],
      [18, 11],
      [19, 11],
      [20, 12],
    ],
    H3_RES_FALLBACK: 12,
    HEATMAP_ID: "foliplus_heatmap",
    HEXAGON: `
      <svg viewBox="0 0 24 24">
        <polygon points="12 3 20.5 7.5 20.5 16.5 12 21 3.5 16.5 3.5 7.5"/>
        <polygon points="12 7 16 9.5 16 14.5 12 17 8 14.5 8 9.5" opacity="0.5"/>
        <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>
      </svg>`,
    AGG_DEFAULT: "{{ this.agg }}",
    FIELD_DEFAULT: "{{ this.style.field }}",
    COLOR_SCHEME: "{{ this.color_scheme }}",
    COLOR_METHOD: "{{ this.method }}",
    N_CLASSES_DEFAULT: {{ this.n_classes }},
    BORDER_W_DEFAULT: {{ this.style.border_weight }},
    BORDER_COLOR_DEFAULT: "{{ this.style.border_color }}",
    FILL_OP: {{ this.style.fill_opacity }},
    BORDER_OP: {{ this.style.border_opacity }},
    LABEL_SHOW: {{ "true" if this.style.label_show else "false" }},
    LABEL_SIZE: {{ this.style.label_size }},
    LABEL_COLOR: "{{ this.style.label_color }}",
    FORMAT: "{{ this.style.label_format }}",
    SCHEME_NAMES: {{ this.schemes | tojson }},
  };

  // ==================== Runtime Guard ====================
  if (!window.foliplus || !window.foliplus.SVGs) {
    console.error(`[${CONST.name}] foliplus runtime not found, plugin disabled.`);
    return;
  }

  // ==================== Dependencies ====================
  const map = {{ this._parent.get_name() }};
  const _ = (k) => (window.foliplus && window.foliplus.gt ? window.foliplus.gt(k) : k);

  window.foliplus.registerHintIcon(CONST.name, CONST.HEXAGON);

  // --- Dynamic Dependency Loader ---
  // Loads CDN scripts at runtime via shared window.foliplus.loadScripts.
  const DEPS = [
    {
      name: "h3",
      url: CONST.jsdelivr + "h3-js@{{ this._h3_version }}/dist/h3-js.umd.js",
      check: () => typeof h3 !== "undefined",
    },
    {
      name: "ss",
      url:
        CONST.jsdelivr +
        "simple-statistics@{{ this._ss_version }}/dist/simple-statistics.min.js",
      check: () => typeof ss !== "undefined",
    },
    {
      name: "chroma",
      url: CONST.jsdelivr + "chroma-js@{{ this._chroma_version }}/chroma.min.js",
      check: () => typeof chroma !== "undefined",
    },
  ];

  window.foliplus.loadScripts(
    DEPS,
    (ok) => {
      if (ok) return run();
    },
    CONST.LOAD_SCRIPT_RETRIES,
    CONST.LOAD_SCRIPT_INTERVAL_MS,
    {
      hintKey: CONST.name,
      localeMap: {
        ss: `${CONST.name}.no_ss`,
        chroma: `${CONST.name}.no_chroma`,
        default: `${CONST.name}.no_h3`,
      },
    },
  );

  function run() {
    // Guard: LayerControl must be registered first to provide createLayers()/createCanvas()
    if (!window.foliplus.LayerControlAPI) {
      console.error(`[${CONST.name}] ${_(`${CONST.name}.no_layercontrol`)}`);
      window.foliplus.showHint(
        CONST.name,
        _(`${CONST.name}.no_layercontrol`),
        window.foliplus.HINT_DURATION.PERSIST,
      );
      return;
    }

    // ==================== Core: Data Aggregation & Rendering ===
    class HeatmapManager {
      constructor(mapInstance) {
        this.map = mapInstance;

        // State management
        this.selectedLayerId = null;
        this.pointLayers = [];
        this.currentAgg = CONST.AGG_DEFAULT;
        this.currentField = CONST.FIELD_DEFAULT;
        this.currentScheme = CONST.COLOR_SCHEME;
        this.currentMethod = CONST.COLOR_METHOD;
        this.autoFieldKey = null;
        this.N_CLASSES = CONST.N_CLASSES_DEFAULT;
        this.BORDER_W = CONST.BORDER_W_DEFAULT;
        this.BORDER_COLOR = CONST.BORDER_COLOR_DEFAULT;
        this.currentLabelShow = CONST.LABEL_SHOW;
        this.valueFallbackWarned = false;
        // Create a managed canvas via LayerControl API.
        // Canvas lives in `.leaflet-map-pane` with position offset to cancel
        // the mapPane CSS transform.  Drawn with latLngToContainerPoint.
        // LayerControl handles visibility (checkbox) and z-order (drag-reorder).
        this.overlay = window.foliplus.LayerControlAPI.createCanvas({
          id: CONST.HEATMAP_ID,
          name: _(`${CONST.name}.title`),
          iconSvg: CONST.HEXAGON,
        });
        this.ui = null;
        this.cachedPoints = null;
        this.cachedFeatures = null;
        this.labelStyleCache = null;

        this.bindMapEvents();
      }

      bindMapEvents() {
        // Canvas in mapPane with position offset → no transform clipping.
        // During zoom: hide canvas, re-render at new zoom after animation.
        // During pan (move without zoom): RAF-throttled redraw for smoothness.
        this.isZooming = false;
        this.moveRafId = null;

        this.onZoomStart = () => {
          this.isZooming = true;
          this.overlay.setVisible(false);
        };
        this.map.on("zoomstart", this.onZoomStart);

        this.redrawOnMove = () => {
          if (this.isZooming) return;
          if (this.moveRafId) return;
          this.moveRafId = requestAnimationFrame(() => {
            this.moveRafId = null;
            if (this.overlay.canvas && this.cachedFeatures) this.redrawHeatmap();
          });
        };
        this.map.on("move", this.redrawOnMove);

        this.onZoomEnd = foliplus.debounce(() => {
          if (this.selectedLayerId) {
            this.renderHexagons();
            this.overlay.setVisible(true);
          }
          // Always reset zooming state, even if no layer selected
          this.isZooming = false;
        }, CONST.ZOOM_DEBOUNCE_MS);
        this.map.on("zoomend", this.onZoomEnd);

        this.onLayerChange = foliplus.debounce(() => {
          this.cachedPoints = null;
          if (this.ui) {
            this.scanMapLayers();
            this.ui.rebuildLayerDropdown();
          }
        }, CONST.LAYER_SCAN_DEBOUNCE_MS);
        this.map.on("layeradd layerremove", this.onLayerChange);
      }

      /** Redraw the heatmap canvas from cached features. */
      redrawHeatmap() {
        const canvas = this.overlay.canvas;
        const features = this.cachedFeatures;
        if (!canvas || !features) return;
        const ctx = this.overlay.ctx;
        if (!ctx) return;
        const container = this.map.getContainer();
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);

        const labelCfg = this.resolveLabelStyle();

        features.forEach((feat) => {
          this.drawHexagon(ctx, feat);
          if (this.currentLabelShow) this.drawHexLabel(ctx, feat, labelCfg);
        });
      }

      /** Draw a single hexagon polygon (fill + stroke). */
      drawHexagon(ctx, feat) {
        const pts = feat.geometry.coordinates[0].map((p) =>
          this.map.latLngToContainerPoint(L.latLng(p[1], p[0])),
        );
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.fillStyle = feat.properties.fillColor || CONST.DEFAULT_GRAY;
        ctx.globalAlpha = CONST.FILL_OP;
        ctx.fill();
        ctx.globalAlpha = 1;

        if (this.BORDER_W > 0 && CONST.BORDER_OP > 0) {
          ctx.strokeStyle = this.BORDER_COLOR;
          ctx.lineWidth = this.BORDER_W;
          ctx.globalAlpha = CONST.BORDER_OP;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      /** Resolve label styling from CSS custom properties (cached). */
      resolveLabelStyle() {
        if (this.labelStyleCache) return this.labelStyleCache;
        const ctrlEl = this.ui?.container;
        const cssVal = (prop, fallback) =>
          ctrlEl
            ? getComputedStyle(ctrlEl).getPropertyValue(prop).trim() || fallback
            : fallback;
        this.labelStyleCache = {
          font: `${cssVal("--heatmap-label-font-weight", "bold")} ${cssVal("--heatmap-label-font-size", `${CONST.LABEL_SIZE}px`)} ${cssVal("--heatmap-label-font-family", "sans-serif")}`,
          color: cssVal("--heatmap-label-color", CONST.LABEL_COLOR),
          stroke: cssVal("--heatmap-label-stroke-color", "rgba(0,0,0,0.75)"),
          strokeWidth: parseFloat(cssVal("--heatmap-label-stroke-width", "3")),
        };
        return this.labelStyleCache;
      }

      /** Draw a formatted value label centered on the hexagon. */
      drawHexLabel(ctx, feat, { font, color, stroke, strokeWidth }) {
        const centroid = feat.properties.centroid;
        const pt = this.map.latLngToContainerPoint(L.latLng(centroid[0], centroid[1]));
        const text = window.foliplus.formatNumber(feat.properties.value, CONST.FORMAT);
        ctx.font = font;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.strokeStyle = stroke;
        ctx.lineWidth = strokeWidth;
        ctx.lineJoin = "round";
        ctx.strokeText(text, pt.x, pt.y);
        ctx.fillStyle = color;
        ctx.fillText(text, pt.x, pt.y);
      }

      // --- Data Extraction ---
      scanMapLayers() {
        this.pointLayers = [];
        const pointLayersInfo =
          window.foliplus.LayerControlAPI.getLayersByType("point");
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
            id: info.id,
            name: info.name,
            layer,
            count: pts.length,
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
          } else if (l.getLayers) l.getLayers().forEach(walk);
        };
        walk(layer);
        return pts;
      }

      collectFields(layers) {
        const fields = {};
        layers.forEach((info) => {
          this.extractPoints(info.layer).forEach((pt) => {
            const m = pt.marker;
            if (typeof m.value === "number") fields.value = true;
            if (typeof m.options?.value === "number") fields["options.value"] = true;
            if (m.feature?.properties) {
              Object.keys(m.feature.properties).forEach((k) => {
                if (typeof m.feature.properties[k] === "number")
                  fields[`properties.${k}`] = true;
              });
            }
          });
        });
        return Object.keys(fields);
      }

      pickAutoField(fields) {
        if (!fields || fields.length === 0) return null;
        return fields[0];
      }

      readMarkerField(marker, field) {
        if (!field) return undefined;
        if (field === "value") return marker.value;
        if (field === "options.value") return marker.options?.value;
        if (field.startsWith("properties.")) {
          const key = field.substring(11);
          return marker.feature?.properties?.[key];
        }
        return undefined;
      }

      getPointValue(marker) {
        if (this.currentAgg === "count") return 1;
        const key =
          this.currentField === "_auto" ? this.autoFieldKey : this.currentField;
        const val = this.readMarkerField(marker, key);
        if (val === undefined || isNaN(val)) {
          if (!this.valueFallbackWarned) {
            this.valueFallbackWarned = true;
            console.warn(
              `[${CONST.name}] ${_(`${CONST.name}.value_fallback`).replace("{field}", this.currentField)}`,
            );
          }
          return 1;
        }
        return Number(val);
      }

      collectSelectedPoints() {
        this.valueFallbackWarned = false;
        // Cache by layerId + currentAgg + currentField — invalidate on param change
        const key = `${this.selectedLayerId}|${this.currentAgg}|${this.currentField}`;
        if (this.cachedPoints && this.cachedPoints.key === key) {
          return this.cachedPoints.pts;
        }
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
        this.cachedPoints = { key, pts };
        return pts;
      }

      // --- Algorithm Configuration ---
      getH3Res(zoom) {
        const entry = CONST.H3_RES_MAP.find(([z]) => zoom <= z);
        return entry ? entry[1] : CONST.H3_RES_FALLBACK;
      }

      getColorScale(name, n) {
        if (typeof chroma !== "undefined")
          return chroma.scale(name).mode("lab").colors(n);
        return Array(n).fill(CONST.DEFAULT_GRAY);
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

        if (method === "jenks") {
          try {
            return ss.jenks(data, nClasses);
          } catch (e) {}
          return [lo, hi];
        }
        if (method === "quantile") {
          const b = [lo];
          for (let i = 1; i < nClasses; i++) b.push(ss.quantile(sorted, i / nClasses));
          return b.concat(hi);
        }
        if (method === "heads") {
          const b = [lo];
          for (let i = 1; i < nClasses; i++)
            b.push(sorted[Math.min(Math.floor((i * n) / nClasses), n - 1)]);
          return b.concat(hi);
        }
        const step = (hi - lo) / nClasses;
        const b = [];
        for (let i = 0; i <= nClasses; i++) b.push(lo + step * i);
        return b;
      }

      // --- Hexagon Rendering ---
      renderHexagons() {
        // Invalidate label style cache — will be re-read on next redraw
        this.labelStyleCache = null;
        if (!this.map || !this.map._container) return;
        if (!this.selectedLayerId) {
          this.clearHeatmapCanvas();
          return;
        }
        const pts = this.collectSelectedPoints();
        const zoom = this.map.getZoom();
        const res = this.getH3Res(zoom);
        const aggregated = this.aggregateData(pts, res);
        if (!aggregated) return;
        const features = this.buildFeatures(aggregated);
        this.renderFeatures(features);
      }

      /** Aggregate points into H3 hex cells with current agg method. */
      aggregateData(pts, res) {
        const hexCells = {};
        pts.forEach((pt) => {
          try {
            const h3Idx = h3.latLngToCell(pt.lat, pt.lng, res);
            if (!hexCells[h3Idx])
              hexCells[h3Idx] = { sum: 0, count: 0, min: Infinity, max: -Infinity };
            const cell = hexCells[h3Idx];
            cell.sum += pt.value;
            cell.count += 1;
            if (pt.value < cell.min) cell.min = pt.value;
            if (pt.value > cell.max) cell.max = pt.value;
          } catch (e) {
            console.warn(
              `[${CONST.name}] ${_(`${CONST.name}.h3_cell_fail`)}`,
              pt.lat,
              pt.lng,
              e,
            );
          }
        });

        const getAggValue = (cell) => {
          switch (this.currentAgg) {
            case "count":
              return cell.count;
            case "sum":
              return cell.sum;
            case "avg":
              return cell.count > 0 ? cell.sum / cell.count : 0;
            case "min":
              return cell.min;
            case "max":
              return cell.max;
            default:
              return cell.count;
          }
        };

        const allVals = Object.values(hexCells).map(getAggValue);
        if (allVals.length === 0) {
          this.clearHeatmapCanvas();
          return null;
        }

        const nClasses = Math.min(this.N_CLASSES, allVals.length);
        const breaks = this.computeBreaks(allVals, nClasses, this.currentMethod);
        const classColors = this.getColorScale(this.currentScheme, nClasses);

        const valueToClassIdx = (val) => {
          if (breaks.length < 2) return 0;
          for (let i = 1; i < breaks.length; i++) if (val <= breaks[i]) return i - 1;
          return breaks.length - 2;
        };

        return { hexCells, getAggValue, valueToClassIdx, classColors };
      }

      /** Build GeoJSON features from aggregated hex cells. */
      buildFeatures({ hexCells, getAggValue, valueToClassIdx, classColors }) {
        const features = [];
        for (const [h3Idx, cell] of Object.entries(hexCells)) {
          const val = getAggValue(cell);
          const classIdx = valueToClassIdx(val);
          const fillColor = classColors[classIdx];
          let centroid;
          try {
            const center = h3.cellToLatLng(h3Idx);
            centroid = [center[0], center[1]];
          } catch (e) {
            // Fallback: compute centroid from boundary polygon
            centroid = null;
          }
          try {
            const boundary = h3.cellToBoundary(h3Idx);
            const coords = boundary.map((p) => [p[1], p[0]]);
            coords.push(coords[0]);
            if (!centroid) {
              let cx = 0,
                cy = 0;
              for (let j = 0; j < coords.length - 1; j++) {
                cx += coords[j][0];
                cy += coords[j][1];
              }
              centroid = [cy / (coords.length - 1), cx / (coords.length - 1)];
            }
            features.push({
              type: "Feature",
              geometry: { type: "Polygon", coordinates: [coords] },
              properties: { value: val, classIdx, fillColor, h3: h3Idx, centroid },
            });
          } catch (e) {
            console.warn(
              `[${CONST.name}] ${_(`${CONST.name}.h3_boundary_fail`)}`,
              h3Idx,
              e,
            );
          }
        }
        return features;
      }

      /** Render hexagons + labels onto the managed Canvas.
       *  Canvas lives in mapPane with position offset cancelling the
       *  mapPane CSS transform — no more clipping from zoom animations.
       *  LayerControl's enforceOrder sets canvas z-index via onZIndex
       *  callback, and checkbox visibility via onToggle callback. */
      renderFeatures(features) {
        if (!features.length) {
          this.clearHeatmapCanvas();
          return;
        }
        this.cachedFeatures = features;

        this.overlay.resize();
        this.overlay.updatePosition();
        this.redrawHeatmap();
        this.overlay.setVisible(true);
        this.overlay.register();
      }

      clearHeatmapCanvas() {
        this.cachedFeatures = null;
        if (this.overlay) {
          const ctx = this.overlay.ctx;
          if (ctx) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, this.overlay.canvas.width, this.overlay.canvas.height);
          }
          this.overlay.setVisible(false);
          this.overlay.unregister();
        }
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
        const wrapper = this.buildHeader();
        this.buildDataSection();
        this.buildStyleSection();
        this.setupObserver();
        return wrapper;
      }

      /** Create the outer container, toggle button, and panel header. */
      buildHeader() {
        const wrapper = L.DomUtil.create("div", "leaflet-bar leaflet-control");
        this.container = L.DomUtil.create(
          "div",
          "map-panel ctrl-fold heatmap-ctrl collapsed",
          wrapper,
        );
        L.DomEvent.disableClickPropagation(wrapper);
        L.DomEvent.disableScrollPropagation(wrapper);

        const toggleBtn = L.DomUtil.create("button", "toggle-btn", this.container);
        toggleBtn.title = _(`${CONST.name}.title`);
        toggleBtn.innerHTML = CONST.HEXAGON;

        const panelWrap = L.DomUtil.create("div", "panel-wrap", this.container);
        const header = L.DomUtil.create("div", "panel-header", panelWrap);
        header.innerHTML = `
          <span class="header-title">
            <span class="header-icon">${CONST.HEXAGON}</span>
            ${_(`${CONST.name}.title`)}
          </span>
          <button class="close-btn ctrl-abs-btn" title="${_(`${CONST.name}.close_title`)}">
            ${window.foliplus.SVGs.CLOSE}
          </button>`;

        window.foliplus.bindPanelToggle({
          container: this.container,
          toggleBtn: ".toggle-btn",
          header: ".panel-header",
        });
        window.foliplus.bindOutsideCollapse({
          map: this.manager.map,
          container: this.container,
        });

        return wrapper;
      }

      /** Build the data section: layer select, aggregation method, field selector. */
      buildDataSection() {
        const panelWrap = this.container.querySelector(".panel-wrap");
        const content = L.DomUtil.create("div", "panel-content", panelWrap);
        const configBody = L.DomUtil.create("div", "config-body", content);
        const dataHeading = L.DomUtil.create("div", "section-heading", configBody);
        dataHeading.textContent = _(`${CONST.name}.section_data`);

        const layerRow = L.DomUtil.create("div", "form-row", configBody);
        const layerRowLabel = L.DomUtil.create("label", "form-label", layerRow);
        layerRowLabel.textContent = _(`${CONST.name}.layer`);
        const layerSelectWrap = L.DomUtil.create("div", "form-control-wrap", layerRow);
        this.layerSelect = L.DomUtil.create(
          "select",
          "form-select layer-select",
          layerSelectWrap,
        );

        this.extraBody = L.DomUtil.create("div", "extra-body", configBody);
        this.extraBody.style.display = "none";

        // Aggregation method
        const aggRow = L.DomUtil.create("div", "form-row", this.extraBody);
        const aggRowLabel = L.DomUtil.create("label", "form-label", aggRow);
        aggRowLabel.textContent = _(`${CONST.name}.agg_method`);
        const aggControlWrap = L.DomUtil.create("div", "form-control-wrap", aggRow);
        this.aggSelect = L.DomUtil.create("select", "form-select", aggControlWrap);
        this.aggSelect.innerHTML = `
          <option value="count">${_(`${CONST.name}.agg_count`)}</option>
          <option value="sum">${_(`${CONST.name}.agg_sum`)}</option>
          <option value="avg">${_(`${CONST.name}.agg_avg`)}</option>
          <option value="min">${_(`${CONST.name}.agg_min`)}</option>
          <option value="max">${_(`${CONST.name}.agg_max`)}</option>`;
        this.aggSelect.value = this.manager.currentAgg;
        this.aggSelect.onchange = () => {
          this.manager.currentAgg = this.aggSelect.value;
          this.updateFieldSelector();
          this.manager.renderHexagons();
        };

        this.fieldWrap = L.DomUtil.create(
          "div",
          "form-row field-wrap hidden",
          this.extraBody,
        );
        const fieldLabel = L.DomUtil.create("label", "form-label", this.fieldWrap);
        fieldLabel.textContent = _(`${CONST.name}.field`);
        const fieldControlWrap = L.DomUtil.create(
          "div",
          "form-control-wrap",
          this.fieldWrap,
        );
        this.fieldSelect = L.DomUtil.create("select", "form-select", fieldControlWrap);
        this.fieldSelect.onchange = () => {
          this.manager.currentField = this.fieldSelect.value;
          this.syncSelect(this.fieldSelect, this.fieldSelect.value);
          this.manager.renderHexagons();
        };

        // Initialize layer dropdown LAST after all select refs are created
        this.buildLayerListItems(this.layerSelect);
      }

      /** Build the style section: classification, color scheme, border, label toggle, action buttons. */
      buildStyleSection() {
        const styleHeading = L.DomUtil.create("div", "section-heading", this.extraBody);
        styleHeading.textContent = _(`${CONST.name}.section_style`);
        const styleSection = L.DomUtil.create("div", "section-block", this.extraBody);

        // Classification method / classes
        const classRow = L.DomUtil.create("div", "form-row", styleSection);
        const classRowLabel = L.DomUtil.create("label", "form-label", classRow);
        classRowLabel.textContent = _(`${CONST.name}.class_method`);
        const classControlWrap = L.DomUtil.create(
          "div",
          "form-control-wrap form-control-inline",
          classRow,
        );
        this.methodSelect = L.DomUtil.create("select", "form-select", classControlWrap);
        this.methodSelect.innerHTML = `
          <option value="jenks">${_(`${CONST.name}.jenks`)}</option>
          <option value="quantile">${_(`${CONST.name}.quantile`)}</option>
          <option value="equal">${_(`${CONST.name}.equal`)}</option>
          <option value="heads">${_(`${CONST.name}.heads`)}</option>`;
        this.methodSelect.value = this.manager.currentMethod;
        this.methodSelect.onchange = () => {
          this.manager.currentMethod = this.methodSelect.value;
          this.manager.renderHexagons();
        };

        this.classSelect = L.DomUtil.create(
          "select",
          "form-select class-count-select",
          classControlWrap,
        );
        for (let ci = 2; ci <= 9; ci++) {
          const co = document.createElement("option");
          co.value = ci;
          co.textContent = ci;
          this.classSelect.appendChild(co);
        }
        this.classSelect.value = Math.min(9, Math.max(2, this.manager.N_CLASSES));
        this.classSelect.onchange = () => {
          this.manager.N_CLASSES = Math.min(
            9,
            Math.max(2, parseInt(this.classSelect.value, 10) || 6),
          );
          this.updateSchemeBar();
          if (this.schemeDropdown) this.refreshSchemeDropdownItems();
          this.manager.renderHexagons();
        };

        // Color scheme
        const schemeRow = L.DomUtil.create("div", "form-row", styleSection);
        const schemeRowLabel = L.DomUtil.create("label", "form-label", schemeRow);
        schemeRowLabel.textContent = _(`${CONST.name}.scheme`);
        this.schemeControlWrap = L.DomUtil.create(
          "div",
          "form-control-wrap",
          schemeRow,
        );
        this.schemeBar = L.DomUtil.create("div", "scheme-bar", this.schemeControlWrap);
        this.schemeBarInner = L.DomUtil.create(
          "div",
          "scheme-bar-inner",
          this.schemeBar,
        );
        this.schemeSelectHidden = L.DomUtil.create(
          "select",
          "scheme-select-hidden",
          this.schemeControlWrap,
        );

        CONST.SCHEME_NAMES.forEach((name) => {
          const opt = document.createElement("option");
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
        this.schemeBar.setAttribute("role", "combobox");
        this.schemeBar.setAttribute("aria-label", _(`${CONST.name}.scheme`));
        this.schemeBar.onclick = (e) => {
          e.stopPropagation();
          this.toggleSchemeDropdown();
        };
        this.schemeBar.onkeydown = (e) => {
          if (["Enter", " ", "ArrowUp", "ArrowDown"].includes(e.key)) {
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
          }, CONST.SCHEME_DROPDOWN_BLUR_DELAY_MS);
        };

        // Border settings
        const borderRow = L.DomUtil.create("div", "form-row", styleSection);
        const borderRowLabel = L.DomUtil.create("label", "form-label", borderRow);
        borderRowLabel.textContent = _(`${CONST.name}.border`);
        const borderControlWrap = L.DomUtil.create(
          "div",
          "form-control-wrap form-control-inline",
          borderRow,
        );
        this.borderColorInput = L.DomUtil.create(
          "input",
          "border-color-input",
          borderControlWrap,
        );
        this.borderColorInput.type = "color";
        this.borderColorInput.value = this.manager.BORDER_COLOR;
        this.borderColorInput.oninput = () => {
          this.manager.BORDER_COLOR = this.borderColorInput.value;
          this.manager.renderHexagons();
        };
        this.borderWeightInput = L.DomUtil.create(
          "input",
          "border-weight-input",
          borderControlWrap,
        );
        this.borderWeightInput.type = "number";
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
          "div",
          "form-row section-block-last",
          styleSection,
        );
        const labelRowText = L.DomUtil.create("label", "form-label", labelRow);
        labelRowText.textContent = _(`${CONST.name}.label`);
        const labelControlWrap = L.DomUtil.create("div", "form-control-wrap", labelRow);
        const labelToggle = L.DomUtil.create(
          "label",
          "toggle-switch",
          labelControlWrap,
        );
        this.labelChk = L.DomUtil.create("input", "", labelToggle);
        this.labelChk.type = "checkbox";
        this.labelChk.checked = this.manager.currentLabelShow;
        this.labelChk.onchange = () => {
          this.manager.currentLabelShow = this.labelChk.checked;
          this.manager.renderHexagons();
        };
        L.DomUtil.create("span", "toggle-slider", labelToggle);
        L.DomUtil.create("hr", "section-divider", this.extraBody);

        // Bottom action buttons
        const btnRow = L.DomUtil.create("div", "btn-row", this.extraBody);
        const clearBtn = L.DomUtil.create("button", "btn btn-clear", btnRow);
        clearBtn.textContent = _(`${CONST.name}.clear`);
        clearBtn.onclick = () => {
          this.resetAll();
          this.syncSelect(this.layerSelect, "");
          this.syncSelect(this.aggSelect, CONST.AGG_DEFAULT);
          this.syncSelect(this.classSelect, String(CONST.N_CLASSES_DEFAULT));
          this.syncSelect(this.methodSelect, CONST.COLOR_METHOD);
          this.schemeSelectHidden.value = CONST.COLOR_SCHEME;
          this.labelChk.checked = CONST.LABEL_SHOW;
          this.borderWeightInput.value = CONST.BORDER_W_DEFAULT;
          this.borderColorInput.value = CONST.BORDER_COLOR_DEFAULT;

          this.updateSchemeBar();
          this.updateFieldSelector();
          this.extraBody.style.display = "none";
          this.container.classList.remove("expanded");
          this.container.classList.add("collapsed");
        };

        const confirmBtn = L.DomUtil.create("button", "btn btn-confirm", btnRow);
        confirmBtn.textContent = _(`${CONST.name}.confirm`);
        confirmBtn.onclick = () => {
          this.manager.renderHexagons();
          this.container.classList.remove("expanded");
          this.container.classList.add("collapsed");
        };
      }

      /** Set up MutationObserver to refresh layer dropdown on panel expand. */
      setupObserver() {
        this.observer = new MutationObserver(() => {
          if (this.container.classList.contains("expanded") && !this.expandHookDone) {
            this.expandHookDone = true;
            this.rebuildLayerDropdown();
          }
          if (this.container.classList.contains("collapsed"))
            this.expandHookDone = false;
        });
        this.observer.observe(this.container, { attributes: true });
      }

      onRemove() {
        // Clean up map event listeners
        if (this.manager.moveRafId) cancelAnimationFrame(this.manager.moveRafId);
        if (this.manager.onZoomEnd) this.manager.onZoomEnd.cancel();
        if (this.manager.onLayerChange) this.manager.onLayerChange.cancel();
        this.manager.map.off("zoomstart", this.manager.onZoomStart);
        this.manager.map.off("move", this.manager.redrawOnMove);
        this.manager.map.off("zoomend", this.manager.onZoomEnd);
        this.manager.map.off("layeradd layerremove", this.manager.onLayerChange);

        // Disconnect MutationObserver
        if (this.observer) this.observer.disconnect();

        this.manager.clearHeatmapCanvas();
        if (this.manager.overlay) this.manager.overlay.destroy();
        this.manager.overlay = null;
        this.manager.ui = null;
      }

      // --- UI Logic Methods ---
      buildLayerListItems(sel) {
        this.manager.scanMapLayers();
        sel.innerHTML = "";
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = _(`${CONST.name}.layer_placeholder`);
        placeholder.disabled = true;
        placeholder.selected = !this.manager.selectedLayerId;
        placeholder.className = "placeholder-option";
        sel.appendChild(placeholder);

        this.manager.pointLayers.forEach((info) => {
          const opt = document.createElement("option");
          opt.value = info.id;
          opt.textContent = info.name;
          sel.appendChild(opt);
        });

        if (this.manager.selectedLayerId) sel.value = this.manager.selectedLayerId;
        else sel.selectedIndex = 0;

        sel.onchange = () => {
          this.manager.selectedLayerId = sel.value || null;
          if (this.extraBody) {
            this.extraBody.style.display = this.manager.selectedLayerId ? "" : "none";
          }
          this.syncSelect(sel, sel.value);
          this.updateFieldSelector();
          if (this.manager.selectedLayerId) this.manager.renderHexagons();
          else this.manager.clearHeatmapCanvas();
        };

        this.syncSelect(sel, sel.value);
      }

      rebuildLayerDropdown() {
        if (this.layerSelect) this.buildLayerListItems(this.layerSelect);
      }

      updateFieldSelector() {
        if (!this.fieldWrap || !this.fieldSelect) return;
        if (this.manager.currentAgg === "count") {
          this.fieldWrap.classList.add("hidden");
          return;
        }
        this.fieldWrap.classList.remove("hidden");

        const selected = this.manager.pointLayers.filter(
          (info) => info.id === this.manager.selectedLayerId,
        );
        const fields = this.manager.collectFields(selected);
        this.manager.autoFieldKey = this.manager.pickAutoField(fields);

        const phOpt = document.createElement("option");
        phOpt.value = "_auto";
        phOpt.textContent = _(`${CONST.name}.field_auto`);
        phOpt.disabled = true;
        phOpt.className = "placeholder-option";

        this.fieldSelect.innerHTML = "";
        this.fieldSelect.appendChild(phOpt);

        fields.forEach((f) => {
          const opt = document.createElement("option");
          opt.value = f;
          opt.textContent = f.startsWith("properties.") ? f.substring(11) : f;
          this.fieldSelect.appendChild(opt);
        });

        if (
          fields.includes(this.manager.currentField) ||
          this.manager.currentField === "_auto"
        ) {
          this.fieldSelect.value = this.manager.currentField;
        } else {
          this.manager.currentField = "_auto";
          this.fieldSelect.value = "_auto";
        }

        this.syncSelect(this.fieldSelect, this.fieldSelect.value);
      }

      /** Render color blocks into a container. */
      renderColorBar(container, name, nClasses) {
        const colors = this.manager.getColorScale(name, nClasses);
        container.innerHTML = "";
        for (const color of colors) {
          const blk = document.createElement("div");
          blk.className = "scheme-bar-block";
          blk.style.background = color;
          blk.style.width = `${100 / colors.length}%`;
          container.appendChild(blk);
        }
      }

      updateSchemeBar() {
        this.renderColorBar(
          this.schemeBarInner,
          this.manager.currentScheme,
          this.manager.N_CLASSES,
        );
      }

      refreshSchemeDropdownItems() {
        if (!this.schemeDropdown) return;
        const items = this.schemeDropdown.querySelectorAll(".scheme-dropdown-item");
        items.forEach((item) => {
          const name = item.getAttribute("data-scheme-name");
          if (!name) return;
          const bar = item.querySelector(".scheme-dropdown-bar");
          if (bar) this.renderColorBar(bar, name, this.manager.N_CLASSES);
        });
      }

      toggleSchemeDropdown() {
        if (this.schemeDropdown) {
          this.schemeDropdown.remove();
          this.schemeDropdown = null;
          return;
        }
        this.schemeDropdown = L.DomUtil.create(
          "div",
          "scheme-dropdown",
          this.schemeControlWrap,
        );
        this.schemeDropdown.setAttribute("role", "listbox");

        let focusIdx = -1;
        CONST.SCHEME_NAMES.forEach((name, idx) => {
          const item = L.DomUtil.create(
            "div",
            "scheme-dropdown-item",
            this.schemeDropdown,
          );
          item.setAttribute("role", "option");
          item.setAttribute("data-scheme-name", name);
          item.tabIndex = -1;
          if (name === this.manager.currentScheme) {
            item.classList.add("active");
            focusIdx = idx;
          }

          const itemBar = L.DomUtil.create("div", "scheme-dropdown-bar", item);
          this.renderColorBar(itemBar, name, this.manager.N_CLASSES);

          item.onclick = (ev) => {
            ev.stopPropagation();
            this.selectScheme(name);
          };
        });

        const items = this.schemeDropdown.querySelectorAll(".scheme-dropdown-item");
        if (items.length) {
          if (focusIdx >= 0) items[focusIdx].focus();
          else items[0].focus();
        }

        this.schemeDropdown.onkeydown = (e) => {
          const activeIdx = Array.from(items).indexOf(document.activeElement);
          if (e.key === "ArrowDown") {
            e.preventDefault();
            items[(activeIdx + 1) % items.length].focus();
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            items[(activeIdx - 1 + items.length) % items.length].focus();
          } else if (e.key === "Enter") {
            e.preventDefault();
            const active = document.activeElement;
            if (active?.classList.contains("scheme-dropdown-item")) {
              const idx = Array.from(items).indexOf(active);
              this.selectScheme(CONST.SCHEME_NAMES[idx]);
            }
          } else if (e.key === "Escape") {
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
          setTimeout(() => this.initScan(attempt - 1), CONST.INIT_SCAN_INTERVAL_MS);
        } else if (this.manager.pointLayers.length === 0) {
          window.foliplus.showHint(
            CONST.name,
            _(`${CONST.name}.no_layer`),
            window.foliplus.HINT_DURATION.LONG,
          );
        } else {
          this.rebuildLayerDropdown();
        }
      }

      resetAll() {
        this.manager.selectedLayerId = null;
        this.manager.autoFieldKey = null;
        this.manager.currentAgg = CONST.AGG_DEFAULT;
        this.manager.currentField = CONST.FIELD_DEFAULT;
        this.manager.N_CLASSES = CONST.N_CLASSES_DEFAULT;
        this.manager.currentMethod = CONST.COLOR_METHOD;
        this.manager.currentScheme = CONST.COLOR_SCHEME;
        this.manager.currentLabelShow = CONST.LABEL_SHOW;
        this.manager.BORDER_W = CONST.BORDER_W_DEFAULT;
        this.manager.BORDER_COLOR = CONST.BORDER_COLOR_DEFAULT;
        this.manager.clearHeatmapCanvas();
      }

      syncSelect(el, value) {
        el.value = value;
        el.classList.toggle("is-placeholder", !value || value === "_auto");
      }
    }

    // ==================== Instantiation ====================
    // Instantiate manager and control, then add to map
    const heatmapManager = new HeatmapManager(map);
    const heatmapCtrl = new HeatmapControl(
      { position: "{{ this.position }}" },
      heatmapManager,
    );

    heatmapCtrl.addTo(map);
    heatmapCtrl.initScan(CONST.INIT_SCAN_ATTEMPTS);
  }
})();

(function () {
  // ==================== Constants ====================
  const CONST = {
    name: "HeatmapControl",
    TIMING: {
      ZOOM_DEBOUNCE: 200,
      LAYER_SCAN_DEBOUNCE: 200,
      INIT_SCAN_ATTEMPTS: 8,
      INIT_SCAN_INTERVAL: 300,
      SCHEME_DROPDOWN_BLUR_DELAY: 150,
      LOAD_SCRIPT_RETRIES: 2,
      LOAD_SCRIPT_INTERVAL: 3000,
    },
    GRAY: "#999",
    H3: {
      RES_MAP: [
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
      RES_FALLBACK: 12,
    },
    ID: "foliplus_heatmap",
    AGG: "{{ this.agg }}",
    FIELD: "{{ this.style.field }}",
    SCHEME: "{{ this.color_scheme }}",
    METHOD: "{{ this.method }}",
    N_CLASSES: {{ this.n_classes }},
    BORDER: {
      W: {{ this.style.border_weight }},
      COLOR: "{{ this.style.border_color }}",
      FILL_OP: {{ this.style.fill_opacity }},
      OP: {{ this.style.border_opacity }},
    },
    LABEL: {
      SHOW: {{ "true" if this.style.label_show else "false" }},
      SIZE: {{ this.style.label_size }},
      COLOR: "{{ this.style.label_color }}",
      FORMAT: "{{ this.style.label_format }}",
    },
    SCHEME_NAMES: {{ this.schemes | tojson }},
    CLASSES: {
      FORM_ROW: "form-row",
      FORM_LABEL: "form-label",
      FORM_CONTROL_WRAP: "form-control-wrap",
      FORM_SELECT: "form-select",
      HIDDEN: "hidden",
      COLLAPSED: "collapsed",
      EXPANDED: "expanded",
      PLACEHOLDER_OPTION: "placeholder-option",
      SCHEME_DROPDOWN_ITEM: "scheme-dropdown-item",
    },
    SEL: {
      SCHEME_DROPDOWN_ITEM: ".scheme-dropdown-item",
    },
  };

  // ==================== Runtime Guard ====================
  if (!window.foliplus || !window.foliplus.SVGs) {
    console.error(`[${CONST.name}] foliplus runtime not found, plugin disabled.`);
    return;
  }

  // ==================== Dependencies ====================
  const map = {{ this._parent.get_name() }};
  const _ = (k) => (window.foliplus && window.foliplus.gt ? window.foliplus.gt(k) : k);

  // ==================== SVG Icons ====================
  const SVGs = {
    HEXAGON: `
      <svg viewBox="0 0 24 24">
        <polygon points="12,3 20.5,7.5 20.5,16.5 12,21 3.5,16.5 3.5,7.5" stroke-width="1.5"/>
        <polygon points="12,3 20.5,7.5 20.5,16.5 12,21 3.5,16.5 3.5,7.5" class="hf-bg"/>
        <polygon points="9.5,10.5 12,9 14.5,10.5 14.5,12.5 12,14 9.5,12.5" class="hf-center"/>
        <polygon points="9.5,10.5 12,9 14.5,10.5 14.5,12.5 12,14 9.5,12.5" stroke-width="1"/>
        <polygon points="9.5,5.5 12,4 14.5,5.5 14.5,7.5 12,9 9.5,7.5" class="hf-secondary"/>
        <polygon points="9.5,5.5 12,4 14.5,5.5 14.5,7.5 12,9 9.5,7.5" stroke-width="1"/>
        <polygon points="14,7.5 17,6 20.5,7.5 20.5,9.5 17,11 14,9.5" stroke-width="1"/>
        <polygon points="14,14.5 17,13 20.5,14.5 20.5,16.5 17,18 14,16.5" stroke-width="1"/>
        <polygon points="9.5,16.5 12,15 14.5,16.5 14.5,18.5 12,20 9.5,18.5" class="hf-secondary"/>
        <polygon points="9.5,16.5 12,15 14.5,16.5 14.5,18.5 12,20 9.5,18.5" stroke-width="1"/>
        <polygon points="3.5,14.5 7,13 10,14.5 10,16.5 7,18 3.5,16.5" stroke-width="1"/>
        <polygon points="3.5,7.5 7,6 10,7.5 10,9.5 7,11 3.5,9.5" stroke-width="1"/>
      </svg>`,
  };

  window.foliplus.registerHintIcon(CONST.name, SVGs.HEXAGON);

  // ==================== Guard: LayerControl required ====================
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
      this.currentAgg = CONST.AGG;
      this.currentField = CONST.FIELD;
      this.currentScheme = CONST.SCHEME;
      this.currentMethod = CONST.METHOD;
      this.autoFieldKey = null;
      this.N_CLASSES = CONST.N_CLASSES;
      this.BORDER_W = CONST.BORDER.W;
      this.BORDER_COLOR = CONST.BORDER.COLOR;
      this.currentLabelShow = CONST.LABEL.SHOW;
      this.valueFallbackWarned = false;
      // Create a managed canvas via LayerControl API.
      // Canvas lives in `.leaflet-map-pane` with position offset to cancel
      // the mapPane CSS transform.  Drawn with latLngToContainerPoint.
      // LayerControl handles visibility (checkbox) and z-order (drag-reorder).
      this.overlay = window.foliplus.LayerControlAPI.createCanvas({
        id: CONST.ID,
        name: _(`${CONST.name}.title`),
        iconSvg: SVGs.HEXAGON,
      });
      this.ui = null;
      this.cachedPoints = null;
      this.cachedFeatures = null;
      this.cachedAgg = null;
      this.labelStyleCache = null;
      this.renderAll = false;

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
      }, CONST.TIMING.ZOOM_DEBOUNCE);
      this.map.on("zoomend", this.onZoomEnd);

      this.onLayerChange = foliplus.debounce(() => {
        this.cachedPoints = null;
        this.cachedAgg = null;
        if (this.ui) {
          this.scanMapLayers();
          this.ui.rebuildLayerDropdown();
        }
      }, CONST.TIMING.LAYER_SCAN_DEBOUNCE);
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
      // Viewport culling: skip hexagons outside the visible map bounds.
      // Set renderAll = true (e.g. before export) to disable culling.
      const bounds = this.renderAll ? null : this.map.getBounds();
      const isVisible = (feat) => {
        if (!bounds) return true;
        const c = feat.properties.centroid;
        return c && bounds.contains(L.latLng(c[0], c[1]));
      };

      features.forEach((feat) => {
        if (!isVisible(feat)) return;
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
      ctx.fillStyle = feat.properties.fillColor || CONST.GRAY;
      ctx.globalAlpha = CONST.BORDER.FILL_OP;
      ctx.fill();
      ctx.globalAlpha = 1;

      if (this.BORDER_W > 0 && CONST.BORDER.OP > 0) {
        ctx.strokeStyle = this.BORDER_COLOR;
        ctx.lineWidth = this.BORDER_W;
        ctx.globalAlpha = CONST.BORDER.OP;
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
        font: `${cssVal("--heatmap-label-font-weight", "bold")} ${cssVal("--heatmap-label-font-size", `${CONST.LABEL.SIZE}px`)} ${cssVal("--heatmap-label-font-family", "sans-serif")}`,
        color: cssVal("--heatmap-label-color", CONST.LABEL.COLOR),
        stroke: cssVal("--heatmap-label-stroke-color", "rgba(0,0,0,0.75)"),
        strokeWidth: parseFloat(cssVal("--heatmap-label-stroke-width", "3")),
      };
      return this.labelStyleCache;
    }

    /** Draw a formatted value label centered on the hexagon. */
    drawHexLabel(ctx, feat, { font, color, stroke, strokeWidth }) {
      const centroid = feat.properties.centroid;
      const pt = this.map.latLngToContainerPoint(L.latLng(centroid[0], centroid[1]));
      const text = window.foliplus.formatNumber(
        feat.properties.value,
        CONST.LABEL.FORMAT,
      );
      // Use cached font string to avoid repeated Canvas font parsing
      if (ctx.font !== font) ctx.font = font;
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
      const pointLayersInfo = window.foliplus.LayerControlAPI.getLayersByType("point");
      if (!pointLayersInfo.length) return;

      const seenIds = {};
      for (const info of pointLayersInfo) {
        if (seenIds[info.id]) continue;
        seenIds[info.id] = true;
        const layer = window.foliplus.LayerControlAPI.findLayer(info.id);
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
      const key = this.currentField === "_auto" ? this.autoFieldKey : this.currentField;
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
      const entry = CONST.H3.RES_MAP.find(([z]) => zoom <= z);
      return entry ? entry[1] : CONST.H3.RES_FALLBACK;
    }

    getColorScale(name, n) {
      if (typeof chroma !== "undefined")
        return chroma.scale(name).mode("lab").colors(n);
      return Array(n).fill(CONST.GRAY);
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
      // Aggregation cache key: layer + agg + field + res + method + scheme + nClasses
      const aggKey = `${this.selectedLayerId}|${this.currentAgg}|${this.currentField}|${res}|${this.currentMethod}|${this.currentScheme}|${this.N_CLASSES}`;
      let aggregated;
      if (this.cachedAgg && this.cachedAgg.key === aggKey)
        aggregated = this.cachedAgg.data;
      else {
        aggregated = this.aggregateData(pts, res);
        if (aggregated) this.cachedAgg = { key: aggKey, data: aggregated };
      }
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
      this.cachedAgg = null;
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
      this.m.ui = this;
      this.schemeDropdown = null;
      this.expandHookDone = false;
    }

    /** Alias for convenience */
    get m() {
      return this.manager;
    }

    /** Create a form-row with label + control-wrap. */
    createFormRow(parent, labelKey, rowClass = CONST.CLASSES.FORM_ROW) {
      const row = L.DomUtil.create("div", rowClass, parent);
      const label = L.DomUtil.create("label", CONST.CLASSES.FORM_LABEL, row);
      label.textContent = _(labelKey);
      const wrap = L.DomUtil.create("div", CONST.CLASSES.FORM_CONTROL_WRAP, row);
      return { row, label, wrap };
    }

    onAdd() {
      const { container, ctrl, panelContent } = window.foliplus.createPanelControl({
        cssClass: "heatmap-ctrl",
        toggleTitle: _(`${CONST.name}.title`),
        toggleSvg: SVGs.HEXAGON,
        panelTitle: _(`${CONST.name}.title`),
        closeTitle: _(`${CONST.name}.close_title`),
      });
      this.container = ctrl;
      this.buildDataSection(panelContent);
      this.buildStyleSection();
      this.setupObserver();
      return container;
    }

    /** Build the data section: layer select, aggregation method, field selector. */
    buildDataSection(panelContent) {
      const configBody = L.DomUtil.create("div", "config-body", panelContent);
      const dataHeading = L.DomUtil.create("div", "section-heading", configBody);
      dataHeading.textContent = _(`${CONST.name}.section_data`);

      const { wrap: layerSelectWrap } = this.createFormRow(
        configBody,
        `${CONST.name}.layer`,
      );
      this.layerSelect = L.DomUtil.create(
        "select",
        "form-select layer-select",
        layerSelectWrap,
      );

      this.extraBody = L.DomUtil.create("div", "extra-body", configBody);
      this.extraBody.style.display = "none";

      // Aggregation method
      const { wrap: aggControlWrap } = this.createFormRow(
        this.extraBody,
        `${CONST.name}.agg_method`,
      );
      this.aggSelect = L.DomUtil.create(
        "select",
        CONST.CLASSES.FORM_SELECT,
        aggControlWrap,
      );
      this.aggSelect.innerHTML = `
          <option value="count">${_(`${CONST.name}.agg_count`)}</option>
          <option value="sum">${_(`${CONST.name}.agg_sum`)}</option>
          <option value="avg">${_(`${CONST.name}.agg_avg`)}</option>
          <option value="min">${_(`${CONST.name}.agg_min`)}</option>
          <option value="max">${_(`${CONST.name}.agg_max`)}</option>`;
      this.aggSelect.value = this.m.currentAgg;
      this.aggSelect.onchange = () => {
        this.m.currentAgg = this.aggSelect.value;
        this.updateFieldSelector();
        this.m.renderHexagons();
      };

      this.fieldWrap = L.DomUtil.create(
        "div",
        "form-row field-wrap hidden",
        this.extraBody,
      );
      const fieldLabel = L.DomUtil.create(
        "label",
        CONST.CLASSES.FORM_LABEL,
        this.fieldWrap,
      );
      fieldLabel.textContent = _(`${CONST.name}.field`);
      const fieldControlWrap = L.DomUtil.create(
        "div",
        CONST.CLASSES.FORM_CONTROL_WRAP,
        this.fieldWrap,
      );
      this.fieldSelect = L.DomUtil.create(
        "select",
        CONST.CLASSES.FORM_SELECT,
        fieldControlWrap,
      );
      this.fieldSelect.onchange = () => {
        this.m.currentField = this.fieldSelect.value;
        this.syncSelect(this.fieldSelect, this.fieldSelect.value);
        this.m.renderHexagons();
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
      const classRow = L.DomUtil.create("div", CONST.CLASSES.FORM_ROW, styleSection);
      const classRowLabel = L.DomUtil.create(
        "label",
        CONST.CLASSES.FORM_LABEL,
        classRow,
      );
      classRowLabel.textContent = _(`${CONST.name}.class_method`);
      const classControlWrap = L.DomUtil.create(
        "div",
        "form-control-wrap form-control-inline",
        classRow,
      );
      this.methodSelect = L.DomUtil.create(
        "select",
        CONST.CLASSES.FORM_SELECT,
        classControlWrap,
      );
      this.methodSelect.innerHTML = `
          <option value="jenks">${_(`${CONST.name}.jenks`)}</option>
          <option value="quantile">${_(`${CONST.name}.quantile`)}</option>
          <option value="equal">${_(`${CONST.name}.equal`)}</option>
          <option value="heads">${_(`${CONST.name}.heads`)}</option>`;
      this.methodSelect.value = this.m.currentMethod;
      this.methodSelect.onchange = () => {
        this.m.currentMethod = this.methodSelect.value;
        this.m.renderHexagons();
      };

      this.classSelect = L.DomUtil.create(
        "select",
        "form-select class-count-select",
        classControlWrap,
      );
      for (let ci = 2; ci <= 9; ci++) {
        this.classSelect.appendChild(
          window.foliplus.dom.el("option", { value: ci }, String(ci)),
        );
      }
      this.classSelect.value = Math.min(9, Math.max(2, this.m.N_CLASSES));
      this.classSelect.onchange = () => {
        this.m.N_CLASSES = Math.min(
          9,
          Math.max(2, parseInt(this.classSelect.value, 10) || 6),
        );
        this.updateSchemeBar();
        if (this.schemeDropdown) this.refreshSchemeDropdownItems();
        this.m.renderHexagons();
      };

      // Color scheme
      const schemeRow = L.DomUtil.create("div", CONST.CLASSES.FORM_ROW, styleSection);
      const schemeRowLabel = L.DomUtil.create(
        "label",
        CONST.CLASSES.FORM_LABEL,
        schemeRow,
      );
      schemeRowLabel.textContent = _(`${CONST.name}.scheme`);
      this.schemeControlWrap = L.DomUtil.create(
        "div",
        CONST.CLASSES.FORM_CONTROL_WRAP,
        schemeRow,
      );
      this.schemeBar = L.DomUtil.create("div", "scheme-bar", this.schemeControlWrap);
      this.schemeBarInner = L.DomUtil.create("div", "scheme-bar-inner", this.schemeBar);
      this.schemeSelectHidden = L.DomUtil.create(
        "select",
        "scheme-select-hidden",
        this.schemeControlWrap,
      );

      CONST.SCHEME_NAMES.forEach((name) => {
        this.schemeSelectHidden.appendChild(
          window.foliplus.dom.el("option", { value: name }, name),
        );
      });
      this.schemeSelectHidden.value = this.m.currentScheme;
      this.schemeSelectHidden.onchange = () => {
        this.m.currentScheme = this.schemeSelectHidden.value;
        this.updateSchemeBar();
        this.m.renderHexagons();
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

      // Close scheme dropdown when clicking outside
      this.closeSchemeDropdown = (e) => {
        if (
          this.schemeDropdown &&
          !this.schemeBar.contains(e.target) &&
          !this.schemeDropdown.contains(e.target)
        ) {
          this.schemeDropdown.remove();
          this.schemeDropdown = null;
          document.removeEventListener("click", this.closeSchemeDropdown);
        }
      };
      // Wrap toggleSchemeDropdown to also register outside-click listener
      const origToggle = this.toggleSchemeDropdown.bind(this);
      this.toggleSchemeDropdown = () => {
        origToggle();
        if (this.schemeDropdown)
          document.addEventListener("click", this.closeSchemeDropdown);
      };

      // Border settings
      const borderRow = L.DomUtil.create("div", CONST.CLASSES.FORM_ROW, styleSection);
      const borderRowLabel = L.DomUtil.create(
        "label",
        CONST.CLASSES.FORM_LABEL,
        borderRow,
      );
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
      this.borderColorInput.value = this.m.BORDER_COLOR;
      this.borderColorInput.oninput = () => {
        this.m.BORDER_COLOR = this.borderColorInput.value;
        this.m.renderHexagons();
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
      this.borderWeightInput.value = this.m.BORDER_W;
      this.borderWeightInput.onchange = () => {
        this.m.BORDER_W = parseFloat(this.borderWeightInput.value) || 1;
        this.m.renderHexagons();
      };

      // Label toggle
      const labelRow = L.DomUtil.create(
        "div",
        "form-row section-block-last",
        styleSection,
      );
      const labelRowText = L.DomUtil.create(
        "label",
        CONST.CLASSES.FORM_LABEL,
        labelRow,
      );
      labelRowText.textContent = _(`${CONST.name}.label`);
      const labelControlWrap = L.DomUtil.create(
        "div",
        CONST.CLASSES.FORM_CONTROL_WRAP,
        labelRow,
      );
      const labelToggle = L.DomUtil.create("label", "toggle-switch", labelControlWrap);
      this.labelChk = L.DomUtil.create("input", "", labelToggle);
      this.labelChk.type = "checkbox";
      this.labelChk.checked = this.m.currentLabelShow;
      this.labelChk.onchange = () => {
        this.m.currentLabelShow = this.labelChk.checked;
        this.m.renderHexagons();
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
        this.syncSelect(this.aggSelect, CONST.AGG);
        this.syncSelect(this.classSelect, String(CONST.N_CLASSES));
        this.syncSelect(this.methodSelect, CONST.METHOD);
        this.schemeSelectHidden.value = CONST.SCHEME;
        this.labelChk.checked = CONST.LABEL.SHOW;
        this.borderWeightInput.value = CONST.BORDER.W;
        this.borderColorInput.value = CONST.BORDER.COLOR;

        this.updateSchemeBar();
        this.updateFieldSelector();
        this.extraBody.style.display = "none";
        this.container.classList.remove(CONST.CLASSES.EXPANDED);
        this.container.classList.add(CONST.CLASSES.COLLAPSED);
      };

      const confirmBtn = L.DomUtil.create("button", "btn btn-confirm", btnRow);
      confirmBtn.textContent = _(`${CONST.name}.confirm`);
      confirmBtn.onclick = () => {
        this.m.renderHexagons();
        this.container.classList.remove(CONST.CLASSES.EXPANDED);
        this.container.classList.add(CONST.CLASSES.COLLAPSED);
      };
    }

    /** Set up MutationObserver to refresh layer dropdown on panel expand. */
    setupObserver() {
      this.observer = new MutationObserver(() => {
        if (
          this.container.classList.contains(CONST.CLASSES.EXPANDED) &&
          !this.expandHookDone
        ) {
          this.expandHookDone = true;
          this.rebuildLayerDropdown();
        }
        if (this.container.classList.contains(CONST.CLASSES.COLLAPSED))
          this.expandHookDone = false;
      });
      this.observer.observe(this.container, { attributes: true });
    }

    onRemove() {
      // Clean up map event listeners
      if (this.m.moveRafId) cancelAnimationFrame(this.m.moveRafId);
      if (this.m.onZoomEnd) this.m.onZoomEnd.cancel();
      if (this.m.onLayerChange) this.m.onLayerChange.cancel();
      this.m.map.off("zoomstart", this.m.onZoomStart);
      this.m.map.off("move", this.m.redrawOnMove);
      this.m.map.off("zoomend", this.m.onZoomEnd);
      this.m.map.off("layeradd layerremove", this.m.onLayerChange);

      // Disconnect MutationObserver
      if (this.observer) this.observer.disconnect();

      this.m.clearHeatmapCanvas();
      if (this.m.overlay) this.m.overlay.destroy();
      this.m.overlay = null;
      this.m.ui = null;
    }

    // --- UI Logic Methods ---
    buildLayerListItems(sel) {
      this.m.scanMapLayers();
      sel.innerHTML = "";
      const placeholder = window.foliplus.dom.el(
        "option",
        {
          value: "",
          disabled: "disabled",
          class: CONST.CLASSES.PLACEHOLDER_OPTION,
          selected: !this.m.selectedLayerId ? "" : undefined,
        },
        _(`${CONST.name}.layer_placeholder`),
      );
      sel.appendChild(placeholder);

      this.m.pointLayers.forEach((info) => {
        sel.appendChild(
          window.foliplus.dom.el("option", { value: info.id }, info.name),
        );
      });

      if (this.m.selectedLayerId) sel.value = this.m.selectedLayerId;
      else sel.selectedIndex = 0;

      sel.onchange = () => {
        this.m.selectedLayerId = sel.value || null;
        if (this.extraBody) {
          this.extraBody.style.display = this.m.selectedLayerId ? "" : "none";
        }
        this.syncSelect(sel, sel.value);
        this.updateFieldSelector();
        if (this.m.selectedLayerId) this.m.renderHexagons();
        else this.m.clearHeatmapCanvas();
      };

      this.syncSelect(sel, sel.value);
    }

    rebuildLayerDropdown() {
      if (this.layerSelect) this.buildLayerListItems(this.layerSelect);
    }

    updateFieldSelector() {
      if (!this.fieldWrap || !this.fieldSelect) return;
      if (this.m.currentAgg === "count") {
        this.fieldWrap.classList.add(CONST.CLASSES.HIDDEN);
        return;
      }
      this.fieldWrap.classList.remove(CONST.CLASSES.HIDDEN);

      const selected = this.m.pointLayers.filter(
        (info) => info.id === this.m.selectedLayerId,
      );
      const fields = this.m.collectFields(selected);
      this.m.autoFieldKey = this.m.pickAutoField(fields);

      const phOpt = window.foliplus.dom.el(
        "option",
        {
          value: "_auto",
          disabled: "disabled",
          class: CONST.CLASSES.PLACEHOLDER_OPTION,
        },
        _(`${CONST.name}.field_auto`),
      );

      this.fieldSelect.innerHTML = "";
      this.fieldSelect.appendChild(phOpt);

      fields.forEach((f) => {
        this.fieldSelect.appendChild(
          window.foliplus.dom.el(
            "option",
            { value: f },
            f.startsWith("properties.") ? f.substring(11) : f,
          ),
        );
      });

      if (fields.includes(this.m.currentField) || this.m.currentField === "_auto") {
        this.fieldSelect.value = this.m.currentField;
      } else {
        this.m.currentField = "_auto";
        this.fieldSelect.value = "_auto";
      }

      this.syncSelect(this.fieldSelect, this.fieldSelect.value);
    }

    /** Render color blocks into a container. */
    renderColorBar(container, name, nClasses) {
      const colors = this.m.getColorScale(name, nClasses);
      container.innerHTML = "";
      for (const color of colors) {
        container.appendChild(
          window.foliplus.dom.el("div", {
            class: "scheme-bar-block",
            style: `background:${color};width:${100 / colors.length}%`,
          }),
        );
      }
    }

    updateSchemeBar() {
      this.renderColorBar(this.schemeBarInner, this.m.currentScheme, this.m.N_CLASSES);
      this.schemeBar.title = this.m.currentScheme;
    }

    refreshSchemeDropdownItems() {
      if (!this.schemeDropdown) return;
      const items = this.schemeDropdown.querySelectorAll(
        CONST.SEL.SCHEME_DROPDOWN_ITEM,
      );
      items.forEach((item) => {
        const name = item.getAttribute("data-scheme-name");
        if (!name) return;
        const bar = item.querySelector(".scheme-dropdown-bar");
        if (bar) this.renderColorBar(bar, name, this.m.N_CLASSES);
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
          CONST.CLASSES.SCHEME_DROPDOWN_ITEM,
          this.schemeDropdown,
        );
        item.setAttribute("role", "option");
        item.setAttribute("data-scheme-name", name);
        item.tabIndex = -1;
        if (name === this.m.currentScheme) {
          item.classList.add("active");
          focusIdx = idx;
        }

        const itemBar = L.DomUtil.create("div", "scheme-dropdown-bar", item);
        this.renderColorBar(itemBar, name, this.m.N_CLASSES);
        item.title = name;

        item.onclick = (ev) => {
          ev.stopPropagation();
          this.selectScheme(name);
        };
      });

      const items = this.schemeDropdown.querySelectorAll(
        CONST.SEL.SCHEME_DROPDOWN_ITEM,
      );
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
          if (active?.classList.contains(CONST.CLASSES.SCHEME_DROPDOWN_ITEM)) {
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
      this.m.currentScheme = name;
      this.schemeSelectHidden.value = name;
      this.updateSchemeBar();
      if (this.schemeDropdown) {
        this.schemeDropdown.remove();
        this.schemeDropdown = null;
      }
      this.m.renderHexagons();
      this.schemeBar.focus();
    }

    initScan(attempt) {
      this.m.scanMapLayers();
      if (this.m.pointLayers.length === 0 && attempt > 0) {
        setTimeout(() => this.initScan(attempt - 1), CONST.TIMING.INIT_SCAN_INTERVAL);
      } else if (this.m.pointLayers.length === 0) {
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
      this.m.selectedLayerId = null;
      this.m.autoFieldKey = null;
      this.m.currentAgg = CONST.AGG;
      this.m.currentField = CONST.FIELD;
      this.m.N_CLASSES = CONST.N_CLASSES;
      this.m.currentMethod = CONST.METHOD;
      this.m.currentScheme = CONST.SCHEME;
      this.m.currentLabelShow = CONST.LABEL.SHOW;
      this.m.BORDER_W = CONST.BORDER.W;
      this.m.BORDER_COLOR = CONST.BORDER.COLOR;
      this.m.clearHeatmapCanvas();
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
  heatmapCtrl.initScan(CONST.TIMING.INIT_SCAN_ATTEMPTS);
})();

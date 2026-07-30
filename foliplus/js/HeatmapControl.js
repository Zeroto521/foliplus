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
      SHOW: {{ this.style.label_show | tojson }},
      SIZE: {{ this.style.label_size }},
      COLOR: "{{ this.style.label_color }}",
      FORMAT: "{{ this.style.label_format }}",
    },
    AGG: {
      COUNT: "count",
      SUM: "sum",
      AVG: "avg",
      MIN: "min",
      MAX: "max",
    },
    SCHEME_NAMES: {{ this.schemes | tojson }},
    CLASSES: {
      FORM_ROW: "foliplus-heatmap-form-row",
      FORM_LABEL: "foliplus-heatmap-form-label",
      FORM_CONTROL: "foliplus-heatmap-form-control",
      FORM_SELECT: "foliplus-heatmap-form-select",
      HIDDEN: "hidden",
      COLLAPSED: "collapsed",
      EXPANDED: "expanded",
      ACTIVE: "active",
      PLACEHOLDER_OPTION: "foliplus-heatmap-placeholder-opt",
      SCHEME_DROPDOWN_ITEM: "foliplus-heatmap-scheme-dropdown-item",
      SECTION_HEADING: "foliplus-heatmap-section-heading",
      SECTION_BLOCK: "foliplus-heatmap-section-block",
      SECTION_BLOCK_LAST: "foliplus-heatmap-section-block-last",
      CONFIG_BODY: "foliplus-heatmap-config-body",
      EXTRA_BODY: "foliplus-heatmap-extra-body",
      FIELD: "foliplus-heatmap-field",
      SCHEME_BAR: "foliplus-heatmap-scheme-bar",
      SCHEME_BAR_INNER: "foliplus-heatmap-scheme-bar-inner",
      SCHEME_BAR_BLOCK: "foliplus-heatmap-scheme-bar-block",
      SCHEME_DROPDOWN: "foliplus-heatmap-scheme-dropdown",
      SCHEME_DROPDOWN_BAR: "foliplus-heatmap-scheme-dropdown-bar",
      SCHEME_SELECT_HIDDEN: "hidden",
      BTN: "foliplus-heatmap-btn",
      BTN_ROW: "foliplus-heatmap-btn-row",
      BTN_CLEAR: "foliplus-heatmap-btn-clear",
      BTN_CONFIRM: "foliplus-heatmap-btn-confirm",
      TOGGLE_SWITCH: "foliplus-heatmap-toggle-switch",
      TOGGLE_SLIDER: "foliplus-heatmap-toggle-slider",
      BORDER_COLOR_INPUT: "foliplus-heatmap-color-input",
      BORDER_WEIGHT_INPUT: "foliplus-heatmap-weight-input",
      CLASS_COUNT_SELECT: "foliplus-heatmap-class-select",
      FORM_CONTROL_INLINE: "foliplus-heatmap-form-inline",
      SECTION_DIVIDER: "foliplus-section-divider",
      CLASS_PLACEHOLDER: "foliplus-heatmap-placeholder",
      HEATMAP_CTRL: "foliplus-heatmap-ctrl",
    },
    SEL: {
      SCHEME_DROPDOWN_ITEM: ".foliplus-heatmap-scheme-dropdown-item",
      SCHEME_DROPDOWN_BAR: ".foliplus-heatmap-scheme-dropdown-bar",
      SCHEME_BAR: ".foliplus-heatmap-scheme-bar",
      FORM_SELECT: ".foliplus-heatmap-form-select",
      FORM_LABEL: ".foliplus-heatmap-form-label",
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
  const SVGs = {
    HEXAGON: `
      <svg viewBox="0 0 24 24">
        <polygon points="12,3 20.5,7.5 20.5,16.5 12,21 3.5,16.5 3.5,7.5" stroke-width="1.5"/>
        <polygon points="12,3 20.5,7.5 20.5,16.5 12,21 3.5,16.5 3.5,7.5" class="foliplus-hf-bg"/>
        <polygon points="9.5,10.5 12,9 14.5,10.5 14.5,12.5 12,14 9.5,12.5" class="foliplus-hf-center"/>
        <polygon points="9.5,10.5 12,9 14.5,10.5 14.5,12.5 12,14 9.5,12.5" stroke-width="1"/>
        <polygon points="9.5,5.5 12,4 14.5,5.5 14.5,7.5 12,9 9.5,7.5" class="foliplus-hf-secondary"/>
        <polygon points="9.5,5.5 12,4 14.5,5.5 14.5,7.5 12,9 9.5,7.5" stroke-width="1"/>
        <polygon points="14,7.5 17,6 20.5,7.5 20.5,9.5 17,11 14,9.5" stroke-width="1"/>
        <polygon points="14,14.5 17,13 20.5,14.5 20.5,16.5 17,18 14,16.5" stroke-width="1"/>
        <polygon points="9.5,16.5 12,15 14.5,16.5 14.5,18.5 12,20 9.5,18.5" class="foliplus-hf-secondary"/>
        <polygon points="9.5,16.5 12,15 14.5,16.5 14.5,18.5 12,20 9.5,18.5" stroke-width="1"/>
        <polygon points="3.5,14.5 7,13 10,14.5 10,16.5 7,18 3.5,16.5" stroke-width="1"/>
        <polygon points="3.5,7.5 7,6 10,7.5 10,9.5 7,11 3.5,9.5" stroke-width="1"/>
      </svg>`,
  };

  foliplus.registerHintIcon(CONST.name, SVGs.HEXAGON);

  // ==================== Guard: LayerControl required ====================
  if (!foliplus.LayerAPI) {
    console.error(`[${CONST.name}] ${_(`${CONST.name}.no_layercontrol`)}`);
    foliplus.showHint(
      CONST.name,
      _(`${CONST.name}.no_layercontrol`),
      foliplus.HINT_DURATION.PERSIST,
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
      this.currentAgg = CONST.AGG.COUNT;
      this.currentField = CONST.FIELD;
      this.currentScheme = CONST.SCHEME;
      this.currentMethod = CONST.METHOD;
      this.autoFieldKey = null;
      this.fieldAuto = true;
      this.numClasses = CONST.N_CLASSES;
      this.borderWeight = CONST.BORDER.W;
      this.borderColor = CONST.BORDER.COLOR;
      this.currentLabelShow = CONST.LABEL.SHOW;
      this.valueFallbackWarned = false;
      // Create a managed canvas via LayerControl API.
      // Canvas lives in `.leaflet-map-pane` with position offset to cancel
      // the mapPane CSS transform.  Drawn with latLngToContainerPoint.
      // LayerControl handles visibility (checkbox) and z-order (drag-reorder).
      this.overlay = foliplus.LayerAPI.createCanvas({
        id: CONST.ID,
        name: _(`${CONST.name}.title`),
        iconSvg: SVGs.HEXAGON,
      });
      this.ui = null;
      this.cachedPoints = null;
      this.cachedFeatures = null;
      this.cachedAgg = null;
      this.cachedLabelStyle = null;
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
      if (!this.overlay.canvas || !this.cachedFeatures) return;
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

      this.cachedFeatures.forEach((feat) => {
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

      if (this.borderWeight > 0 && CONST.BORDER.OP > 0) {
        ctx.strokeStyle = this.borderColor;
        ctx.lineWidth = this.borderWeight;
        ctx.globalAlpha = CONST.BORDER.OP;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    /** Resolve label styling from CSS custom properties (cached once). */
    resolveLabelStyle() {
      if (this.cachedLabelStyle) return this.cachedLabelStyle;
      const cs = getComputedStyle(this.ui.container);
      const val = (prop, fb) => cs.getPropertyValue(prop).trim() || fb;

      this.cachedLabelStyle = {
        font: `${val("--heatmap-label-font-weight", "bold")} ${val("--heatmap-label-font-size", `${CONST.LABEL.SIZE}px`)} ${val("--heatmap-label-font-family", "sans-serif")}`,
        color: val("--heatmap-label-color", CONST.LABEL.COLOR),
        stroke: val("--heatmap-label-stroke-color", "rgba(0,0,0,0.75)"),
        strokeWidth: parseFloat(val("--heatmap-label-stroke-width", "3")),
      };
      return this.cachedLabelStyle;
    }

    /** Draw a formatted value label centered on the hexagon. */
    drawHexLabel(ctx, feat, { font, color, stroke, strokeWidth }) {
      const centroid = feat.properties.centroid;
      const pt = this.map.latLngToContainerPoint(L.latLng(centroid[0], centroid[1]));
      const text = foliplus.formatNumber(feat.properties.value, CONST.LABEL.FORMAT);
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
      const pointLayersInfo = foliplus.LayerAPI.getLayersByType("point");
      if (!pointLayersInfo.length) return;

      const seenIds = {};
      for (const info of pointLayersInfo) {
        if (seenIds[info.id]) continue;
        seenIds[info.id] = true;

        const pts = foliplus.LayerAPI.extractPoints(info.id);
        if (pts.length === 0) continue;
        const layer = foliplus.LayerAPI.findLayer(info.id);
        this.pointLayers.push({
          id: info.id,
          name: info.name,
          layer,
          count: pts.length,
        });
      }
    }

    collectFields(layers) {
      const fields = {};
      layers.forEach((info) => {
        foliplus.LayerAPI.extractPoints(info.id).forEach((pt) => {
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
      if (this.currentAgg === CONST.AGG.COUNT) return 1;
      const key = this.fieldAuto ? this.autoFieldKey : this.currentField;
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
      const key = `${this.selectedLayerId}|${this.currentAgg}|${this.fieldAuto}|${this.currentField}`;
      if (this.cachedPoints && this.cachedPoints.key === key)
        return this.cachedPoints.pts;

      const pts = [];
      if (!this.selectedLayerId) return pts;
      this.pointLayers.forEach((info) => {
        if (info.id === this.selectedLayerId) {
          foliplus.LayerAPI.extractPoints(info.id).forEach((p) => {
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
          const clusters = ss.ckmeans(data, nClasses);
          const breaks = [clusters[0][0]];
          clusters.forEach((c) => breaks.push(c[c.length - 1]));
          return breaks;
        } catch (e) {}
        return [lo, hi];
      } else if (method === "quantile") {
        const b = [lo];
        for (let i = 1; i < nClasses; i++)
          b.push(ss.quantileSorted(sorted, i / nClasses));
        return b.concat(hi);
      } else if (method === "heads") {
        const b = [lo];
        for (let i = 1; i < nClasses; i++)
          b.push(sorted[Math.min(Math.floor((i * n) / nClasses), n - 1)]);
        return b.concat(hi);
      } else {
        const step = (hi - lo) / nClasses;
        const b = [];
        for (let i = 0; i <= nClasses; i++) b.push(lo + step * i);
        return b;
      }
    }

    // --- Hexagon Rendering ---
    renderHexagons() {
      if (!this.map || !this.map._container) return;
      if (!this.selectedLayerId) {
        this.clearHeatmapCanvas();
        return;
      }
      const pts = this.collectSelectedPoints();
      const zoom = this.map.getZoom();
      const res = this.getH3Res(zoom);
      const aggKey = `${this.selectedLayerId}|${this.currentAgg}|${this.fieldAuto}|${this.currentField}|${res}|${this.currentMethod}|${this.currentScheme}|${this.numClasses}`;
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
          case CONST.AGG.COUNT:
            return cell.count;
          case CONST.AGG.SUM:
            return cell.sum;
          case CONST.AGG.AVG:
            return cell.count > 0 ? cell.sum / cell.count : 0;
          case CONST.AGG.MIN:
            return cell.min;
          case CONST.AGG.MAX:
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

      const nClasses = Math.min(this.numClasses, allVals.length);
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

      this.overlay.register();
      this.redrawHeatmap();
    }

    clearHeatmapCanvas() {
      this.cachedFeatures = null;
      this.cachedAgg = null;
      if (this.overlay) this.overlay.unregister(); // auto-clears canvas + hides
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
      const row = foliplus.dom.el("div", { class: rowClass, parent });
      foliplus.dom.el(
        "label",
        { class: CONST.CLASSES.FORM_LABEL, parent: row },
        _(labelKey),
      );
      const wrap = foliplus.dom.el("div", {
        class: CONST.CLASSES.FORM_CONTROL,
        parent: row,
      });
      return { row, wrap };
    }

    onAdd() {
      const { container, ctrl, panelContent } = foliplus.createPanelControl({
        cssClass: CONST.CLASSES.HEATMAP_CTRL,
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
      const configBody = foliplus.dom.el("div", {
        class: CONST.CLASSES.CONFIG_BODY,
        parent: panelContent,
      });
      foliplus.dom.el("div", {
        class: CONST.CLASSES.SECTION_HEADING,
        parent: configBody,
        innerHTML: _(`${CONST.name}.section_data`),
      });

      const { wrap: layerSelectWrap } = this.createFormRow(
        configBody,
        `${CONST.name}.layer`,
      );
      this.layerSelect = foliplus.dom.el("select", {
        class: CONST.CLASSES.FORM_SELECT,
        parent: layerSelectWrap,
      });

      this.extraBody = foliplus.dom.el("div", {
        class: `${CONST.CLASSES.EXTRA_BODY} ${CONST.CLASSES.HIDDEN}`,
        parent: configBody,
      });

      // Aggregation method
      const { wrap: aggControlWrap } = this.createFormRow(
        this.extraBody,
        `${CONST.name}.agg_method`,
      );
      this.aggSelect = foliplus.dom.el("select", {
        class: CONST.CLASSES.FORM_SELECT,
        parent: aggControlWrap,
        innerHTML: `
          <option value="${CONST.AGG.COUNT}">${_(`${CONST.name}.agg_count`)}</option>
          <option value="${CONST.AGG.SUM}">${_(`${CONST.name}.agg_sum`)}</option>
          <option value="${CONST.AGG.AVG}">${_(`${CONST.name}.agg_avg`)}</option>
          <option value="${CONST.AGG.MIN}">${_(`${CONST.name}.agg_min`)}</option>
          <option value="${CONST.AGG.MAX}">${_(`${CONST.name}.agg_max`)}</option>`,
        value: this.m.currentAgg,
        onchange: () => {
          this.m.currentAgg = this.aggSelect.value;
          this.updateFieldSelector();
          this.m.renderHexagons();
        },
      });

      this.fieldWrap = foliplus.dom.el("div", {
        class: `${CONST.CLASSES.FORM_ROW} ${CONST.CLASSES.FIELD} ${CONST.CLASSES.HIDDEN}`,
        parent: this.extraBody,
      });
      foliplus.dom.el("label", {
        class: CONST.CLASSES.FORM_LABEL,
        parent: this.fieldWrap,
        innerHTML: _(`${CONST.name}.field`),
      });
      const fieldControlWrap = foliplus.dom.el("div", {
        class: CONST.CLASSES.FORM_CONTROL,
        parent: this.fieldWrap,
      });
      this.fieldSelect = foliplus.dom.el("select", {
        class: CONST.CLASSES.FORM_SELECT,
        parent: fieldControlWrap,
        onchange: () => {
          this.m.currentField = this.fieldSelect.value;
          this.m.fieldAuto = false;
          this.syncSelect(this.fieldSelect, this.fieldSelect.value);
          this.m.renderHexagons();
        },
      });

      // Initialize layer dropdown LAST after all select refs are created
      this.buildLayerListItems(this.layerSelect);
    }

    /** Build the style section: classification, color scheme, border, label toggle, action buttons. */
    buildStyleSection() {
      foliplus.dom.el("div", {
        class: CONST.CLASSES.SECTION_HEADING,
        parent: this.extraBody,
        innerHTML: _(`${CONST.name}.section_style`),
      });
      const styleSection = foliplus.dom.el("div", {
        class: CONST.CLASSES.SECTION_BLOCK,
        parent: this.extraBody,
      });

      // Classification method / classes
      const classRow = foliplus.dom.el("div", {
        class: CONST.CLASSES.FORM_ROW,
        parent: styleSection,
      });
      foliplus.dom.el("label", {
        class: CONST.CLASSES.FORM_LABEL,
        parent: classRow,
        innerHTML: _(`${CONST.name}.class_method`),
      });
      const classControlWrap = foliplus.dom.el("div", {
        class: `${CONST.CLASSES.FORM_CONTROL} ${CONST.CLASSES.FORM_CONTROL_INLINE}`,
        parent: classRow,
      });
      this.methodSelect = foliplus.dom.el("select", {
        class: CONST.CLASSES.FORM_SELECT,
        parent: classControlWrap,
        innerHTML: `
          <option value="jenks">${_(`${CONST.name}.jenks`)}</option>
          <option value="quantile">${_(`${CONST.name}.quantile`)}</option>
          <option value="equal">${_(`${CONST.name}.equal`)}</option>
          <option value="heads">${_(`${CONST.name}.heads`)}</option>`,
        value: this.m.currentMethod,
        onchange: () => {
          this.m.currentMethod = this.methodSelect.value;
          this.m.renderHexagons();
        },
      });

      this.classSelect = foliplus.dom.el("select", {
        class: `${CONST.CLASSES.FORM_SELECT} ${CONST.CLASSES.CLASS_COUNT_SELECT}`,
        parent: classControlWrap,
        onchange: () => {
          this.m.numClasses = Math.min(
            9,
            Math.max(2, parseInt(this.classSelect.value, 10) || 6),
          );
          this.updateSchemeBar();
          if (this.schemeDropdown) this.refreshSchemeDropdownItems();
          this.m.renderHexagons();
        },
      });
      for (let ci = 2; ci <= 9; ci++)
        foliplus.dom.el("option", { value: ci, parent: this.classSelect }, String(ci));
      this.classSelect.value = Math.min(9, Math.max(2, this.m.numClasses));

      // Color scheme
      const schemeRow = foliplus.dom.el("div", {
        class: CONST.CLASSES.FORM_ROW,
        parent: styleSection,
      });
      foliplus.dom.el("label", {
        class: CONST.CLASSES.FORM_LABEL,
        parent: schemeRow,
        innerHTML: _(`${CONST.name}.scheme`),
      });
      this.schemeControlWrap = foliplus.dom.el("div", {
        class: CONST.CLASSES.FORM_CONTROL,
        parent: schemeRow,
      });
      this.schemeBar = foliplus.dom.el("div", {
        class: CONST.CLASSES.SCHEME_BAR,
        tabindex: 0,
        role: "combobox",
        "aria-label": _(`${CONST.name}.scheme`),
        parent: this.schemeControlWrap,
      });
      this.schemeBarInner = foliplus.dom.el("div", {
        class: CONST.CLASSES.SCHEME_BAR_INNER,
        parent: this.schemeBar,
      });
      this.schemeSelectHidden = foliplus.dom.el("select", {
        class: CONST.CLASSES.SCHEME_SELECT_HIDDEN,
        parent: this.schemeControlWrap,
        onchange: () => {
          this.m.currentScheme = this.schemeSelectHidden.value;
          this.updateSchemeBar();
          this.m.renderHexagons();
        },
      });
      CONST.SCHEME_NAMES.forEach((name) => {
        foliplus.dom.el(
          "option",
          { value: name, parent: this.schemeSelectHidden },
          name,
        );
      });
      this.schemeSelectHidden.value = this.m.currentScheme;
      this.updateSchemeBar();

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
      const origToggle = this.toggleSchemeDropdown.bind(this);
      this.toggleSchemeDropdown = () => {
        origToggle();
        if (this.schemeDropdown)
          document.addEventListener("click", this.closeSchemeDropdown);
      };

      // Border settings
      const borderRow = foliplus.dom.el("div", {
        class: CONST.CLASSES.FORM_ROW,
        parent: styleSection,
      });
      foliplus.dom.el("label", {
        class: CONST.CLASSES.FORM_LABEL,
        parent: borderRow,
        innerHTML: _(`${CONST.name}.border`),
      });
      const borderControlWrap = foliplus.dom.el("div", {
        class: `${CONST.CLASSES.FORM_CONTROL} ${CONST.CLASSES.FORM_CONTROL_INLINE}`,
        parent: borderRow,
      });
      this.borderColorInput = foliplus.dom.el("input", {
        class: CONST.CLASSES.BORDER_COLOR_INPUT,
        type: "color",
        parent: borderControlWrap,
        value: this.m.borderColor,
        oninput: () => {
          this.m.borderColor = this.borderColorInput.value;
          this.m.renderHexagons();
        },
      });
      this.borderWeightInput = foliplus.dom.el("input", {
        class: CONST.CLASSES.BORDER_WEIGHT_INPUT,
        type: "number",
        min: 0,
        max: 10,
        step: 0.5,
        parent: borderControlWrap,
        value: this.m.borderWeight,
        onchange: () => {
          this.m.borderWeight = parseFloat(this.borderWeightInput.value) || 1;
          this.m.renderHexagons();
        },
      });

      // Label toggle
      const labelRow = foliplus.dom.el("div", {
        class: `${CONST.CLASSES.FORM_ROW} ${CONST.CLASSES.SECTION_BLOCK_LAST}`,
        parent: styleSection,
      });
      foliplus.dom.el("label", {
        class: CONST.CLASSES.FORM_LABEL,
        parent: labelRow,
        innerHTML: _(`${CONST.name}.label`),
      });
      const labelControlWrap = foliplus.dom.el("div", {
        class: CONST.CLASSES.FORM_CONTROL,
        parent: labelRow,
      });
      const labelToggle = foliplus.dom.el("label", {
        class: CONST.CLASSES.TOGGLE_SWITCH,
        parent: labelControlWrap,
      });
      this.labelChk = foliplus.dom.el("input", {
        type: "checkbox",
        parent: labelToggle,
        checked: this.m.currentLabelShow,
        onchange: () => {
          this.m.currentLabelShow = this.labelChk.checked;
          this.m.renderHexagons();
        },
      });
      foliplus.dom.el("span", {
        class: CONST.CLASSES.TOGGLE_SLIDER,
        parent: labelToggle,
      });
      foliplus.dom.el("hr", {
        class: CONST.CLASSES.SECTION_DIVIDER,
        parent: this.extraBody,
      });

      // Bottom action buttons
      const btnRow = foliplus.dom.el("div", {
        class: CONST.CLASSES.BTN_ROW,
        parent: this.extraBody,
      });
      foliplus.dom.el("button", {
        class: `${CONST.CLASSES.BTN} ${CONST.CLASSES.BTN_CLEAR}`,
        parent: btnRow,
        innerHTML: _(`${CONST.name}.clear`),
        onclick: () => {
          this.resetAll();
          this.syncSelect(this.layerSelect, "");
          this.syncSelect(this.aggSelect, CONST.AGG.COUNT);
          this.syncSelect(this.classSelect, String(CONST.N_CLASSES));
          this.syncSelect(this.methodSelect, CONST.METHOD);
          this.schemeSelectHidden.value = CONST.SCHEME;
          this.labelChk.checked = CONST.LABEL.SHOW;
          this.borderWeightInput.value = CONST.BORDER.W;
          this.borderColorInput.value = CONST.BORDER.COLOR;
          this.updateSchemeBar();
          this.updateFieldSelector();
          this.extraBody.classList.add(CONST.CLASSES.HIDDEN);
          this.container.classList.remove(CONST.CLASSES.EXPANDED);
          this.container.classList.add(CONST.CLASSES.COLLAPSED);
        },
      });
      foliplus.dom.el("button", {
        class: `${CONST.CLASSES.BTN} ${CONST.CLASSES.BTN_CONFIRM}`,
        parent: btnRow,
        innerHTML: _(`${CONST.name}.confirm`),
        onclick: () => {
          this.m.renderHexagons();
          this.container.classList.remove(CONST.CLASSES.EXPANDED);
          this.container.classList.add(CONST.CLASSES.COLLAPSED);
        },
      });
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
      const placeholder = foliplus.dom.el(
        "option",
        {
          value: "",
          disabled: "disabled",
          class: CONST.CLASSES.PLACEHOLDER_OPTION,
          parent: sel,
          selected: !this.m.selectedLayerId ? "" : undefined,
        },
        _(`${CONST.name}.layer_placeholder`),
      );

      this.m.pointLayers.forEach((info) => {
        foliplus.dom.el("option", { value: info.id, parent: sel }, info.name);
      });

      if (this.m.selectedLayerId) sel.value = this.m.selectedLayerId;
      else sel.selectedIndex = 0;

      sel.onchange = () => {
        this.m.selectedLayerId = sel.value || null;
        if (this.extraBody)
          this.extraBody.classList.toggle(
            CONST.CLASSES.HIDDEN,
            !this.m.selectedLayerId,
          );
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
      if (this.m.currentAgg === CONST.AGG.COUNT) {
        this.fieldWrap.classList.add(CONST.CLASSES.HIDDEN);
        return;
      }
      this.fieldWrap.classList.remove(CONST.CLASSES.HIDDEN);

      const selected = this.m.pointLayers.filter(
        (info) => info.id === this.m.selectedLayerId,
      );
      const fields = this.m.collectFields(selected);
      this.m.autoFieldKey = this.m.pickAutoField(fields);

      this.fieldSelect.innerHTML = "";
      foliplus.dom.el(
        "option",
        {
          value: "",
          disabled: "disabled",
          class: CONST.CLASSES.PLACEHOLDER_OPTION,
          parent: this.fieldSelect,
        },
        _(`${CONST.name}.field_auto`),
      );

      fields.forEach((f) => {
        foliplus.dom.el(
          "option",
          { value: f, parent: this.fieldSelect },
          f.startsWith("properties.") ? f.substring(11) : f,
        );
      });

      this.m.fieldAuto = !fields.includes(this.m.currentField);
      this.fieldSelect.value = this.m.fieldAuto ? "" : this.m.currentField;

      this.syncSelect(this.fieldSelect, this.fieldSelect.value);
    }

    /** Render color blocks into a container. */
    renderColorBar(container, name, nClasses) {
      const colors = this.m.getColorScale(name, nClasses);
      container.innerHTML = "";
      for (const color of colors) {
        foliplus.dom.el("div", {
          class: CONST.CLASSES.SCHEME_BAR_BLOCK,
          style: `background:${color};width:${100 / colors.length}%`,
          parent: container,
        });
      }
    }

    updateSchemeBar() {
      this.renderColorBar(this.schemeBarInner, this.m.currentScheme, this.m.numClasses);
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
        const bar = item.querySelector(CONST.SEL.SCHEME_DROPDOWN_BAR);
        if (bar) this.renderColorBar(bar, name, this.m.numClasses);
      });
    }

    toggleSchemeDropdown() {
      if (this.schemeDropdown) {
        this.schemeDropdown.remove();
        this.schemeDropdown = null;
        return;
      }
      this.schemeDropdown = foliplus.dom.el("div", {
        class: CONST.CLASSES.SCHEME_DROPDOWN,
        role: "listbox",
        parent: this.schemeControlWrap,
      });

      let focusIdx = -1;
      CONST.SCHEME_NAMES.forEach((name, idx) => {
        const item = foliplus.dom.el("div", {
          class: CONST.CLASSES.SCHEME_DROPDOWN_ITEM,
          role: "option",
          tabindex: -1,
          "data-scheme-name": name,
          parent: this.schemeDropdown,
        });
        if (name === this.m.currentScheme) {
          item.classList.add(CONST.CLASSES.ACTIVE);
          focusIdx = idx;
        }

        const itemBar = foliplus.dom.el("div", {
          class: CONST.CLASSES.SCHEME_DROPDOWN_BAR,
          parent: item,
        });
        this.renderColorBar(itemBar, name, this.m.numClasses);
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
      if (this.m.pointLayers.length === 0 && attempt > 0)
        setTimeout(() => this.initScan(attempt - 1), CONST.TIMING.INIT_SCAN_INTERVAL);
      else if (this.m.pointLayers.length === 0)
        foliplus.showHint(
          CONST.name,
          _(`${CONST.name}.no_layer`),
          foliplus.HINT_DURATION.LONG,
        );
      else this.rebuildLayerDropdown();
    }

    resetAll() {
      this.m.selectedLayerId = null;
      this.m.autoFieldKey = null;
      this.m.fieldAuto = true;
      this.m.currentAgg = CONST.AGG.COUNT;
      this.m.currentField = CONST.FIELD;
      this.m.numClasses = CONST.N_CLASSES;
      this.m.currentMethod = CONST.METHOD;
      this.m.currentScheme = CONST.SCHEME;
      this.m.currentLabelShow = CONST.LABEL.SHOW;
      this.m.borderWeight = CONST.BORDER.W;
      this.m.borderColor = CONST.BORDER.COLOR;
      this.m.clearHeatmapCanvas();
    }

    syncSelect(el, value) {
      el.value = value;
      el.classList.toggle(CONST.CLASSES.CLASS_PLACEHOLDER, !value);
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

// HeatmapControl data aggregation & rendering logic (HeatmapManager).
import { cssVar } from "../common/cssvar.js";
import { debounce } from "../common/debounce.js";
import { formatNumber } from "../common/format.js";
import { createTranslator } from "../common/locale.js";
import { bindMapSync } from "../common/panel.js";
import * as CONST from "./HeatmapControl.const.js";
import * as SVGs from "./HeatmapControl.icon.js";
import { rebuildLayerDropdown } from "./HeatmapControl.ui.js";

const foliplus = window.foliplus;
const _ = createTranslator(CONF);

// ==================== Core: Data Aggregation & Rendering ====================
class HeatmapManager {
  constructor(mapInstance) {
    this.map = mapInstance;

    // State management
    this.selectedLayerId = null;
    this.pointLayers = [];
    this.currentAgg = CONF.agg;
    this.currentField = CONF.field;
    this.currentScheme = CONF.color_scheme;
    this.currentMethod = CONF.method;
    this.autoFieldKey = null;
    this.fieldAuto = true;
    this.numClasses = CONF.n_classes;
    this.borderWeight = CONF.border_weight;
    this.borderColor = CONF.border_color;
    this.currentLabelShow = CONF.label_show;
    this.valueFallbackWarned = false;
    // Create a managed canvas via LayerControl API.
    // Canvas lives in `.leaflet-map-pane` with position offset to cancel
    // the mapPane CSS transform.  Drawn with latLngToContainerPoint.
    // LayerControl handles visibility (checkbox) and z-order (drag-reorder).
    this.overlay = foliplus.LayerAPI.createCanvas({
      id: CONST.ID,
      name: _(`${CONF.name}.title`),
      iconSvg: SVGs.HEXAGON,
    });
    // Register lifecycle hooks for full-content capture (e.g. ExportControl).
    this.overlay.hooks.before.push(() => {
      this.renderAll = true;
      this.redrawHeatmap();
    });
    this.overlay.hooks.after.push(() => {
      this.renderAll = false;
      this.redrawHeatmap();
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
    // Hide canvas during zoom to avoid flicker, RAF-throttled redraw during pan.
    // zoomend triggers full re-render (renderHexagons) via separate handler
    // because it needs debounced H3 hexbin recalculation, not just cache redraw.
    this.mapCleanup = bindMapSync({
      map: this.map,
      hideEvents: ["zoomstart"],
      showEvents: ["zoomend"],
      onMove: () => {
        if (this.overlay.canvas && this.cachedFeatures) this.redrawHeatmap();
      },
      onHide: () => {
        this.overlay.setVisible(false);
      },
      onShow: () => {
        this.overlay.setVisible(true);
      },
    });

    this.onZoomEnd = debounce(() => {
      if (this.selectedLayerId) {
        this.renderHexagons();
        this.overlay.setVisible(true);
      }
    }, CONST.TIMING.ZOOM_DEBOUNCE);
    this.map.on("zoomend", this.onZoomEnd);

    this.onLayerChange = debounce(() => {
      this.cachedPoints = null;
      this.cachedAgg = null;
      if (this.ui) {
        this.scanMapLayers();
        rebuildLayerDropdown(this.ui);
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
    ctx.globalAlpha = CONF.fill_opacity;
    ctx.fill();
    ctx.globalAlpha = 1;

    if (this.borderWeight > 0 && CONF.border_opacity > 0) {
      ctx.strokeStyle = this.borderColor;
      ctx.lineWidth = this.borderWeight;
      ctx.globalAlpha = CONF.border_opacity;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  /** Resolve label styling from CSS custom properties (cached once). */
  resolveLabelStyle() {
    if (this.cachedLabelStyle) return this.cachedLabelStyle;

    const css = (prop, fb) => cssVar(this.ui.container, prop, fb);
    this.cachedLabelStyle = {
      font: `${css("--heatmap-label-font-weight")} ${css("--heatmap-label-font-size")} ${css("--heatmap-label-font-family")}`,
      color: css("--heatmap-label-color"),
      stroke: css("--heatmap-label-stroke-color"),
      strokeWidth: parseFloat(css("--heatmap-label-stroke-width")),
    };
    return this.cachedLabelStyle;
  }

  /** Draw a formatted value label centered on the hexagon. */
  drawHexLabel(ctx, feat, { font, color, stroke, strokeWidth }) {
    const centroid = feat.properties.centroid;
    const pt = this.map.latLngToContainerPoint(L.latLng(centroid[0], centroid[1]));
    const text = formatNumber(feat.properties.value, CONF.label_format);
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
      this.pointLayers.push({
        id: info.id,
        name: info.name,
        layer: info.layer, // provided by getLayersByType — no extra lookup
        count: pts.length,
      });
    }
  }

  collectFields(layers) {
    const fields = [];
    const seen = new Set();
    layers.forEach((info) => {
      foliplus.LayerAPI.extractPoints(info.id).forEach((pt) => {
        const m = pt.marker;
        if (m.feature?.properties) {
          Object.keys(m.feature.properties).forEach((k) => {
            if (typeof m.feature.properties[k] === "number" && !seen.has(k)) {
              seen.add(k);
              fields.push(`properties.${k}`);
            }
          });
        }
      });
    });
    return fields;
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
          `[${CONF.name}] Falling back to 1 for missing values, field=${this.currentField}`,
        );
      }
      return 1;
    }
    return Number(val);
  }

  getSelectedPoints() {
    this.valueFallbackWarned = false;
    const key = `${this.selectedLayerId}|${this.currentAgg}|${this.fieldAuto}|${this.currentField}`;
    if (this.cachedPoints && this.cachedPoints.key === key)
      return this.cachedPoints.pts;

    const pts = [];
    if (!this.selectedLayerId) return pts;
    const info = this.pointLayers.find((i) => i.id === this.selectedLayerId);
    if (!info) return pts;

    foliplus.LayerAPI.extractPoints(info.id).forEach((p) => {
      pts.push({
        lat: p.lat,
        lng: p.lng,
        value: this.getPointValue(p.marker),
        marker: p.marker,
      });
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
    if (typeof chroma !== "undefined") return chroma.scale(name).mode("lab").colors(n);
    return Array(n).fill(CONST.GRAY);
  }

  computeBreaks(data, nClasses, method) {
    if (data.length === 0) return [];
    const sorted = data.slice().sort((a, b) => a - b);
    const n = sorted.length;
    if (n <= 2) return [sorted[0], sorted[n - 1]];
    nClasses = Math.max(3, Math.min(nClasses, n));

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
    if (!this.map || !this.map._container || !this.overlay) return;
    if (!this.selectedLayerId) {
      this.clearHeatmapCanvas();
      return;
    }
    const pts = this.getSelectedPoints();
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
        console.warn(`[${CONF.name}] h3 cell conversion failed`, pt.lat, pt.lng, e);
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
        console.warn(`[${CONF.name}] h3 boundary conversion failed`, h3Idx, e);
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

export { HeatmapManager };

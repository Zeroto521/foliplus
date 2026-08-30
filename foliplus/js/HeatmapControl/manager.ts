// HeatmapControl data aggregation & rendering logic (HeatmapManager).
import { generateId } from "#core/component.js";
import { EVENTS, ensureEvents } from "#core/event/index.js";
import { cssVar } from "#common/cssvar.js";
import { type Debounced, debounce } from "#common/debounce.js";
import { type NumberStyle, formatNumber } from "#common/format.js";
import { createScopedTranslator } from "#common/locale.js";
import { bindMapSync } from "#common/panel.js";
import * as Storage from "#common/storage.js";
import * as CONST from "./const.js";
import * as SVGs from "./icon.js";
import { type HeatmapControlUI, rebuildLayerDropdown } from "./ui.js";

const T = createScopedTranslator(CONF);

/** A point marker carrying an optional numeric value (foliplus data contract). */
type HeatmapPointMarker = (L.Marker | L.CircleMarker) & {
  value?: number;
  options?: { value?: number };
};

/** A hexagon feature drawn on the heatmap canvas. */
interface HexFeature {
  type?: string;
  geometry: { type: string; coordinates: number[][][] };
  properties: {
    centroid: [number, number] | null;
    fillColor?: string;
    value?: number;
    classIdx?: number;
    [key: string]: unknown;
  };
}

/** Aggregated hex cell. */
interface HexCell {
  sum: number;
  count: number;
  min: number;
  max: number;
}

/** Aggregated data returned by aggregateData. */
interface AggregatedData {
  hexCells: Record<string, HexCell>;
  getAggValue: (cell: HexCell) => number;
  valueToClassIdx: (val: number) => number;
  classColors: string[];
}

/** Canvas label style resolved from CSS custom properties. */
interface LabelStyle {
  font: string;
  color: string;
  stroke: string;
  strokeWidth: number;
}

/** A point layer collected from LayerControl. */
interface PointLayerInfo {
  id: string;
  name: string;
  layer: L.Layer | null;
  count: number;
}

/** A selected point with its aggregated value. */
interface SelectedPoint {
  lat: number;
  lng: number;
  value: number;
  marker: L.Marker;
}

/** Persisted heatmap configuration (survives page reload). */
interface SavedConfig {
  layerId?: string | null;
  agg?: string;
  method?: string;
  scheme?: string;
  numClasses?: number;
  borderWeight?: number;
  borderColor?: string;
  labelShow?: boolean;
  field?: string;
  fieldAuto?: boolean;
}

// ==================== Core: Data Aggregation & Rendering ====================
class HeatmapManager {
  map: L.Map;
  selectedLayerId: string | null;
  pointLayers: PointLayerInfo[];
  currentAgg: string;
  currentField: string;
  currentScheme: string;
  currentMethod: string;
  autoFieldKey: string | null;
  fieldAuto: boolean;
  numClasses: number;
  borderWeight: number;
  borderColor: string;
  currentLabelShow: boolean;
  valueFallbackWarned: boolean;
  overlay: CreateCanvasAPI;
  ui: { ctrl: HTMLElement } | null;
  cachedPoints: { key: string; pts: SelectedPoint[] } | null;
  cachedFeatures: HexFeature[] | null;
  cachedAgg: { key: string; data: AggregatedData } | null;
  cachedLabelStyle: LabelStyle | null;
  renderAll: boolean;
  declare mapCleanup: () => void;
  declare onLayerChange: Debounced;
  declare removeLayerChangeListener: () => void;
  declare onZoomEnd: Debounced;

  /** The layer id used to register this manager's heatmap canvas. */
  layerId: string;

  /**
   * @param mapInstance - Leaflet map instance.
   * @param opts - Optional configuration.
   * @param opts.id - Optional namespace for the layer ID. When provided,
   *   the canvas is registered as "{ID}_{id}" to support multi-instance maps.
   */
  constructor(mapInstance: L.Map, opts?: { id?: string }) {
    this.map = mapInstance;
    this.layerId = generateId(CONST.ID, opts?.id);

    // State management
    this.selectedLayerId = null;
    this.pointLayers = [];
    this.currentAgg = CONF.agg ?? CONST.AGG.COUNT;
    this.currentField = CONF.field ?? "";
    this.currentScheme = CONF.color_scheme ?? "Reds";
    this.currentMethod = CONF.method ?? CONST.METHOD.JENKS;
    this.autoFieldKey = null;
    this.fieldAuto = true;
    this.numClasses = CONF.n_classes ?? CONST.CLASS_COUNT.DEFAULT;
    this.borderWeight = CONF.border_weight ?? CONST.BORDER.WEIGHT_DEFAULT;
    this.borderColor = CONF.border_color ?? CONST.GRAY;
    this.currentLabelShow = CONF.label_show ?? false;
    this.valueFallbackWarned = false;
    // Create a managed canvas via LayerControl API.
    // Canvas lives in `.leaflet-map-pane` with position offset to cancel
    // the mapPane CSS transform.  Drawn with latLngToContainerPoint.
    // LayerControl handles visibility (checkbox) and z-order (drag-reorder).
    this.overlay = map.foliplus!.LayerAPI!.createCanvas({
      id: this.layerId,
      name: T("title"),
      iconSvg: SVGs.HEXAGON,
      featureCountProvider: () => this.cachedFeatures?.length ?? 0,
    });
    // Subscribe to export events for full-content capture (ExportControl).
    ensureEvents(this.map).on(EVENTS.BEFORE_EXPORT, () => {
      this.renderAll = true;
      this.redrawHeatmap();
    });
    ensureEvents(this.map).on(EVENTS.AFTER_EXPORT, () => {
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
        this.overlay.setVisible?.(false);
      },
      onShow: () => {
        this.overlay.setVisible?.(true);
      },
    });

    this.onZoomEnd = debounce(() => {
      if (this.selectedLayerId) {
        this.renderHexagons();
        this.overlay.setVisible?.(true);
      }
    }, CONST.TIMING.ZOOM_DEBOUNCE);
    this.map.on("zoomend", this.onZoomEnd);

    this.onLayerChange = debounce(() => {
      this.cachedPoints = null;
      this.cachedAgg = null;
      if (this.ui) {
        this.scanMapLayers();
        rebuildLayerDropdown(this.ui as HeatmapControlUI);
      }
    }, CONST.TIMING.LAYER_SCAN_DEBOUNCE);
    // Subscribe to the semantic registry-change event instead of raw Leaflet
    // layeradd/layerremove — LayerManager emits EVENTS.LAYER_CHANGE on
    // register/unregister/reorder, so unrelated map activity is filtered out
    // and callback-only registrations (no map.addLayer) are covered too.
    this.removeLayerChangeListener = ensureEvents(this.map).on(
      EVENTS.LAYER_CHANGE,
      () => this.onLayerChange(),
    );
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
    const bounds = this.renderAll ? null : this.map.getBounds();
    const isVisible = (feat: HexFeature) => {
      if (!bounds) return true;
      const c = feat.properties.centroid;
      return !!c && bounds.contains(L.latLng(c[0], c[1]));
    };

    this.cachedFeatures.forEach(feat => {
      if (!isVisible(feat)) return;
      this.drawHexagon(ctx, feat);
      if (this.currentLabelShow) this.drawHexLabel(ctx, feat, labelCfg);
    });
  }

  /** Draw a single hexagon polygon (fill + stroke). */
  drawHexagon(ctx: CanvasRenderingContext2D, feat: HexFeature) {
    const pts = feat.geometry.coordinates[0].map(p =>
      this.map.latLngToContainerPoint(L.latLng(p[1], p[0])),
    );
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = feat.properties.fillColor || CONST.GRAY;
    ctx.globalAlpha = CONF.fill_opacity ?? 1;
    ctx.fill();
    ctx.globalAlpha = 1;

    if (this.borderWeight > 0 && (CONF.border_opacity ?? 0) > 0) {
      ctx.strokeStyle = this.borderColor;
      ctx.lineWidth = this.borderWeight;
      ctx.globalAlpha = CONF.border_opacity ?? 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  /** Resolve label styling from CSS custom properties (cached once). */
  resolveLabelStyle(): LabelStyle {
    if (this.cachedLabelStyle) return this.cachedLabelStyle;

    const css = (prop: string, fb = "") => cssVar(this.ui!.ctrl, prop, fb);
    this.cachedLabelStyle = {
      font: `${css("--heatmap-label-font-weight")} ${css("--heatmap-label-font-size")} ${css("--heatmap-label-font-family")}`,
      color: css("--heatmap-label-color", "#fff"),
      stroke: css("--heatmap-label-stroke-color", "rgba(0,0,0,0.75)"),
      strokeWidth: parseFloat(css("--heatmap-label-stroke-width", "3")),
    };
    return this.cachedLabelStyle;
  }

  /** Draw a formatted value label centered on the hexagon. */
  drawHexLabel(
    ctx: CanvasRenderingContext2D,
    feat: HexFeature,
    { font, color, stroke, strokeWidth }: LabelStyle,
  ) {
    const centroid = feat.properties.centroid;
    if (!centroid) return;
    const pt = this.map.latLngToContainerPoint(L.latLng(centroid[0], centroid[1]));
    const text = formatNumber(
      feat.properties.value ?? 0,
      CONF.label_format,
      CONF.locale_code,
    );
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
    const pointLayersInfo = map.foliplus!.LayerAPI!.getLayersByType("point");
    if (!pointLayersInfo.length) return;

    const seenIds: Record<string, boolean> = {};
    for (const info of pointLayersInfo) {
      if (seenIds[info.id]) continue;
      seenIds[info.id] = true;

      const pts = map.foliplus!.LayerAPI!.extractPoints(info.id);
      if (pts.length === 0) continue;
      this.pointLayers.push({
        id: info.id,
        name: info.name,
        layer: info.layer,
        count: pts.length,
      });
    }
  }

  collectFields(layers: Array<{ id: string }>): string[] {
    const fields: string[] = [];
    const seen = new Set<string>();
    layers.forEach(info => {
      map.foliplus!.LayerAPI!.extractPoints(info.id).forEach(pt => {
        const m = pt.marker;
        if (m?.feature?.properties) {
          const props = m.feature.properties;
          Object.keys(props).forEach(k => {
            if (typeof props[k] === "number" && !seen.has(k)) {
              seen.add(k);
              fields.push(`properties.${k}`);
            }
          });
        }
      });
    });
    return fields;
  }

  pickAutoField(fields: string[] | null): string | null {
    if (!fields || fields.length === 0) return null;
    return fields[0];
  }

  /**
   * Read a numeric field off a point marker (foliplus data contract).
   * Supported field syntax: "value", "options.value", "properties.<key>".
   */
  readMarkerField(
    marker: L.Marker | L.CircleMarker,
    field: string | null,
  ): number | undefined {
    if (!field) return undefined;
    const extended = marker as HeatmapPointMarker;
    if (field === "value") return extended.value;
    if (field === "options.value") return extended.options?.value;
    if (field.startsWith("properties.")) {
      const key = field.substring(11);
      return marker.feature?.properties?.[key];
    }
    return undefined;
  }

  getPointValue(marker: L.Marker | L.CircleMarker): number {
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

  getSelectedPoints(): SelectedPoint[] {
    this.valueFallbackWarned = false;
    const key = `${this.selectedLayerId}|${this.currentAgg}|${this.fieldAuto}|${this.currentField}`;
    if (this.cachedPoints && this.cachedPoints.key === key)
      return this.cachedPoints.pts;

    const pts: SelectedPoint[] = [];
    if (!this.selectedLayerId) return pts;
    const info = this.pointLayers.find(i => i.id === this.selectedLayerId);
    if (!info) return pts;

    map.foliplus!.LayerAPI!.extractPoints(info.id).forEach(p => {
      pts.push({
        lat: p.lat,
        lng: p.lng,
        value: this.getPointValue(p.marker),
        marker: p.marker as L.Marker,
      });
    });
    this.cachedPoints = { key, pts };
    return pts;
  }

  getH3Res(zoom: number): number {
    const entry = (CONST.H3.RES_MAP as Array<[number, number]>).find(
      ([z]) => zoom <= z,
    );
    return entry ? entry[1] : CONST.H3.RES_FALLBACK;
  }

  getColorScale(name: string, n: number): string[] {
    if (typeof chroma !== "undefined")
      return chroma.scale(name).mode("lab").colors(n) as string[];
    return Array(n).fill(CONST.GRAY);
  }

  computeBreaks(data: number[], nClasses: number, method: string): number[] {
    if (data.length === 0) return [];
    const sorted = data.slice().sort((a, b) => a - b);
    const n = sorted.length;
    if (n <= 2) return [sorted[0], sorted[n - 1]];
    nClasses = Math.max(3, Math.min(nClasses, n));

    const lo = sorted[0];
    const hi = sorted[n - 1];

    if (method === CONST.METHOD.JENKS) {
      try {
        const clusters = ss.ckmeans(data, nClasses);
        const breaks: number[] = [clusters[0][0]];
        clusters.forEach(c => breaks.push(c[c.length - 1]));
        return breaks;
      } catch (e) {
        /* fall through */
      }
      return [lo, hi];
    } else if (method === CONST.METHOD.QUANTILE) {
      const b: number[] = [lo];
      for (let i = 1; i < nClasses; i++)
        b.push(ss.quantileSorted(sorted, i / nClasses));
      return b.concat(hi);
    } else if (method === CONST.METHOD.HEADS) {
      const b: number[] = [lo];
      for (let i = 1; i < nClasses; i++)
        b.push(sorted[Math.min(Math.floor((i * n) / nClasses), n - 1)]);
      return b.concat(hi);
    } else {
      const step = (hi - lo) / nClasses;
      const b: number[] = [];
      for (let i = 0; i <= nClasses; i++) b.push(lo + step * i);
      return b;
    }
  }

  renderHexagons() {
    if (!this.map || !this.overlay) return;
    if (!this.selectedLayerId) {
      this.clearHeatmapCanvas();
      return;
    }
    const pts = this.getSelectedPoints();
    const zoom = this.map.getZoom();
    const res = this.getH3Res(zoom);
    const aggKey = `${this.selectedLayerId}|${this.currentAgg}|${this.fieldAuto}|${this.currentField}|${res}|${this.currentMethod}|${this.currentScheme}|${this.numClasses}`;
    let aggregated: AggregatedData | undefined;
    if (this.cachedAgg && this.cachedAgg.key === aggKey)
      aggregated = this.cachedAgg.data;
    else {
      aggregated = this.aggregateData(pts, res) ?? undefined;
      if (aggregated) this.cachedAgg = { key: aggKey, data: aggregated };
    }
    if (!aggregated) return;
    const features = this.buildFeatures(aggregated);
    this.renderFeatures(features);
  }

  aggregateData(pts: SelectedPoint[], res: number): AggregatedData | null {
    const hexCells: Record<string, HexCell> = {};
    pts.forEach(pt => {
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

    const getAggValue = (cell: HexCell): number => {
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
    const valueToClassIdx = (val: number): number => {
      if (breaks.length < 2) return 0;
      for (let i = 1; i < breaks.length; i++) if (val <= breaks[i]) return i - 1;
      return breaks.length - 2;
    };
    return { hexCells, getAggValue, valueToClassIdx, classColors };
  }

  buildFeatures({
    hexCells,
    getAggValue,
    valueToClassIdx,
    classColors,
  }: AggregatedData): HexFeature[] {
    const features: HexFeature[] = [];
    for (const [h3Idx, cell] of Object.entries(hexCells)) {
      const val = getAggValue(cell);
      const classIdx = valueToClassIdx(val);
      const fillColor = classColors[classIdx];
      let centroid: [number, number] | null = null;
      try {
        const c = h3.cellToLatLng(h3Idx);
        centroid = [c[0], c[1]];
      } catch (e) {
        /* fallback */
      }
      try {
        const boundary = h3.cellToBoundary(h3Idx);
        const coords = boundary.map(p => [p[1], p[0]]);
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

  renderFeatures(features: HexFeature[]) {
    if (!features.length) {
      this.clearHeatmapCanvas();
      return;
    }
    this.cachedFeatures = features;
    this.overlay.register();
    this.redrawHeatmap();
    // Notify LayerControl to refresh the count column for this layer.
    ensureEvents(this.map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: this.layerId });
  }

  clearHeatmapCanvas() {
    this.cachedFeatures = null;
    this.cachedAgg = null;
    if (this.overlay) this.overlay.unregister();
    (this.ui as any)?.schemeBarCleanup?.();
    (this.ui as any)?.dropdownCleanup?.();
    // Notify LayerControl to refresh the count column (now 0).
    ensureEvents(this.map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: this.layerId });
  }

  /** Load saved configuration from localStorage into this manager's state. */
  loadSavedConfig(): SavedConfig | null {
    // Storage.load already returns null when the key is missing/unreadable.
    return Storage.load<SavedConfig | null>(CONST.STORAGE.KEY, CONF.name);
  }

  /** Save the current manager state to localStorage. */
  saveConfig() {
    Storage.save(
      CONST.STORAGE.KEY,
      {
        layerId: this.selectedLayerId,
        agg: this.currentAgg,
        method: this.currentMethod,
        scheme: this.currentScheme,
        numClasses: this.numClasses,
        borderWeight: this.borderWeight,
        borderColor: this.borderColor,
        labelShow: this.currentLabelShow,
        field: this.currentField,
        fieldAuto: this.fieldAuto,
      } satisfies SavedConfig,
      CONF.name,
    );
  }

  /** Remove persisted configuration from localStorage. */
  clearSavedConfig() {
    try {
      window.localStorage.removeItem(CONST.STORAGE.KEY);
    } catch (e) {
      console.warn(
        `[${CONF.name}] Failed to clear saved data (key=${CONST.STORAGE.KEY})`,
        e,
      );
    }
  }

  /** Apply a loaded config object to the manager's state. */
  applySavedConfig(saved: SavedConfig) {
    if (saved.agg) this.currentAgg = saved.agg;
    if (saved.method) this.currentMethod = saved.method;
    if (saved.scheme) this.currentScheme = saved.scheme;
    if (saved.numClasses !== undefined) {
      this.numClasses = Math.min(
        CONST.CLASS_COUNT.MAX,
        Math.max(CONST.CLASS_COUNT.MIN, saved.numClasses),
      );
    }
    if (saved.borderWeight !== undefined) {
      this.borderWeight = saved.borderWeight;
    }
    if (saved.borderColor) this.borderColor = saved.borderColor;
    if (saved.labelShow !== undefined) this.currentLabelShow = saved.labelShow;
    if (saved.field) this.currentField = saved.field;
    if (saved.fieldAuto !== undefined) this.fieldAuto = saved.fieldAuto;
    this.selectedLayerId = saved.layerId ?? null;
  }
}

export { HeatmapManager };

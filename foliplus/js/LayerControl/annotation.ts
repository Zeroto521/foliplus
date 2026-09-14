// LayerControl annotation — per-layer text-label rendering.
//
// Annotations are an overlay drawn by LayerControl on top of data layers:
// an isLabel L.marker per feature, positioned at the feature's anchor point
// (point below the marker, polygon/line at the centroid). The label value is
// read live from feature.properties[field], so the label always reflects the
// current data. Because isLabel leaves are filtered out of countFeatureGeometry
// / getGeometryType / extractPoints in core/layer/util.ts, they never affect
// the layer's count, type icon, or point extraction, and they toggle together
// with the parent layer (added as children of the source layer via addLayer).
import {
  type LabelField,
  autoLabelField,
  collectLabelFields,
} from "#core/labelField.js";
import { type LabelAwareLayer, forEachLeaf } from "#core/layer/index.js";
import { dom } from "#common/dom.js";
import { type NumberStyle, formatLabelNumber } from "#common/format.js";
import { createScopedTranslator } from "#common/locale.js";
import * as CONST from "./const.js";

// CONF is a free variable from the IIFE template wrapper.
const T = createScopedTranslator(CONF);

// Label marker offset (px) from the anchor. Positive dy = below anchor (the
// convention used in MeasureControl labels). For point layers the anchor is
// the marker latlng, so the label sits just below the point; for polygon/line
// the anchor is the centroid, so the label sits slightly below center.
const LABEL_OFFSET_DY = 14;

/** Per-layer annotation config (matches what persistence stores). */
interface AnnotationConfig {
  show: boolean;
  field: string;
  format: NumberStyle;
}

/** A label marker plus the leaf it annotates, for later reuse / removal. */
interface LabelMarker {
  leaf: L.Layer;
  marker: L.Marker;
}

/**
 * AnnotationManager owns per-layer label state and rendering.
 * Pure logic + DOM rendering; state and persistence are written to
 * LayerPersistence by LayerUI.
 */
class AnnotationManager {
  private readonly map: L.Map;
  private readonly layerFind: (id: string) => L.Layer | null;
  private readonly config: Map<string, AnnotationConfig>;
  /** Resolved auto field per layer, dropped when its features can change. */
  private readonly autoFieldCache: Map<string, string>;

  constructor(mapInstance: L.Map, layerFind: (id: string) => L.Layer | null) {
    this.map = mapInstance;
    this.layerFind = layerFind;
    this.config = new Map();
    this.autoFieldCache = new Map();
  }

  /** Read the config for a layer, or the default (labels off) when unset. */
  getConfig(id: string): AnnotationConfig {
    return { ...CONST.DEFAULT_ANNOTATION, ...(this.config.get(id) ?? {}) };
  }

  setConfig(id: string, cfg: AnnotationConfig): void {
    this.config.set(id, cfg);
  }

  /** All configured layers' id → config entries (for persistence). */
  configEntries(): [string, AnnotationConfig][] {
    return [...this.config.entries()];
  }

  /** Collect the layer's labelable fields, with each key's sampled type.
   *  Both string and numeric fields are returned (annotations are not limited
   *  to numeric columns); the type only drives the number-format row. The
   *  returned names are the bare property names (no "properties." prefix) so
   *  callers store and compare them uniformly. The walk itself is shared with
   *  the heatmap's field contract — see core/labelField. */
  collectFields(id: string): LabelField[] {
    const layer = this.layerFind(id);
    if (!layer) return [];
    const leaves: L.Layer[] = [];
    forEachLeaf(layer, (leaf: L.Layer) => leaves.push(leaf));
    return collectLabelFields(leaves);
  }

  /** Read a leaf's field value as a string for display.
   *  Returns null when the leaf has no properties object. */
  readFieldValue(leaf: L.Layer, field: string): string | null {
    const props = (
      leaf as L.Layer & { feature?: { properties?: Record<string, unknown> } }
    ).feature?.properties;
    if (!props || !(field in props)) return null;
    return String(props[field]);
  }

  /** Resolve the anchor latlng for a feature leaf.
   *  Point markers → getLatLng(); polygon/line → bounds center.
   *  Returns null when the leaf has no usable geometry. */
  resolveAnchor(leaf: L.Layer): L.LatLng | null {
    // Duck-type for a point accessor (markers expose getLatLng); fall back to
    // bounds center for paths. Avoids instanceof against a possibly-mocked L.
    const getLatLng = (leaf as L.Layer & { getLatLng?: () => L.LatLng }).getLatLng;
    if (typeof getLatLng === "function") {
      const ll = getLatLng.call(leaf);
      if (ll) return ll;
    }
    const bounds = (
      leaf as L.Layer & { getBounds?: () => L.LatLngBounds }
    ).getBounds?.();
    if (bounds && bounds.isValid()) return bounds.getCenter();
    return null;
  }

  /** The field a layer's labels read: the one the config names, or — when the
   *  config leaves it open (`field: ""`, what the picker's "Auto" entry means) —
   *  the shared auto pick over the layer's fields.
   *
   *  Resolved at render time rather than written into the config, so a layer
   *  whose columns change keeps labelling itself instead of being pinned to a
   *  field name that no longer exists. */
  resolveField(id: string): string {
    const explicit = this.getConfig(id).field;
    if (explicit) return explicit;
    const cached = this.autoFieldCache.get(id);
    if (cached !== undefined) return cached;
    const picked = autoLabelField(this.collectFields(id));
    this.autoFieldCache.set(id, picked);
    return picked;
  }

  /** Drop a layer's cached auto pick. Called when its features can change, so
   *  the next render re-samples the columns. */
  invalidateAutoField(id: string): void {
    this.autoFieldCache.delete(id);
  }

  /** Format a value for display according to the configured style.
   *  String values pass through unchanged; numeric values go through the shared
   *  label formatter, so an annotation label and a heatmap hex label render the
   *  same value the same way. */
  formatValue(value: string, format: NumberStyle, locale = "en"): string {
    const n = parseNum(value);
    if (n === null) return value;
    return formatLabelNumber(n, format, locale);
  }

  /** Render labels for a layer according to its current config.
   *  Removes any existing labels first (so field/format/show changes are a
   *  single tear-down + re-build rather than two separate paths).
   *  Returns the list of LabelMarker it created (for external tracking). */
  renderLabels(id: string): LabelMarker[] {
    this.clearLabels(id);
    if (!this.getConfig(id).show) return [];
    const field = this.resolveField(id);
    if (!field) return [];

    const layer = this.layerFind(id);
    if (!layer) return [];
    const locale = CONF.locale_code ?? "en";
    const labels: LabelMarker[] = [];

    forEachLeaf(layer, (leaf: L.Layer) => {
      const raw = this.readFieldValue(leaf, field);
      const anchor = this.resolveAnchor(leaf);
      if (raw === null || anchor === null) return;

      const text = this.formatValue(raw, this.getConfig(id).format, locale);
      if (!text) return;

      const labelMarker = L.marker(anchor, {
        icon: L.divIcon({
          className: CONST.CLASSES.ANNOTATION_LABEL,
          // Element, not an HTML string: divIcon accepts a Node and appends
          // it as-is, so the label text can never reach an innerHTML sink.
          html: dom.el("span", { class: "foliplus-annotation-label-text" }, text),
          iconAnchor: [0, -LABEL_OFFSET_DY], // anchor at label top → text sits below
        }),
        interactive: false,
        pane: "markerPane",
      });
      (labelMarker as LabelAwareLayer).isLabel = true;
      (layer as L.LayerGroup).addLayer(labelMarker);
      labels.push({ leaf, marker: labelMarker });
    });
    return labels;
  }

  /** Remove every annotation label that belongs to a given layer. */
  clearLabels(id: string): void {
    const layer = this.layerFind(id);
    if (!layer) return;
    forEachLeaf(layer, (leaf: L.Layer) => {
      if ((leaf as LabelAwareLayer).isLabel) {
        (layer as L.LayerGroup).removeLayer(leaf);
      }
    });
  }

  /** Re-render every configured layer's labels. */
  refreshAll(): void {
    for (const [id, cfg] of this.config.entries()) {
      if (cfg.show) this.renderLabels(id);
    }
  }

  /** Tear down labels for a layer and forget its config (e.g. on
   *  unregister). Deleting the entry keeps a removed layer's id from being
   *  written back to localStorage by the next annotations save. */
  destroyLayer(id: string): void {
    this.clearLabels(id);
    this.config.delete(id);
    this.autoFieldCache.delete(id);
  }

  destroy(): void {
    for (const id of this.config.keys()) {
      this.clearLabels(id);
    }
    this.config.clear();
  }
}

/** Parse a string value to a number when it's genuinely numeric. */
const parseNum = (v: string): number | null => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export { AnnotationManager, type AnnotationConfig };

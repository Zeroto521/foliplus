// LayerControl annotation — per-layer text-label rendering.
//
// Annotations are an overlay drawn by LayerControl on top of data layers:
// an isLabel L.marker per feature, positioned at the feature's anchor point
// (point below the marker, polygon/line centred on the centroid). The value is
// read from feature.properties[field] and baked into the marker's icon at render
// time, so a field or format change re-renders rather than updating in place.
// Because isLabel leaves are filtered out of countFeatureGeometry
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
import * as CONST from "./const.js";

// CONF is a free variable from the IIFE template wrapper.

// Label anchoring. A `divIcon` cannot place itself: the chip's width is only
// known after layout, so the horizontal position has to come from CSS (see the
// label rules in LayerControl.css) and `iconSize` must be [0, 0] — Leaflet's
// divIcon default of 12x12 otherwise puts a box at the anchor and lets the text
// spill out to the right of it.
//
//   point leaves → the chip's top edge sits just below the marker, centred on
//                  it, which is the relationship MeasureControl's area label has
//                  to its centroid dot ([0, -10] over a centred chip).
//   path leaves  → the centroid IS the anchor and the chip is centred on it.
const LABEL_SIZE: [number, number] = [0, 0];
const LABEL_POINT_OFFSET_Y = 10;
const LABEL_SHAPE_OFFSET_Y = 0;

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

  /** Whether a layer already carries a config. Distinguishes "never configured"
   *  from "configured to the default", which `getConfig` cannot — it merges the
   *  defaults in. The persisted-state seed needs that difference so it does not
   *  overwrite live state. */
  hasConfig(id: string): boolean {
    return this.config.has(id);
  }

  /** All configured layers' id → config entries (for persistence). */
  configEntries(): [string, AnnotationConfig][] {
    return [...this.config.entries()];
  }

  /** Collect the layer's labelable fields, with each key's sampled type.
   *  Both string and numeric fields are returned (annotations are not limited
   *  to numeric columns); the type only drives the number-format row. The
   *  returned names are the bare property names (no "properties." prefix) so
   *  callers store and compare them uniformly.
   *
   *  The *walk* runs through core/labelField's collector; what stays local is
   *  the leaf traversal, and the heatmap deliberately keeps its own collection
   *  too — its field contract is a different one (numeric only, `properties.`
   *  prefixed, fed from extractPoints) while the shared rules it does use are
   *  the auto pick and the numeric test. */
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

  /** Whether a leaf's anchor is its own point (a marker) rather than the centre
   *  of its extents (a path). Same duck-typing `resolveAnchor` walks, exposed so
   *  the anchor kind and the anchor point are decided from one reading. */
  isPointAnchor(leaf: L.Layer): boolean {
    return (
      typeof (leaf as L.Layer & { getLatLng?: () => L.LatLng }).getLatLng === "function"
    );
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
   *  Returns the markers it created: callers that track them (and the tests,
   *  which assert on "nothing was drawn") read that instead of re-walking the
   *  layer to find them. */
  renderLabels(id: string): LabelMarker[] {
    this.clearLabels(id);
    if (!this.getConfig(id).show) return [];
    const field = this.resolveField(id);
    if (!field) return [];

    const layer = this.layerFind(id);
    if (!layer) return [];
    // Labels are parented to the layer, so a layer that cannot hold children
    // (a bare `L.Marker`/`L.CircleMarker` registered on its own, which the API
    // allows and whose `feature.properties` `collectFields` finds) has nowhere
    // to put them — and calling `addLayer` on it would throw.
    if (typeof (layer as L.LayerGroup).addLayer !== "function") return [];
    const locale = CONF.locale_code ?? "en";
    const labels: LabelMarker[] = [];

    forEachLeaf(layer, (leaf: L.Layer) => {
      const raw = this.readFieldValue(leaf, field);
      const anchor = this.resolveAnchor(leaf);
      if (raw === null || anchor === null) return;
      // Decide the anchor kind once — it drives both the offset and the class
      // that tells CSS which way to centre the chip.
      const atPoint = this.isPointAnchor(leaf);

      const text = this.formatValue(raw, this.getConfig(id).format, locale);
      if (!text) return;

      const labelMarker = L.marker(anchor, {
        icon: L.divIcon({
          className: `${CONST.CLASSES.ANNOTATION_LABEL} ${
            atPoint
              ? CONST.CLASSES.ANNOTATION_LABEL_POINT
              : CONST.CLASSES.ANNOTATION_LABEL_SHAPE
          }`,
          // Element, not an HTML string: divIcon accepts a Node and appends
          // it as-is, so the label text can never reach an innerHTML sink.
          html: dom.el("span", { class: "foliplus-annotation-label-text" }, text),
          iconSize: LABEL_SIZE,
          // Written as two literals rather than one negated constant: negating a
          // zero offset yields -0, which is a different value to a marker icon.
          iconAnchor: atPoint ? [0, -LABEL_POINT_OFFSET_Y] : [0, LABEL_SHAPE_OFFSET_Y],
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

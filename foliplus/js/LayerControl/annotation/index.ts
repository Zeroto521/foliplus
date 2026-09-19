// LayerControl annotation — per-layer text-label rendering.
//
// Labels are drawn on one canvas per layer, each mounted in its layer's own
// annotation pane, so they take their layer's place in the stack: a layer above
// covers them, they cover the layers below.
//
// Collision is per layer too, by design: the z-order already expresses "who
// covers whom", so a cross-layer plan would only make an upper layer's labels
// vanish under a lower layer's — the layers themselves are the avoidance.
import { EVENTS, ensureEvents } from "#core/event/index.js";
import { type Box, withinRect } from "#core/labelCollision.js";
import {
  type LabelField,
  autoLabelField,
  collectLabelFields,
} from "#core/labelField.js";
import { forEachLeaf } from "#core/layer/index.js";
import { destroyPane } from "#core/leafletAdapter.js";
import {
  type CanvasLabelStyle,
  resolveCanvasLabelStyle,
  withLabelPaint,
} from "#common/canvasLabel.js";
import { type NumberStyle, formatLabelNumber } from "#common/format.js";
import { bindMapSync } from "#common/panel.js";
import * as CONST from "../const.js";
import { AnnotationCanvas } from "./canvas.js";
import {
  type LabelCandidate,
  type LabelSpec,
  type PlacedLabel,
  layoutLabel,
  planLabelLayout,
} from "./layout.js";

// CONF is a free variable from the IIFE template wrapper.

/** How far outside the viewport an anchor may sit and still get laid out.
 *  A label is centred on its anchor and at most a few hundred px wide, so
 *  anything beyond this margin can never intersect the viewport — culling
 *  before layoutLabel skips the per-character width estimate for the bulk
 *  of a dense layer (6k points rarely have 6k on screen). */
const ANCHOR_CULL_MARGIN = 300;

/** A label a layer asked for, described by its feature rather than by pixels —
 *  the plan converts the latlng on every frame, so a pan leaves no stale
 *  coordinates behind. */
interface LayerLabel {
  id: string;
  text: string;
  latlng: L.LatLng;
  atPoint: boolean;
  priority: number;
}

/** Per-layer annotation config (matches what persistence stores). */
interface AnnotationConfig {
  show: boolean;
  field: string;
  /** Runtime paint overrides — fall back to the shared --label-* tokens. */
  color: string;
  size: number;
  format: NumberStyle;
  /** Whether this layer's own labels thin themselves out where they overlap. */
  collide: boolean;
}

/** Label priority is uniform within a layer: collision is per layer, so the
 *  planner's tie-breaks (box width, then insertion order) decide which of two
 *  overlapping labels in the same layer survives. The field itself stays — it
 *  is part of the shared planner's candidate contract. */
const LABEL_PRIORITY = 50;

/**
 * AnnotationManager owns per-layer label state, the per-layer plans and the
 * per-layer canvases. state and persistence are written to LayerPersistence
 * by LayerUI.
 */
class AnnotationManager {
  private readonly map: L.Map;
  private readonly layerFind: (id: string) => L.Layer | null;
  private readonly config: Map<string, AnnotationConfig>;
  /** Resolved auto field per layer, dropped when its features can change. */
  private readonly autoFieldCache: Map<string, string>;
  /** The labels each layer wants drawn. */
  private readonly labelsByLayer = new Map<string, LayerLabel[]>();
  /** A layer's own label pane and the canvas mounted in it. */
  private readonly panes = new Map<string, HTMLElement>();
  private readonly canvases = new Map<string, AnnotationCanvas>();
  /** The layer the focus mode is spotlighting, or null when not focusing. */
  private focusFilter: string | null = null;
  /** Map-event wiring shared with the other canvas overlays (see
   *  bindMapSync): zoom hide/show, pan translate, full plan on zoom/resize. */
  private readonly mapCleanup: () => void;
  private readonly unsubscribe: Array<() => void> = [];
  /** Typography from the --label-* tokens, cached like the canvases cache their
   *  paint style: re-reading six CSS variables per throttled frame is pure
   *  overhead, and the tokens only change with the theme. */
  private cachedSpec: LabelSpec | null = null;
  /** mapPane's position at the last full plan — the pan fast path translates
   *  the planned boxes by the delta from it instead of re-planning. */
  private planOrigin: { x: number; y: number } | null = null;
  /** What the last full plan handed each canvas, kept for the pan translate. */
  private readonly lastPlanned = new Map<string, PlacedLabel[]>();

  constructor(mapInstance: L.Map, layerFind: (id: string) => L.Layer | null) {
    this.map = mapInstance;
    this.layerFind = layerFind;
    this.config = new Map();
    this.autoFieldCache = new Map();

    // The same event contract HeatmapControl's canvas uses. A pan translates
    // every label by the same delta, so the collision decision stands — only
    // the boxes move (refreshPan). Anything that can change geometry (zoom,
    // resize, a pan settling) goes through a full plan. The zoom hide/show
    // pair keeps the fixed-pixel labels off-screen while Leaflet
    // CSS-transforms mapPane (the #339 canvas did the same).
    this.mapCleanup = bindMapSync({
      map: mapInstance,
      hideEvents: ["zoomstart"],
      showEvents: ["zoomend"],
      updateEvents: ["zoom", "moveend", "resize"],
      onHide: this.hideLabels,
      onShow: this.showLabels,
      onUpdate: () => this.refresh(),
      onMove: () => this.refreshPan(),
    });
    // Membership changes repaint only the layer that moved — every other
    // layer's plan still stands (same boxes, same collision). Toggling a
    // 6k-point layer's checkbox must not re-plan the whole map.
    mapInstance.on("layeradd", this.onLayerMembership);
    mapInstance.on("layerremove", this.onLayerMembership);

    // Export safety: the exporter's locked path grows the container and shifts
    // the view, then captures on the very next frame — so the redraw here is
    // synchronous. A throttled one would land a frame late and the capture
    // would read the pre-export canvas.
    const events = ensureEvents(mapInstance);
    this.unsubscribe.push(
      events.on(EVENTS.BEFORE_EXPORT, () => this.refresh()),
      events.on(EVENTS.AFTER_EXPORT, () => this.refresh()),
    );
  }

  /** The Python CONF default annotation config (labels off, auto field, auto
   *  format, page-level collide). Reset restores this — never the persisted
   *  user choice. */
  defaultConfig(): AnnotationConfig {
    return {
      ...CONST.DEFAULT_ANNOTATION,
      collide: CONF.label_collide ?? true,
    };
  }

  /** Read the config for a layer, or the default (labels off) when unset. The
   *  collide default is the page's (`label_collide`, the parameter both controls
   *  share); a stored user choice — the panel toggle — overrides it per layer. */
  getConfig(id: string): AnnotationConfig {
    return {
      ...this.defaultConfig(),
      ...(this.config.get(id) ?? {}),
    };
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
   *  callers store and compare them uniformly — the same contract HeatmapControl
   *  uses for its aggregation field picker.
   *
   *  The *walk* runs through core/labelField's collector; what stays local is
   *  the leaf traversal. HeatmapControl keeps its own collection (fed from
   *  extractPoints, numeric only) but shares the bare-name field contract,
   *  the auto pick, and `bareFieldName` for legacy configs. */
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
   *  Returns the labels the plan was given: callers that track them (and the
   *  tests, which assert on "nothing was drawn") read that instead of walking
   *  the canvas. */
  renderLabels(id: string): LayerLabel[] {
    this.clearLabels(id);
    const cfg = this.getConfig(id);
    if (!cfg.show) return [];
    const field = this.resolveField(id);
    if (!field) return [];
    const layer = this.layerFind(id);
    if (!layer) return [];
    const locale = CONF.locale_code ?? "en";
    const labels: LayerLabel[] = [];

    forEachLeaf(layer, (leaf: L.Layer) => {
      const raw = this.readFieldValue(leaf, field);
      const anchor = this.resolveAnchor(leaf);
      if (raw === null || anchor === null) return;
      // The anchor kind is decided once here; the plan reads it to offset a
      // point label below its marker and centre a path label on its centroid.
      const atPoint = this.isPointAnchor(leaf);
      const text = this.formatValue(raw, cfg.format, locale);
      if (!text) return;
      labels.push({
        id: `${id}:${labels.length}`,
        text,
        latlng: anchor,
        atPoint,
        priority: LABEL_PRIORITY,
      });
    });

    if (labels.length > 0) {
      this.labelsByLayer.set(id, labels);
      this.ensureCanvas(id);
    }
    this.refresh();
    return labels;
  }

  /** Remove every annotation label that belongs to a given layer. */
  clearLabels(id: string): void {
    if (!this.labelsByLayer.delete(id)) return;
    this.canvases.get(id)?.paint([]);
    this.refresh();
  }

  /** Tear down labels for a layer and forget its config (e.g. on
   *  unregister). Deleting the entry keeps a removed layer's id from being
   *  written back to localStorage by the next annotations save. */
  destroyLayer(id: string): void {
    this.clearLabels(id);
    this.dropCanvas(id);
    this.config.delete(id);
    this.autoFieldCache.delete(id);
  }

  destroy(): void {
    this.mapCleanup();
    this.map.off("layeradd", this.onLayerMembership);
    this.map.off("layerremove", this.onLayerMembership);
    this.unsubscribe.forEach(off => off());
    this.unsubscribe.length = 0;
    for (const id of [...this.canvases.keys()]) this.dropCanvas(id);
    this.lastPlanned.clear();
    this.planOrigin = null;
    this.config.clear();
    this.autoFieldCache.clear();
  }

  /** Restrict the plan to one layer while the focus mode spotlights it — the
   *  other layers' labels would otherwise float over geometry the focus just
   *  hid (and, worse, hide the spotlighted layer's labels from the plan). Null
   *  clears the restriction. */
  setFocusFilter(layerId: string | null): void {
    if (this.focusFilter === layerId) return;
    this.focusFilter = layerId;
    this.refresh();
  }

  /** Hide every label canvas for the duration of a zoom animation (see the
   *  constructor's zoomstart/zoomend wiring). */
  private hideLabels = (): void => {
    for (const canvas of this.canvases.values()) canvas.setVisible(false);
  };

  /** Un-hide the canvases after the animation and redraw at the new zoom. */
  private showLabels = (): void => {
    for (const canvas of this.canvases.values()) canvas.setVisible(true);
    this.refresh();
  };

  /** Repaint one layer after its map membership changed (the panel's checkbox
   *  hide/show goes through map.removeLayer/addLayer). Only that layer's plan
   *  changes — every other layer keeps its boxes and its collision decision.
   *  A dense layer stays cheap here because plannedFor pre-culls off-screen
   *  anchors before laying out any text. */
  private readonly onLayerMembership = (event: { layer?: L.Layer }): void => {
    const target = event.layer;
    if (!target) return;
    for (const [id, canvas] of this.canvases) {
      if (this.layerFind(id) !== target) continue;
      const container = this.map.getContainer();
      const viewport = {
        x: 0,
        y: 0,
        w: container.clientWidth,
        h: container.clientHeight,
      };
      const planned = this.plannedFor(id, this.layerSpec(container, id), viewport);
      this.lastPlanned.set(id, planned);
      canvas.paint(planned, this.paintStyle(container, id));
      return;
    }
  };

  /** Plan each visible layer's labels independently, then hand every canvas its
   *  slice. Collision is per layer by design: the layers themselves are
   *  stacked, so a layer above already covers the labels below — hiding a lower
   *  layer's label would add nothing, and a cross-layer plan would make an
   *  upper layer's labels vanish under a lower layer's. */
  private refresh(): void {
    if (this.canvases.size === 0) return;
    const container = this.map.getContainer();
    const spec = (this.cachedSpec ??= specOf(container));
    const viewport = {
      x: 0,
      y: 0,
      w: container.clientWidth,
      h: container.clientHeight,
    };
    // Remember where the mapPane sat while planning — the pan fast path
    // translates by the delta from here (same source latLngToContainerPoint
    // uses, so the translate matches a re-plan exactly).
    const mapPane = this.map.getPanes().mapPane;
    this.planOrigin = mapPane ? { ...L.DomUtil.getPosition(mapPane) } : null;
    this.lastPlanned.clear();
    for (const [id, canvas] of this.canvases) {
      const planned = this.plannedFor(id, this.layerSpec(container, id), viewport);
      this.lastPlanned.set(id, planned);
      canvas.paint(planned, this.paintStyle(container, id));
    }
  }

  /** Per-layer layout spec: shared tokens, with that layer's font size. */
  private layerSpec(container: HTMLElement, id: string): LabelSpec {
    const base = (this.cachedSpec ??= specOf(container));
    const size = this.getConfig(id).size;
    return size === base.fontSize ? base : { ...base, fontSize: size };
  }

  /** Per-layer paint style: shared tokens, with that layer's color/size. */
  private paintStyle(container: HTMLElement, id: string): CanvasLabelStyle {
    const cfg = this.getConfig(id);
    return withLabelPaint(resolveCanvasLabelStyle(container), {
      color: cfg.color,
      size: cfg.size,
    });
  }

  /** Pan fast path: a pan translates every label by the same delta, so the
   *  last plan's boxes shift wholesale instead of re-running the planner. The
   *  viewport cull still applies — a label entering the frame during the pan
   *  appears on the full re-plan at moveend (the planner's trade for skipping
   *  O(n log n) per frame). */
  private refreshPan(): void {
    if (this.canvases.size === 0) return;
    const mapPane = this.map.getPanes().mapPane;
    const pos = mapPane ? L.DomUtil.getPosition(mapPane) : null;
    if (!this.planOrigin || !pos) {
      this.refresh();
      return;
    }
    const dx = pos.x - this.planOrigin.x;
    const dy = pos.y - this.planOrigin.y;
    if (dx === 0 && dy === 0) return;
    const container = this.map.getContainer();
    const viewport = {
      x: 0,
      y: 0,
      w: container.clientWidth,
      h: container.clientHeight,
    };
    for (const [id, canvas] of this.canvases) {
      const planned = this.lastPlanned.get(id);
      if (!planned) {
        // A canvas born after the last full plan (a layer enabled mid-pan)
        // has nothing to translate — plan it properly.
        const fresh = this.plannedFor(id, this.layerSpec(container, id), viewport);
        this.lastPlanned.set(id, fresh);
        canvas.paint(fresh, this.paintStyle(container, id));
        continue;
      }
      canvas.paint(
        withinRect(
          planned.map(label => ({
            ...label,
            box: { ...label.box, x: label.box.x + dx, y: label.box.y + dy },
          })),
          viewport,
        ),
        this.paintStyle(container, id),
      );
    }
  }

  /** What one layer's canvas draws: its own labels, laid out, culled to the
   *  viewport and — unless the layer opted out — thinned by collision. */
  private plannedFor(id: string, spec: LabelSpec, viewport: Box): PlacedLabel[] {
    if (!this.isVisible(id)) return [];
    const labels = this.labelsByLayer.get(id);
    if (!labels || labels.length === 0) return [];

    const candidates: LabelCandidate[] = [];
    for (const label of labels) {
      const anchor = this.map.latLngToContainerPoint(label.latlng);
      // Cheap pre-cull on the anchor alone: layoutLabel walks the text per
      // character, which is the bulk of the plan's cost on a dense layer —
      // and a 6k-point layer rarely has 6k anchors on screen.
      if (
        anchor.x < viewport.x - ANCHOR_CULL_MARGIN ||
        anchor.x > viewport.x + viewport.w + ANCHOR_CULL_MARGIN ||
        anchor.y < viewport.y - ANCHOR_CULL_MARGIN ||
        anchor.y > viewport.y + viewport.h + ANCHOR_CULL_MARGIN
      ) {
        continue;
      }
      candidates.push({
        id: label.id,
        text: label.text,
        atPoint: label.atPoint,
        priority: label.priority,
        anchor,
      });
    }

    // Collision off: the layer wants every label drawn, so only the layout and
    // the viewport cull still apply.
    if (!this.getConfig(id).collide) {
      return withinRect(
        candidates.map(label => layoutLabel(label, spec)),
        viewport,
      );
    }
    return planLabelLayout(candidates, spec, viewport);
  }

  /** Whether a layer's labels take part right now: it has to be on the map, and
   *  — while a focus is active — it has to be the spotlighted layer. */
  private isVisible(id: string): boolean {
    if (this.focusFilter !== null && id !== this.focusFilter) return false;
    const layer = this.layerFind(id);
    return !!layer && this.map.hasLayer(layer);
  }

  /** Lazily create a layer's pane + canvas. The pane is what puts labels at the
   *  layer's place in the stack — LayerManager.enforceOrder z-orders it. */
  private ensureCanvas(id: string): void {
    if (this.canvases.has(id)) return;
    const name = CONST.ANNOTATION_PANE_PREFIX + id;
    const pane = this.map.getPane(name) ?? this.map.createPane(name);
    pane.classList.add("foliplus-annotation-pane");
    this.panes.set(id, pane);
    this.canvases.set(id, new AnnotationCanvas(this.map, pane));
  }

  /** Drop a layer's canvas and pane. Called on unregister and on teardown; the
   *  pane has to leave Leaflet's registry too, or getPane keeps returning it. */
  private dropCanvas(id: string): void {
    this.canvases.get(id)?.destroy();
    this.canvases.delete(id);
    const pane = this.panes.get(id);
    if (!pane) return;
    destroyPane(this.map, CONST.ANNOTATION_PANE_PREFIX + id);
    this.panes.delete(id);
  }
}

/** The label typography for the plan, from the shared --label-* tokens. */
const specOf = (root: HTMLElement): LabelSpec => {
  const style: CanvasLabelStyle = resolveCanvasLabelStyle(root);
  return {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    haloWidth: style.haloWidth,
    pointOffsetY: 10,
    shapeOffsetY: 0,
  };
};

/** Parse a string value to a number when it's genuinely numeric. */
const parseNum = (v: string): number | null => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export { AnnotationManager, type AnnotationConfig, type LayerLabel };

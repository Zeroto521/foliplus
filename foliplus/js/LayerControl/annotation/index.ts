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
import { areaCentroid } from "#core/geo/index.js";
import {
  type Box,
  type LabelField,
  autoLabelField,
  collectLabelFields,
  withinRect,
} from "#core/label/index.js";
import { NO_FEATURE_TREE_KINDS, findNode, walkLeaf } from "#core/layer/index.js";
import { bindMapSync } from "#core/leaflet/index.js";
import type { NumberStyle } from "#foliplus/config-schema.js";
import { resolveCanvasLabelStyle, withLabelPaint } from "#common/canvasLabel.js";
import { finalize } from "#common/finalize.js";
import { clampLabelSize, normalizeHexColor } from "#common/form.js";
import { NUMBER_FORMAT, formatLabelNumber } from "#common/format.js";
import { createLogger } from "#common/log.js";
import type { CanvasLabelStyle } from "#common/type.js";
import * as CONST from "../const.js";
import type { AnnotationConfig } from "../type.js";
import { AnnotationCanvas } from "./canvas.js";
import {
  type LabelCandidate,
  type LabelSpec,
  type PlannedLabel,
  layoutLabel,
  planLabelLayout,
} from "./layout.js";

// The component's prefix, not the folder's: `Annotation` is an internal
// subsystem name a user never sees, and every diagnostic from a mounted
// LayerControl should grep as `[LayerControl]` — the same rule the UI modules
// follow through `ui.log`.
const log = createLogger("LayerControl");

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

/** The foliplus-owned slice of a layer's options — the one namespaced corner
 *  of a record Leaflet, folium and third-party layers all write into. */
type FoliplusLayerOptions = {
  foliplus?: FoliplusDeclaration;
};

/** A declaration an author leaves on the layer itself — `explore(foliplus=...)`
 *  in folium, serialized onto `layer.options.foliplus` by the layer's own
 *  template. Only the dimensions this control consumes are typed; everything
 *  else rides the index signature and is ignored, so a newer dimension
 *  (`icon`, label typography) degrades instead of throwing.
 *
 *  Hand-written rather than schema-generated: the value never crosses from
 *  Python, so there is no Python source for the generator to read. */
type FoliplusDeclaration = {
  annotation?: Partial<AnnotationConfig>;
  [key: string]: unknown;
};

// CONFIG is a free variable from the IIFE template wrapper.

/** How far outside the viewport an anchor may sit and still get laid out.
 *  A label is centered on its anchor and at most a few hundred px wide, so
 *  anything beyond this margin can never intersect the viewport — culling
 *  before layoutLabel skips the per-character width estimate for the bulk
 *  of a dense layer (6k points rarely have 6k on screen). */
const ANCHOR_CULL_MARGIN = 300;

/** Label priority is uniform within a layer: collision is per layer, so the
 *  planner's tie-breaks (box width, then insertion order) decide which of two
 *  overlapping labels in the same layer survives. The field itself stays — it
 *  is part of the shared planner's candidate contract. */
const LABEL_PRIORITY = 50;

/** Whether a string is one of the declared number formats — a typo has to
 *  degrade to the default, not reach the label renderer unresolved. */
const isDeclaredFormat = (format: string): format is NumberStyle =>
  (Object.values(NUMBER_FORMAT) as NumberStyle[]).includes(format as NumberStyle);

/** Whether a string is a hex colour the label renderer can paint — the panel's
 *  colour input and the built-in default are both hex, so anything else is a
 *  typo and degrades to the token default instead of reaching the canvas.
 *  `#rgb` is accepted and normalised to `#rrggbb` so a declared colour and a
 *  later panel edit compare equal. */
const isDeclaredColor = (color: string): boolean =>
  /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color);

/** The annotation keys an author declared for one layer — a PARTIAL record:
 *  only the keys actually declared are returned. An absent key must stay
 *  absent so the default below it survives the merge; coercing a full config
 *  (`coerceAnnotationFields`, ui/style/label.ts) would read an undeclared
 *  `collide` as `true` and shadow the page-level `label_collide` — the author
 *  named one field and the whole page's avoidance silently changed. */
const pickDeclaredAnnotation = (
  raw: Partial<AnnotationConfig> | undefined,
): Partial<AnnotationConfig> => {
  if (!raw) return {};
  const out: Partial<AnnotationConfig> = {};
  if (typeof raw.field === "string") out.field = raw.field;
  if (typeof raw.format === "string" && isDeclaredFormat(raw.format)) {
    out.format = raw.format;
  }
  if (typeof raw.color === "string" && isDeclaredColor(raw.color)) {
    out.color = normalizeHexColor(raw.color);
  }
  // The panel clamps the size input to the shared bounds; a declaration goes
  // through the same clamp so a hand-written 99px cannot reach the canvas.
  if (typeof raw.size === "number" && Number.isFinite(raw.size)) {
    out.size = clampLabelSize(raw.size);
  }
  if (typeof raw.collide === "boolean") out.collide = raw.collide;
  // Declaring a field turns the layer's labels on — the built-in default is off,
  // so a field alone would be visible only as the panel's starting value. An
  // explicit `show: false` is the escape hatch: name a field for the panel's
  // starting point while keeping the map clean.
  if (typeof raw.show === "boolean") out.show = raw.show;
  else if (out.field !== undefined) out.show = true;
  return out;
};

/**
 * AnnotationManager owns per-layer label state, the per-layer plans and the
 * per-layer canvases. state and persistence are written to LayerPersistence
 * by LayerUI.
 *
 * Panes are NOT this manager's anymore: the label pane is a declared
 * `role: "annotation"` PaneSpec of the layer's surface, created when the
 * surface materializes (the registration edge declares it iff the layer has
 * labelable fields — `LayerController.withAnnotationSpec`). This manager only
 * mounts and unmounts the canvas inside that pane, so the pane's lifetime,
 * z and opacity carrier are the surface's — the same bookkeeping as every
 * other pane the face owns.
 */
class AnnotationManager {
  private readonly map: L.Map;
  private readonly layerFind: (id: string) => L.Layer | null;
  private readonly config: Map<string, AnnotationConfig>;
  /** Resolved auto field per layer, dropped when its features can change. */
  private readonly autoFieldCache: Map<string, string>;
  /** Author-declared annotation keys per id. Cached: getConfig runs once per
   *  layer per frame (refreshPan → layerSpec/paintStyle), and a declaration
   *  is static for the life of the page, so the tree walk underneath runs once. */
  private readonly authorCache: Map<string, Partial<AnnotationConfig>>;
  /** The labels each layer wants drawn. */
  private readonly labelsByLayer = new Map<string, LayerLabel[]>();
  private readonly canvases = new Map<string, AnnotationCanvas>();
  /** Layer opacity per id, kept even while the label canvas is unmounted.
   *  R11 bakes alpha into the draws (the pane no longer takes CSS opacity),
   *  so a value written before the canvas exists has to be replayed onto it
   *  at mount — otherwise labels would paint at 1 while the data panes sit
   *  at the user's opacity. */
  private readonly layerAlphas = new Map<string, number>();
  /** The layer the focus mode is spotlighting, or null when not focusing. */
  private focusFilter: string | null = null;
  /** Map-event wiring shared with the other canvas overlays (see
   *  bindMapSync): zoom hide/show, pan translate, full plan on zoom/resize. */
  private readonly mapCleanup: () => void;
  private readonly unsubscribe: Array<() => void> = [];
  /** Typography from the --foliplus-label-* tokens, cached like the canvases cache their
   *  paint style: re-reading six CSS variables per throttled frame is pure
   *  overhead, and the tokens only change with the theme. */
  private cachedSpec: LabelSpec | null = null;
  /** Where mapPane sat when each layer's current plan was made — the pan
   *  fast path translates that layer's planned boxes by the delta from its
   *  own origin instead of re-planning. Per layer because plans are per
   *  layer: a content-change repaint at time T re-stamps only that layer's
   *  origin, never the origin of layers planned earlier. */
  private readonly planOrigins = new Map<string, { x: number; y: number }>();
  /** What the last full plan handed each canvas, kept for the pan translate. */
  private readonly lastPlanned = new Map<string, PlannedLabel[]>();

  constructor(opts: { map: L.Map; layerFind: (id: string) => L.Layer | null }) {
    this.map = opts.map;
    this.layerFind = opts.layerFind;
    this.config = new Map();
    this.autoFieldCache = new Map();
    this.authorCache = new Map();

    // The same event contract HeatmapControl's canvas uses. A pan translates
    // every label by the same delta, so the collision decision stands — only
    // the boxes move (refreshPan). Anything that can change geometry (zoom,
    // resize, a pan settling) goes through a full plan. The zoom hide/show
    // pair keeps the fixed-pixel labels off-screen while Leaflet
    // CSS-transforms mapPane (the #339 canvas did the same).
    this.mapCleanup = bindMapSync({
      map: this.map,
      hideEvents: ["zoomstart"],
      showEvents: ["zoomend"],
      updateEvents: ["zoom", "moveend", "resize"],
      onHide: this.hideLabels,
      onShow: this.showLabels,
      onUpdate: () => this.refresh(),
      onMove: () => this.refreshPan(),
    });

    const events = ensureEvents(this.map);
    // Membership changes repaint only the layer that moved — every other
    // layer's plan still stands (same boxes, same collision). Toggling a
    // 6k-point layer's checkbox must not re-plan the whole map.
    //
    // LAYER_CHANGE is the semantic replacement for the raw
    // `layeradd`/`layerremove` pair this used to read, and it covers the same
    // writes: LayerControl emits it for every map-membership change it owns —
    // register, unregister, the visibility executor's add/remove, the focus
    // re-add, and a late folium binding that resolves after this control's own
    // script. The bus also filters out the unrelated activity the raw pair
    // used to fire for (markers and overlays the other controls add), which is
    // why HeatmapControl switched the same way.
    this.unsubscribe.push(
      events.on(
        EVENTS.LAYER_CHANGE,
        payload => {
          // Guard: third-party or historical bare emit (no payload).
          // All product emit sites carry {id, kind} — a missing payload here
          // means an external caller fired the event without the contract.
          // Fallback to full refresh (repaint every label-bearing layer), which
          // is the old raw layeradd/layerremove behavior.
          if (!payload) {
            this.refresh();
            return;
          }
          const { id, kind } = payload;
          // A tile basemap, a solid color face, and a self-drawn canvas never
          // get an annotation pane — the registration edge declares it only for
          // a labelable feature tree — so they can never own a canvas to repaint.
          if (NO_FEATURE_TREE_KINDS.has(kind)) return;
          this.onLayerMembership(id);
        },
        "internal",
      ),
      // Export safety: the exporter's locked path grows the container and shifts
      // the view, then captures on the very next frame — so the redraw here is
      // synchronous. A throttled one would land a frame late and the capture
      // would read the pre-export canvas.
      events.on(EVENTS.BEFORE_EXPORT, () => this.refresh(), "internal"),
      events.on(EVENTS.AFTER_EXPORT, () => this.refresh(), "internal"),
    );
  }

  /** The built-in default annotation config (labels off, auto field, auto
   *  format, page-level collide) — the bottom layer of getConfig's merge. */
  defaultConfig(): AnnotationConfig {
    return {
      ...CONST.DEFAULT_ANNOTATION,
      collide: CONFIG.label_collide ?? true,
    };
  }

  /** Read the config for a layer: built-in defaults, the author's declaration,
   *  then the user's stored choice — each layer overriding the one below. */
  getConfig(id: string): AnnotationConfig {
    return {
      ...this.defaultConfig(),
      ...this.authorAnnotation(id),
      ...(this.config.get(id) ?? {}),
    };
  }

  /** The annotation keys the author declared on this layer, as a PARTIAL record.
   *  A middle layer of getConfig's merge: the built-in defaults below, the
   *  user's choice above, so it is structural rather than guarded — the user's
   *  panel toggle always wins.
   *
   *  Nothing goes into the intent store: this is an author's default, not user
   *  intent, and the store's document domain is user intent. getConfig is the
   *  single read point, so no consumer has to know the declaration exists. */
  private authorAnnotation(id: string): Partial<AnnotationConfig> {
    const cached = this.authorCache.get(id);
    if (cached !== undefined) return cached;
    const layer = this.layerFind(id);
    if (!layer) return {}; // not linked yet — leave unknown, never cache it
    const declared = findNode(
      layer,
      node => (node.options as FoliplusLayerOptions | undefined)?.foliplus,
    );
    // No foliplus namespace yet: the load-time sweep can read a layer before
    // it has attached one (folium lands a layer's script after the control's),
    // so an empty read is provisional — caching it would shadow the declaration
    // that arrives later, for the life of the page. Only a resolved namespace
    // is static and cacheable.
    if (!declared) return {};
    const out = pickDeclaredAnnotation(declared.annotation);
    this.authorCache.set(id, out); // the declaration is static once resolved
    return out;
  }

  setConfig(id: string, cfg: AnnotationConfig): void {
    this.config.set(id, cfg);
  }

  /** Delete a layer's config entry — the Reset path. Removing rather than
   *  writing a full default record is what lets the author's declaration show
   *  through: getConfig then reads "built-in defaults ⊕ author declaration",
   *  and collide still comes from the page-level `label_collide` default.
   *  Distinct from `unloadLayer`, which must keep the config across a teardown.
   *  `authorCache` is deliberately left alone — the declaration belongs to the
   *  layer, not the user, so only `destroyLayer` drops that entry. */
  clearConfig(id: string): void {
    this.config.delete(id);
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
    walkLeaf(layer, (leaf: L.Layer) => leaves.push(leaf));
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

  /** Anchor kind of a leaf, read once and used to decide BOTH the anchor
   *  point and whether the label offsets as a point or a path. The kind
   *  tracks the geometry type when `feature.geometry` is present — Point /
   *  MultiPoint → "point" (offset below the marker), anything else → "path"
   *  (centered on the shape's centroid / bounds). When no geometry is present
   *  the marker accessor decides: `getLatLng` → "point", otherwise → "path".
   *  Reading the kind once keeps `isPointAnchor` and `resolveAnchor` from
   *  drifting apart on leaves that carry both (e.g. an L.Circle). */
  private anchorKind(leaf: L.Layer): "point" | "path" {
    const geom = (leaf as L.Layer & { feature?: GeoJSON.Feature }).feature?.geometry;
    if (geom) {
      return geom.type === "Point" || geom.type === "MultiPoint" ? "point" : "path";
    }
    return typeof (leaf as L.Layer & { getLatLng?: () => L.LatLng }).getLatLng ===
      "function"
      ? "point"
      : "path";
  }

  /** Whether the label for a leaf offsets as a point (marker) rather than
   *  as a path centroid. Same read `resolveAnchor` uses to pick the anchor. */
  isPointAnchor(leaf: L.Layer): boolean {
    return this.anchorKind(leaf) === "point";
  }

  /** Resolve the anchor latlng for a feature leaf.
   *  Point (marker, no geometry) → `getLatLng()`; Polygon / MultiPolygon →
   *  area centroid; other paths → bounds center. `getLatLng` still wins on
   *  a leaf that carries BOTH (e.g. a Circle) so the label follows the
   *  marker's live position; `anchorKind` reports such a leaf as "path" so
   *  the offset is drawn for a shape, not a marker.
   *  Returns null when the leaf has no usable geometry. */
  resolveAnchor(leaf: L.Layer): L.LatLng | null {
    // Duck-type for a point accessor (markers expose getLatLng); fall back to
    // a geometry-aware anchor for paths. Avoids instanceof against a
    // possibly-mocked L.
    const getLatLng = (leaf as L.Layer & { getLatLng?: () => L.LatLng }).getLatLng;
    if (typeof getLatLng === "function") {
      const ll = getLatLng.call(leaf);
      if (ll) return ll;
    }
    const geom = (leaf as L.Layer & { feature?: GeoJSON.Feature }).feature?.geometry;
    if (geom && (geom.type === "Polygon" || geom.type === "MultiPolygon")) {
      return areaCentroid(geom);
    }
    const bounds = (
      leaf as L.Layer & { getBounds?: () => L.LatLngBounds }
    ).getBounds?.();
    if (bounds?.isValid()) return bounds.getCenter();
    return null;
  }

  /** The field a layer's labels read: the one the config names, or — when the
   *  config leaves it open (`field: ""`, what the picker's "Auto" entry means) —
   *  the shared auto pick over the layer's fields.
   *
   *  Resolved at render time rather than written into the config, so a layer
   *  whose columns change keeps labeling itself instead of being pinned to a
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
   *  the canvas.
   *
   *  The repaint is per layer: one final paint of this layer's canvas, never
   *  a paint-[]-then-refresh-all pair. Collision is per layer by design, so
   *  no other layer's plan changes when this one rebuilds — and M layers
   *  replaying in the same frame cost M repaints, not M². Zoom / pan /
   *  resize / export still go through the full `refresh()`. */
  renderLabels(id: string): LayerLabel[] {
    // Unconditional and idempotent: a stale plan left behind by an earlier
    // clear (or a canvas whose labels map already dropped) must not survive
    // this render just because labelsByLayer no longer has the id.
    const clearAnd = (): [] => {
      this.clearLabels(id);
      return [];
    };
    const cfg = this.getConfig(id);
    if (!cfg.show) return clearAnd();
    const field = this.resolveField(id);
    if (!field) return clearAnd();
    const layer = this.layerFind(id);
    if (!layer) return clearAnd();
    const locale = CONFIG.locale_code ?? "en";
    const labels: LayerLabel[] = [];

    walkLeaf(layer, (leaf: L.Layer) => {
      const raw = this.readFieldValue(leaf, field);
      const anchor = this.resolveAnchor(leaf);
      if (raw === null || anchor === null) return;
      // The anchor kind is decided once here; the plan reads it to offset a
      // point label below its marker and center a path label on its resolved
      // anchor (area centroid for polygons, bounds center for lines).
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
      this.refreshLayer(id);
    } else {
      this.clearLabels(id);
    }
    return labels;
  }

  /** Remove every annotation label that belongs to a given layer, and the
   *  pan plan built from them. One repaint — this layer's own canvas,
   *  painted empty.
   *
   *  The plan maps are cleared FIRST, and unconditionally: `refreshPan`
   *  translates a layer from `lastPlanned` + `planOrigins`, so leaving them
   *  behind lets a pan repaint the labels this call just removed (show=false,
   *  field gone, layer unloaded). Deleting them before the labelsByLayer
   *  early return also heals a state where the labels map already dropped but
   *  a plan survived.
   *
   *  Per-layer boundary: only this id's plan and canvas are touched. Collision
   *  is per layer by design, so no other layer's boxes or origin change —
   *  clearing one layer can never re-plan or shift another. */
  clearLabels(id: string): void {
    this.lastPlanned.delete(id);
    this.planOrigins.delete(id);
    if (!this.labelsByLayer.delete(id)) return;
    this.canvases.get(id)?.paint([]);
  }

  /** Bake the layer's opacity slider value into this layer's label canvas
   *  (R11) and repaint. The annotation pane no longer takes the CSS opacity
   *  write — baking is the sole carrier so labels do not double-compound
   *  with the vector data panes' CSS.
   *
   *  The value is recorded even when the canvas is unmounted (labels off):
   *  `ensureCanvas` replays it onto the fresh canvas so a late-mounted label
   *  never paints at full strength against a dimmed data layer. */
  applyLayerAlpha(id: string, alpha: number): void {
    this.layerAlphas.set(id, alpha);
    this.canvases.get(id)?.setLayerAlpha(alpha);
  }

  /** Tear down a layer's rendering state — labels, canvas, auto-field
   *  cache — but KEEP its config: an unregister is a teardown, not a
   *  delete, and the stored label intent has to survive it. The `layers`
   *  live source re-reads `configEntries` on every flush, so dropping the
   *  config here would erase `layers[id].annotation` from storage on the
   *  next save — a label-only layer would lose its section entirely. */
  unloadLayer(id: string): void {
    this.clearLabels(id);
    this.dropCanvas(id);
    this.autoFieldCache.delete(id);
  }

  /** Forget a layer entirely — rendering state AND config. `deleteLayer`
   *  only: a removed id must not answer `configEntries`. The record's
   *  `removed` prune is the storage-side backstop either way. */
  destroyLayer(id: string): void {
    this.unloadLayer(id);
    this.config.delete(id);
    this.authorCache.delete(id);
    this.layerAlphas.delete(id);
  }

  destroy(): void {
    // Snapshot the canvases themselves, not their ids: a step that removes the
    // last reference can let a re-entrant `ensureCanvas` mount a replacement
    // under the same id, and an id lookup at step time would destroy that new
    // canvas instead of the one this teardown owns.
    const canvases = [...this.canvases];
    finalize(
      [
        ["map-cleanup", () => this.mapCleanup()],
        ...this.unsubscribe.map((off, i) => [`unsubscribe:${i}`, off] as const),
        ...canvases.map(
          ([id, canvas]) => [`canvas:${id}`, () => canvas.destroy()] as const,
        ),
      ],
      failure => log.warn(`destroy step "${failure.name}" threw`, failure.error),
    );
    // Plain state resets: they cannot throw, and a failed step must not leave
    // config for a torn-down manager readable.
    this.unsubscribe.length = 0;
    this.canvases.clear();
    this.lastPlanned.clear();
    this.planOrigins.clear();
    this.config.clear();
    this.autoFieldCache.clear();
    this.authorCache.clear();
    this.layerAlphas.clear();
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
   *  anchors before laying out any text. Keyed by the id the event carries
   *  instead of matching layer objects, so a repaint is one map lookup rather
   *  than a walk of every canvas comparing stamps. */
  private readonly onLayerMembership = (id: string): void => {
    this.refreshLayer(id);
  };

  /** Plan each visible layer's labels independently, then hand every canvas its
   *  slice. Collision is per layer by design: the layers themselves are
   *  stacked, so a layer above already covers the labels below — hiding a lower
   *  layer's label would add nothing, and a cross-layer plan would make an
   *  upper layer's labels vanish under a lower layer's. */
  private refresh(): void {
    if (this.canvases.size === 0) return;
    const container = this.map.getContainer();
    this.cachedSpec ??= specOf(container);
    const viewport = {
      x: 0,
      y: 0,
      w: container.clientWidth,
      h: container.clientHeight,
    };
    // Remember where mapPane sat while planning — the pan fast path
    // translates by the delta from here (same source latLngToContainerPoint
    // uses, so the translate matches a re-plan exactly).
    const mapPane = this.map.getPanes().mapPane;
    const origin = mapPane ? { ...L.DomUtil.getPosition(mapPane) } : null;
    this.lastPlanned.clear();
    this.planOrigins.clear();
    for (const [id, canvas] of this.canvases) {
      const planned = this.plannedFor(id, this.layerSpec(container, id), viewport);
      this.lastPlanned.set(id, planned);
      if (origin) this.planOrigins.set(id, origin);
      canvas.paint(planned, this.paintStyle(container, id));
    }
  }

  /** Repaint ONE layer's canvas from its current labels — the content-change
   *  and membership path. Only that layer's plan runs: other layers' boxes
   *  and collision decisions stand (collision is per layer by design), so
   *  one layer's change costs one repaint, not one per layer on the map.
   *  Geometry-wide changes (zoom / resize / export / a settled pan) still
   *  go through the full `refresh()`. */
  private refreshLayer(id: string): void {
    const canvas = this.canvases.get(id);
    if (!canvas) return;
    const container = this.map.getContainer();
    const viewport = {
      x: 0,
      y: 0,
      w: container.clientWidth,
      h: container.clientHeight,
    };
    const planned = this.plannedFor(id, this.layerSpec(container, id), viewport);
    this.lastPlanned.set(id, planned);
    const mapPane = this.map.getPanes().mapPane;
    if (mapPane) this.planOrigins.set(id, { ...L.DomUtil.getPosition(mapPane) });
    canvas.paint(planned, this.paintStyle(container, id));
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
    if (!pos) {
      this.refresh();
      return;
    }
    const container = this.map.getContainer();
    const viewport = {
      x: 0,
      y: 0,
      w: container.clientWidth,
      h: container.clientHeight,
    };
    for (const [id, canvas] of this.canvases) {
      const planned = this.lastPlanned.get(id);
      const origin = planned ? this.planOrigins.get(id) : undefined;
      if (!planned || !origin) {
        // A canvas born after its layer's last plan (a layer enabled
        // mid-pan, or one planned without a pane origin) has nothing to
        // translate — plan it properly, stamped with the origin it planned
        // at, so the NEXT pan can translate it like everyone else.
        const fresh = this.plannedFor(id, this.layerSpec(container, id), viewport);
        this.lastPlanned.set(id, fresh);
        // Snapshot, like every planning path: the pane position object can be
        // reused/mutated by Leaflet, and a live reference would track the
        // current pos so dx stays 0 and this layer stops translating.
        this.planOrigins.set(id, { ...pos });
        canvas.paint(fresh, this.paintStyle(container, id));
        continue;
      }
      const dx = pos.x - origin.x;
      const dy = pos.y - origin.y;
      if (dx === 0 && dy === 0) continue;
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
  private plannedFor(id: string, spec: LabelSpec, viewport: Box): PlannedLabel[] {
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
   *  — while a focus is active — it has to be the spotlighted layer.
   *
   *  Uses `map.hasLayer` rather than `paintsAtZoom` because annotations are
   *  rendered on a vector canvas — there is no GridLayer zoom gate that
   *  would skip drawing outside `minZoom`/`maxZoom`. */
  private isVisible(id: string): boolean {
    if (this.focusFilter !== null && id !== this.focusFilter) return false;
    const layer = this.layerFind(id);
    return !!layer && this.map.hasLayer(layer);
  }

  /** Mount a layer's label canvas into its surface-declared annotation pane.
   *
   *  The pane already exists — the registration edge declared it alongside
   *  the capability (`withAnnotationSpec`), so the surface created it with
   *  the rest of the face and z-priced by the ordering pass. Opacity is NOT
   *  inherited from the pane (R11: the pane stays at CSS 1 and the canvas
   *  bakes layerAlpha) — `layerAlphas` is replayed onto the fresh canvas so
   *  a value written while labels were off still lands. */
  private ensureCanvas(id: string): void {
    if (this.canvases.has(id)) return;
    const pane = this.map.getPane(CONST.ANNOTATION_PANE_PREFIX + id);
    if (!pane) return; // no declared carrier (capability "none") — no labels
    pane.classList.add("foliplus-annotation-pane");
    const canvas = new AnnotationCanvas(this.map, pane);
    this.canvases.set(id, canvas);
    const alpha = this.layerAlphas.get(id);
    if (alpha !== undefined) canvas.setLayerAlpha(alpha);
  }

  /** Drop a layer's label canvas. Called on unregister and on teardown. The
   *  pane itself is the surface's — it survives with the rest of a declared
   *  face so the same id can register again without rebuilding its panes
   *  (the core `LayerSurface.destroy` contract); only the canvas is ours. */
  private dropCanvas(id: string): void {
    // `finally`, not `finalize`: one invariant (the entry must leave the map),
    // and it must hold on every exit path — including the one where destroy()
    // throws. A single reset is what finally is for.
    try {
      this.canvases.get(id)?.destroy();
    } finally {
      this.canvases.delete(id);
      // The plan belonged to the canvas. A same-id re-registration that draws
      // no labels must not inherit the old plan and have it translated on the
      // first pan by a fresh canvas.
      this.lastPlanned.delete(id);
      this.planOrigins.delete(id);
    }
  }
}

/** The label typography for the plan, from the shared --foliplus-label-* tokens. */
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

export { AnnotationManager };

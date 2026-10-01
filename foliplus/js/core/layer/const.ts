// core constants — shared by LayerInfoRegistry / PaneManager.
// Pure values, no DOM / CONF dependency. Re-exported by LayerControl/const.
/** Layer-stack z bases — the "layer z" family. Values are frozen; the
 *  three-family z policy table (layer / control / export) lives in
 *  css/common/token.css → Z-index. */
const Z_INDEX = { BASE: 600, TILE_BASE: 200, STEP: 10 };

const RECURSION = { PANE_DEPTH: 5, LAYER_DEPTH: 10 };

/** Upper bound on memoised child-pane discovery results. Entries are keyed by
 *  `L.stamp`, which Leaflet never reuses, so layer churn would otherwise
 *  accumulate them until teardown. Eviction is FIFO by first insertion, and
 *  evicting costs one extra `walkTree` walk — far under what the entry
 *  saves on its next hit. */
const CACHE = { PANE_DISCOVERY_ENTRIES: 4096 };

/** The class name a hidden canvas face carries — the visibility carrier for
 *  canvas-only surfaces (`capabilities.visibility === "pane"`). Shared here
 *  so `LayerFactory` (which writes it) and the executor's dispatcher (which
 *  reads it) both point at the same CSS token. */
const HIDDEN = "hidden";

/** Auto-generated per-layer fallback pane (hyphenated, stamp-keyed).
 *  Named component panes share the same hyphen convention — see
 *  CANVAS_PANE_PREFIX and LayerControl's ANNOTATION_PANE_PREFIX. */
const FALLBACK_PANE_PREFIX = "foliplus-pane-";

/** Pane name prefix for `createCanvas` overlays (HeatmapControl).
 *  Hyphenated like `foliplus-annotation-*` — these are named, component-owned
 *  panes, not the auto-generated fallback family. The canvas mounts here so
 *  z-order, focus hide, and export walk the same pane model as every other
 *  layer. */
const CANVAS_PANE_PREFIX = "foliplus-canvas-";

/** Pane name prefix for a solid-color basemap. Same family as
 *  `CANVAS_PANE_PREFIX`: a named, component-owned pane that owns the layer's
 *  whole face. The pane element itself is the face (it carries the fill), so
 *  the prefix is what tells the ordering pass and the exporter that this pane
 *  is a single flat surface rather than a container for vector children. */
const COLOR_PANE_PREFIX = "foliplus-color-";

/** A pane name must survive its journey into the DOM — Leaflet's `createPane`
 *  sets the name as an element id and a CSS class. Anything outside this
 *  pattern would be a third-party injection surface (a `<script>` in a
 *  class list, an `id` clash on a page that shares the doc, a `../` traversal
 *  in a compound selector). Only `[a-zA-Z0-9_-]` survives all three sinks
 *  (alphanumerics + hyphen + underscore; the last two are legal in both an
 *  HTML id and a CSS class).
 *
 *  Fallback panes (`FALLBACK_PANE_PREFIX` + `L.stamp`) and canvas panes
 *  (`CANVAS_PANE_PREFIX` + `opts.id`) are composed inside this project and
 *  land here too — the ids in `createCanvas`/`createLayers` must already
 *  satisfy this shape, and they do today because a numeric-or-alphanumeric id
 *  is what foliplus callers use. */
const PANE_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** Geometry type names (used by layer traversal / type detection). */
const GEOM_TYPE = {
  POINT: "point",
  LINE: "line",
  POLYGON: "polygon",
  EMPTY: "empty",
  UNKNOWN: "unknown",
  CUSTOM: "custom",
};

/** Layer group names — the `LayerInfo.group` vocabulary ("base" | "overlay").
 *  Owned by core so z / registry / factory compare against one definition;
 *  consumers import it from the `core/layer` barrel. */
const GROUP = { OVERLAY: "overlay", BASE: "base" } as const;

/** Layer kind names — the `LayerKind` vocabulary ("tile" | "vector" | "canvas"
 *  | "solid" | "cluster" | "custom"). Owned by core so the factory, registry,
 *  and surface probe stamp and compare against one definition; `LayerKind` in
 *  type.ts derives from it, so the vocabulary cannot drift. */
const KIND = {
  TILE: "tile",
  VECTOR: "vector",
  CANVAS: "canvas",
  SOLID: "solid",
  CLUSTER: "cluster",
  CUSTOM: "custom",
} as const;

/** Dimension-key names — the shared word face of `LayerDimension.key`,
 *  `DIM_ORDER`, and the capability slots ("opacity" | "fill" | "border" |
 *  "zoomRange" | "annotation"). Owned by core so the style registry and the
 *  capability contract read one definition; `LayerDimKey` in type.ts derives
 *  from it, so the vocabulary cannot drift. */
const DIM = {
  OPACITY: "opacity",
  FILL: "fill",
  BORDER: "border",
  ZOOM_RANGE: "zoomRange",
  ANNOTATION: "annotation",
} as const;

/** Capability-tier names — how a surface honestly carries a write
 *  ("native" | "pane" | "none"). The `LayerCapabilities` slots' value face:
 *  `detectCapabilities` stamps these, the style gates and the executor
 *  compare against them. Slot *names* stay plain property identifiers. */
const CAP_TIER = {
  NATIVE: "native",
  PANE: "pane",
  NONE: "none",
} as const;

/** Pane-role names — the `PaneSpec.role` vocabulary
 *  ("base" | "sub" | "annotation" | "preview"). Owned by core so z
 *  arithmetic, `PaneManager`'s spec gate, and `LayerControl`'s annotation /
 *  focus rules read one definition; `PaneRole` in type.ts derives from it,
 *  so the vocabulary cannot drift. */
const PANE_ROLE = {
  BASE: "base",
  SUB: "sub",
  ANNOTATION: "annotation",
  PREVIEW: "preview",
} as const;

/** Surface-content kind names — the discriminator vocabulary of
 *  `SurfaceContentOpts` and `SurfaceContentHandle`
 *  ("layers" | "canvas" | "color" | "custom"). Owned by core so
 *  `LayerFactory`'s branch split and stamps read one definition. The
 *  discriminated-union type positions stay literal (they are the type-level
 *  discriminators themselves). */
const CONTENT_KIND = {
  LAYERS: "layers",
  CANVAS: "canvas",
  COLOR: "color",
  CUSTOM: "custom",
} as const;

export {
  CACHE,
  CANVAS_PANE_PREFIX,
  CAP_TIER,
  COLOR_PANE_PREFIX,
  CONTENT_KIND,
  DIM,
  FALLBACK_PANE_PREFIX,
  GEOM_TYPE,
  GROUP,
  HIDDEN,
  KIND,
  PANE_NAME_PATTERN,
  PANE_ROLE,
  RECURSION,
  Z_INDEX,
};

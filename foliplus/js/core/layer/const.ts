// core constants — shared by LayerRegistry / PaneManager.
// Pure values, no DOM / CONF dependency. Re-exported by LayerControl/const.
const Z_INDEX = { BASE: 600, TILE_BASE: 200, STEP: 10 };

const RECURSION = { PANE_DEPTH: 5, LAYER_DEPTH: 10 };

/** Upper bound on memoised child-pane discovery results. Entries are keyed by
 *  `L.stamp`, which Leaflet never reuses, so layer churn would otherwise
 *  accumulate them until teardown. Eviction is FIFO by first insertion, and
 *  evicting costs one extra `forEachLayer` walk — far under what the entry
 *  saves on its next hit. */
const CACHE = { PANE_DISCOVERY_ENTRIES: 4096 };

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

/** The class that switches Leaflet's shared tile panes off. A solid-color
 *  basemap is the only thing that may write it: its own pane sits *under* the
 *  tiles in Leaflet's shared stack, so hiding the tiles is part of showing the
 *  color, and it belongs on the surface rather than as a global side effect
 *  that outlives the layer. */
const TILE_HIDDEN_CLASS = "foliplus-layer-tile-hidden";

/** Geometry type names (used by layer traversal / type detection). */
const GEOM_TYPE = {
  POINT: "point",
  LINE: "line",
  POLYGON: "polygon",
  EMPTY: "empty",
  UNKNOWN: "unknown",
  CUSTOM: "custom",
};

export {
  CACHE,
  CANVAS_PANE_PREFIX,
  COLOR_PANE_PREFIX,
  FALLBACK_PANE_PREFIX,
  GEOM_TYPE,
  PANE_NAME_PATTERN,
  RECURSION,
  TILE_HIDDEN_CLASS,
  Z_INDEX,
};

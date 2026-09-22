// core constants — shared by LayerRegistry / PaneManager.
// Pure values, no DOM / CONF dependency. Re-exported by LayerControl/const.
const Z_INDEX = { BASE: 600, TILE_BASE: 200, STEP: 10 };

const RECURSION = { PANE_DEPTH: 5, LAYER_DEPTH: 10 };

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

export {
  CANVAS_PANE_PREFIX,
  FALLBACK_PANE_PREFIX,
  GEOM_TYPE,
  PANE_NAME_PATTERN,
  RECURSION,
  Z_INDEX,
};

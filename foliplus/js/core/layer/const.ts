// core constants — shared by LayerRegistry / PaneManager.
// Pure values, no DOM / CONF dependency. Re-exported by LayerControl/const.
const Z_INDEX = { BASE: 600, TILE_BASE: 200, STEP: 10 };

/**
 * z-index step between sub-panes within a single layer. Sub-panes are the
 * child `layerGroup`s `createLayers({ panes: [...] })` registers; each one
 * paints one step above the previous. LayerControl's `bumpPanes` uses this
 * step so a layer's sub-panes land at `base + k * CHILD_PANE_STEP`, `k` =
 * the sub-pane's position in `opts.panes`. Ordered by z ascending: sub-panes
 * are expected to be named in the same ascending order they should paint.
 */
const CHILD_PANE_STEP = 1;

const RECURSION = { PANE_DEPTH: 5, LAYER_DEPTH: 10 };

const RENDERER_KEY = "foliplus_renderer_";

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
  CHILD_PANE_STEP,
  FALLBACK_PANE_PREFIX,
  GEOM_TYPE,
  RECURSION,
  RENDERER_KEY,
  Z_INDEX,
};

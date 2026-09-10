// core constants — shared by LayerRegistry / PaneManager.
// Pure values, no DOM / CONF dependency. Re-exported by LayerControl/const.
const Z_INDEX = { BASE: 600, TILE_BASE: 200, STEP: 10 };

/**
 * z-index step between a layer's base pane and its sub-panes. Sub-panes are
 * the child `layerGroup`s `createLayers({ panes: [...] })` registers (e.g.
 * measure's `measure_label`). LayerControl's `bumpPanes` uses the same steps
 * on every layer: `base + offset[k]` for the k-th sub-pane. Keeping the table
 * here — not in PaneManager — keeps the offsets shared between registration
 * and z-sorting without either side knowing the other's details.
 *
 * Ordered by z ascending: sub-panes are expected to be named in the same
 * ascending order they should paint (paths first, then nodes, then labels).
 * The k-th name in `opts.panes` gets `offset[k]`.
 */
const CHILD_PANE_OFFSET = [0, 1, 2] as const;

const RECURSION = { PANE_DEPTH: 5, LAYER_DEPTH: 10 };

const RENDERER_KEY = "foliplus_renderer_";

const FALLBACK_PANE_PREFIX = "foliplus_pane_";

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
  CHILD_PANE_OFFSET,
  FALLBACK_PANE_PREFIX,
  GEOM_TYPE,
  RECURSION,
  RENDERER_KEY,
  Z_INDEX,
};

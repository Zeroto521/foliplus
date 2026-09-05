// core constants — shared by LayerRegistry / PaneManager.
// Pure values, no DOM / CONF dependency. Re-exported by LayerControl/const.
const Z_INDEX = { BASE: 600, TILE_BASE: 200, STEP: 10 };

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

export { FALLBACK_PANE_PREFIX, GEOM_TYPE, RECURSION, RENDERER_KEY, Z_INDEX };

// core constants — shared by LayerRegistry / PaneManager.
// Pure values, no DOM / CONF dependency. Re-exported by LayerControl/const.
const Z_INDEX = { BASE: 600, TILE_BASE: 200, STEP: 10 };

/** Per-pane z overrides. Panes that share a base z resolve by the order in
 *  which they were created, which is not something a component can rely on —
 *  so each member of a stack declares its own z explicitly. */
const PANE_Z: Record<string, number> = {
  measure_graph: Z_INDEX.BASE,
  measure_node: Z_INDEX.BASE + 1,
  measure_label: Z_INDEX.BASE + 2,
};

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

export { Z_INDEX, PANE_Z, RECURSION, RENDERER_KEY, FALLBACK_PANE_PREFIX, GEOM_TYPE };

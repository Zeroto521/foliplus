// core constants — shared by LayerRegistry / PaneManager.
// Pure values, no DOM / CONF dependency. Re-exported by LayerControl/const.
export const Z_INDEX = { BASE: 600, TILE_BASE: 200, STEP: 10 };

/** Per-pane z overrides. Panes that share a base z resolve by the order in
 *  which they were created, which is not something a component can rely on —
 *  so each member of a stack declares its own z explicitly. */
export const PANE_Z: Record<string, number> = {
  measure_graph: Z_INDEX.BASE,
  measure_node: Z_INDEX.BASE + 1,
  measure_label: Z_INDEX.BASE + 2,
};

export const RECURSION = { PANE_DEPTH: 5, LAYER_DEPTH: 10 };

export const RENDERER_KEY = "foliplus_renderer_";

export const FALLBACK_PANE_PREFIX = "foliplus_pane_";

/** Geometry type names (used by layer traversal / type detection). */
export const GEOM_TYPE = {
  POINT: "point",
  LINE: "line",
  POLYGON: "polygon",
  EMPTY: "empty",
  UNKNOWN: "unknown",
  CUSTOM: "custom",
};

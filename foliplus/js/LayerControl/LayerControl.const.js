/** Timing / delay constants. */
export const INIT_DELAY_MS = 300;
export const ENFORCE_ORDER_DEBOUNCE_MS = 50;

/** Z-index values. */
export const Z_INDEX = {
  BASE: 600,
  TILE_BASE: 200,
  STEP: 10,
};

/** Recursion depth limits. */
export const RECURSION = {
  PANE_DEPTH: 5,
  LAYER_DEPTH: 10,
};

/** Drag hint cooldown. */
export const DRAG = { HINT_COOLDOWN_MS: 800 };

/** Persistent storage keys. */
export const STORAGE = {
  ORDER_KEY: `foliplus_layer_order_${map.getContainer().id}`,
  FOLD_KEY: `foliplus_fold_state_${map.getContainer().id}`,
};

/** Color map layer. */
export const COLOR = {
  MAP_ID: "foliplus_color_map",
  DEFAULT: "#cccccc",
};

/** Renderer key prefix. */
export const RENDERER_KEY = "foliplus_renderer_";

/** Fallback pane prefix. */
export const FALLBACK_PANE_PREFIX = "foliplus_pane_";

/** CSS class names. */
export const CLASSES = {
  LAYER_ITEM: "foliplus-layer-item",
  ACTIVE: "active",
  CHECKBOX: "foliplus-checkbox",
  GROUP_FOLDED: "foliplus-layer-group-folded",
  COLOR_INPUT: "foliplus-color-layer-input",
  COLOR_ITEM: "foliplus-color-layer-item",
  HIDDEN: "hidden",
  DRAG_OVER_TOP: "foliplus-layer-drag-over-top",
  DRAG_OVER_BOTTOM: "foliplus-layer-drag-over-bottom",
  DRAGGING: "foliplus-layer-dragging",
  FOLD_BTN: "foliplus-layer-fold-btn",
  FOLDED: "foliplus-layer-folded",
  TYPE_ICON_COL: "foliplus-type-icon-col",
  TOGGLE_ALL: "foliplus-layer-toggle-all",
  FOLD_BTN_CTR: "foliplus-layer-sep",
  SEP_LABEL: "foliplus-layer-sep-label",
};

/** Data attribute names. */
export const DATA = {
  INDEX: "data-index",
  LAYER_ID: "data-layer-id",
};

/** DOM selectors. */
export const SEL = {
  LAYER_ITEM: ".foliplus-layer-item",
  COLOR_ITEM: ".foliplus-color-layer-item",
  COLOR_INPUT: ".foliplus-color-layer-input",
  TOGGLE_ALL: ".foliplus-layer-toggle-all",
};

/** Group names. */
export const GROUP = {
  OVERLAY: "overlay",
  BASE: "base",
};

/** Geometry type names. */
export const GEOM_TYPE = {
  POINT: "point",
  LINE: "line",
  POLYGON: "polygon",
  EMPTY: "empty",
  UNKNOWN: "unknown",
  CUSTOM: "custom",
};

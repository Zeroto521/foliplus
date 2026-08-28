/** Timing / delay constants. */
export const INIT_DELAY_MS = 300;
export const ENFORCE_ORDER_DEBOUNCE_MS = 50;
export const SAVE_ORDER_DEBOUNCE_MS = 100;

/** Drag hint cooldown. */
export const DRAG = { HINT_COOLDOWN_MS: 800 };

/** Persistent storage keys. */
export const STORAGE = {
  ORDER_KEY: `foliplus_layer_order_${map.getContainer().id}`,
  FOLD_KEY: `foliplus_fold_state_${map.getContainer().id}`,
};

/** Color map layer. */
export const COLOR = { MAP_ID: "foliplus_color_map", DEFAULT: "#cccccc" };

/** Focus-on-layer behaviour. */
export const FOCUS = {
  /** How long the focus rectangle + corner markers stay visible. */
  RECT_DURATION_MS: 3500,
  /** fitBounds animation duration. */
  FIT_DURATION: 0.6,
  /** [topBottom, leftRight] padding so the rect isn't clipped at edges. */
  PADDING: [32, 32] as [number, number],
  /** Cap maxZoom to current + this step (prevents satellite-zoom snaps on tiny features). */
  MAX_ZOOM_STEP: 6,
  /** Bounds area (deg²) below which we treat the layer as a single point → flyTo center. */
  MIN_BOUNDS_AREA: 0.0001,
  /** Opacity applied to non-focused layers while a focus is in progress. */
  DIM_OPACITY: 0.25,
};

/** CSS class names. */
export const CLASSES = {
  LAYER_ITEM: "foliplus-layer-item",
  ACTIVE: "active",
  CHECKBOX: "foliplus-checkbox",
  DRAG_CELL: "foliplus-drag-cell",
  GROUP_FOLDED: "foliplus-layer-group-folded",
  COLOR_INPUT: "foliplus-color-layer-input",
  COLOR_ITEM: "foliplus-color-layer-item",
  LAYER_LABEL: "foliplus-layer-label",
  HIDDEN: "hidden",
  FOCUSED: "foliplus-layer-focused",
  DRAG_OVER_TOP: "foliplus-layer-drag-over-top",
  DRAG_OVER_BOTTOM: "foliplus-layer-drag-over-bottom",
  DRAGGING: "foliplus-layer-dragging",
  FOLD_BTN: "foliplus-layer-fold-btn",
  FOLDED: "foliplus-layer-folded",
  TYPE_ICON_COL: "foliplus-type-icon-col",
  COUNT_COL: "foliplus-layer-count",
  MORE_BTN: "foliplus-layer-more-btn",
  TOGGLE_ALL: "foliplus-layer-toggle-all",
  FOLD_BTN_CTR: "foliplus-layer-sep",
  SEP_LABEL: "foliplus-layer-sep-label",
  FOCUSING: "foliplus-layer-focusing",
};

/** Data attribute names. */
export const DATA = {
  INDEX: "data-index",
  LAYER_ID: "data-layer-id",
  COUNT: "data-item-count",
  TITLE: "data-item-title",
};

/** DOM selectors. */
export const SEL = {
  LAYER_ITEM: ".foliplus-layer-item",
  COLOR_ITEM: ".foliplus-color-layer-item",
  COLOR_INPUT: ".foliplus-color-layer-input",
  TOGGLE_ALL: ".foliplus-layer-toggle-all",
  COUNT_COL: ".foliplus-layer-count",
};

/** Group names. */
export const GROUP = { OVERLAY: "overlay", BASE: "base" };

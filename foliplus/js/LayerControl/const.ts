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
  /** How long the focus rectangle stays visible. */
  RECT_DURATION_MS: 3500,
  /** fitBounds animation duration. */
  FIT_DURATION: 0.6,
  /** [topBottom, leftRight] fitBounds padding (px). 32px keeps the dashed rect
   *  + 4px corner markers clear of the viewport edge (Leaflet clips at 0). */
  PADDING: [32, 32] as [number, number],
  /** Cap fitBounds maxZoom at current + this step. Without it, a small feature
   *  snaps to the map's max zoom (satellite view); +6 keeps the layer's
   *  surroundings in frame. */
  MAX_ZOOM_STEP: 6,
  /** Bounds area (deg²) below which we treat the layer as a single point → flyTo center. */
  MIN_BOUNDS_AREA: 0.0001,
  /** Opacity of the "dim outside" mask. Keep in sync with ExportControl's
   *  --export-dim-color (rgba(0,0,0,0.4)) so both selection boxes dim alike. */
  MASK_OPACITY: 0.4,
  /** CSS filter applied to non-focused layers while a focus is in progress.
   *  Darkens and desaturates ("grey ghost") so the focused layer is the only
   *  coloured + bright element. Keeps layers opaque — unlike opacity, which
   *  fades to the light basemap and reads as brighter. Brightness is the
   *  primary signal: it also dims layers that are already grey (desaturation
   *  alone would leave them unchanged). */
  DIM_FILTER: "brightness(0.4) saturate(0.15)",
  /** CSS filter applied to the focused layer itself. An accent drop-shadow
   *  gives it a positive "selected" glow, so it stands out even when it is
   *  grey (a grey layer dimmed against grey ghosts is otherwise invisible). */
  FOCUS_FILTER: "drop-shadow(0 0 4px var(--accent-primary))",
  /** Z-index of the focus overlay pane (mask + rectangle). Layer panes live
   *  below this (600 + 10·i); the focused layer is temporarily lifted just
   *  below it (PANE_Z − 10) so dimmed layers above it never cover it. */
  PANE_Z: 9000,
};

/** Leaflet pane name for the focus overlay (mask + rectangle). */
export const FOCUS_PANE = "foliplus-focus-overlay";

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

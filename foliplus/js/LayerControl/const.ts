import { NUMBER_FORMAT } from "#common/format.js";

/** Timing / delay constants. */
const ENFORCE_ORDER_DEBOUNCE_MS = 50;
const SAVE_ORDER_DEBOUNCE_MS = 100;

/** Drag hint cooldown. */
const DRAG = { HINT_COOLDOWN_MS: 800 };

/** Persistent storage keys. */
const STORAGE = {
  ORDER_KEY: `foliplus_layer_order_${map.getContainer().id}`,
  FOLD_KEY: `foliplus_fold_state_${map.getContainer().id}`,
  /** Set of layer ids currently off the map. Absolute, not relative: it is
   *  what is hidden, not merely what the user toggled to hide. A relative set
   *  could never express "show a layer the author declared show=False", because
   *  that id was never added to begin with. */
  VISIBILITY_KEY: `foliplus_layer_visibility_${map.getContainer().id}`,
  /** Map of layer id → user-assigned display name. */
  NAMES_KEY: `foliplus_layer_names_${map.getContainer().id}`,
  /** Map of layer id → annotation config (show/field/format). */
  ANNOTATION_KEY: `foliplus_layer_annotation_${map.getContainer().id}`,
};

/** Color map layer. */
const COLOR = { MAP_ID: "foliplus_color_map", DEFAULT: "#cccccc" };

/** Focus-on-layer behaviour. */
const FOCUS = {
  /** How long the focus rectangle stays visible. */
  RECT_DURATION_MS: 3500,
  /** fitBounds animation duration. */
  FIT_DURATION: 0.6,
  /** [topBottom, leftRight] fitBounds padding (px). 32px keeps the dashed
   *  selection rect clear of the viewport edge (Leaflet clips at 0). */
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
  /** Z-index of the focus overlay pane (mask + rectangle). Layer panes live
   *  below this (600 + 10·i); the focused layer is temporarily lifted just
   *  below it so other layers never cover it. */
  PANE_Z: 9000,
  /** Gap below PANE_Z the focused layer's pane is lifted to (must stay below
   *  the mask, above every layer pane). */
  FOCUSED_Z_GAP: 10,
};

/** Leaflet pane name for the focus overlay (mask + rectangle). */
const FOCUS_PANE = "foliplus-focus-overlay";

/** Leaflet pane name prefix for a layer's annotation labels: one pane per
 *  labelled layer, so its labels sit at that layer's place in the stack.
 *  `LayerManager.enforceOrder` z-orders each pane just above its layer. */
const ANNOTATION_PANE_PREFIX = "foliplus-annotation-";

/** Z offset of a layer's annotation pane above its layer. Layers sit
 *  `Z_INDEX.STEP` (10) apart, so +1 keeps the labels above their own layer
 *  while the next layer up still covers them — the same gap the focus ladder
 *  reuses when it raises a layer. */
const ANNOTATION_Z_OFFSET = 1;

/** CSS class names. */
const CLASSES = {
  LAYER_ITEM: "foliplus-layer-item",
  ACTIVE: "active",
  CHECKBOX: "foliplus-checkbox",
  DRAG_CELL: "foliplus-drag-cell",
  GROUP_FOLDED: "foliplus-layer-group-folded",
  COLOR_INPUT: "foliplus-color-layer-input",
  COLOR_ITEM: "foliplus-color-layer-item",
  LAYER_LABEL: "foliplus-layer-label",
  /** Marks a row that owns the live Row-cursor visual (arrow keyboard cursor
   *  or Tab focus). The recipe CSS keys only on this class + `:hover` — never
   *  on `:focus-visible` — so Escape is a single class removal. */
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
  /** Set on the map container while a focus is active. CSS hides every
   *  `.foliplus-layer-pane` except the focused one (`.foliplus-focus-pane`)
   *  declaratively — one class write instead of a JS visibility loop. */
  FOCUS_ACTIVE: "foliplus-focus-active",
  /** Marked on the focused layer's pane(s)/canvas so it stays visible while
   *  every other layer is hidden by the `.foliplus-focus-active` rule. */
  FOCUS_PANE: "foliplus-focus-pane",
  /** Added to the focused layer's element(s) so its accent drop-shadow glow
   *  fades in (CSS animation) — a single element, not a per-layer loop. */
  FOCUS_GLOW: "foliplus-focus-glow",
  /** Inline rename input shown inside a layer label. */
  RENAME_INPUT: "foliplus-layer-rename-input",
  /** Set on a layer row while its inline rename input is open. */
  RENAMING: "foliplus-layer-renaming",
  /** Floating style panel opened from the layer overflow menu. */
  STYLE_PANEL: "foliplus-layer-style-panel",
  /** The style panel's controls. Each is named by the builder *and* looked up
   *  again by the change handlers that read the panel back, so the names live
   *  here instead of being typed twice and drifting. */
  STYLE_FIELD_SELECT: "foliplus-style-field-select",
  STYLE_FORMAT_ROW: "foliplus-style-format-row",
  STYLE_FORMAT_SELECT: "foliplus-style-format-select",
  STYLE_TOGGLE_INPUT: "foliplus-style-toggle-input",
  STYLE_BODY: "foliplus-style-body",
  STYLE_LABEL_COLOR_INPUT: "foliplus-style-label-color-input",
  STYLE_LABEL_SIZE_INPUT: "foliplus-style-label-size-input",
  /** The "avoid overlap" switch — its own class, because the panel's change
   *  delegation keys on the class to tell the two switches apart. */
  STYLE_COLLIDE_INPUT: "foliplus-style-collide-input",
  /** Shared form-row layout classes (also used by HeatmapControl template). */
  FORM_ROW: "foliplus-form-row",
  FORM_LABEL: "foliplus-form-label",
  FORM_CONTROL: "foliplus-form-control",
  FORM_INLINE: "foliplus-form-inline",
  TOGGLE_SWITCH: "foliplus-toggle-switch",
  TOGGLE_SLIDER: "foliplus-toggle-slider",
  ATTRS_PANEL: "foliplus-layer-attrs-panel",
  ATTRS_ICON: "foliplus-layer-attrs-icon",
};

/** Data attribute names. */
const DATA = {
  INDEX: "data-index",
  LAYER_ID: "data-layer-id",
  COUNT: "data-item-count",
  TITLE: "data-item-title",
};

/** Overflow-menu action values (data-action). */
const ACTION = {
  FOCUS_LAYER: "focus-layer",
  RENAME_LAYER: "rename-layer",
  STYLE_LAYER: "style-layer",
  ATTRS_LAYER: "layer-attributes",
};

/** DOM selectors. */
const SEL = {
  LAYER_ITEM: ".foliplus-layer-item",
  COLOR_ITEM: ".foliplus-color-layer-item",
  COLOR_INPUT: ".foliplus-color-layer-input",
  TOGGLE_ALL: ".foliplus-layer-toggle-all",
  COUNT_COL: ".foliplus-layer-count",
  /** Any cursor-recipe row (data item or the fold/toggle-all row). Child
   *  control focus (checkbox / more / fold) attributes to this via closest(). */
  ROW: ".foliplus-layer-item, .foliplus-layer-toggle-all",
};

/** Group names. */
const GROUP = { OVERLAY: "overlay", BASE: "base" };

/** Default annotation config for a layer (disabled). */
const DEFAULT_ANNOTATION = {
  show: false,
  field: "",
  format: NUMBER_FORMAT.AUTO,
} as const;

export {
  ACTION,
  ANNOTATION_PANE_PREFIX,
  ANNOTATION_Z_OFFSET,
  CLASSES,
  COLOR,
  DATA,
  DEFAULT_ANNOTATION,
  DRAG,
  ENFORCE_ORDER_DEBOUNCE_MS,
  FOCUS,
  FOCUS_PANE,
  GROUP,
  SAVE_ORDER_DEBOUNCE_MS,
  SEL,
  STORAGE,
};

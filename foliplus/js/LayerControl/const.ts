import { ANNOTATION_Z_OFFSET, FOCUS_Z } from "#core/layer/index.js";
import { LABEL_COLOR_DEFAULT, LABEL_SIZE } from "#common/form.js";
import { NUMBER_FORMAT } from "#common/format.js";

/** Timing / delay constants. */
const ENFORCE_ORDER_DEBOUNCE_MS = 50;
/** One debounce for every persisted dimension -- the record is written whole,
 *  so there is a single timer rather than one per dimension. */
const SAVE_DEBOUNCE_MS = 100;

/** Drag hint cooldown. */
const DRAG = { HINT_COOLDOWN_MS: 800 };

/** Persistent storage key. One record per map container, so multi-map pages
 *  keep their state separate and a new dimension is added by extending the
 *  record rather than by introducing a new key. */
const STORAGE = { KEY: `foliplus_layer_state_${map.getContainer().id}` };

/** Color map layer. */
const COLOR = { MAP_ID: "foliplus_color_map", DEFAULT: "#cccccc" };

/** Focus-on-layer behavior. */
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
   *  below this; the focused layer is temporarily lifted just below it so
   *  other layers never cover it. The real value lives in the shared z
   *  ladder (`core/layer/z`); this alias exists so existing assertions and
   *  external readers can refer to the value through the component's own
   *  surface without reaching into core — the single source of truth is
   *  still only `core/layer/z`. */
  PANE_Z: FOCUS_Z.overlay,
  /** Gap below PANE_Z the focused layer's pane is lifted to (must stay below
   *  the mask, above every layer pane). Same alias rationale as PANE_Z. */
  FOCUSED_Z_GAP: FOCUS_Z.gap,
};

/** Leaflet pane name for the focus overlay (mask + rectangle). */
const FOCUS_PANE = "foliplus-focus-overlay";

/** Leaflet pane name prefix for a layer's annotation labels: one pane per
 *  labeled layer, so its labels sit at that layer's place in the stack.
 *  `LayerManager.enforceOrder` z-orders each pane just above its layer. */
const ANNOTATION_PANE_PREFIX = "foliplus-annotation-";

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
  /** Divider above the ⋮ menu's destructive entry — its own <li> so the
   *  keyboard order stays one slot per entry. */
  MENU_DIVIDER: "foliplus-layer-more-menu-divider",
  /** The ⋮ menu's delete label, kept in its own element so the armed state
   *  can swap the text without rebuilding the entry. */
  MENU_DELETE_LABEL: "foliplus-layer-more-menu-delete-label",
  /** The ⋮ menu's delete entry while it waits for its confirming click. */
  MENU_DELETE_ARMED: "foliplus-layer-more-menu-delete-armed",
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
  /** Fill color row (vector layers): swatch + native <input type=color>.
   *  Its own class so the change delegation can tell it from the label
   *  color swatch, and so a future delegated drawer can gate on it. */
  STYLE_FILL_ROW: "foliplus-style-fill-row",
  STYLE_FILL_COLOR_INPUT: "foliplus-style-fill-color-input",
  STYLE_FILL_OPACITY_NUMBER: "foliplus-style-fill-opacity-number",
  /** Shared section heading (form.css). */
  SECTION_HEADING: "foliplus-section-heading",
  /** Opacity control: range slider + paired number input. */
  STYLE_OPACITY_TRACK: "foliplus-style-opacity-track",
  STYLE_OPACITY_FILL: "foliplus-style-opacity-fill",
  STYLE_OPACITY_RANGE: "foliplus-style-opacity-range",
  STYLE_OPACITY_RAIL: "foliplus-style-opacity-rail",
  STYLE_OPACITY_DOT: "foliplus-style-opacity-dot",
  STYLE_OPACITY_VALUES: "foliplus-style-opacity-values",
  /** Zoom-range row: a dual-thumb slider with a current-zoom marker.
   *
   *  The rail carries two textures and nothing else: the selected span is the
   *  accent fill, the rest is a transparency checkerboard — "the layer is not
   *  rendered there", the same convention the opacity row's checkerboard used.
   *  Integer tick marks were dropped with it: on an 8px rail a second texture
   *  only fights the first. */
  STYLE_ZOOM_RANGE_ROW: "foliplus-style-zoom-range-row",
  STYLE_ZOOM_RANGE_CONTROL: "foliplus-style-zoom-range-control",
  STYLE_ZOOM_RANGE_TRACK: "foliplus-style-zoom-range-track",
  STYLE_ZOOM_RANGE_FILL: "foliplus-style-zoom-range-fill",
  STYLE_ZOOM_RANGE_MIN: "foliplus-style-zoom-range-min",
  STYLE_ZOOM_RANGE_MAX: "foliplus-style-zoom-range-max",
  STYLE_ZOOM_RANGE_CURRENT_VALUE: "foliplus-style-zoom-range-current-value",
  STYLE_ZOOM_RANGE_VAL: "foliplus-style-zoom-range-value",
  /** The round readouts on the rail: the map's two zoom limits (-min, -max) and
   *  the current level (-current). A dot's ring is accent where the layer
   *  renders and gray where it does not. */
  STYLE_ZOOM_RANGE_DOT: "foliplus-style-zoom-range-dot",
  STYLE_ZOOM_RANGE_DOT_COVERED: "foliplus-style-zoom-range-dot-covered",
  /** Set on a value label whose mark is too close to a higher-priority one to
   *  sit under it without overlapping. */
  STYLE_ZOOM_RANGE_LABEL_HIDDEN: "foliplus-style-zoom-range-label-hidden",
  /** Marks the row when the map's current zoom falls outside the layer's
   *  range — a dimmed state that reads "you set this to hide at the current
   *  level" without hiding the row itself (the user may still want to change
   *  it). */
  STYLE_ZOOM_RANGE_OUT_OF_RANGE: "foliplus-zoom-range-out-of-range",
  /* ── Shared slider component (common/slider.css) ──
     Both range controls are this component; the rows below add their own hook
     classes for behavior and tests, and set `--slider-thumb-ring` for their
     own coverage state. Geometry is declared once, in the component. */
  SLIDER: "foliplus-slider",
  SLIDER_RAIL: "foliplus-slider-rail",
  SLIDER_FILL: "foliplus-slider-fill",
  SLIDER_DOT: "foliplus-slider-dot",
  SLIDER_DOT_COVERED: "foliplus-slider-dot-covered",
  SLIDER_DOT_MIN: "foliplus-slider-dot-min",
  SLIDER_DOT_MAX: "foliplus-slider-dot-max",
  SLIDER_HANDLE: "foliplus-slider-handle",
  SLIDER_VALUES: "foliplus-slider-values",
  SLIDER_LABEL_HIDDEN: "foliplus-slider-label-hidden",
  SLIDER_BUBBLE: "foliplus-slider-bubble",
  /** Shared form-row layout classes (also used by HeatmapControl template). */
  FORM_ROW: "foliplus-form-row",
  FORM_LABEL: "foliplus-form-label",
  FORM_CONTROL: "foliplus-form-control",
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
  DELETE_LAYER: "delete-layer",
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
  MENU_DELETE_LABEL: `.${CLASSES.MENU_DELETE_LABEL}`,
};

/** Group names. */
const GROUP = { OVERLAY: "overlay", BASE: "base" };

/** Default annotation config for a layer (disabled). */
const DEFAULT_ANNOTATION = {
  show: false,
  field: "",
  color: LABEL_COLOR_DEFAULT,
  size: LABEL_SIZE.SIZE_DEFAULT,
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
  SAVE_DEBOUNCE_MS,
  SEL,
  STORAGE,
};

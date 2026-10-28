import { FOCUS_Z, LABEL_PANE_PREFIX } from "#core/layer/index.js";
import { DEFAULT_LABEL_COLOR, LABEL_SIZE } from "#common/form.js";
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
const SOLID_BASEMAP_ID = "foliplus_color_map";
const COLOR = { DEFAULT: "#cccccc" };

/** Shared bounds for a layer's fixed pixel radius (CircleMarker only). One
 *  home so the number field, the persistence parser and the write path cannot
 *  drift apart. */
const SIZE = {
  MIN: 1,
  MAX: 64,
  STEP: 1,
  /** The value an empty entry lands on. Matches the `CircleMarker` radius an
   *  author gets without specifying one (folium 0.20.0 and Leaflet both
   *  default to 10), so a cleared field returns to where a freshly drawn,
   *  un-declared marker sits. Only reachable through the invalid-input branch
   *  and the no-leaf fallback — never a bound. */
  DEFAULT: 10,
} as const;

/** Defaults for the value-based fill (the fill row). The method / scheme
 *  values only seed the first ramp a user switches to (a stored
 *  `FillRampConfig` always wins); the class-count vocabulary lives in
 *  #core/classify and is imported where it is used. */
const RAMP = {
  METHOD_DEFAULT: "jenks",
  SCHEME_DEFAULT: "Viridis",
} as const;

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
   *  --foliplus-export-dim-color (rgba(0,0,0,0.4)) so both selection boxes dim alike. */
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

/** CSS class names. */
const CLASSES = {
  LAYER_ITEM: "foliplus-layer-item",
  ACTIVE: "foliplus-active",
  CHECKBOX: "foliplus-checkbox",
  DRAG_CELL: "foliplus-drag-cell",
  GROUP_FOLDED: "foliplus-layer-group-folded",
  LAYER_LABEL: "foliplus-layer-label",
  /** Marks a row that owns the live Row-cursor visual (arrow keyboard cursor
   *  or Tab focus). The recipe CSS keys only on this class + `:hover` — never
   *  on `:focus-visible` — so Escape is a single class removal. */
  FOCUSED: "foliplus-is-focused-row",
  DRAG_OVER_TOP: "foliplus-layer-drag-over-top",
  DRAG_OVER_BOTTOM: "foliplus-layer-drag-over-bottom",
  DRAGGING: "foliplus-layer-dragging",
  FOLD_BTN: "foliplus-layer-fold-btn",
  FOLDED: "foliplus-layer-folded",
  TYPE_ICON_COL: "foliplus-type-icon-col",
  COUNT_COL: "foliplus-layer-count",
  /** Count column with a committed filter: a neutral count + funnel prefix. */
  COUNT_FILTERED: "foliplus-layer-count-filtered",
  /** The 12px neutral (text-primary) funnel glyph before a filtered count. */
  COUNT_FUNNEL: "foliplus-layer-count-funnel",
  MORE_BTN: "foliplus-layer-more-btn",
  TOGGLE_ALL: "foliplus-layer-toggle-all",
  FOLD_BTN_CTR: "foliplus-layer-sep",
  SEPARATOR_LABEL: "foliplus-layer-sep-label",
  /** Set on the map container when zero basemaps are visible (A′ hatch).
   *  Painted via CSS `background-image`, which ExportControl's
   *  resolveExportBackground deliberately skips — an empty state never
   *  reaches an export. */
  NO_BASE_MAP: "foliplus-no-base-map",
  FOCUSING: "foliplus-is-focusing",
  /** Set on the map container while a focus is active. CSS hides every
   *  `.foliplus-layer-pane` except the focused one (`.foliplus-focus-pane`)
   *  declaratively — one class write instead of a JS visibility loop. */
  FOCUS_ACTIVE: "foliplus-is-focus-mode",
  /** Marked on the focused layer's pane(s)/canvas so it stays visible while
   *  every other layer is hidden by the `.foliplus-is-focus-mode` rule. */
  FOCUS_PANE: "foliplus-focus-pane",
  /** Marked on the panes of the active basemap (topmost base layer that is
   *  effectiveShown) while a layer is focused. Only this basemap is exempted
   *  from the hide rule and dimmed — other base panes are hidden like data
   *  layers. Applied dynamically during focus, never stamped at registration. */
  FOCUS_BASEMAP: "foliplus-focus-basemap",
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
  /** The Label section's row wrapper — the `annotation` dimension's `row`
   *  element (toggle + body), so the panel assembly and the tests can
   *  select the section's content as one unit. No styles hang off it. */
  STYLE_LABEL_SECTION: "foliplus-style-label-section",
  STYLE_LABEL_COLOR_INPUT: "foliplus-style-label-color-input",
  STYLE_LABEL_SIZE_INPUT: "foliplus-style-label-size-input",
  /** Border row (vector layers): stroke swatch + width field. Each control
   *  gets its own class so the panel's change delegation and the tests can
   *  tell it apart from the label color swatch. */
  STYLE_BORDER_ROW: "foliplus-style-border-row",
  STYLE_BORDER_COLOR_INPUT: "foliplus-style-border-color-input",
  STYLE_BORDER_WEIGHT_INPUT: "foliplus-style-border-weight-input",
  /** The "avoid overlap" switch — its own class, because the panel's change
   *  delegation keys on the class to tell the two switches apart. */
  STYLE_COLLIDE_INPUT: "foliplus-style-collide-input",
  /** Fill color row (vector layers): swatch + native <input type=color>.
   *  Its own class so the change delegation can tell it from the label
   *  color swatch, and so a future delegated drawer can gate on it. */
  STYLE_FILL_ROW: "foliplus-style-fill-row",
  STYLE_FILL_COLOR_INPUT: "foliplus-style-fill-color-input",
  STYLE_FILL_OPACITY_NUMBER: "foliplus-style-fill-opacity-number",
  /** Fill mode block: the mode row plus the active arm's detail rows.
   *  The block is the row's DOM root; detail rows are separate FORM_ROWs so
   *  the label column stays aligned without indentation. */
  STYLE_FILL_BLOCK: "foliplus-style-fill-block",
  STYLE_FILL_MODE_SELECT: "foliplus-style-fill-mode-select",
  STYLE_FILL_DETAIL: "foliplus-style-fill-detail",
  /** Ramp detail controls (color-by-value arm): field, method, class count
   *  and the shared scheme trigger. All four are native selects / the shared
   *  picker trigger, the same controls the heatmap panel offers. */
  STYLE_FILL_FIELD_SELECT: "foliplus-style-fill-field-select",
  STYLE_FILL_METHOD_SELECT: "foliplus-style-fill-method-select",
  STYLE_FILL_CLASSES_SELECT: "foliplus-style-fill-classes-select",
  STYLE_FILL_SCHEME_TRIGGER: "foliplus-style-scheme-trigger",
  STYLE_FILL_SCHEME_BAR: "foliplus-style-scheme-bar",
  STYLE_FILL_SCHEME_HIDDEN: "foliplus-scheme-picker-hidden",
  /** Size row (CircleMarker only): a number field plus its unit suffix. Its
   *  own class so the change delegation and the tests can tell it from the
   *  label-size and border-weight number fields. */
  STYLE_SIZE_ROW: "foliplus-style-size-row",
  STYLE_SIZE_INPUT: "foliplus-style-size-input",
  /** Opacity row: the slider host, its class and the row hook. */
  STYLE_OPACITY_TRACK: "foliplus-style-opacity-track",
  STYLE_OPACITY_SLIDER: "foliplus-style-opacity-slider",
  /** Zoom-range row: a dual-thumb slider with a current-zoom marker.
   *
   *  The rail carries two textures and nothing else: the selected span is the
   *  accent fill, the rest is a transparency checkerboard — "the layer is not
   *  rendered there", the same convention the opacity row's checkerboard used.
   *  Integer tick marks were dropped with it: on an 8px rail a second texture
   *  only fights the first. */
  STYLE_ZOOM_RANGE_ROW: "foliplus-style-zoom-range-row",
  STYLE_ZOOM_RANGE_CONTROL: "foliplus-style-zoom-range-control",
  /** Marks the row when the map's current zoom falls outside the layer's
   *  range — a dimmed state that reads "you set this to hide at the current
   *  level" without hiding the row itself (the user may still want to change
   *  it). */
  STYLE_ZOOM_RANGE_OUT_OF_RANGE: "foliplus-zoom-range-out-of-range",
  /* ── Shared slider component (common/slider.css) ──
     Both range controls are this component; a row adds only its own hook
     class for behaviour and tests. Geometry, marks and numbers are declared
     once, inside the primitive. */
  SLIDER: "foliplus-slider",
  /** Shared form-row layout classes (also used by HeatmapControl template). */
  FORM_ROW: "foliplus-form-row",
  FORM_LABEL: "foliplus-form-label",
  FORM_CONTROL: "foliplus-form-control",
  TOGGLE_SWITCH: "foliplus-toggle-switch",
  TOGGLE_SLIDER: "foliplus-toggle-slider",
  ATTRS_PANEL: "foliplus-layer-attrs-panel",
  ATTRS_ICON: "foliplus-layer-attrs-icon",
  /** Floating filter panel opened from the layer overflow menu. */
  FILTER_PANEL: "foliplus-layer-filter-panel",
  /** Empty-state message inside the filter panel (no numeric fields). */
  FILTER_EMPTY: "foliplus-filter-empty",
  /** Header icon of the filter panel (a funnel glyph). */
  FILTER_ICON: "foliplus-layer-filter-icon",
  /** Read-only filter field name in the panel's field row. */
  FILTER_FIELD: "foliplus-filter-field",
  /** Host element of the shared dual-thumb Slider in the range row. */
  FILTER_SLIDER: "foliplus-filter-slider",
  /** Live "kept / total" readout (aria-live=polite). */
  FILTER_RESULT: "foliplus-filter-result",
  /** Clear-filter footer button. */
  FILTER_CLEAR: "foliplus-filter-clear",
  /** Enum filter body: the dimension cell that stacks its name and trigger. */
  FILTER_ENUM: "foliplus-filter-enum",
  /** Enum trigger button; the shared form-select recipe paints the control. */
  FILTER_ENUM_TRIGGER: "foliplus-filter-enum-trigger",
  /** Enum option listbox (a transient popup inside the dimension cell). */
  FILTER_ENUM_LIST: "foliplus-filter-enum-list",
  /** One option row inside the enum listbox. */
  FILTER_ENUM_OPTION: "foliplus-filter-enum-option",
  /** Leading checkmark slot of an enum option. */
  FILTER_ENUM_CHECK: "foliplus-filter-enum-check",
  /** Label text of an enum option. */
  FILTER_ENUM_LABEL: "foliplus-filter-enum-label",
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
  /** Opens the layer's filter panel. Hidden on rows that do not
   *  declare the filter capability (`filterProvider` + `filterSetter` —
   *  HeatmapControl today). */
  FILTER_LAYER: "filter-layer",
  ATTRS_LAYER: "layer-attributes",
  DELETE_LAYER: "delete-layer",
};

/** DOM selectors. */
const SEL = {
  LAYER_ITEM: ".foliplus-layer-item",
  TOGGLE_ALL: ".foliplus-layer-toggle-all",
  COUNT_COL: ".foliplus-layer-count",
  /** Any cursor-recipe row (data item or the fold/toggle-all row). Child
   *  control focus (checkbox / more / fold) attributes to this via closest(). */
  ROW: ".foliplus-layer-item, .foliplus-layer-toggle-all",
  MENU_DELETE_LABEL: `.${CLASSES.MENU_DELETE_LABEL}`,
  SEPARATOR_LABEL: `.${CLASSES.SEPARATOR_LABEL}`,
};

/** Upper bound for a map and layer that declare no max zoom.

 *  One value for both the map's fallback ceiling and the slider's author-bound
 *  fallback: two different numbers would let the panel offer a range the map
 *  itself refuses. */
const AUTHOR_ZOOM_FALLBACK_MAX = 20;

/** Default annotation config for a layer (disabled). */
const DEFAULT_ANNOTATION = {
  show: false,
  field: "",
  color: DEFAULT_LABEL_COLOR,
  size: LABEL_SIZE.SIZE_DEFAULT,
  format: NUMBER_FORMAT.AUTO,
} as const;

export {
  ACTION,
  LABEL_PANE_PREFIX,
  AUTHOR_ZOOM_FALLBACK_MAX,
  CLASSES,
  COLOR,
  DATA,
  DEFAULT_ANNOTATION,
  DRAG,
  ENFORCE_ORDER_DEBOUNCE_MS,
  FOCUS,
  FOCUS_PANE,
  RAMP,
  SAVE_DEBOUNCE_MS,
  SEL,
  SIZE,
  SOLID_BASEMAP_ID,
  STORAGE,
};

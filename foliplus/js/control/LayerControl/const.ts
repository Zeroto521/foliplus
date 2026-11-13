import { FOCUS_Z, LABEL_PANE_PREFIX } from "#core/layer/index.js";
import { NUMBER_FORMAT } from "#platform/format.js";
import { DEFAULT_LABEL_COLOR, LABEL_CLASS, LABEL_SIZE } from "#ui/index.js";

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
 *  `ValueConfig` always wins); the class-count vocabulary lives in
 *  #core/classify and is imported where it is used. */
const FILL_VALUE = {
  METHOD_DEFAULT: "jenks",
  SCHEME_DEFAULT: "Viridis",
  /** The qualitative palette an *inferred* categorical fill falls back to when
   *  the author named no scheme. Only the inference path uses it: an explicit
   *  `kind: "category"` still hard-rejects without a scheme, and a declared
   *  scheme (on either mode) is the author's choice and is kept verbatim. Set3
   *  is the qualitative default CATEGORY_SCHEMES offers. */
  CATEGORY_SCHEME_DEFAULT: "Set3",
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
  /** Set on a leaf hidden by the generic data-layer filter (path element /
   *  marker icon + shadow). CSS `display:none` removes it from paint AND from
   *  hit-testing, and ExportControl's SVG/marker channels skip it via computed
   *  display — one class write instead of a per-leaf style loop. */
  FILTER_HIDDEN: "foliplus-feature-filtered",
  MORE_BTN: "foliplus-layer-more-btn",
  MORE_MENU: "foliplus-layer-more-menu",
  TOGGLE_ALL: "foliplus-layer-toggle-all",
  /** The section header's "clean empty folders" button. A native <button> so keyboard users Tab to it; rendered only while the section owns at least one empty folder key. */
  CLEAN_FOLDERS_BTN: "foliplus-layer-clean-folders",
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
  STYLE_RESET_BTN: "foliplus-style-reset-btn",
  STYLE_FORMAT_ROW: LABEL_CLASS.STYLE_FORMAT_ROW,
  STYLE_FORMAT_SELECT: LABEL_CLASS.STYLE_FORMAT_SELECT,
  STYLE_TOGGLE_INPUT: LABEL_CLASS.STYLE_TOGGLE_INPUT,
  STYLE_BODY: LABEL_CLASS.STYLE_BODY,
  /** The Label section's row wrapper — the `label` dimension's `row`
   *  element (toggle + body), so the panel assembly and the tests can
   *  select the section's content as one unit. No styles hang off it. */
  STYLE_LABEL_SECTION: "foliplus-style-label-section",
  STYLE_LABEL_COLOR_INPUT: LABEL_CLASS.STYLE_LABEL_COLOR_INPUT,
  STYLE_LABEL_SIZE_INPUT: LABEL_CLASS.STYLE_LABEL_SIZE_INPUT,
  /** Border row (vector layers): stroke swatch + width field. Each control
   *  gets its own class so the panel's change delegation and the tests can
   *  tell it apart from the label color swatch. */
  STYLE_BORDER_ROW: "foliplus-style-border-row",
  STYLE_BORDER_COLOR_INPUT: "foliplus-style-border-color-input",
  STYLE_BORDER_WEIGHT_INPUT: "foliplus-style-border-weight-input",
  /** Border mode block: the mode row plus the active mode's detail rows —
   *  the same block/detail shape as the fill mode block, so the two rows
   *  read identically. The mode select is three-state on a line (original /
   *  single / by value) and two-state on polygon/point (original / single),
   *  and the detail rows reuse the STYLE_FILL_* control classes
   *  (they describe the control shape, not the dimension). */
  STYLE_BORDER_MODE_SELECT: "foliplus-style-border-mode-select",
  STYLE_BORDER_DETAIL: "foliplus-style-border-detail",
  STYLE_BORDER_BLOCK: "foliplus-style-border-block",

  /** The "avoid overlap" switch — its own class, because the panel's change
   *  delegation keys on the class to tell the two switches apart. */
  STYLE_COLLIDE_INPUT: LABEL_CLASS.STYLE_COLLIDE_INPUT,
  /** Fill color row (vector layers): swatch + native <input type=color>.
   *  Its own class so the change delegation can tell it from the label
   *  color swatch, and so a future delegated drawer can gate on it. */
  STYLE_FILL_ROW: "foliplus-style-fill-row",
  STYLE_FILL_COLOR_INPUT: "foliplus-style-fill-color-input",
  STYLE_FILL_OPACITY_NUMBER: "foliplus-style-fill-opacity-number",
  /** Fill mode block: the mode row plus the active mode's detail rows.
   *  The block is the row's DOM root; detail rows are separate FORM_ROWs so
   *  the label column stays aligned without indentation. */
  STYLE_FILL_BLOCK: "foliplus-style-fill-block",
  STYLE_FILL_MODE_SELECT: "foliplus-style-fill-mode-select",
  STYLE_FILL_DETAIL: "foliplus-style-fill-detail",
  /** The original-colors mode's read-only detail: the author's column, their
   *  colors as one ordered gradient and their count, on the same
   *  label/control grid the by-value mode uses. `READONLY` is the shared box
   *  frame (a form control without a chevron, focus or pointer affordance), so
   *  a readout lands on the same column edge as the select it replaces and
   *  carries no hover/active feedback. */
  STYLE_FILL_READONLY: "foliplus-style-fill-readonly",
  STYLE_FILL_ORIGINAL_COLUMN: "foliplus-style-fill-original-column",
  STYLE_FILL_ORIGINAL_COLORS: "foliplus-style-fill-original-colors",
  STYLE_FILL_ORIGINAL_STRIP: "foliplus-style-fill-original-strip",
  STYLE_FILL_ORIGINAL_COUNT: "foliplus-style-fill-original-count",
  STYLE_FILL_ORIGINAL_METHOD: "foliplus-style-fill-original-method",
  STYLE_FILL_ORIGINAL_VALUE: "foliplus-style-fill-original-value",
  /** Ramp detail controls (color-by-value mode): field, method, class count
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
  STYLE_ICON_ROW: "foliplus-style-icon-row",
  STYLE_MODE_BLOCK: "foliplus-style-mode-block",
  /** The style panel header icon (a sliders glyph). */
  STYLE_ICON_CLASS: "foliplus-layer-style-icon",
  STYLE_ICON_COLOR_ROW: "foliplus-style-icon-color-row",
  /** The opacity number field on the icon-color row — its own class so the
   *  shared number-field commit handler and the tests can tell it from the
   *  fill-opacity and size fields. */
  STYLE_ICON_COLOR_OPACITY_NUMBER: "foliplus-style-icon-color-opacity-number",
  STYLE_MARKER_COLOR_ROW: "foliplus-style-marker-color-row",
  STYLE_MARKER_COLOR_OPACITY_NUMBER: "foliplus-style-marker-color-opacity-number",
  /** The icon row's trigger button (shows the current glyph or 「原始」). */
  STYLE_ICON_TRIGGER: "foliplus-style-icon-trigger",
  STYLE_ICON_TRIGGER_GLYPH: "foliplus-style-icon-trigger-glyph",
  STYLE_ICON_TRIGGER_NAME: "foliplus-style-icon-trigger-name",
  /** The trigger's unavailable state (a syntactically valid name the loaded
   *  stylesheet does not paint, or a name that fails syntax). */
  STYLE_ICON_TRIGGER_UNAVAILABLE: "foliplus-style-icon-trigger-unavailable",
  /** The dashed-outline circle shown as the glyph preview in the unavailable
   *  state — a bare span (no FontAwesome glyph to paint), drawn by CSS. */
  STYLE_ICON_UNAVAILABLE_GLYPH: "foliplus-style-icon-unavailable-glyph",
  /** The glyph grid popup. */
  STYLE_ICON_GRID: "foliplus-style-icon-grid",
  /** One glyph cell in the grid. */
  STYLE_ICON_CELL: "foliplus-style-icon-cell",
  /** The selected cell's highlight. */
  STYLE_ICON_CELL_SELECTED: "foliplus-style-icon-cell-selected",
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
     once, inside the primitive; the root name itself is owned by
     ui/sliderClassName. */
  ATTRS_PANEL: "foliplus-layer-attrs-panel",
  ATTRS_ICON: "foliplus-layer-attrs-icon",
  /** Floating filter panel opened from the layer overflow menu. */
  FILTER_PANEL: "foliplus-layer-filter-panel",
  /** Empty-state message inside the filter panel (no numeric fields). */
  FILTER_EMPTY: "foliplus-filter-empty",
  /** Header icon of the filter panel (a funnel glyph). */
  FILTER_ICON: "foliplus-layer-filter-icon",
  /** The filter field row's read-only value: the dimension's field name, in
   *  the style panel's read-only box frame (STYLE_FILL_READONLY) so the control
   *  column matches every other row's. */
  FILTER_FIELD_VALUE: "foliplus-filter-field-value",
  /** Read-only filter field name in the panel's field row. */
  FILTER_FIELD: "foliplus-filter-field",
  /** Host element of the shared dual-thumb Slider in the range row. */
  FILTER_SLIDER: "foliplus-filter-slider",
  /** Live "kept / total" readout (aria-live=polite). */
  FILTER_RESULT: "foliplus-filter-result",
  /** Clear-filter footer button. */
  FILTER_CLEAR: "foliplus-filter-clear",
  /** Enum filter body: the cell that hosts the shared multiple dropdown. */
  FILTER_ENUM: "foliplus-filter-enum",
  /** Truncation hint under the enum dropdown (large discrete domain). */
  FILTER_ENUM_HINT: "foliplus-filter-enum-hint",
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
  /** Explicitly delete the folder block a row belongs to. The row's layer keeps its folder until this fires; then every member is promoted to root and the folder key is removed. data-action value only — the menu renders the entry when the row's layer has a folder. */
  DELETE_FOLDER: "delete-folder",
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
  CLEAN_FOLDERS: `.${CLASSES.CLEAN_FOLDERS_BTN}`,
};

/** Upper bound for a map and layer that declare no max zoom.

 *  One value for both the map's fallback ceiling and the slider's author-bound
 *  fallback: two different numbers would let the panel offer a range the map
 *  itself refuses. */
const AUTHOR_ZOOM_FALLBACK_MAX = 20;

/** Default label config for a layer (disabled). */
const DEFAULT_LABEL = {
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
  DEFAULT_LABEL,
  DRAG,
  ENFORCE_ORDER_DEBOUNCE_MS,
  FOCUS,
  FOCUS_PANE,
  FILL_VALUE,
  SAVE_DEBOUNCE_MS,
  SEL,
  SIZE,
  SOLID_BASEMAP_ID,
  STORAGE,
};

// HeatmapControl constants — independent named exports, consumed via
// ``import * as CONST`` so callers keep the ``CONST.X`` access pattern.
// Only pure static constants live here; CONF-derived values are accessed
// via ``CONF.*`` directly in the consuming code.

const TIMING = {
  ZOOM_DEBOUNCE: 200,
  LAYER_SCAN_DEBOUNCE: 200,
  SCHEME_DROPDOWN_BLUR_DELAY: 150,
};

const GRAY = "#999";

const H3 = {
  RES_MAP: [
    [2, 0],
    [3, 1],
    [4, 1],
    [5, 2],
    [6, 3],
    [7, 4],
    [8, 4],
    [9, 5],
    [10, 6],
    [11, 6],
    [12, 7],
    [13, 7],
    [14, 8],
    [15, 9],
    [16, 9],
    [17, 10],
    [18, 11],
    [19, 11],
    [20, 12],
  ],
  RES_FALLBACK: 12,
};

const ID = "foliplus_heatmap";

const AGG = {
  DEFAULT: CONF.agg,
  COUNT: "count",
  SUM: "sum",
  AVG: "avg",
  MIN: "min",
  MAX: "max",
};

const METHOD = {
  DEFAULT: CONF.method ?? "jenks",
  JENKS: "jenks",
  QUANTILE: "quantile",
  EQUAL: "equal",
  HEADS: "heads",
};

const CLASS_COUNT = {
  MIN: 2,
  MAX: 9,
  DEFAULT: 6,
};

const BORDER = {
  WEIGHT_MIN: 0,
  WEIGHT_MAX: 10,
  WEIGHT_STEP: 0.5,
  WEIGHT_DEFAULT: 1,
};

/** Hex-label typography bounds. Mirrors Python `label_size: PositiveInt`. */
const LABEL = {
  SIZE_MIN: 6,
  SIZE_MAX: 32,
  SIZE_STEP: 1,
  SIZE_DEFAULT: 11,
  COLOR_DEFAULT: "#ffffff",
};

const CLASSES = {
  HIDDEN: "foliplus-hidden",
  COLLAPSED: "collapsed",
  EXPANDED: "expanded",
  ACTIVE: "active",
  PLACEHOLDER_OPTION: "foliplus-heatmap-placeholder-opt",
  SCHEME_DROPDOWN_ITEM: "foliplus-heatmap-scheme-dropdown-item",
  SECTION_HEADING: "foliplus-heatmap-section-heading",
  SECTION_BLOCK: "foliplus-heatmap-section-block",
  SECTION_BLOCK_LAST: "foliplus-heatmap-section-block-last",
  CONFIG_BODY: "foliplus-heatmap-config-body",
  EXTRA_BODY: "foliplus-heatmap-extra-body",
  FIELD: "foliplus-heatmap-field",
  SCHEME_BAR: "foliplus-heatmap-scheme-bar",
  SCHEME_BAR_OPEN: "foliplus-heatmap-scheme-bar-open",
  SCHEME_BAR_INNER: "foliplus-heatmap-scheme-bar-inner",
  SCHEME_BAR_BLOCK: "foliplus-heatmap-scheme-bar-block",
  SCHEME_DROPDOWN: "foliplus-heatmap-scheme-dropdown",
  SCHEME_DROPDOWN_BAR: "foliplus-heatmap-scheme-dropdown-bar",
  BTN_ROW: "foliplus-heatmap-btn-row",
  BTN_CLEAR: "foliplus-heatmap-btn-clear",
  BORDER_COLOR_INPUT: "foliplus-heatmap-color-input",
  BORDER_WEIGHT_INPUT: "foliplus-heatmap-weight-input",
  CLASS_COUNT_SELECT: "foliplus-heatmap-class-select",
  FORM_CONTROL_INLINE: "foliplus-heatmap-form-inline",
  SECTION_DIVIDER: "foliplus-section-divider",
  CLASS_PLACEHOLDER: "foliplus-heatmap-placeholder",
  HEATMAP_CTRL: "foliplus-heatmap-ctrl",
};

const SEL = {
  SCHEME_DROPDOWN_ITEM: ".foliplus-heatmap-scheme-dropdown-item",
  SCHEME_DROPDOWN_BAR: ".foliplus-heatmap-scheme-dropdown-bar",
  SCHEME_BAR: ".foliplus-heatmap-scheme-bar",
  SCHEME_BAR_INNER: ".foliplus-heatmap-scheme-bar-inner",
};

/** Persistent storage key for heatmap configuration. */
const STORAGE = { KEY: `foliplus_heatmap_${map.getContainer().id}` };

const DATA_ATTR = {
  LAYER: "data-heatmap-layer",
  EXTRA_BODY: "data-heatmap-extra-body",
  AGG: "data-heatmap-agg",
  FIELD: "data-heatmap-field",
  FIELD_SELECT: "data-heatmap-field-select",
  METHOD: "data-heatmap-method",
  CLASS_COUNT: "data-heatmap-class-count",
  SCHEME_CTRL: "data-heatmap-scheme-ctrl",
  SCHEME_HIDDEN: "data-heatmap-scheme-hidden",
  BORDER_COLOR: "data-heatmap-border-color",
  BORDER_WEIGHT: "data-heatmap-border-weight",
  LABEL_CHK: "data-heatmap-label-chk",
  LABEL_COLOR: "data-heatmap-label-color",
  LABEL_SIZE: "data-heatmap-label-size",
  LABEL_FORMAT: "data-heatmap-label-format",
  BTN_CLEAR: "data-heatmap-btn-clear",
};

export {
  AGG,
  BORDER,
  CLASS_COUNT,
  CLASSES,
  DATA_ATTR,
  GRAY,
  H3,
  ID,
  LABEL,
  METHOD,
  SEL,
  STORAGE,
  TIMING,
};

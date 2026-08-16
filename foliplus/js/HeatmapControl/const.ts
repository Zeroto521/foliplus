// HeatmapControl constants — independent named exports, consumed via
// ``import * as CONST`` so callers keep the ``CONST.X`` access pattern.
// Only pure static constants live here; CONF-derived values are accessed
// via ``CONF.*`` directly in the consuming code.

export const TIMING = {
  ZOOM_DEBOUNCE: 200,
  LAYER_SCAN_DEBOUNCE: 200,
  INIT_SCAN_ATTEMPTS: 8,
  INIT_SCAN_INTERVAL: 300,
  SCHEME_DROPDOWN_BLUR_DELAY: 150,
  LOAD_SCRIPT_RETRIES: 2,
  LOAD_SCRIPT_INTERVAL: 3000,
};

export const GRAY = "#999";

export const H3 = {
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

export const ID = "foliplus_heatmap";

/** Generate a namespaced layer ID for multi-instance support. */
export const generateId = (namespace?: string): string =>
  namespace ? `${ID}_${namespace}` : ID;

export const AGG = {
  DEFAULT: CONF.agg,
  COUNT: "count",
  SUM: "sum",
  AVG: "avg",
  MIN: "min",
  MAX: "max",
};

export const METHOD = {
  DEFAULT: CONF.method ?? "jenks",
  JENKS: "jenks",
  QUANTILE: "quantile",
  EQUAL: "equal",
  HEADS: "heads",
};

export const CLASS_COUNT = {
  MIN: 2,
  MAX: 9,
  DEFAULT: 6,
};

export const BORDER = {
  WEIGHT_MIN: 0,
  WEIGHT_MAX: 10,
  WEIGHT_STEP: 0.5,
  WEIGHT_DEFAULT: 1,
};

export const CLASSES = {
  FORM_ROW: "foliplus-heatmap-form-row",
  FORM_LABEL: "foliplus-heatmap-form-label",
  FORM_CONTROL: "foliplus-heatmap-form-control",
  FORM_SELECT: "foliplus-heatmap-form-select",
  HIDDEN: "hidden",
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
  BTN: "foliplus-heatmap-btn",
  BTN_ROW: "foliplus-heatmap-btn-row",
  BTN_CLEAR: "foliplus-heatmap-btn-clear",
  BTN_CONFIRM: "foliplus-heatmap-btn-confirm",
  TOGGLE_SWITCH: "foliplus-heatmap-toggle-switch",
  TOGGLE_SLIDER: "foliplus-heatmap-toggle-slider",
  BORDER_COLOR_INPUT: "foliplus-heatmap-color-input",
  BORDER_WEIGHT_INPUT: "foliplus-heatmap-weight-input",
  CLASS_COUNT_SELECT: "foliplus-heatmap-class-select",
  FORM_CONTROL_INLINE: "foliplus-heatmap-form-inline",
  SECTION_DIVIDER: "foliplus-section-divider",
  CLASS_PLACEHOLDER: "foliplus-heatmap-placeholder",
  HEATMAP_CTRL: "foliplus-heatmap-ctrl",
};

export const SEL = {
  SCHEME_DROPDOWN_ITEM: ".foliplus-heatmap-scheme-dropdown-item",
  SCHEME_DROPDOWN_BAR: ".foliplus-heatmap-scheme-dropdown-bar",
  SCHEME_BAR: ".foliplus-heatmap-scheme-bar",
  SCHEME_BAR_INNER: ".foliplus-heatmap-scheme-bar-inner",
  FORM_SELECT: ".foliplus-heatmap-form-select",
  FORM_LABEL: ".foliplus-heatmap-form-label",
};

export const HM_DATA_ATTR = {
  LAYER: "data-hm-layer",
  EXTRA_BODY: "data-hm-extra-body",
  AGG: "data-hm-agg",
  FIELD: "data-hm-field",
  FIELD_SELECT: "data-hm-field-select",
  METHOD: "data-hm-method",
  CLASS_COUNT: "data-hm-class-count",
  SCHEME_CTRL: "data-hm-scheme-ctrl",
  SCHEME_HIDDEN: "data-hm-scheme-hidden",
  BORDER_COLOR: "data-hm-border-color",
  BORDER_WEIGHT: "data-hm-border-weight",
  LABEL_CHK: "data-hm-label-chk",
  BTN_CLEAR: "data-hm-btn-clear",
  BTN_CONFIRM: "data-hm-btn-confirm",
};

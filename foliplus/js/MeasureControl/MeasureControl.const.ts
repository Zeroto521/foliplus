/** Timing / delay constants. */
export const TIMING = {
  CLICK_COOLDOWN: 300,
  FINALIZE_DELAY: 50,
  DEL_ICON_RETRY_DELAY: 50,
  SUPPRESS_HIDE_DELAY: 100,
};

/** Delete icon config. */
export const DEL_ICON = {
  RETRY_LIMIT: 10,
  DEFAULT_ANCHOR: [0, 0],
  MARKER_ANCHOR: [0, 24],
  SIZE: [0, 0],
  CHAR: "\u2715",
  CLASS: "foliplus-measure-del-icon",
  WRAP_CLASS: "foliplus-del-icon",
};

/** Measure node marker. */
export const MARKER = { RADIUS: 5 };

/** Center dot marker. */
export const CENTER_DOT = {
  SIZE: [12, 12],
  ANCHOR: [6, 6],
  CLASS: "foliplus-measure-center-dot",
  CLASS_FINAL: "foliplus-measure-center-dot final",
};

/** Label markers. */
export const LABEL = {
  DEFAULT_ANCHOR: [0, -10],
  RADIUS_ANCHOR: [0, 0],
  MID_ANCHOR: [0, 0],
  CENTROID_ANCHOR: [0, -10],
  SIZE: [0, 0],
  CLASS: "foliplus-measure-label",
  CLASS_RADIUS: "foliplus-measure-label-radius",
  CLASS_MID: "foliplus-measure-label-mid",
};

/** Formatting. */
export const FORMAT = {
  LAT_LNG_PRECISION: 6,
  KM_THRESHOLD: 1000,
  KM_DECIMALS: 1,
};

/** Z-index. */
export const Z_INDEX = { OFFSET: 11000 };

/** IDs and pane names. */
export const ID = "foliplus_measure";
export const PANES = { GRAPH: "measure_graph", LABEL: "measure_label" };

/** CSS class names. */
export const CLASSES = {
  LINE_DASHED: "foliplus-measure-line foliplus-measure-line-dashed",
  LINE_PREVIEW: "foliplus-measure-line foliplus-measure-line-preview",
  LINE_SOLID: "foliplus-measure-line foliplus-measure-line-solid",
  CIRCLE_PREVIEW: "foliplus-measure-circle foliplus-measure-circle-preview",
  CIRCLE_FINAL: "foliplus-measure-circle foliplus-measure-circle-final",
  POLYGON_FINAL: "foliplus-measure-line-solid foliplus-measure-polygon-final",
  NODE_FINAL: "foliplus-measure-node foliplus-measure-node-final",
  NODE_PREVIEW: "foliplus-measure-node foliplus-measure-node-preview",
  NODE_ORIGIN: "foliplus-measure-node foliplus-measure-node-origin",
  RIPPLE: "foliplus-measure-ripple",
  DASH_SWEEP: "foliplus-measure-dash-sweep",
  HIDDEN: "foliplus-measure-hidden",
  VISIBLE: "visible",
  ACTIVE: "active",
  MEASURING: "foliplus-measuring",
  COLLAPSED: "collapsed",
  EXPANDED: "expanded",
};

/** Toggle constants. */
export const TOGGLE = { RESET: "reset" };

/** Style property names. */
export const STYLE = { SWEEP_LENGTH: "--sweep-length" };

/** DOM selectors. */
export const SEL = {
  LABEL: ".foliplus-measure-label",
  DEL_ICON: ".foliplus-measure-del-icon",
  TOOL_BTN: ".foliplus-tool-btn",
};

/** Persistent storage key. */
export const STORAGE = { KEY: `foliplus_measure_${map.getContainer().id}` };

/** Mode names. */
export const MODE = {
  MARKER: "marker",
  DISTANCE: "distance",
  POLYGON: "polygon",
  CIRCLE: "circle",
  CLEAR: "clear",
};

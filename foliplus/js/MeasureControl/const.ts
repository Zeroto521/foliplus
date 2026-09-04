import {
  DEL_ICON_CHAR,
  DEL_ICON_SELECTOR,
  DEL_ICON_Z_OFFSET,
} from "#common/delicon.js";

/** Timing / delay constants. */
export const TIMING = {
  CLICK_COOLDOWN: 300,
  FINALIZE_DELAY: 50,
};

/** Measure node marker. */
export const MARKER = { RADIUS: 5 };

/** Center dot marker. */
export const CENTER_DOT = {
  SIZE: [12, 12],
  ANCHOR: [6, 6],
  CLASS: "foliplus-measure-center-dot",
};

/** Label markers. */
export const LABEL = {
  DEFAULT_ANCHOR: [0, -10],
  RADIUS_ANCHOR: [0, 0],
  MID_ANCHOR: [0, 0],
  // The centroid label and the 12×12 center dot share a latlng and BOTH live
  // in the label pane (isLabel). The dot needs to clear the polygon fill,
  // which sits in the graph pane — a semi-transparent fill over the dot hides
  // the hit target and makes it ungrabable in edit mode, so the dot stays
  // above the fill via CENTROID_DOT_Z_OFFSET within the label pane. The label
  // then sits above the dot by the offset delta so the chip stays readable.
  // The [0, -10] anchor lifts the chip above the dot's centered position.
  CENTROID_ANCHOR: [0, -10],
  // Baseline offset for the centroid dot inside the label pane. Above the max
  // viewport Y (sortLayers assigns each icon z = screen Y, so this clears
  // every segment label) and below the del icon (11000).
  CENTROID_DOT_Z_OFFSET: 1500,
  // Delta above the dot's offset: keeps the area label above the dot AND above
  // segment labels within the label pane. The label is interactive:false, so
  // it never steals the dot's drag target.
  CENTROID_Z_OFFSET: 1800,
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
export const Z_INDEX = { OFFSET: DEL_ICON_Z_OFFSET };

/** IDs and pane names. */
export const ID = "foliplus_measure";
export const PANES = { GRAPH: "measure_graph", LABEL: "measure_label" };

/** CSS class names. */
export const CLASSES = {
  // Three path states shared by lines, circles, and polygons.
  PATH_SOLID: "foliplus-measure-path foliplus-measure-path-solid",
  PATH_DASHED: "foliplus-measure-path foliplus-measure-path-dashed",
  PATH_PREVIEW: "foliplus-measure-path foliplus-measure-path-preview",
  // Fill modifier for area shapes (circle/polygon).
  SHAPE_FILL: "foliplus-measure-shape-fill",
  NODE_HOLLOW: "foliplus-measure-node",
  NODE_SOLID: "foliplus-measure-node foliplus-measure-node-solid",
  RIPPLE: "foliplus-measure-ripple",
  DASH_SWEEP: "foliplus-measure-dash-sweep",
  ACTIVE: "active",
  MEASURING: "foliplus-measuring",
  EDITING: "foliplus-measure-editing",
  COLLAPSED: "collapsed",
  EXPANDED: "expanded",
};

/** Style property names. */
export const STYLE = { SWEEP_LENGTH: "--sweep-length" };

/** DOM selectors. */
export const SEL = {
  LABEL: ".foliplus-measure-label",
  DEL_ICON: DEL_ICON_SELECTOR,
  TOOL_BTN: ".foliplus-tool-btn[data-mode]",
};

/** Persistent storage key. */
export const STORAGE = { KEY: `foliplus_measure_${map.getContainer().id}` };

/** Export formats. */
export const EXPORT_FORMAT = {
  GEOJSON: "geojson",
  CSV: "csv",
} as const;

export type ExportFormat = (typeof EXPORT_FORMAT)[keyof typeof EXPORT_FORMAT];

/** Standard GeoJSON type names (RFC 7946). */
export const GEOJSON = {
  FEATURE: "Feature",
  FEATURE_COLLECTION: "FeatureCollection",
  POINT: "Point",
  LINE_STRING: "LineString",
  POLYGON: "Polygon",
} as const;

/** Mode names. */
export const MODE = {
  MARKER: "marker",
  DISTANCE: "distance",
  POLYGON: "polygon",
  CIRCLE: "circle",
  EDIT: "edit",
  CLEAR: "clear",
};

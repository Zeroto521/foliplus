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
  // The centroid label and the 12×12 center dot share a latlng AND the label
  // pane, so their stacking must come from zIndexOffset rather than pane
  // order: a graph→label split depended on enforceOrder keeping the label
  // pane above the graph pane, and a low-z layer in the list could demote it
  // back down, burying the dot under the fill. Same-pane offsets can't.
  // The [0, -10] anchor lifts the chip above the dot's centered position.
  CENTROID_ANCHOR: [0, -10],
  // Modest offset (above max viewport Y ≈ 900, below the dot's dotZOffset and
  // the del icon's 11000) that keeps the area label above the center dot and
  // above segment labels within the label pane after sortLayers re-sorts by Y
  // on zoom.
  CENTROID_Z_OFFSET: 2000,
  // Center dot. Same label pane as the chip, lower offset — the chip always
  // wins, regardless of DOM order. Deliberately not the del icon's 11000, so
  // the ✕ keeps floating on top when the del row is shown.
  dotZOffset: 1000,
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

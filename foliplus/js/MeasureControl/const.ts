import {
  DEL_ICON_CHAR,
  DEL_ICON_SELECTOR,
  DEL_ICON_Z_OFFSET,
} from "#common/delicon.js";

/** Timing / delay constants. */
const TIMING = {
  CLICK_COOLDOWN: 300,
  FINALIZE_DELAY: 50,
};

/** Measure node marker. */
const MARKER = { RADIUS: 5 };

/** Center dot marker. */
const CENTER_DOT = {
  SIZE: [12, 12],
  ANCHOR: [6, 6],
  CLASS: "foliplus-measure-center-dot",
};

/** Label markers. */

/** Label markers. */
const LABEL = {
  DEFAULT_ANCHOR: [0, -10],
  RADIUS_ANCHOR: [0, 0],
  MID_ANCHOR: [0, 0],
  // The centroid label shares the same latlng as the 12×12 center dot. The
  // dot goes to measure_graph (no isLabel flag) — same as node markers. The
  // label is isLabel (measure_label, z=621 above graph z=620), so it always
  // paints above the dot by pane ordering.
  // The [0, -10] anchor lifts the chip above the dot's centered position.
  // Within the label pane it also needs a zIndexOffset (CENTROID_Z_OFFSET)
  // so it stays above segment labels — sortLayers re-sorts by Y on zoom,
  // which can push a lower-Y segment label over the area label.
  CENTROID_ANCHOR: [0, -10],
  // Modest offset (above max viewport Y ≈ 900, below del icon 11000) that
  // keeps the area label above segment labels within the label pane after
  // sortLayers re-sorts by Y on zoom, without reaching other panes.
  CENTROID_Z_OFFSET: 2000,
  SIZE: [0, 0],
  CLASS: "foliplus-measure-label",
  CLASS_RADIUS: "foliplus-measure-label-radius",
  CLASS_MID: "foliplus-measure-label-mid",
};

/** Label collision priority — the lowest values are hidden first when labels
 *  overlap heavily. Segment labels are the most numerous (a dense polygon
 *  stacks dozens of them), so they give way to the unique centroid / radius
 *  value first. */
const LABEL_PRIORITY = {
  SEGMENT: 60,
  CENTROID: 80,
  RADIUS: 80,
};

/** Formatting. */
const FORMAT = {
  LAT_LNG_PRECISION: 6,
  KM_THRESHOLD: 1000,
  KM_DECIMALS: 1,
};

/** Z-index. */
const Z_INDEX = { OFFSET: DEL_ICON_Z_OFFSET };

/** IDs and pane names. */
const ID = "foliplus_measure";
const PANES = { GRAPH: "measure_graph", LABEL: "measure_label" };

/** CSS class names. */
const CLASSES = {
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
const STYLE = { SWEEP_LENGTH: "--sweep-length" };

/** DOM selectors. */
const SEL = {
  LABEL: ".foliplus-measure-label",
  DEL_ICON: DEL_ICON_SELECTOR,
  TOOL_BTN: ".foliplus-tool-btn[data-mode]",
};

/** Persistent storage key. */
const STORAGE = { KEY: `foliplus_measure_${map.getContainer().id}` };

/** Export formats. */
const EXPORT_FORMAT = {
  GEOJSON: "geojson",
  CSV: "csv",
} as const;

type ExportFormat = (typeof EXPORT_FORMAT)[keyof typeof EXPORT_FORMAT];

/** Standard GeoJSON type names (RFC 7946). */
const GEOJSON = {
  FEATURE: "Feature",
  FEATURE_COLLECTION: "FeatureCollection",
  POINT: "Point",
  LINE_STRING: "LineString",
  POLYGON: "Polygon",
} as const;

/** Mode names. */
const MODE = {
  MARKER: "marker",
  DISTANCE: "distance",
  POLYGON: "polygon",
  CIRCLE: "circle",
  EDIT: "edit",
  CLEAR: "clear",
};

export {
  TIMING,
  MARKER,
  CENTER_DOT,
  LABEL,
  LABEL_PRIORITY,
  FORMAT,
  Z_INDEX,
  ID,
  PANES,
  CLASSES,
  STYLE,
  SEL,
  STORAGE,
  EXPORT_FORMAT,
  type ExportFormat,
  GEOJSON,
  MODE,
};

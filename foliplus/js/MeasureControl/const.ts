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
  // The centroid/circle-center dot is a 12×12 filled circle centered on the
  // point. The label is anchored at the dot's center; lift it ~22px so its
  // bottom edge clears the dot's top edge (6px dot radius above center) and
  // the label never visually overlaps the solid dot. This spatial separation
  // is preferred over z-index tricks, which do not reliably beat the dot.
  // With iconAnchor [0, +22]: the anchor point sits 22px below the label's
  // top-left, so the label renders above the point. Use 30px so the label's
  // bottom edge clears the dot's top edge (6px dot radius) plus the label
  // height (~20px) plus a small visual gap.
  CENTROID_ANCHOR: [0, 30],
  SIZE: [0, 0],
  CLASS: "foliplus-measure-label",
  CLASS_RADIUS: "foliplus-measure-label-radius",
  CLASS_MID: "foliplus-measure-label-mid",
};

/** Label collision priority — the lowest values are hidden first when labels
 *  overlap heavily. Segment labels are the most numerous (a dense polygon
 *  stacks dozens of them), so they give way to the unique centroid / radius
 *  value first. */
export const LABEL_PRIORITY = {
  SEGMENT: 60,
  CENTROID: 80,
  RADIUS: 80,
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

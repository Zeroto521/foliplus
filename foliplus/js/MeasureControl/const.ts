import { DEL_ICON_CHAR, DEL_ICON_SELECTOR } from "#common/delicon.js";

/** Timing / delay constants. */
const TIMING = {
  CLICK_COOLDOWN: 300,
  FINALIZE_DELAY: 50,
};

/** Measure node marker. */
const MARKER = { RADIUS: 5 };

/** Label markers. */
const LABEL = {
  DEFAULT_ANCHOR: [0, -10],
  RADIUS_ANCHOR: [0, 0],
  MID_ANCHOR: [0, 0],
  // The centroid label shares the same latlng as the center dot. The dot is
  // a CircleMarker (SVG path) in measure_graph, so it shares the SVG renderer
  // with the fill and needs no zIndexOffset — DOM order guarantees paint
  // order. The label is isLabel (measure_label, z = graph + 1), so it always
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
  CLASS_READOUT: "foliplus-measure-readout",
  CLASS_LABEL: "foliplus-measure-readout-label",
  CLASS_COORD: "foliplus-measure-coord",
};

/** Label collision priority — the lowest values are hidden first when labels
 *  overlap heavily. Segment labels are the most numerous (a dense polygon
 *  stacks dozens of them), so they give way to the unique centroid / radius
 *  value first. */
const LABEL_PRIORITY = {
  SEGMENT: 60,
  /** The distance mode's final label also carries the cumulative total. */
  TOTAL: 70,
  CENTROID: 80,
  RADIUS: 80,
};

/** Formatting. */
const FORMAT = {
  LAT_LNG_PRECISION: 6,
  KM_THRESHOLD: 1000,
  // Area gets one extra digit: the unit conversion squares, so error grows
  // faster and a 2nd digit carries real information.
  // 0 decimals for the small-unit branches: they cap below the threshold, so a
  // fractional digit would read as false precision.
  SMALL_DECIMALS: 0,
  KM_DECIMALS: 1,
  KM2_DECIMALS: 2,
};

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
  COORD_LABEL: ".foliplus-measure-coord",
};

/** Persistent storage key. */
const STORAGE = { KEY: `foliplus_measure_${map.getContainer().id}` };

/** Export formats. */
const EXPORT_FORMAT = {
  GEOJSON: "geojson",
  CSV: "csv",
} as const;

type ExportFormat = (typeof EXPORT_FORMAT)[keyof typeof EXPORT_FORMAT];

/** Default format for `CONF.export_format` — used when the value is missing
 * or unknown. Python's `MeasureControl` rejects anything outside
 * `EXPORT_FORMAT`, so this only guards misconfiguration. */
const DEFAULT_EXPORT_FORMAT: ExportFormat = EXPORT_FORMAT.GEOJSON;

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
  LABEL,
  LABEL_PRIORITY,
  FORMAT,
  ID,
  PANES,
  CLASSES,
  STYLE,
  SEL,
  STORAGE,
  EXPORT_FORMAT,
  DEFAULT_EXPORT_FORMAT,
  type ExportFormat,
  GEOJSON,
  MODE,
};

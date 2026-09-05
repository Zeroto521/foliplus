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
  // with the fill and needs no zIndexOffset — it is attached before the fill,
  // so DOM source order puts it above. The label is isLabel (measure_label,
  // z = graph + 1), so it always paints above the dot by pane ordering.
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

/** Cursor-following readout. The chip is anchored to the pointer exactly like
 *  the area label is anchored to the centroid dot — centered horizontally, its
 *  top edge `ANCHOR_GAP` px below the anchor, due south. `CLASS_FLIP` re-anchors
 *  it above the cursor when there is no room below. */
const READOUT = {
  ANCHOR_GAP: 10,
  CLASS_PREFIX: "foliplus-measure-readout",
  CLASS_FLIP: "foliplus-measure-readout-flip",
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
// `NODE` holds markers that must paint above the paths attached after them.
// The circle center is the only one routed there: within a single pane, paint
// order is DOM source order and the center is attached before the radius line
// that would otherwise cover it, so it needs its own pane rather than a later
// attach. The polygon centroid stays in `GRAPH` — it is attached before the
// fill, so source order already puts it on top, and sharing that renderer is
// what keeps it immune to `sortLayers`' z-index re-sort on zoom.
const PANES = {
  GRAPH: "measure_graph",
  NODE: "measure_node",
  LABEL: "measure_label",
};

/** CSS class names. */
const CLASSES = {
  // Three path states shared by lines, circles, and polygons.
  PATH_SOLID: "foliplus-measure-path foliplus-measure-path-solid",
  PATH_DASHED: "foliplus-measure-path foliplus-measure-path-dashed",
  PATH_PREVIEW: "foliplus-measure-path foliplus-measure-path-preview",
  // Fill modifier for area shapes (circle/polygon).
  SHAPE_FILL: "foliplus-measure-shape-fill",
  // Node fill states, parallel to PATH_SOLID / PATH_PREVIEW: a modifier that a
  // node marker always appends to the base, never a complete class list.
  NODE_HOLLOW: "foliplus-measure-node",
  NODE_SOLID: "foliplus-measure-node-solid",
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

/** Layer-attachment stack: the order a component adds graph layers so the
 *  SVG renderer paints them in the intended order. `L.SVG._update` clones an
 *  existing `<path>` into a new layer instead of creating one, and its
 *  `appendChild` on the path is unconditional, so any second attach
 *  (`addLayer`, `bringToFront`, `L.svg().addTo(map)`) throws
 *  `Element.appendChild` on a path that already holds one element and kills
 *  the whole renderer. Attaching each layer exactly once in this order is the
 *  structural guarantee; the order is the z-order — first is bottom, last is
 *  top — so a later sibling never covers an earlier one. Nodes are the final
 *  layer: they overlap the paths and the center dot is the only circle point
 *  that survives finalization, so it must stay on top. Labels are divIcon
 *  markers in a separate pane that already sits above this one, so they are
 *  outside the stack. */
const LAYER_STACK = ["shape", "radiusLine", "node"] as const;
type MeasureStack = (typeof LAYER_STACK)[number];

export {
  TIMING,
  MARKER,
  LABEL,
  READOUT,
  LABEL_PRIORITY,
  LAYER_STACK,
  type MeasureStack,
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

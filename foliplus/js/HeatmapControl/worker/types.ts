// Shared contracts for the HeatmapControl aggregation worker.
//
// `aggregate.ts` and `heatmap.worker.ts` live inside the worker bundle, and
// `manager.ts` lives in the component bundle.  They cannot import from each
// other: the worker bundle must stay free of `window.foliplus`, and the
// component bundle must not drag a second copy of h3 in.  This file is the
// shared type-only seam — it compiles to nothing in either bundle.
//
// Every type here is exported once, at the end of the file.
import type { Feature, Polygon } from "geojson";

/** A hexagon feature drawn on the heatmap canvas. */
type HexFeature = Feature<
  Polygon,
  {
    /** Aggregated value the hexagon represents. */
    value: number;
    /** Index of the break interval the value falls into. */
    classIdx: number;
    /** Fill color resolved from `classIdx` via the active color scheme. */
    fillColor: string;
    /** The h3 cell index the polygon belongs to. */
    h3: string;
    /** Cell centroid in `[lat, lng]`, or `null` when it could not be derived. */
    centroid: [number, number] | null;
  }
>;

/** A source point, projected to plain numbers before it crosses the worker
 *  boundary so no structured-clone of a Leaflet object is required. */
interface PointInput {
  lat: number;
  lng: number;
  value: number;
}

/** Message payload sent to the worker. */
interface AggregateMessage {
  point: PointInput[];
  res: number;
  agg: string;
  method: string;
  classes: number;
  colors: string[];
  /** Correlation id so a stale reply can be discarded after a settings change. */
  seq: number;
}

/** Message payload posted back from the worker. */
interface AggregateResult {
  seq: number;
  feature: HexFeature[];
}

/** The h3 surface `aggregate` needs.  `h3-js` accepts a string or a split
 *  long for a cell index; `aggregate` only ever passes back the string it
 *  got from `latLngToCell`, so string is the working contract. */
interface H3Api {
  latLngToCell: (lat: number, lng: number, res: number) => string;
  cellToLatLng: (h3: string) => number[];
  cellToBoundary: (h3: string, formatAsGeoJson?: boolean) => number[][];
}

export {
  type AggregateMessage,
  type AggregateResult,
  type H3Api,
  type HexFeature,
  type PointInput,
};

// Shared contracts for the HeatmapControl aggregation worker.
//
// `aggregate.ts` and `heatmap.worker.ts` live inside the worker bundle, and
// `manager.ts` lives in the component bundle.  They cannot import from each
// other: the worker bundle must stay free of `window.foliplus`, and the
// component bundle must not drag a second copy of h3 in.  This file is the
// shared type-only seam — it compiles to nothing in either bundle.
import type { Feature, Polygon } from "geojson";

/** A hexagon feature drawn on the heatmap canvas. */
export type HexFeature = Feature<
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
export interface PointInput {
  lat: number;
  lng: number;
  value: number;
}

/** Message payload sent to the worker. */
export interface AggregateMessage {
  pts: PointInput[];
  res: number;
  agg: string;
  method: string;
  numClasses: number;
  classColors: string[];
  /** Correlation id so a stale reply can be discarded after a settings change. */
  seq: number;
}

/** Message payload posted back from the worker. */
export interface AggregateResult {
  seq: number;
  features: HexFeature[];
}

/** The h3 surface `aggregate` needs — the vendor build in `h3-asm.js` is a
 *  strict superset of this. */
export interface H3Api {
  latLngToCell: (lat: number, lng: number, res: number) => string;
  cellToLatLng: (h3: string) => number[];
  cellToBoundary: (h3: string, ...args: unknown[]) => number[][];
}

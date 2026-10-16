// core/geo/type — shared geometric shapes.
// Pure types: the input/output contracts of the geodesic helpers and their
// callers. Lives beside `geodesic.ts` and `coord.ts` so modules outside
// core/geo (ExportControl session/persistence/manager for GeoBounds;
// ExportControl type for LatLngPoint) can import them without pulling
// value code in.
/** WGS-84 point: longitude first, latitude second (matches Leaflet's
 *  `LatLng` pair convention used by turf). */
interface LatLngPoint {
  lng: number;
  lat: number;
}

/** Geo bounds with northwest and southeast corners. */
interface GeoBounds {
  nw: LatLngPoint;
  se: LatLngPoint;
}

/** Screen-space rectangle (top-left origin). */
interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type { GeoBounds, LatLngPoint, Rect };

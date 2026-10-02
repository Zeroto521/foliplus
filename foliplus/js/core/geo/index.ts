// core/geo — coordinate systems & geodesic geometry (pure logic, no CONFIG/DOM).
export { COORD_BOUNDS, fromWgs84, getMapCrsType, toWgs84 } from "./coord.js";
export { area, bearing, boundsToRect, centroid, distance, midpoint } from "./geo.js";
export type { GeoBounds, LatLngPoint, Rect } from "./geo.js";

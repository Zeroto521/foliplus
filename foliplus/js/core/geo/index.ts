// core/geo — coordinate systems & geodesic geometry (pure logic, no CONF/DOM).
export { COORD_BOUNDS, fromWgs84, getMapCrsType, toWgs84 } from "./coord.js";
export { area, bearing, centroid, distance, midpoint } from "./geo.js";
export type { LatLngPoint } from "./geo.js";

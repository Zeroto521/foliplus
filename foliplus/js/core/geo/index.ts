// core/geo — coordinate systems & geodesic geometry (pure logic, no CONFIG/DOM).
export { COORD_BOUNDS, fromWgs84, getMapCrsType, toWgs84 } from "./coord.js";
export {
  area,
  areaCentroid,
  bearing,
  boundsToRect,
  distance,
  midpoint,
  vertexMean,
} from "./geodesic.js";
export type { GeoBounds, LatLngPoint, Rect } from "./type.js";

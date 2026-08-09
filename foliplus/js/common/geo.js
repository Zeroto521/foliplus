// Geodesic coordinate helpers (turf.js) — pure functions shared by components.
// Imported statically by components (谁用谁 import). `turf` and `L` are globals
// provided by the page (Leaflet + turf via CDN), as before.

/** Distance between two points in meters (turf.js geodesic).
 *  @param {Object} a - Point with lng/lat properties.
 *  @param {Object} b - Point with lng/lat properties. */
const distance = (a, b) => {
  return turf.distance(turf.point([a.lng, a.lat]), turf.point([b.lng, b.lat]), {
    units: "meters",
  });
};

/** Initial bearing (azimuth) from point a to point b, 0°–360° clockwise from north.
 *  Uses turf.js bearing. */
const bearing = (a, b) => {
  const bVal = turf.bearing(turf.point([a.lng, a.lat]), turf.point([b.lng, b.lat]));
  return (bVal + 360) % 360;
};

/** Geodesic midpoint between two points using turf.js.
 *  @param {Object} a - First point with lng/lat properties.
 *  @param {Object} b - Second point with lng/lat properties.
 *  @returns {L.LatLng} Midpoint LatLng. */
const midpoint = (a, b) => {
  const mid = turf.midpoint(turf.point([a.lng, a.lat]), turf.point([b.lng, b.lat]));
  return L.latLng(mid.geometry.coordinates[1], mid.geometry.coordinates[0]);
};

/** Centroid (arithmetic mean of vertices) of a polygon.
 *  @param {Array<{lng:number,lat:number}>} points - Array of coordinate objects.
 *  @returns {L.LatLng} Centroid LatLng. */
const centroid = (points) => {
  const cx = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.lng, 0) / points.length;
  return L.latLng(cx, cy);
};

/** Geodesic area of a polygon using turf.js.
 *  @param {Array<{lng:number,lat:number}>} points - Array of coordinate objects.
 *  @returns {number} Area in square meters. */
const area = (points) => {
  if (points.length < 3) return 0;
  const coords = points.map((p) => [p.lng, p.lat]);
  // Close the ring
  coords.push(coords[0]);
  return turf.area(turf.polygon([coords]));
};

export { area, bearing, centroid, distance, midpoint };

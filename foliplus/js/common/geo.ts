// Geodesic coordinate helpers (turf.js) — pure functions shared by components.
// Imported statically by components. `turf` and `L` are globals
// provided by the page (Leaflet + turf via CDN), as before.

export interface LatLngPoint {
  lng: number;
  lat: number;
}

/** Distance between two points in meters (turf.js geodesic). */
const distance = (a: LatLngPoint, b: LatLngPoint): number => {
  return turf.distance(turf.point([a.lng, a.lat]), turf.point([b.lng, b.lat]), {
    units: "meters",
  });
};

/** Initial bearing (azimuth) from point a to point b, 0°–360° clockwise from north. */
const bearing = (a: LatLngPoint, b: LatLngPoint): number => {
  const bVal = turf.bearing(turf.point([a.lng, a.lat]), turf.point([b.lng, b.lat]));
  return (bVal + 360) % 360;
};

/** Geodesic midpoint between two points using turf.js. */
const midpoint = (a: LatLngPoint, b: LatLngPoint): L.LatLng => {
  const mid = turf.midpoint(turf.point([a.lng, a.lat]), turf.point([b.lng, b.lat]));
  const coord = (mid.geometry as GeoJSON.Point).coordinates;
  return L.latLng(coord[1], coord[0]);
};

/** Centroid (arithmetic mean of vertices) of a polygon. */
const centroid = (points: LatLngPoint[]): L.LatLng => {
  const cx = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.lng, 0) / points.length;
  return L.latLng(cx, cy);
};

/** Geodesic area of a polygon using turf.js. */
const area = (points: LatLngPoint[]): number => {
  if (points.length < 3) return 0;
  const coords: number[][] = points.map(p => [p.lng, p.lat]);
  coords.push(coords[0]);
  return turf.area(turf.polygon([coords]));
};

export { area, bearing, centroid, distance, midpoint };

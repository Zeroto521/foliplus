// Geodesic coordinate helpers (turf.js) — pure functions shared by components.
// `turf` and `L` are globals provided by the page (Leaflet + turf via CDN).

interface LatLngPoint {
  lng: number;
  lat: number;
}

/** Geo bounds with northwest and southeast corners. */
interface GeoBounds {
  nw: LatLngPoint;
  se: LatLngPoint;
}

/** Screen-space rectangle. */
interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Convert geo bounds (nw/se) to a screen-space rect using the map's projection. */
const boundsToRect = (map: L.Map, bounds: GeoBounds): Rect => {
  const nw = map.latLngToContainerPoint(L.latLng(bounds.nw.lat, bounds.nw.lng));
  const se = map.latLngToContainerPoint(L.latLng(bounds.se.lat, bounds.se.lng));
  return {
    left: Math.min(nw.x, se.x),
    top: Math.min(nw.y, se.y),
    width: Math.abs(se.x - nw.x),
    height: Math.abs(se.y - nw.y),
  };
};

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

/** Arithmetic mean of vertices — a cheap approximation, NOT the mass center.
 *  Use `areaCentroid` for the area-weighted mass center of a polygon. */
const vertexMean = (points: LatLngPoint[]): L.LatLng => {
  const latSum = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lngSum = points.reduce((s, p) => s + p.lng, 0) / points.length;
  return L.latLng(latSum, lngSum);
};

/** Geodesic area of a polygon using turf.js. */
const area = (points: LatLngPoint[]): number => {
  if (points.length < 3) return 0;
  const coords: number[][] = points.map(p => [p.lng, p.lat]);
  coords.push(coords[0]);
  return turf.area(turf.polygon([coords]));
};

/** Area-weighted centroid of a Polygon or MultiPolygon (shoelace, holes net out). */
const areaCentroid = (geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): L.LatLng => {
  const polygons: GeoJSON.Position[][][] =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let totalArea = 0;
  let cx = 0;
  let cy = 0;
  for (const rings of polygons) {
    let polyArea = 0;
    let px = 0;
    let py = 0;
    for (const ring of rings) {
      let a = 0;
      let rx = 0;
      let ry = 0;
      for (let i = 0; i < ring.length; i++) {
        const [x0, y0] = ring[i];
        const [x1, y1] = ring[(i + 1) % ring.length];
        const cross = x0 * y1 - x1 * y0;
        a += cross;
        rx += (x0 + x1) * cross;
        ry += (y0 + y1) * cross;
      }
      polyArea += a;
      px += rx;
      py += ry;
    }
    if (polyArea === 0) continue;
    const cxAbs = px / (3 * polyArea);
    const cyAbs = py / (3 * polyArea);
    totalArea += Math.abs(polyArea);
    cx += cxAbs * Math.abs(polyArea);
    cy += cyAbs * Math.abs(polyArea);
  }
  if (totalArea === 0) return L.latLng(0, 0);
  return L.latLng(cy / totalArea, cx / totalArea);
};

export { area, areaCentroid, bearing, boundsToRect, distance, midpoint, vertexMean };
export type { GeoBounds, LatLngPoint, Rect };

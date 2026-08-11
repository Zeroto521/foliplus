// Coordinate transformation and CRS detection for foliplus components.
//
// Pure functions (no module-level state) — imported statically by components.
// The runtime geocoder (runtime.geocode.js) also imports these, which is fine:
// esbuild inlines a copy into runtime.min.js as well.
//
// These functions operate on Leaflet maps and coordinate systems.

type CrsType = "BD09" | "GCJ02" | "WGS84";

/**
 * Detect whether the map uses Baidu coordinate system (BD-09).
 * Checks L.CRS.Baidu, crs.code, and tile URL patterns.
 */
const isBaiduCRS = (map: any): boolean => {
  try {
    const crs = map.options.crs;
    if (L.CRS && L.CRS.Baidu && crs === L.CRS.Baidu) return true;
    if (crs && (crs.code || "").toLowerCase().includes("baidu")) return true;

    const layers = map._layers;
    for (const id in layers)
      if (layers[id]._url && layers[id]._url.includes("bdimg.com")) return true;

    return false;
  } catch (e) {
    return false;
  }
};

/**
 * Detect whether a map uses domestic Chinese tile providers.
 * Checks Baidu, AutoNavi, Tianditu, Tencent, Google, and AMap URL patterns.
 */
const isDomesticMap = (map: any): boolean => {
  try {
    const crs = map.options.crs;
    if (crs && (crs.code || "").toLowerCase().includes("baidu")) return true;
    const layers = map._layers;
    for (const id in layers) {
      if (layers[id]._url) {
        const url = layers[id]._url;
        if (
          url.includes("bdimg.com") ||
          url.includes("autonavi") ||
          url.includes("tianditu") ||
          url.includes("gtimg.com") ||
          url.includes("googleapis") ||
          url.includes("amap.com")
        )
          return true;
      }
    }
    return false;
  } catch (e) {
    return false;
  }
};

/**
 * Ensure that the gcoord library is loaded. If not, logs a warning.
 */
const ensureGcoord = (): boolean => {
  // gcoord_warn hint was removed in favor of console.warn because
  // the warning only triggers when the user places a geopoint on a
  // non-WGS84 map, which is an edge case that doesn't warrant a
  // persistent UI hint.  The console warning is sufficient for
  // developers to diagnose the missing dependency.
  if (typeof gcoord === "undefined") {
    console.warn(
      "[foliplus] gcoord library failed to load, coordinate transformation unavailable",
    );
    return false;
  }
  return true;
};

/**
 * Detect the map's coordinate reference system type: 'BD09', 'GCJ02', or 'WGS84'.
 */
const getMapCrsType = (map: any): CrsType => {
  if (isBaiduCRS(map)) return "BD09";
  if (isDomesticMap(map)) return "GCJ02";
  return "WGS84";
};

/**
 * Convert map-displayed coordinates (GCJ-02 / BD-09) to WGS-84.
 * Automatically detects the map CRS (Baidu → BD09, domestic → GCJ02).
 */
const toWgs84 = (map: any, lng: number, lat: number): number[] => {
  if (!ensureGcoord()) return [lng, lat];

  const srcType = getMapCrsType(map);
  if (srcType === "WGS84") return [lng, lat];

  const src = srcType === "BD09" ? gcoord.BD09 : gcoord.GCJ02;
  return gcoord.transform([lng, lat], src, gcoord.WGS84);
};

/**
 * Convert WGS-84 coordinates to the map's display CRS (BD09 / GCJ02).
 * Automatically detects the map CRS. Non-domestic maps are returned unchanged.
 */
const fromWgs84 = (map: any, lng: number, lat: number): number[] => {
  if (!ensureGcoord()) return [lng, lat];

  const dstType = getMapCrsType(map);
  if (dstType === "WGS84") return [lng, lat];

  const dst = dstType === "BD09" ? gcoord.BD09 : gcoord.GCJ02;
  return gcoord.transform([lng, lat], gcoord.WGS84, dst);
};

export { getMapCrsType, toWgs84, fromWgs84 };

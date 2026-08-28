// Coordinate transformation and CRS detection for foliplus components.
//
// Pure functions (no module-level state) — imported statically by components.
// The runtime geocoder (geocode.js) also imports these, which is fine:
// esbuild inlines a copy into runtime.min.js as well.
//
// These functions operate on Leaflet maps and coordinate systems.

type CrsType = "BD09" | "GCJ02" | "WGS84";

/** Check if any tile layer in the map has a URL matching one of the patterns. */
const hasTileUrlMatching = (map: L.Map | null, patterns: string[]): boolean => {
  try {
    const layers = map?._layers as Record<string, L.TileLayer> | undefined;
    if (!layers) return false;
    for (const id in layers) {
      const url = layers[id]?._url;
      if (url && patterns.some(p => url.includes(p))) return true;
    }
  } catch (_) {
    // Ignore errors from layer traversal.
  }
  return false;
}

/** Check if the map's CRS code contains a pattern (case-insensitive). */
const hasCrsCode = (map: L.Map | null, codePattern: string): boolean => {
  try {
    const crs = map?.options?.crs;
    if (!crs) return false;
    const code = crs.code || "";
    return code.toLowerCase().includes(codePattern.toLowerCase());
  } catch (_) {
    return false;
  }
}

/**
 * Detect whether the map uses Baidu coordinate system (BD-09).
 * Checks L.CRS.Baidu, crs.code, and tile URL patterns.
 */
const isBaiduCRS = (map: L.Map | null): boolean => {
  try {
    const LCRS = L.CRS as { Baidu?: L.CRS };
    if (LCRS && LCRS.Baidu && map?.options.crs === LCRS.Baidu) return true;
  } catch (_) {
    // L.CRS plugin may be unavailable (jsdom).
  }
  if (hasCrsCode(map, "baidu")) return true;
  return hasTileUrlMatching(map, ["bdimg.com"]);
};

/**
 * Detect whether a map uses domestic Chinese tile providers.
 * Checks Baidu, AutoNavi, Tianditu, Tencent, Google, and AMap URL patterns.
 */
const isDomesticMap = (map: L.Map | null): boolean => {
  if (isBaiduCRS(map)) return true;
  const domesticPatterns = [
    "autonavi",
    "tianditu",
    "gtimg.com",
    "googleapis",
    "amap.com",
  ];
  if (hasTileUrlMatching(map, domesticPatterns)) return true;
  if (hasCrsCode(map, "gcj02")) return true;
  return false;
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
const getMapCrsType = (map: L.Map | null): CrsType => {
  if (isBaiduCRS(map)) return "BD09";
  if (isDomesticMap(map)) return "GCJ02";
  return "WGS84";
};

/**
 * Convert map-displayed coordinates (GCJ-02 / BD-09) to WGS-84.
 * Automatically detects the map CRS (Baidu → BD09, domestic → GCJ02).
 */
const toWgs84 = (map: L.Map, lng: number, lat: number): number[] => {
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
const fromWgs84 = (map: L.Map, lng: number, lat: number): number[] => {
  if (!ensureGcoord()) return [lng, lat];

  const dstType = getMapCrsType(map);
  if (dstType === "WGS84") return [lng, lat];

  const dst = dstType === "BD09" ? gcoord.BD09 : gcoord.GCJ02;
  return gcoord.transform([lng, lat], gcoord.WGS84, dst);
};

export { getMapCrsType, toWgs84, fromWgs84 };

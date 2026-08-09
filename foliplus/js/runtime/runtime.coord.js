// Coordinate transformation and CRS detection for the foliplus runtime.
//
// These functions operate on Leaflet maps and coordinate systems, and are
// assembled onto `window.foliplus.*` by the runtime entry module.

/**
 * Detect whether the map uses Baidu coordinate system (BD-09).
 * Checks L.CRS.Baidu, crs.code, and tile URL patterns.
 *
 * @param {L.Map} map - Leaflet map instance
 * @returns {boolean} True if the map uses Baidu CRS
 */
const isBaiduCRS = (map) => {
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
 *
 * @param {L.Map} map - Leaflet map instance
 * @returns {boolean} True if the map uses domestic tile providers
 */
const isDomesticMap = (map) => {
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
 * @returns {boolean} True if gcoord is available, false otherwise.
 */
const ensureGcoord = () => {
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
 * @param {L.Map} map - Leaflet map instance
 * @returns {string} 'BD09' | 'GCJ02' | 'WGS84' (WGS84 indicates foreign maps that do not require conversion)
 */
const getMapCrsType = (map) => {
  if (isBaiduCRS(map)) return "BD09";
  if (isDomesticMap(map)) return "GCJ02";
  return "WGS84";
};

/**
 * Convert map-displayed coordinates (GCJ-02 / BD-09) to WGS-84.
 * Automatically detects the map CRS (Baidu → BD09, domestic → GCJ02).
 * If gcoord library is not yet loaded, schedules async loading and
 * returns the input coordinates unchanged (with a console warning).
 *
 * @param {L.Map} map - Leaflet map instance
 * @param {number} lng - Longitude in map CRS
 * @param {number} lat - Latitude in map CRS
 * @returns {number[]} [lng, lat] in WGS-84
 */
const toWgs84 = (map, lng, lat) => {
  if (!ensureGcoord()) return [lng, lat];

  const srcType = getMapCrsType(map);
  if (srcType === "WGS84") return [lng, lat];

  const src = srcType === "BD09" ? gcoord.BD09 : gcoord.GCJ02;
  return gcoord.transform([lng, lat], src, gcoord.WGS84);
};

/**
 * Convert WGS-84 coordinates to the map's display CRS (BD09 / GCJ02).
 * Automatically detects the map CRS. Non-domestic maps (no Baidu/AMap
 * tile patterns) are returned unchanged.
 *
 * @param {L.Map} map - Leaflet map instance
 * @param {number} lng - Longitude in WGS-84
 * @param {number} lat - Latitude in WGS-84
 * @returns {number[]} [lng, lat] in map CRS
 */
const fromWgs84 = (map, lng, lat) => {
  if (!ensureGcoord()) return [lng, lat];

  const dstType = getMapCrsType(map);
  if (dstType === "WGS84") return [lng, lat];

  const dst = dstType === "BD09" ? gcoord.BD09 : gcoord.GCJ02;
  return gcoord.transform([lng, lat], gcoord.WGS84, dst);
};

export { getMapCrsType, toWgs84, fromWgs84 };

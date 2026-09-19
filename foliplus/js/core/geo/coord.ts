// Coordinate transformation and CRS detection for foliplus components.
//
// Pure functions (no module-level state) — imported statically by components
// and by core/geocode (which lives in the shared runtime bundle, so esbuild
// bundles this module into foliplus-common.min.js exactly once).
//
// These functions operate on Leaflet maps and coordinate systems.
import { createLogger } from "#common/log.js";

// coord.ts has no CONF — it is shared across components and core — so the
// library name is the only prefix that is correct here.
const log = createLogger("foliplus");

type CrsType = "BD09" | "GCJ02" | "WGS84";

/** The two facts CRS detection reads from a live map. */
interface Probe {
  code: string;
  urls: string[];
}

/** WGS84 longitude/latitude limits, shared by coordinate validation. */
const COORD_BOUNDS = { LON: 180, LAT: 90 };

/**
 * Snapshot the two facts every probe needs — the map's CRS code and the list
 * of tile layer URLs — into plain values, logging any single failure once.
 *
 * getMapCrsType asks three questions (BD09?, domestic?, otherwise WGS84), and
 * each question originally re-read `map._layers` and `map.options.crs.code` on
 * its own. A throwing property therefore produced 3 warnings per call — and
 * geocoding calls getMapCrsType on every search, so the noise would scale with
 * search traffic. Reading each fact once, ahead of the cascade, keeps one
 * failing probe to one warning.
 *
 * The two reads keep their own try/catch so a warning still names the fact
 * that failed. A failed read degrades to the "not found" answer, matching the
 * old catch behaviour: probe misses fall back to WGS84 rather than aborting.
 */
const probeMap = (map: L.Map | null): Probe => {
  const urls: string[] = [];
  try {
    const layers = map?._layers as Record<string, L.TileLayer> | undefined;
    if (layers) {
      for (const id in layers) {
        const url = layers[id]?._url;
        if (url) urls.push(String(url));
      }
    }
  } catch (err) {
    log.warn("tile layer URL traversal failed (CRS fallback to WGS84):", err);
  }
  let code = "";
  try {
    code = map?.options?.crs?.code ?? "";
  } catch (err) {
    log.warn("map CRS code unreadable (CRS fallback to WGS84):", err);
  }
  return { code, urls };
};

/** Check a snapshot of tile layer URLs against URL patterns. */
const hasTileUrlMatching = (urls: string[], patterns: string[]): boolean =>
  urls.some(url => patterns.some(p => url.includes(p)));

/** Check a snapshot CRS code against a pattern (case-insensitive). */
const hasCrsCode = (code: string, codePattern: string): boolean =>
  code.toLowerCase().includes(codePattern.toLowerCase());

/**
 * Detect whether the map uses Baidu coordinate system (BD-09).
 * Checks L.CRS.Baidu, crs.code, and tile URL patterns.
 */
const isBaiduCRS = (map: L.Map | null, probe: Probe): boolean => {
  try {
    const LCRS = L.CRS as { Baidu?: L.CRS };
    if (LCRS && LCRS.Baidu && map?.options.crs === LCRS.Baidu) return true;
  } catch (err) {
    // Fires when reading `L.CRS` itself throws — e.g. Leaflet failed to load
    // (`L` is undefined). A missing Baidu plugin is just `L.CRS.Baidu ===
    // undefined`, which never throws and silently falls through to the
    // code/URL checks below.
    log.warn("L.CRS unavailable (Baidu CRS check skipped):", err);
  }
  if (hasCrsCode(probe.code, "baidu")) return true;
  return hasTileUrlMatching(probe.urls, ["bdimg.com"]);
};

/**
 * Detect whether a map uses domestic Chinese tile providers.
 * Checks Baidu, AutoNavi, Tianditu, Tencent, Google, and AMap URL patterns.
 */
const isDomesticMap = (probe: Probe): boolean => {
  const domesticPatterns = [
    "autonavi",
    "tianditu",
    "gtimg.com",
    "googleapis",
    "amap.com",
  ];
  if (hasTileUrlMatching(probe.urls, domesticPatterns)) return true;
  if (hasCrsCode(probe.code, "gcj02")) return true;
  return false;
};

/**
 * Ensure that the gcoord library is loaded. If not, logs a warning.
 * (A console warning beats a persistent UI hint: the missing dependency only
 * bites on non-WGS84 maps, an edge case developers — not end users — debug.)
 */
const ensureGcoord = (): boolean => {
  if (typeof gcoord === "undefined") {
    log.warn("gcoord library failed to load, coordinate transformation unavailable");
    return false;
  }
  return true;
};

/**
 * Detect the map's coordinate reference system type: 'BD09', 'GCJ02', or
 * 'WGS84'. A failed probe degrades to WGS84 with a console warning.
 */
const getMapCrsType = (map: L.Map | null): CrsType => {
  const probe = probeMap(map);
  if (isBaiduCRS(map, probe)) return "BD09";
  if (isDomesticMap(probe)) return "GCJ02";
  return "WGS84";
};

/**
 * Convert between WGS-84 and the map's display CRS (GCJ02 / BD09) in either
 * direction. Non-domestic maps are returned unchanged.
 */
const convert = (map: L.Map, lng: number, lat: number, toWgs84: boolean): number[] => {
  if (!ensureGcoord()) return [lng, lat];

  const crsType = getMapCrsType(map);
  if (crsType === "WGS84") return [lng, lat];

  const mapCrs = crsType === "BD09" ? gcoord.BD09 : gcoord.GCJ02;
  return toWgs84
    ? gcoord.transform([lng, lat], mapCrs, gcoord.WGS84)
    : gcoord.transform([lng, lat], gcoord.WGS84, mapCrs);
};

/** Convert map-displayed coordinates (GCJ-02 / BD-09) to WGS-84. */
const toWgs84 = (map: L.Map, lng: number, lat: number): number[] =>
  convert(map, lng, lat, true);

/** Convert WGS-84 coordinates to the map's display CRS (BD09 / GCJ02). */
const fromWgs84 = (map: L.Map, lng: number, lat: number): number[] =>
  convert(map, lng, lat, false);

export { COORD_BOUNDS, getMapCrsType, toWgs84, fromWgs84 };

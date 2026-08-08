// Reverse geocoding and address formatting for the foliplus runtime.
//
// Depends on runtime.coord.js helpers (getMapCrsType, toWgs84) and reads
// `foliplus.gt` from the global namespace at call time.

import { getMapCrsType, toWgs84 } from "./runtime.coord.js";

// ── Geocode constants ───────────────────────────────────────────
const GEO_CACHE_MAX = 500;
const NOMINATIM = {
  URL: "https://nominatim.openstreetmap.org",
  FORMAT: "jsonv2",
  THROTTLE_MS: 1000,
  ZOOM: 18,
};

// Uses throttled queue (1 req/s) and response cache.
// geoCache is a Map with a FIFO cap to bound memory during long sessions.
const geoCache = new Map();
const geoCacheGet = (key) => geoCache.get(key);
const geoCacheSet = (key, val) => {
  geoCache.set(key, val);
  if (geoCache.size > GEO_CACHE_MAX) geoCache.delete(geoCache.keys().next().value);
};
let geoPromise = Promise.resolve();
let geoLastReq = 0;

/**
 * Build a Nominatim API URL with shared parameters.
 * @param {string} endpoint - Path like "/search", "/reverse", or "" for search
 * @param {Object} params - Additional query parameters
 * @returns {string} Full URL
 */
const nominatimUrl = (endpoint, params = {}) => {
  const url = new URL(endpoint || "", NOMINATIM.URL);
  url.searchParams.set("format", NOMINATIM.FORMAT);
  for (const [k, v] of Object.entries(params))
    if (v != null) url.searchParams.set(k, String(v));

  if (!url.searchParams.has("accept-language"))
    url.searchParams.set(
      "accept-language",
      (window._LOCALE && window._LOCALE["locale.code"]) || "en",
    );

  return url.toString();
};

/**
 * Format a Nominatim display_name into a concise address string.
 * Used by both reverseGeocode and SearchControl search results to ensure
 * consistent address formatting across the codebase.
 *
 * @param {string} displayName - Nominatim display_name string
 * @param {L.Map} [map] - Leaflet map instance; if provided, detects
 *                        domestic vs foreign CRS to determine ordering
 * @returns {string} Formatted address
 */
const formatAddress = (displayName, map) => {
  if (!displayName) return "";
  const parts = displayName
    .split(",")
    .map((s) => s.trim())
    .filter((s) => {
      if (!s) return false;
      // Remove pure numeric tokens (postal codes, house numbers)
      if (/^\d+$/.test(s)) return false;
      // Remove ZIP+4 and similar (12345-6789, 12345 6789)
      if (/^\d{3,}([-–—]\d{2,}|\s+\d{2,})?$/.test(s)) return false;
      // Remove short numeric+letter combos that look like postal codes (e.g. "EC1A 1BB", "10001")
      if (
        /^[A-Z0-9]{2,10}(\s+[A-Z0-9]{2,10})?$/i.test(s) &&
        s.length <= 10 &&
        /[A-Z]/.test(s) === /[0-9]/.test(s)
      )
        return false;
      return true;
    });
  if (parts.length === 0) return "";
  // Domestic (Chinese) maps OR locale=zh: reverse order (small→large → large→small)
  // Foreign maps: keep original order
  const isChinese =
    (map && getMapCrsType(map) !== "WGS84") ||
    (window._LOCALE && window._LOCALE["locale.code"] === "zh");
  if (isChinese) return parts.reverse().join(",");
  return parts.join(",");
};

/**
 * Reverse geocode coordinates to an address via Nominatim.
 * Results are cached. Requests are throttled to 1 req/s.
 * @param {L.Map} map Leaflet map instance
 * @param {number} lng Longitude
 * @param {number} lat Latitude
 * @returns {Promise<string>} Resolved address string
 */
const reverseGeocode = (map, lng, lat) => {
  const foliplus = window.foliplus || {};
  const key = `${lng},${lat}`;
  const cached = geoCacheGet(key);
  if (cached) return Promise.resolve(cached);

  const wgs = toWgs84(map, parseFloat(lng), parseFloat(lat));
  const url = nominatimUrl("/reverse", {
    lon: wgs[0],
    lat: wgs[1],
    zoom: NOMINATIM.ZOOM,
  });

  geoPromise = geoPromise
    .then(() => {
      const wait = Math.max(
        0,
        NOMINATIM.THROTTLE_MS - (Date.now() - geoLastReq),
      );
      return new Promise((r) => setTimeout(r, wait));
    })
    .then(() => {
      geoLastReq = Date.now();
      return fetch(url)
        .then((r) => r.json())
        .then((data) => {
          const addr =
            formatAddress(data.display_name, map) ||
            foliplus.gt("SearchControl.addr_not_found");
          geoCacheSet(key, addr);
          return addr;
        })
        .catch(() => foliplus.gt("MeasureControl.geo_fail"));
    });
  return geoPromise;
};

export { NOMINATIM, nominatimUrl, formatAddress, reverseGeocode };

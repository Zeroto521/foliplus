// Reverse geocoding (stateful singleton) for the foliplus runtime.
// Shared cache and throttle queue must be global once per map.
// Pure helpers (NOMINATIM, nominatimUrl, formatAddress) live in
// common/geocode.js and are statically imported by components.
import { toWgs84 } from "#common/coord.js";
import { NOMINATIM, formatAddress, nominatimUrl } from "#common/geocode.js";

// Uses throttled queue (1 req/s) and response cache.
// geoCache is a Map with a FIFO cap to bound memory during long sessions.
const GEO_CACHE_MAX = 500;
const geoCache = new Map<string, string>();
const geoCacheGet = (key: string) => geoCache.get(key);
const geoCacheSet = (key: string, val: string) => {
  geoCache.set(key, val);
  if (geoCache.size > GEO_CACHE_MAX) {
    const oldest = geoCache.keys().next().value;
    if (oldest !== undefined) geoCache.delete(oldest);
  }
};
let geoPromise: Promise<unknown> = Promise.resolve();
let geoLastReq = 0;

/**
 * Reverse geocode coordinates to an address via Nominatim.
 * Results are cached. Requests are throttled to 1 req/s.
 * @param {L.Map} map Leaflet map instance
 * @param {number} lng Longitude
 * @param {number} lat Latitude
 * @param {string} [code] - Locale code for accept-language + fallback text
 * @returns {Promise<string>} Resolved address string
 */
const reverseGeocode = (
  map: any,
  lng: number | string,
  lat: number | string,
  code = "en",
): Promise<string> => {
  const key = `${lng},${lat}`;
  const cached = geoCacheGet(key);
  if (cached) return Promise.resolve(cached);

  const wgs = toWgs84(map, parseFloat(String(lng)), parseFloat(String(lat)));
  const url = nominatimUrl(
    "/reverse",
    { lon: wgs[0], lat: wgs[1], zoom: NOMINATIM.ZOOM },
    code,
  );

  const foliplus = window.foliplus || {};
  const common = (foliplus && foliplus._TABLES && foliplus._TABLES[code]) || {};
  const notFound = common["foliplus.addr_not_found"] || "Address not found";
  const fail = common["foliplus.geo_fail"] || "Lookup failed";

  geoPromise = geoPromise
    .then(() => {
      const wait = Math.max(0, NOMINATIM.THROTTLE_MS - (Date.now() - geoLastReq));
      return new Promise(r => setTimeout(r, wait));
    })
    .then(() => {
      geoLastReq = Date.now();
      return fetch(url)
        .then(r => r.json())
        .then(data => {
          const addr = formatAddress(data.display_name, map, code) || notFound;
          geoCacheSet(key, addr);
          return addr;
        })
        .catch(() => fail);
    });
  return geoPromise as Promise<string>;
};

export { reverseGeocode };

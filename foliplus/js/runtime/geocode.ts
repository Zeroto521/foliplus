// Geocoding (stateful singleton) for the foliplus runtime.
// Bidirectional global cache: address → coordinates (forward) and
// coordinates → address (reverse). Shared cache + throttle queue must be
// global once per map (Nominatim rate limit is global, not per-map).
// Pure helpers (NOMINATIM, nominatimUrl, formatAddress) live in
// common/geocode.js and are statically imported by components.
import { Cache } from "#common/cache.js";
import { toWgs84 } from "#common/coord.js";
import { GEODECODE_TIMEOUT_MS, fetchWithTimeout } from "#common/fetch.js";
import { NOMINATIM, formatAddress, nominatimUrl } from "#common/geocode.js";

// FIFO cache shared by both directions, bounded to bound memory.
// Entries expire after 24h so Nominatim result changes are not served stale.
const GEO_CACHE_MAX = 500;
const GEO_TTL_MS = 24 * 60 * 60 * 1000;
const geoCache = new Cache<string, string>(GEO_CACHE_MAX, GEO_TTL_MS);
let geoPromise: Promise<unknown> = Promise.resolve();
let geoLastReq = 0;

/** Serialize requests through a throttled queue (Nominatim 1 req/s). */
const throttled = <T>(fn: () => Promise<T>): Promise<T> => {
  geoPromise = geoPromise.then(() => {
    const wait = Math.max(0, NOMINATIM.THROTTLE_MS - (Date.now() - geoLastReq));
    return new Promise(r => setTimeout(r, wait));
  });
  return geoPromise.then(() => {
    geoLastReq = Date.now();
    return fn();
  });
};

const localeFallback = (code: string, key: string, fallback: string) => {
  const foliplus = window.foliplus || {};
  const common = (foliplus && foliplus._TABLES && foliplus._TABLES[code]) || {};
  return common[key] || fallback;
};

/** Reverse geocode coordinates to an address via Nominatim (cached, throttled). */
const reverseGeocode = (
  map: L.Map,
  lng: number | string,
  lat: number | string,
  code = "en",
): Promise<string> => {
  const key = `reverse:${lng},${lat}`;
  const cached = geoCache.get(key);
  if (cached) return Promise.resolve(cached);

  const wgs = toWgs84(map, parseFloat(String(lng)), parseFloat(String(lat)));
  const url = nominatimUrl(
    "/reverse",
    { lon: wgs[0], lat: wgs[1], zoom: NOMINATIM.ZOOM },
    code,
  );
  const notFound = localeFallback(code, "foliplus.addr_not_found", "Address not found");
  const fail = localeFallback(code, "foliplus.geo_fail", "Lookup failed");

  return throttled(() =>
    fetchWithTimeout(url, { timeoutMs: GEODECODE_TIMEOUT_MS })
      .then(r => r.json())
      .then(data => {
        const addr = formatAddress(data.display_name, map, code) || notFound;
        geoCache.set(key, addr);
        return addr;
      })
      .catch(() => fail),
  );
};

/** A resolved forward-geocode result. */
interface GeocodeResult {
  lat: number;
  lng: number;
  display_name: string;
}

/** Forward geocode an address to coordinates via Nominatim (cached, throttled). */
const geocode = (
  map: L.Map,
  address: string,
  code = "en",
): Promise<GeocodeResult | null> => {
  const key = `forward:${address}`;
  const cached = geoCache.get(key);
  if (cached) {
    const [lat, lng, ...name] = cached.split("\u0001");
    if (name.length)
      return Promise.resolve({
        lat: +lat,
        lng: +lng,
        display_name: name.join("\u0001"),
      });
  }

  const url = nominatimUrl("/search", { q: address, limit: 1, format: "jsonv2" }, code);

  return throttled(() =>
    fetchWithTimeout(url, { timeoutMs: GEODECODE_TIMEOUT_MS })
      .then(r => r.json())
      .then((data: Array<{ lat: string; lon: string; display_name: string }>) => {
        const first = Array.isArray(data) ? data[0] : null;
        if (!first) return null;
        const result: GeocodeResult = {
          lat: parseFloat(first.lat),
          lng: parseFloat(first.lon),
          display_name: first.display_name,
        };
        geoCache.set(
          key,
          `${result.lat}\u0001${result.lng}\u0001${result.display_name}`,
        );
        return result;
      })
      .catch(() => null),
  );
};

export { geocode, reverseGeocode, type GeocodeResult };

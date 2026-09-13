// Geocoding (stateful singleton) for the foliplus runtime.
// Bidirectional global cache: address -> coordinates (forward) and
// coordinates -> address (reverse). Shared cache + throttle queue must be
// global once per map (Nominatim rate limit is global, not per-map).
// The Nominatim provider + URL/format helpers live in nominatim.ts (same
// subdomain); this module owns CRS adaption, caching, and rate limiting.
import { fromWgs84, getMapCrsType, toWgs84 } from "#core/geo/coord.js";
import { Cache } from "#common/cache.js";
import { NOMINATIM, NominatimProvider, formatAddress } from "./nominatim.js";
import type { GeocodeItem } from "./provider.js";
import { createThrottleQueue } from "./rateLimit.js";

// FIFO cache shared by both directions, bounded to bound memory.
// Entries expire after 24h so Nominatim result changes are not served stale.
const GEO_CACHE_MAX = 500;
const GEO_TTL_MS = 24 * 60 * 60 * 1000;
const geoCache = new Cache<string, string>(GEO_CACHE_MAX, GEO_TTL_MS);

// All Nominatim traffic funnels through one throttled queue (1 req/s).
const throttled = createThrottleQueue(NOMINATIM.THROTTLE_MS);
const provider = new NominatimProvider();

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
  const notFound = localeFallback(code, "foliplus.addr_not_found", "Address not found");
  const fail = localeFallback(code, "foliplus.geo_fail", "Lookup failed");

  return throttled(() =>
    provider
      .reverse(wgs[0], wgs[1], code)
      .then(item => {
        const addr = formatAddress(item?.display_name ?? "", map, code) || notFound;
        geoCache.set(key, addr);
        return addr;
      })
      .catch(() => fail),
  );
};

/** A resolved forward-geocode result (map CRS). */
type GeocodeResult = GeocodeItem;

/** Forward geocode an address to coordinates via Nominatim (cached, throttled). */
const geocode = (
  map: L.Map,
  address: string,
  code = "en",
): Promise<GeocodeResult | null> => {
  // CRS-aware key so the same address on different maps (e.g. GCJ02 vs
  // WGS84) do not share a stale cached result.
  const crs = getMapCrsType(map);
  const key = `forward:${address}:${crs}`;
  const cached = geoCache.get(key);
  if (cached) {
    const [lat, lng, ...name] = cached.split("\u0001");
    if (name.length) {
      return Promise.resolve({
        lat: Number(lat),
        lng: Number(lng),
        display_name: name.join("\u0001"),
      });
    }
  }

  return throttled(() =>
    provider
      .search(address, code)
      .then(items => {
        const first = items[0] ?? null;
        if (!first) return null;
        // Nominatim always returns WGS84 - convert to the map CRS so
        // downstream code (SearchControl, etc.) always gets coordinates
        // in the same CRS as map-displayed coordinates.
        const [lng, lat] = fromWgs84(map, first.lng, first.lat);
        const result: GeocodeResult = {
          lat,
          lng,
          display_name: first.display_name,
        };
        geoCache.set(
          key,
          `${result.lat}\u0001${result.lng}\u0001${result.display_name}`,
        );
        // Safe: (lng, lat) is unique - no collision risk
        geoCache.set(`reverse:${lng},${lat}`, first.display_name);
        return result;
      })
      .catch(() => null),
  );
};

/** Cache a suggestion result so searchAddress can serve it from geoCache. */
const cacheSuggestion = (
  map: L.Map,
  address: string,
  lat: number,
  lng: number,
  displayName: string,
) => {
  const crs = getMapCrsType(map);
  const key = `forward:${address}:${crs}`;
  geoCache.set(key, `${lat}\u0001${lng}\u0001${displayName}`);
  // Also populate the reverse entry for the same safety
  geoCache.set(`reverse:${lng},${lat}`, displayName);
};

export { geocode, reverseGeocode, cacheSuggestion, type GeocodeResult };

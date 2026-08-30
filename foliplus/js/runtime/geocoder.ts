// Geocoding (stateful singleton) for the foliplus runtime.
// Bidirectional global cache: address -> coordinates (forward) and
// coordinates -> address (reverse). Cache keys are scoped by provider id and
// CRS; the throttle queue is per-provider (each API has its own rate limit).
// Pure helpers and provider definitions live in core/geocode/* and are
// statically imported here.
import { resolveProvider } from "#core/geocode/index.js";
import type { GeocodeProvider, ProviderConfig } from "#core/geocode/index.js";
import { Cache } from "#common/cache.js";
import { fromWgs84, getMapCrsType, toWgs84 } from "#common/coord.js";
import { GEODECODE_TIMEOUT_MS, fetchWithTimeout } from "#common/fetch.js";
import { formatAddress } from "#common/geocode.js";

// FIFO cache shared by both directions, bounded to bound memory.
// Entries expire after 24h so upstream result changes are not served stale.
const GEO_CACHE_MAX = 500;
const GEO_TTL_MS = 24 * 60 * 60 * 1000;
const geoCache = new Cache<string, string>(GEO_CACHE_MAX, GEO_TTL_MS);

// Cache record separator. U+0001 never appears in addresses or coordinate
// strings, so it cannot collide with payload content.
const SEP = String.fromCodePoint(1);

// Per-provider throttle queues (each API has its own rate limit).
const queues = new Map<string, { promise: Promise<unknown>; last: number }>();

const queueOf = (provider: GeocodeProvider) => {
  let q = queues.get(provider.id);
  if (!q) {
    q = { promise: Promise.resolve(), last: 0 };
    queues.set(provider.id, q);
  }
  return q;
};

/** Serialize requests per provider (Nominatim 1 req/s, Photon/Pelias less strict). */
const throttled = <T>(provider: GeocodeProvider, fn: () => Promise<T>): Promise<T> => {
  const q = queueOf(provider);
  q.promise = q.promise.then(() => {
    const wait = Math.max(0, provider.throttleMs - (Date.now() - q.last));
    return new Promise(r => setTimeout(r, wait));
  });
  return q.promise.then(() => {
    q.last = Date.now();
    return fn();
  });
};

const localeFallback = (code: string, key: string, fallback: string) => {
  const foliplus = window.foliplus || {};
  const common = (foliplus && foliplus._TABLES && foliplus._TABLES[code]) || {};
  return common[key] || fallback;
};

const requestJson = (provider: GeocodeProvider, url: string): Promise<unknown> =>
  fetchWithTimeout(url, {
    timeoutMs: GEODECODE_TIMEOUT_MS,
    headers: provider.headers,
  }).then(r => r.json());

/**
 * Resolve a provider spec defensively — falls back to Nominatim on an unknown
 * id so a misconfigured spec degrades gracefully instead of throwing mid-search.
 */
const safeResolve = (
  provider?: string | ProviderConfig,
  providerConfig?: Record<string, unknown> | null,
): GeocodeProvider => {
  try {
    return resolveProvider(provider, providerConfig);
  } catch {
    return resolveProvider();
  }
};

/** Reverse geocode coordinates to an address via the given provider (cached, throttled). */
const reverseGeocode = (
  map: L.Map,
  lng: number | string,
  lat: number | string,
  code = "en",
  provider?: string | ProviderConfig,
  providerConfig?: Record<string, unknown> | null,
): Promise<string> => {
  const resolved = safeResolve(provider, providerConfig);
  const key = `reverse:${resolved.id}:${lng},${lat}`;
  const cached = geoCache.get(key);
  if (cached) return Promise.resolve(cached);

  const wgs = toWgs84(map, parseFloat(String(lng)), parseFloat(String(lat)));
  const url = resolved.reverse(wgs[0], wgs[1], code);
  const notFound = localeFallback(code, "foliplus.addr_not_found", "Address not found");
  const fail = localeFallback(code, "foliplus.geo_fail", "Lookup failed");

  return throttled(resolved, () =>
    requestJson(resolved, url)
      .then(data => {
        const addr =
          formatAddress(resolved.normalizeReverse(data), map, code) || notFound;
        geoCache.set(key, addr);
        return addr;
      })
      .catch(() => fail),
  );
};

/** A resolved forward-geocode result (already in the map's CRS). */
interface GeocodeResult {
  lat: number;
  lng: number;
  display_name: string;
}

/** Forward geocode an address to coordinates via the given provider (cached, throttled). */
const geocode = (
  map: L.Map,
  address: string,
  code = "en",
  provider?: string | ProviderConfig,
  providerConfig?: Record<string, unknown> | null,
): Promise<GeocodeResult | null> => {
  const resolved = safeResolve(provider, providerConfig);
  // CRS-aware key so the same address on different maps (e.g. GCJ02 vs
  // WGS84) — or on different providers — do not share a stale cached result.
  const crs = getMapCrsType(map);
  const key = `forward:${resolved.id}:${address}:${crs}`;
  const cached = geoCache.get(key);
  if (cached) {
    const [lat, lng, ...name] = cached.split(SEP);
    if (name.length)
      return Promise.resolve({
        lat: +lat,
        lng: +lng,
        display_name: name.join(SEP),
      });
  }

  const url = resolved.search(address, code);

  return throttled(resolved, () =>
    requestJson(resolved, url)
      .then(data => {
        const item = resolved.normalizeSearch(data);
        if (!item) return null;
        // All built-in providers return WGS84 - convert to the map CRS so
        // downstream code always gets coordinates in the same CRS as map-
        // displayed coordinates.
        const [lng, lat] = fromWgs84(map, parseFloat(item.lng), parseFloat(item.lat));
        const result: GeocodeResult = {
          lat,
          lng,
          display_name: item.display_name,
        };
        geoCache.set(
          key,
          `${result.lat}${SEP}${result.lng}${SEP}${result.display_name}`,
        );
        // Safe: (lng, lat) is unique per provider - no collision risk
        geoCache.set(`reverse:${resolved.id}:${lng},${lat}`, result.display_name);
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
  provider?: string | ProviderConfig,
  providerConfig?: Record<string, unknown> | null,
) => {
  const resolved = safeResolve(provider, providerConfig);
  const crs = getMapCrsType(map);
  const key = `forward:${resolved.id}:${address}:${crs}`;
  geoCache.set(key, `${lat}${SEP}${lng}${SEP}${displayName}`);
  // Also populate the reverse entry for the same safety
  geoCache.set(`reverse:${resolved.id}:${lng},${lat}`, displayName);
};

export { geocode, reverseGeocode, cacheSuggestion, type GeocodeResult };

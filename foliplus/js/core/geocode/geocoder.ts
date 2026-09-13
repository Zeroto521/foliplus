// Geocoding (stateful singleton) for the foliplus runtime.
// Bidirectional global cache: address -> coordinates (forward) and
// coordinates -> address (reverse). Cache keys are scoped by provider id and
// CRS; the throttle queue is per-provider (each API has its own rate limit).
// Providers are pure WGS84 (registry.ts / nominatim.ts); this module wraps
// them map-aware via withMapCRS (the single CRS boundary), owns caching and
// rate limiting. Callers may pass an explicit provider spec (e.g. SearchControl
// forwards its configured provider so cache keys stay consistent); components
// that omit it fall back to the map-default provider (map.foliplus.geocodeProvider,
// set by provider-aware controls) and finally to Nominatim.
import { getMapCrsType } from "#core/geo/coord.js";
import { Cache } from "#common/cache.js";
import { GEODECODE_TIMEOUT_MS, fetchWithTimeout } from "#common/fetch.js";
import { withMapCRS } from "./mapProvider.js";
import { formatAddress } from "./nominatim.js";
import { createThrottleQueue } from "./rateLimit.js";
import { resolveProvider } from "./registry.js";
import type { GeocodeProvider, ProviderConfig } from "./type.js";

// FIFO cache shared by both directions, bounded to bound memory.
// Entries expire after 24h so upstream result changes are not served stale.
const GEO_CACHE_MAX = 500;
const GEO_TTL_MS = 24 * 60 * 60 * 1000;
const geoCache = new Cache<string, string>(GEO_CACHE_MAX, GEO_TTL_MS);

// Cache record separator. U+0001 never appears in addresses or coordinate
// strings, so it cannot collide with payload content.
const SEP = String.fromCodePoint(1);

// Per-provider strictly-serialized throttle queues (Nominatim 1 req/s).
const queues = new Map<string, ReturnType<typeof createThrottleQueue>>();

const queueOf = (provider: GeocodeProvider) => {
  let queue = queues.get(provider.id);
  if (!queue) {
    queue = createThrottleQueue(provider.throttleMs);
    queues.set(provider.id, queue);
  }
  return queue;
};

const throttled = <T>(provider: GeocodeProvider, fn: () => Promise<T>): Promise<T> =>
  queueOf(provider)(fn);

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
 * Resolve a provider spec for a map, defensively. Priority: explicit spec >
 * map default (`map.foliplus.geocodeProvider`, registered by provider-aware
 * controls) > Nominatim. Unknown ids fall back to Nominatim so a misconfigured
 * spec degrades gracefully instead of throwing mid-search. The result is
 * wrapped map-aware (CRS conversion), so callers pass map-CRS coordinates and
 * receive map-CRS results regardless of the underlying API.
 */
const safeResolve = (
  map: L.Map,
  provider?: string | ProviderConfig,
  providerConfig?: Record<string, unknown> | null,
): GeocodeProvider => {
  try {
    const spec = provider ?? map.foliplus?.geocodeProvider;
    return withMapCRS(resolveProvider(spec, providerConfig), map);
  } catch {
    return withMapCRS(resolveProvider(), map);
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
  const resolved = safeResolve(map, provider, providerConfig);
  const key = `reverse:${resolved.id}:${lng},${lat}`;
  const cached = geoCache.get(key);
  if (cached) return Promise.resolve(cached);

  // Coordinates are in the map CRS; withMapCRS converts to WGS84 for the API.
  const url = resolved.reverse(parseFloat(String(lng)), parseFloat(String(lat)), code);
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
  lng: number;
  lat: number;
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
  const resolved = safeResolve(map, provider, providerConfig);
  // CRS-aware key so the same address on different maps (e.g. GCJ02 vs
  // WGS84) — or on different providers — do not share a stale cached result.
  const crs = getMapCrsType(map);
  const key = `forward:${resolved.id}:${address}:${crs}`;
  const cached = geoCache.get(key);
  if (cached) {
    const [lng, lat, ...name] = cached.split(SEP);
    if (name.length) {
      return Promise.resolve({
        lng: Number(lng),
        lat: Number(lat),
        display_name: name.join(SEP),
      });
    }
  }

  const url = resolved.search(address, code);

  return throttled(resolved, () =>
    requestJson(resolved, url)
      .then(data => {
        // normalizeSearch returns map-CRS coordinates (withMapCRS converts).
        const item = resolved.normalizeSearch(data);
        if (!item) return null;
        const result: GeocodeResult = {
          lng: parseFloat(item.lng),
          lat: parseFloat(item.lat),
          display_name: item.display_name,
        };
        geoCache.set(
          key,
          `${result.lng}${SEP}${result.lat}${SEP}${result.display_name}`,
        );
        // Safe: (lng, lat) is unique per provider - no collision risk
        geoCache.set(
          `reverse:${resolved.id}:${result.lng},${result.lat}`,
          result.display_name,
        );
        return result;
      })
      .catch(() => null),
  );
};

/** Cache a suggestion result so searchAddress can serve it from geoCache. */
const cacheSuggestion = (
  map: L.Map,
  address: string,
  lng: number,
  lat: number,
  displayName: string,
  provider?: string | ProviderConfig,
  providerConfig?: Record<string, unknown> | null,
) => {
  const resolved = safeResolve(map, provider, providerConfig);
  const crs = getMapCrsType(map);
  const key = `forward:${resolved.id}:${address}:${crs}`;
  geoCache.set(key, `${lng}${SEP}${lat}${SEP}${displayName}`);
  // Also populate the reverse entry for the same safety
  geoCache.set(`reverse:${resolved.id}:${lng},${lat}`, displayName);
};

export { geocode, reverseGeocode, cacheSuggestion, type GeocodeResult };

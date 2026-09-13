// Nominatim URL building, address formatting, and the Nominatim geocode
// provider for foliplus. The pure helpers (NOMINATIM, nominatimUrl,
// formatAddress) are imported statically by components; NominatimProvider
// performs the fetch and is consumed by the geocoder singleton.
import { getMapCrsType } from "#core/geo/coord.js";
import { GEODECODE_TIMEOUT_MS, fetchWithTimeout } from "#common/fetch.js";
import type { GeocodeItem, GeocodeProvider } from "./provider.js";

// ── Geocode constants ───────────────────────────────────────────
const NOMINATIM = {
  URL: "https://nominatim.openstreetmap.org",
  FORMAT: "jsonv2",
  THROTTLE_MS: 1000,
  ZOOM: 18,
};

/**
 * Build a Nominatim API URL with shared parameters.
 * @param endpoint - Path like "/search", "/reverse", or "" for search
 * @param params - Additional query parameters
 * @param code - Locale code for accept-language (e.g. "en"/"zh")
 * @returns Full URL
 */
const nominatimUrl = (
  endpoint: string,
  params: Record<string, string | number | boolean> = {},
  code = "en",
): string => {
  const url = new URL(endpoint || "", NOMINATIM.URL);
  url.searchParams.set("format", NOMINATIM.FORMAT);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }

  if (!url.searchParams.has("accept-language")) {
    url.searchParams.set("accept-language", code);
  }

  return url.toString();
};

/**
 * Format a Nominatim display_name into a concise address string.
 * Used by both reverseGeocode and SearchControl search results to ensure
 * consistent address formatting across the codebase.
 *
 * @param displayName - Nominatim display_name string
 * @param map - Leaflet map instance; if provided, detects
 *              domestic vs foreign CRS to determine ordering
 * @param code - Locale code (e.g. "en"/"zh"); defaults to "en"
 * @returns Formatted address
 */
const formatAddress = (displayName: string, map?: L.Map, code = "en"): string => {
  if (!displayName) return "";
  const parts = displayName
    .split(",")
    .map(s => s.trim())
    .filter(s => {
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
      ) {
        return false;
      }
      return true;
    });
  if (parts.length === 0) return "";
  // Domestic (Chinese) maps OR locale=zh: reverse order (small→large → large→small)
  // Foreign maps: keep original order
  const isChinese = (map && getMapCrsType(map) !== "WGS84") || code === "zh";
  if (isChinese) return parts.reverse().join(",");
  return parts.join(",");
};

/** Geolocation provider backed by the public Nominatim API (WGS84 in/out). */
class NominatimProvider implements GeocodeProvider {
  search(q: string, code: string): Promise<GeocodeItem[]> {
    const url = nominatimUrl("/search", { q, limit: 1 }, code);
    return fetchWithTimeout(url, { timeoutMs: GEODECODE_TIMEOUT_MS })
      .then(r => r.json())
      .then((data: Array<{ lat: string; lon: string; display_name: string }>) =>
        Array.isArray(data)
          ? data.map(item => ({
              lat: parseFloat(item.lat),
              lng: parseFloat(item.lon),
              display_name: item.display_name,
            }))
          : [],
      );
  }

  reverse(lng: number, lat: number, code: string): Promise<GeocodeItem | null> {
    const url = nominatimUrl("/reverse", { lon: lng, lat, zoom: NOMINATIM.ZOOM }, code);
    return fetchWithTimeout(url, { timeoutMs: GEODECODE_TIMEOUT_MS })
      .then(r => r.json())
      .then((data: { lat?: string; lon?: string; display_name?: string } | null) =>
        data && data.display_name
          ? {
              lat: parseFloat(data.lat ?? String(lat)),
              lng: parseFloat(data.lon ?? String(lng)),
              display_name: data.display_name,
            }
          : null,
      );
  }
}

export { NOMINATIM, NominatimProvider, formatAddress, nominatimUrl };

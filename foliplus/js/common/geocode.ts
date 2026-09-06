// Nominatim URL building & address formatting for foliplus components.
// Pure functions (no module-level state) — imported statically by components.
// The stateful reverse-geocoder (geocode.js) also imports these, which
// is fine: esbuild inlines a copy into runtime.min.js as well.
import { getMapCrsType } from "./coord.js";

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
  for (const [k, v] of Object.entries(params))
    if (v != null) url.searchParams.set(k, String(v));

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
      )
        return false;
      return true;
    });
  if (parts.length === 0) return "";
  // Domestic (Chinese) maps OR locale=zh: reverse order (small→large → large→small)
  // Foreign maps: keep original order
  const isChinese = (map && getMapCrsType(map) !== "WGS84") || code === "zh";
  if (isChinese) return parts.reverse().join(",");
  return parts.join(",");
};

export { NOMINATIM, formatAddress, nominatimUrl };

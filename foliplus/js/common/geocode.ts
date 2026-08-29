// Address formatting for foliplus components.
// Pure functions (no module-level state) — imported statically by components.
// The stateful reverse-geocoder (runtime/geocoder.ts) also imports this, which
// is fine: esbuild inlines a copy into runtime.min.js as well.
//
// NOTE: provider definitions (Nominatim/Photon/Pelias URL builders and
// normalizers) moved to core/geocode/*; only the shared address formatter
// remains here.
import { getMapCrsType } from "./coord.js";

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

export { formatAddress };

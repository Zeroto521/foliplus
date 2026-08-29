// Built-in Nominatim provider (OpenStreetMap search API).
import type { GeocodeProvider, SuggestItem } from "./type.js";

const DEFAULT_BASE_URL = "https://nominatim.openstreetmap.org";
const ZOOM = 18;

/** Map a raw Nominatim element to a normalized item (returns null if invalid). */
const toItem = (r: Record<string, unknown> | null | undefined): SuggestItem | null => {
  if (!r || (r.lon ?? r.lng) == null || r.lat == null) return null;
  return {
    lng: String(r.lon ?? r.lng),
    lat: String(r.lat),
    name: typeof r.name === "string" ? r.name : undefined,
    display_name: typeof r.display_name === "string" ? r.display_name : "",
  };
};

const createNominatim = (baseUrl: string = DEFAULT_BASE_URL): GeocodeProvider => ({
  id: "nominatim",
  throttleMs: 1000,
  headers: {},
  suggest(q, limit, center, code) {
    const url = new URL("/search", baseUrl);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("q", q);
    url.searchParams.set("limit", String(limit));
    if (center) {
      url.searchParams.set("lon", String(center[0]));
      url.searchParams.set("lat", String(center[1]));
    }
    url.searchParams.set("accept-language", code || "en");
    return url.toString();
  },
  search(q, code) {
    const url = new URL("/search", baseUrl);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("q", q);
    url.searchParams.set("limit", "1");
    url.searchParams.set("accept-language", code || "en");
    return url.toString();
  },
  reverse(lng, lat, code) {
    const url = new URL("/reverse", baseUrl);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("zoom", String(ZOOM));
    url.searchParams.set("accept-language", code || "en");
    return url.toString();
  },
  normalizeSuggest(data) {
    if (!Array.isArray(data)) return [];
    return data.map(toItem).filter((x): x is SuggestItem => x != null);
  },
  normalizeSearch(data) {
    const first = Array.isArray(data) ? data[0] : null;
    return toItem(first);
  },
  normalizeReverse(data) {
    const d = data as { display_name?: unknown } | null;
    return typeof d?.display_name === "string" ? d.display_name : "";
  },
});

export { createNominatim, DEFAULT_BASE_URL };

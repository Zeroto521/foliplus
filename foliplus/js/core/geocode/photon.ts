// Built-in Photon provider (komoot's OpenStreetMap search API).
import type { GeocodeProvider, SuggestItem } from "./type.js";
import { featuresToItems } from "./util.js";

const DEFAULT_BASE_URL = "https://photon.komoot.io";

/** Join Photon `properties` fields into a Nominatim-style display string. */
const photonDisplayName = (props: Record<string, unknown>): string =>
  [props.name, props.street, props.city, props.state, props.country]
    .filter(v => typeof v === "string" && v !== "")
    .join(", ");

const createPhoton = (baseUrl: string = DEFAULT_BASE_URL): GeocodeProvider => {
  const suggest = (
    q: string,
    limit: number,
    center: [number, number] | null,
    code: string,
  ): string => {
    const url = new URL("/api/", baseUrl);
    url.searchParams.set("q", q);
    url.searchParams.set("limit", String(limit));
    if (center) {
      url.searchParams.set("lon", String(center[0]));
      url.searchParams.set("lat", String(center[1]));
    }
    if (code) url.searchParams.set("lang", code);
    return url.toString();
  };

  const normalizeSuggest = (data: unknown): SuggestItem[] =>
    featuresToItems(data, photonDisplayName);

  return {
    id: "photon",
    throttleMs: 500,
    // Photon's usage policy asks callers to identify themselves via this header.
    headers: { "X-User-Agent": "foliplus" },
    suggest,
    search(q, code) {
      return suggest(q, 1, null, code);
    },
    reverse(lng, lat, code) {
      const url = new URL("/reverse", baseUrl);
      url.searchParams.set("lon", String(lng));
      url.searchParams.set("lat", String(lat));
      if (code) url.searchParams.set("lang", code);
      return url.toString();
    },
    normalizeSuggest,
    normalizeSearch(data) {
      return normalizeSuggest(data)[0] ?? null;
    },
    normalizeReverse(data) {
      const items = normalizeSuggest(data);
      return items[0]?.display_name ?? "";
    },
  };
};

export { createPhoton, DEFAULT_BASE_URL };

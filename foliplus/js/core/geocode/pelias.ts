// Built-in Pelias provider (Mapzen-style geocoding API).
import type { GeocodeProvider, SuggestItem } from "./type.js";
import { featuresToItems } from "./util.js";

const DEFAULT_BASE_URL = "https://api.demo.pelias.io";

/** Pelias `properties.label` is the preferred display string. */
const peliasDisplayName = (props: Record<string, unknown>): string => {
  if (typeof props.label === "string" && props.label !== "") return props.label;
  if (typeof props.name === "string") return props.name;
  return "";
};

const createPelias = (baseUrl: string = DEFAULT_BASE_URL): GeocodeProvider => {
  const suggest = (
    q: string,
    limit: number,
    center: [number, number] | null,
    code: string,
  ): string => {
    const url = new URL("/v1/autocomplete", baseUrl);
    url.searchParams.set("text", q);
    url.searchParams.set("size", String(limit));
    if (center) {
      // Pelias autocomplete bias uses `focus.point`.
      url.searchParams.set("focus.point.lon", String(center[0]));
      url.searchParams.set("focus.point.lat", String(center[1]));
    }
    if (code) url.searchParams.set("lang", code);
    return url.toString();
  };

  const normalizeSuggest = (data: unknown): SuggestItem[] =>
    featuresToItems(data, peliasDisplayName);

  return {
    id: "pelias",
    throttleMs: 250,
    headers: {},
    suggest,
    search(q, code) {
      const url = new URL("/v1/search", baseUrl);
      url.searchParams.set("text", q);
      url.searchParams.set("size", "1");
      if (code) url.searchParams.set("lang", code);
      return url.toString();
    },
    reverse(lng, lat, code) {
      const url = new URL("/v1/reverse", baseUrl);
      url.searchParams.set("point.lon", String(lng));
      url.searchParams.set("point.lat", String(lat));
      if (code) url.searchParams.set("lang", code);
      return url.toString();
    },
    normalizeSuggest,
    normalizeSearch(data) {
      return normalizeSuggest(data)[0] ?? null;
    },
    normalizeReverse(data) {
      return normalizeSuggest(data)[0]?.display_name ?? "";
    },
  };
};

export { createPelias, DEFAULT_BASE_URL };

// Geocode provider layer — shared type definitions.
// Pure types only (no runtime logic); imported by the runtime geocoder and
// by components (e.g. SearchControl) so the provider contract lives in one place.

/** A normalized geocoding result, provider-agnostic (WGS84, strings for precision). */
interface SuggestItem {
  lng: string;
  lat: string;
  name?: string;
  display_name: string;
}

/**
 * A built-in or adapted geocode provider.
 *
 * Providers are **URL builders + response normalizers, not fetchers**: each
 * caller performs its own fetch. That is what lets SearchControl use a provider
 * for its debounced/abortable suggestions while the runtime geocoder uses the
 * same provider for throttled, cached address search — request control stays
 * with the caller, URL shape and response mapping stay per-provider.
 */
interface GeocodeProvider {
  id: string;
  /** Minimum ms between requests to this provider — enforced **globally**
   *  (same id across maps and across the geocoder / suggestion paths share
   *  one clock and queue). The strictest declaration for an id wins. */
  throttleMs: number;
  /** Extra request headers sent with every call (e.g. Photon's X-User-Agent). */
  headers: Record<string, string>;
  /** Autocomplete URL for the given query (optionally biased to `center`). */
  suggest(
    q: string,
    limit: number,
    center: [number, number] | null,
    code: string,
  ): string;
  /** Forward-geocode URL (first hit only). */
  search(q: string, code: string): string;
  /** Reverse-geocode URL. */
  reverse(lng: number, lat: number, code: string): string;
  /** Map a raw suggest response to normalized items. */
  normalizeSuggest(data: unknown): SuggestItem[];
  /** Map a raw search response to a single normalized item. */
  normalizeSearch(data: unknown): SuggestItem | null;
  /** Map a raw reverse response to a display-name string. */
  normalizeReverse(data: unknown): string;
}

/** A resolved forward-geocode result (already in the map's CRS). */
interface GeocodeResult {
  lng: number;
  lat: number;
  display_name: string;
}

export type { GeocodeProvider, GeocodeResult, SuggestItem };

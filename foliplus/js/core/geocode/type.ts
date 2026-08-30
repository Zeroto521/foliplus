// Geocode provider layer — shared type definitions.
// Pure types only (no runtime logic); imported by the runtime geocoder and
// by SearchControl to keep the provider contract in one place.

/** A normalized geocoding result, provider-agnostic (WGS84, strings for precision). */
export interface SuggestItem {
  lng: string;
  lat: string;
  name?: string;
  display_name: string;
}

/** A built-in or adapted geocode provider. URL builders return full URLs;
 *  normalizers map a raw API response to the shared shape above. */
export interface GeocodeProvider {
  id: string;
  /** Client-side minimum ms between requests to this provider. */
  throttleMs: number;
  /** Extra request headers sent with every call (e.g. Photon's X-User-Agent). */
  headers: Record<string, string>;
  suggest(
    q: string,
    limit: number,
    center: [number, number] | null,
    code: string,
  ): string;
  search(q: string, code: string): string;
  reverse(lng: number, lat: number, code: string): string;
  normalizeSuggest(data: unknown): SuggestItem[];
  normalizeSearch(data: unknown): SuggestItem | null;
  normalizeReverse(data: unknown): string;
}

/** Declarative operation config for a custom provider. */
export interface ProviderOpConfig {
  /** URL template; supports the {q} {limit} {lon} {lat} placeholders. */
  url: string;
  /** Static extra query params merged into the template URL. */
  params?: Record<string, string | number>;
}

/**
 * Declarative (JSON-serializable) custom provider definition.
 *
 * Passed from the Python layer as the `provider` kwarg. Normalizers are
 * single-arg arrow-function source strings eval'd with a guard — CONF is
 * authored by the map creator, never by end users.
 */
export interface ProviderConfig {
  id: string;
  /** Optional base URL prefix; resolved before each op's `url`. */
  baseUrl?: string;
  throttleMs?: number;
  headers?: Record<string, string>;
  suggest?: ProviderOpConfig;
  search?: ProviderOpConfig;
  reverse?: ProviderOpConfig;
  normalize?: {
    suggest?: string;
    search?: string;
    reverse?: string;
  };
}

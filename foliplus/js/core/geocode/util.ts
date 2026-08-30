// Pure helpers for the geocode provider layer (URL templates + normalizers).
import type { SuggestItem } from "./type.js";

const TEMPLATE_RE = /\{(\w+)\}/g;

/** Interpolate {q}/{limit}/{lon}/{lat} placeholders in a URL template. */
const interpolate = (template: string, vars: Record<string, string | number>): string =>
  template.replace(TEMPLATE_RE, (match, key: string) =>
    key in vars && vars[key] !== "" ? encodeURIComponent(String(vars[key])) : match,
  );

/** Resolve an operation URL against an optional base URL prefix. */
const joinUrl = (baseUrl: string | undefined, url: string): string => {
  if (!baseUrl || /^https?:\/\//i.test(url)) return url;
  return baseUrl.replace(/\/+$/, "") + "/" + url.replace(/^\/+/, "");
};

/** Append static params to a URL (null/undefined values are skipped). */
const withParams = (url: string, params?: Record<string, string | number>): string => {
  if (!params || url === "") return url;
  const parsed = new URL(url);
  for (const [k, v] of Object.entries(params))
    if (v != null) parsed.searchParams.set(k, String(v));
  return parsed.toString();
};

/**
 * Eval a single-arg arrow-function source string with a narrow structural
 * guard. Throws on anything that is not `(x) => …` / `x => …` — CONF is
 * authored by the map creator, so a malformed normalizer should fail loudly
 * at config time rather than silently at runtime.
 */
const safeEval = (source: string): ((data: unknown) => unknown) => {
  const invalid = () =>
    new Error(`[foliplus] invalid normalizer: ${source.slice(0, 40)}`);
  if (!/^\s*\(?\s*[A-Za-z_$][\w$]*\s*\)?\s*=>/.test(source)) throw invalid();
  let fn: unknown;
  try {
    // eslint-disable-next-line no-eval
    fn = (0, eval)(source);
  } catch {
    throw invalid();
  }
  if (typeof fn !== "function") throw invalid();
  return fn as (data: unknown) => unknown;
};

/** Coerce an arbitrary value into a `SuggestItem[]` (drops non-array results). */
const toItems = (value: unknown): SuggestItem[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is SuggestItem =>
      v != null &&
      typeof v === "object" &&
      "lng" in v &&
      "lat" in v &&
      "display_name" in v,
  );
};

/**
 * Map a GeoJSON FeatureCollection (Photon/Pelias both return one) to
 * `SuggestItem[]`. `displayNameOf` builds the display string from the
 * feature's `properties`.
 */
const featuresToItems = (
  data: unknown,
  displayNameOf: (props: Record<string, unknown>) => string,
): SuggestItem[] => {
  const features = (data as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const out: SuggestItem[] = [];
  for (const f of features as Array<{
    geometry?: { coordinates?: unknown };
    properties?: Record<string, unknown>;
  }>) {
    const coords = f?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const props = f?.properties ?? {};
    out.push({
      lng: String(coords[0]),
      lat: String(coords[1]),
      name: typeof props.name === "string" ? props.name : undefined,
      display_name: displayNameOf(props),
    });
  }
  return out;
};

export { featuresToItems, interpolate, joinUrl, safeEval, toItems, withParams };

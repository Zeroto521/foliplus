// Geocode provider registry — resolves a provider spec (built-in id, built-in
// id + overrides, or a declarative custom provider) to a concrete
// `GeocodeProvider`. Pure lookup — no mutable global state.
import { createNominatim } from "./nominatim.js";
import { createPelias } from "./pelias.js";
import { createPhoton } from "./photon.js";
import type { GeocodeProvider, ProviderConfig, SuggestItem } from "./type.js";
import { interpolate, joinUrl, safeEval, toItems, withParams } from "./util.js";

type ProviderFactory = (baseUrl: string) => GeocodeProvider;

const BUILTIN_FACTORIES: Record<string, ProviderFactory> = {
  nominatim: createNominatim,
  photon: createPhoton,
  pelias: createPelias,
};

const BUILTIN_PROVIDERS: Record<string, GeocodeProvider> = {
  nominatim: createNominatim(),
  photon: createPhoton(),
  pelias: createPelias(),
};

/** Overrides a built-in provider's `baseUrl`/`throttleMs`/`headers` from config. */
const applyConfig = (
  provider: GeocodeProvider,
  factory: ProviderFactory,
  config: Record<string, unknown>,
): GeocodeProvider => {
  const baseUrl =
    typeof config.baseUrl === "string" && config.baseUrl !== ""
      ? config.baseUrl
      : undefined;
  const next = baseUrl ? factory(baseUrl) : provider;
  return {
    ...next,
    throttleMs:
      typeof config.throttleMs === "number" ? config.throttleMs : next.throttleMs,
    headers: {
      ...next.headers,
      ...(config.headers && typeof config.headers === "object"
        ? (config.headers as Record<string, string>)
        : {}),
    },
  };
};

/**
 * Build a `GeocodeProvider` from a declarative (JSON-serializable) config.
 * Normalizer sources are eval'd via `safeEval`, which throws on malformed input.
 */
const providerFromConfig = (config: ProviderConfig): GeocodeProvider => {
  if (!config.id) throw new Error("[foliplus] custom provider requires an id");

  const norm = config.normalize ?? {};
  const normalizeSuggestFn = norm.suggest ? safeEval(norm.suggest) : null;
  const normalizeSearchFn = norm.search ? safeEval(norm.search) : null;
  const normalizeReverseFn = norm.reverse ? safeEval(norm.reverse) : null;

  const buildUrl = (
    op?: ProviderConfig["suggest"],
    vars?: Record<string, string | number>,
  ): string => {
    if (!op || !op.url) return "";
    const template = joinUrl(config.baseUrl, op.url);
    const interpolated = vars ? interpolate(template, vars) : template;
    return withParams(interpolated, op.params);
  };

  return {
    id: config.id,
    throttleMs: config.throttleMs ?? 1000,
    headers: config.headers ?? {},
    suggest(q, limit, center, code) {
      return buildUrl(config.suggest, {
        q,
        limit,
        lon: center ? center[0] : "",
        lat: center ? center[1] : "",
      });
    },
    search(q, code) {
      return buildUrl(config.search, { q });
    },
    reverse(lng, lat, code) {
      return buildUrl(config.reverse, { lon: lng, lat });
    },
    normalizeSuggest(data) {
      return normalizeSuggestFn ? toItems(normalizeSuggestFn(data)) : [];
    },
    normalizeSearch(data) {
      if (!normalizeSearchFn) return null;
      const out = normalizeSearchFn(data);
      // A search normalizer may return a single item or an array of items.
      const items = toItems(Array.isArray(out) ? out : [out]);
      return items[0] ?? null;
    },
    normalizeReverse(data) {
      if (!normalizeReverseFn) return "";
      const out = normalizeReverseFn(data);
      return typeof out === "string" ? out : "";
    },
  };
};

/**
 * Resolve a provider spec to a concrete `GeocodeProvider`.
 *
 * - `undefined` → the built-in Nominatim provider.
 * - string → a built-in provider id; unknown ids throw.
 * - object → a declarative custom provider via `providerFromConfig`.
 * - `config` overrides `baseUrl`/`throttleMs`/`headers` on a string provider.
 */
const resolveProvider = (
  provider?: string | ProviderConfig,
  config?: Record<string, unknown> | null,
): GeocodeProvider => {
  if (typeof provider === "string") {
    const factory = BUILTIN_FACTORIES[provider];
    if (!factory) throw new Error(`[foliplus] unknown geocode provider: ${provider}`);
    return config && Object.keys(config).length
      ? applyConfig(BUILTIN_PROVIDERS[provider], factory, config)
      : BUILTIN_PROVIDERS[provider];
  }
  if (provider && typeof provider === "object") return providerFromConfig(provider);
  return BUILTIN_PROVIDERS.nominatim;
};

export { BUILTIN_FACTORIES, BUILTIN_PROVIDERS, providerFromConfig, resolveProvider };

import { describe, expect, it } from "vitest";
import {
  BUILTIN_PROVIDERS,
  providerFromConfig,
  resolveProvider,
} from "#core/geocode/registry.js";

describe("resolveProvider", () => {
  it("defaults to Nominatim when called with no arguments", () => {
    expect(resolveProvider().id).toBe("nominatim");
  });

  it("resolves built-in ids", () => {
    expect(resolveProvider("photon").id).toBe("photon");
    expect(resolveProvider("pelias").id).toBe("pelias");
  });

  it("throws on an unknown provider id", () => {
    expect(() => resolveProvider("bogus")).toThrow(/unknown geocode provider/);
  });

  it("applies provider_config overrides to a built-in", () => {
    const provider = resolveProvider("photon", {
      baseUrl: "https://photon.example.com",
      throttleMs: 1234,
      headers: { "X-Custom": "yes" },
    });
    expect(provider.id).toBe("photon");
    expect(provider.throttleMs).toBe(1234);
    expect(provider.headers["X-User-Agent"]).toBeTruthy(); // built-in preserved
    expect(provider.headers["X-Custom"]).toBe("yes");
    expect(provider.search("Berlin", "en")).toContain("photon.example.com");
  });

  it("ignores an empty provider_config", () => {
    expect(resolveProvider("nominatim", {})).toBe(BUILTIN_PROVIDERS.nominatim);
  });

  it("keeps the built-in baseUrl when provider_config.baseUrl is empty", () => {
    const provider = resolveProvider("photon", { baseUrl: "" });
    expect(provider.search("Berlin", "en")).toContain("photon.komoot.io");
  });
});

describe("providerFromConfig", () => {
  const custom = {
    id: "myapi",
    baseUrl: "https://geo.example.com",
    throttleMs: 300,
    headers: { Authorization: "Bearer t" },
    suggest: { url: "/suggest?q={q}&limit={limit}&lon={lon}&lat={lat}" },
    search: { url: "/search?q={q}" },
    reverse: { url: "/reverse?lon={lon}&lat={lat}", params: { lang: "en" } },
    normalize: {
      suggest:
        "d => (d.results || []).map(r => ({ lng: String(r.lon), lat: String(r.lat), display_name: r.label || '' }))",
      search:
        "d => d.results && d.results[0] ? { lng: String(d.results[0].lon), lat: String(d.results[0].lat), display_name: d.results[0].label } : null",
      reverse: "d => (d && d.label) || ''",
    },
  };

  it("builds URLs from templates and static params", () => {
    const provider = providerFromConfig(custom);
    expect(provider.suggest("Berlin", 5, [13.4, 52.5], "en")).toBe(
      "https://geo.example.com/suggest?q=Berlin&limit=5&lon=13.4&lat=52.5",
    );
    expect(provider.search("Berlin", "en")).toBe(
      "https://geo.example.com/search?q=Berlin",
    );
    expect(provider.reverse(13.4, 52.5, "en")).toBe(
      "https://geo.example.com/reverse?lon=13.4&lat=52.5&lang=en",
    );
  });

  it("applies custom headers and throttle", () => {
    const provider = providerFromConfig(custom);
    expect(provider.headers.Authorization).toBe("Bearer t");
    expect(provider.throttleMs).toBe(300);
  });

  it("evaluates normalizers", () => {
    const provider = providerFromConfig(custom);
    const raw = { results: [{ lon: 1, lat: 2, label: "A" }] };
    expect(provider.normalizeSuggest(raw)).toEqual([
      { lng: "1", lat: "2", name: undefined, display_name: "A" },
    ]);
    expect(provider.normalizeSearch(raw)).toEqual({
      lng: "1",
      lat: "2",
      name: undefined,
      display_name: "A",
    });
    expect(provider.normalizeReverse({ label: "B" })).toBe("B");
  });

  it("interpolates the {code} / {lang} placeholders from the locale", () => {
    const provider = providerFromConfig({
      id: "locale",
      baseUrl: "https://x.example.com",
      search: { url: "/search?q={q}&lang={lang}&code={code}&size={limit}" },
    });
    expect(provider.search("Paris", "zh")).toBe(
      "https://x.example.com/search?q=Paris&lang=zh&code=zh&size=1",
    );
  });

  it("coerces a single-object suggest normalizer result to an array", () => {
    const provider = providerFromConfig({
      id: "single",
      baseUrl: "https://x.example.com",
      suggest: { url: "/suggest?q={q}" },
      normalize: {
        suggest: "d => ({ lng: '1', lat: '2', display_name: 'A' })",
      },
    });
    expect(provider.normalizeSuggest({})).toEqual([
      { lng: "1", lat: "2", name: undefined, display_name: "A" },
    ]);
  });

  it("returns empty results when no normalizer is provided", () => {
    const provider = providerFromConfig({
      id: "bare",
      baseUrl: "https://x.example.com",
      search: { url: "/search?q={q}" },
    });
    expect(provider.normalizeSuggest({})).toEqual([]);
    expect(provider.normalizeSearch({})).toBeNull();
    expect(provider.normalizeReverse({})).toBe("");
  });

  it("throws on a missing id", () => {
    expect(() =>
      providerFromConfig({ baseUrl: "https://x.example.com" } as never),
    ).toThrow(/requires an id/);
  });

  it("throws on an invalid normalizer source", () => {
    expect(() =>
      providerFromConfig({
        id: "bad",
        baseUrl: "https://x.example.com",
        search: { url: "/search?q={q}" },
        normalize: { search: "not an arrow function" },
      }),
    ).toThrow(/invalid normalizer/);
  });

  it("yields an empty URL for an operation that is not configured", () => {
    const provider = providerFromConfig({
      id: "no-search",
      baseUrl: "https://x.example.com",
      suggest: { url: "/suggest?q={q}" },
    });
    expect(provider.search("q", "en")).toBe("");
    expect(provider.reverse(1, 2, "en")).toBe("");
  });
});

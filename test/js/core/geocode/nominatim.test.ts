import { describe, expect, it } from "vitest";
import { createNominatim, formatAddress, nominatimUrl } from "#core/geocode/index.js";

const provider = createNominatim();

describe("nominatimUrl", () => {
  it("builds a search URL with default params", () => {
    const url = nominatimUrl("/search", { q: "Paris" });
    expect(url).toContain("nominatim.openstreetmap.org/search");
    expect(url).toContain("format=jsonv2");
    expect(url).toContain("q=Paris");
    expect(url).toContain("accept-language=en");
  });

  it("includes all non-null params", () => {
    const url = nominatimUrl("/reverse", {
      lat: "30",
      lon: "120",
      zoom: 18,
      nullVal: null,
    });
    expect(url).toContain("lat=30");
    expect(url).toContain("lon=120");
    expect(url).toContain("zoom=18");
    expect(url).not.toContain("nullVal");
  });

  it("uses accept-language from code param", () => {
    const url = nominatimUrl("/search", { q: "test" }, "zh");
    expect(url).toContain("accept-language=zh");
  });

  it("does not override accept-language if already set", () => {
    const url = nominatimUrl("/search", { q: "test", "accept-language": "fr" });
    expect(url).toContain("accept-language=fr");
  });

  it("builds a URL when the endpoint is empty (plain search)", () => {
    const url = nominatimUrl("", { q: "Paris" });
    expect(url).toContain("nominatim.openstreetmap.org/?");
    expect(url).toContain("format=jsonv2");
    expect(url).toContain("q=Paris");
  });
});

describe("formatAddress", () => {
  it("returns empty string for empty input", () => {
    expect(formatAddress("")).toBe("");
    expect(formatAddress(null)).toBe("");
    expect(formatAddress(undefined)).toBe("");
  });

  it("filters postal codes and numeric tokens", () => {
    const input = "Rue de Rivoli, 75001, Paris, France";
    const result = formatAddress(input, undefined, "en");
    expect(result).not.toContain("75001");
    expect(result).toContain("Rue de Rivoli");
    expect(result).toContain("Paris");
    expect(result).toContain("France");
  });

  it("reverses order for Chinese locale", () => {
    const input = "Rue de Rivoli, 75001, Paris, France";
    const result = formatAddress(input, undefined, "zh");
    expect(result).toBe("France,Paris,Rue de Rivoli");
  });

  it("reverses order for domestic map", () => {
    const map = {
      options: { crs: { code: "EPSG:3857" } },
      _layers: { 1: { _url: "https://autonavi.com/tile" } },
    };
    const input = "Some Street, District, Beijing, China";
    const result = formatAddress(input, map, "en");
    expect(result).toBe("China,Beijing,District,Some Street");
  });

  it("keeps original order for foreign maps", () => {
    const map = {
      options: { crs: { code: "EPSG:3857" } },
      _layers: { 1: { _url: "https://tile.openstreetmap.org" } },
    };
    const input = "Broadway, New York, NY, United States";
    const result = formatAddress(input, map, "en");
    expect(result).toBe("Broadway,New York,NY,United States");
  });

  it("returns empty when all parts are filtered", () => {
    expect(formatAddress("12345", undefined, "en")).toBe("");
  });

  it("filters ZIP+4 patterns", () => {
    const input = "Main St, 12345-6789, US";
    const result = formatAddress(input, undefined, "en");
    expect(result).not.toContain("12345-6789");
    expect(result).toContain("Main St");
    expect(result).toContain("US");
  });

  it("filters mixed alphanumeric postal codes like EC1A 1BB", () => {
    const input = "Baker Street, EC1A 1BB, London, UK";
    const result = formatAddress(input, undefined, "en");
    expect(result).not.toContain("EC1A 1BB");
    expect(result).toContain("Baker Street");
    expect(result).toContain("London");
    expect(result).toContain("UK");
  });

  it("filters empty tokens between commas", () => {
    const result = formatAddress("Paris,, France", undefined, "en");
    expect(result).toBe("Paris,France");
  });
});

describe("Nominatim provider — URL building", () => {
  it("builds a suggest URL with query, limit, bias and accept-language", () => {
    const url = provider.suggest("test query", 5, [119.3, 26.08], "zh");
    expect(url).toContain("nominatim.openstreetmap.org/search");
    expect(url).toContain("format=jsonv2");
    expect(url).toContain("q=test+query");
    expect(url).toContain("limit=5");
    expect(url).toContain("lon=119.3");
    expect(url).toContain("lat=26.08");
    expect(url).toContain("accept-language=zh");
  });

  it("omits the bias params when center is null", () => {
    const url = provider.suggest("Paris", 5, null, "en");
    expect(url).not.toContain("lon=");
    expect(url).not.toContain("lat=");
  });

  it("builds a search URL with limit 1", () => {
    const url = provider.search("Paris", "en");
    expect(url).toContain("q=Paris");
    expect(url).toContain("limit=1");
  });

  it("builds a reverse URL with zoom", () => {
    const url = provider.reverse(119.3, 26.08, "en");
    expect(url).toContain("nominatim.openstreetmap.org/reverse");
    expect(url).toContain("lon=119.3");
    expect(url).toContain("lat=26.08");
    expect(url).toContain("zoom=18");
  });

  it("respects a custom baseUrl", () => {
    const custom = createNominatim("https://nominatim.example.com");
    expect(custom.search("Paris", "en")).toContain("nominatim.example.com/search");
  });

  it("accept-language falls back to en when code is empty", () => {
    expect(provider.search("Paris", "")).toContain("accept-language=en");
    expect(provider.reverse(119.3, 26.08, "")).toContain("accept-language=en");
    expect(provider.suggest("Paris", 5, [1, 2], "")).toContain("accept-language=en");
  });
});

describe("Nominatim provider — normalizers", () => {
  it("maps raw lon→lng and drops invalid entries", () => {
    const raw = [
      { lon: "120.0", lat: "30.0", name: "A", display_name: "A, Place" },
      { lng: "121.0", lat: "31.0", display_name: "B" },
      { lat: "32.0" }, // missing lon/lng → dropped
    ];
    const items = provider.normalizeSuggest(raw);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      lng: "120.0",
      lat: "30.0",
      name: "A",
      display_name: "A, Place",
    });
    expect(items[1].lng).toBe("121.0");
  });

  it("normalizeSearch returns the first valid item or null", () => {
    expect(
      provider.normalizeSearch([{ lon: "1", lat: "2", display_name: "X" }]),
    ).toEqual({ lng: "1", lat: "2", name: undefined, display_name: "X" });
    expect(provider.normalizeSearch([])).toBeNull();
    expect(provider.normalizeSearch("not-an-array")).toBeNull();
  });

  it("normalizeReverse extracts display_name (empty when absent)", () => {
    expect(provider.normalizeReverse({ display_name: "Fuzhou,China" })).toBe(
      "Fuzhou,China",
    );
    expect(provider.normalizeReverse({})).toBe("");
  });

  it("normalizeSuggest returns [] for non-array input", () => {
    expect(provider.normalizeSuggest({})).toEqual([]);
    expect(provider.normalizeSuggest(null)).toEqual([]);
  });

  it("normalizes non-string name/display_name to undefined/''", () => {
    const items = provider.normalizeSuggest([
      { lon: "1", lat: "2", name: 123, display_name: 456 },
    ]);
    expect(items[0].name).toBeUndefined();
    expect(items[0].display_name).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { createNominatim } from "#core/geocode/nominatim.js";

const provider = createNominatim();

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
});

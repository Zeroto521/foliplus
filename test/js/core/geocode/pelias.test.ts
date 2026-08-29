import { describe, expect, it } from "vitest";
import { createPelias } from "#core/geocode/pelias.js";

const provider = createPelias();

describe("Pelias provider — URL building", () => {
  it("builds an autocomplete URL with text/size/focus/lang", () => {
    const url = provider.suggest("Berlin", 5, [13.4, 52.5], "de");
    expect(url).toContain("pelias.io/v1/autocomplete");
    expect(url).toContain("text=Berlin");
    expect(url).toContain("size=5");
    expect(url).toContain("focus.point.lon=13.4");
    expect(url).toContain("focus.point.lat=52.5");
    expect(url).toContain("lang=de");
  });

  it("builds a search URL with size 1", () => {
    const url = provider.search("Berlin", "en");
    expect(url).toContain("pelias.io/v1/search");
    expect(url).toContain("text=Berlin");
    expect(url).toContain("size=1");
  });

  it("builds a reverse URL with point.lon/lat", () => {
    const url = provider.reverse(13.4, 52.5, "en");
    expect(url).toContain("pelias.io/v1/reverse");
    expect(url).toContain("point.lon=13.4");
    expect(url).toContain("point.lat=52.5");
  });

  it("respects a custom baseUrl", () => {
    const custom = createPelias("https://geocode.example.com");
    expect(custom.search("Berlin", "en")).toContain("geocode.example.com/v1/search");
  });
});

describe("Pelias provider — normalizers", () => {
  const featureCollection = {
    geocoding: { version: "0.2", query: { text: "Berlin" } },
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { coordinates: [13.405, 52.52] },
        properties: {
          id: "1",
          gid: "g1",
          name: "Berlin",
          label: "Berlin, Germany",
          country: "Germany",
        },
      },
    ],
  };

  it("maps features to items using properties.label", () => {
    const items = provider.normalizeSuggest(featureCollection);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      lng: "13.405",
      lat: "52.52",
      name: "Berlin",
      display_name: "Berlin, Germany",
    });
  });

  it("falls back to name when label is absent", () => {
    const items = provider.normalizeSuggest({
      features: [
        {
          geometry: { coordinates: [13.405, 52.52] },
          properties: { name: "Berlin" },
        },
      ],
    });
    expect(items[0].display_name).toBe("Berlin");
  });

  it("normalizeSearch returns first item, normalizeReverse its display name", () => {
    expect(provider.normalizeSearch(featureCollection)?.display_name).toBe(
      "Berlin, Germany",
    );
    expect(provider.normalizeReverse(featureCollection)).toBe("Berlin, Germany");
  });

  it("omits focus/lang when no bias or locale", () => {
    const url = provider.suggest("Berlin", 5, null, "");
    expect(url).not.toContain("focus.point");
    expect(url).not.toContain("lang=");
  });

  it("search/reverse omit lang when code is empty", () => {
    expect(provider.search("Berlin", "")).not.toContain("lang=");
    expect(provider.reverse(13.4, 52.5, "")).not.toContain("lang=");
  });

  it("display name falls back through label → name → empty", () => {
    const empty = provider.normalizeSuggest({
      features: [{ geometry: { coordinates: [0, 0] }, properties: { label: "" } }],
    });
    expect(empty[0].display_name).toBe("");
    const nameFallback = provider.normalizeSuggest({
      features: [
        { geometry: { coordinates: [0, 0] }, properties: { label: "", name: "X" } },
      ],
    });
    expect(nameFallback[0].display_name).toBe("X");
  });

  it("normalizeSearch/normalizeReverse return null/'' for empty results", () => {
    expect(provider.normalizeSearch({ features: [] })).toBeNull();
    expect(provider.normalizeReverse({ features: [] })).toBe("");
  });
});

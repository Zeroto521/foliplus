import { describe, expect, it } from "vitest";
import { createPhoton } from "#core/geocode/photon.js";

const provider = createPhoton();

describe("Photon provider — URL building", () => {
  it("builds a suggest URL with q/limit/lang/bias", () => {
    const url = provider.suggest("Berlin", 5, [13.4, 52.5], "de");
    expect(url).toContain("photon.komoot.io/api/");
    expect(url).toContain("q=Berlin");
    expect(url).toContain("limit=5");
    expect(url).toContain("lang=de");
    expect(url).toContain("lon=13.4");
    expect(url).toContain("lat=52.5");
  });

  it("omits lang and bias when not provided", () => {
    const url = provider.suggest("Berlin", 5, null, "");
    expect(url).not.toContain("lang=");
    expect(url).not.toContain("lon=");
  });

  it("builds a reverse URL", () => {
    expect(provider.reverse(13.4, 52.5, "de")).toContain("photon.komoot.io/reverse");
  });

  it("requires an X-User-Agent header", () => {
    expect(provider.headers["X-User-Agent"]).toBeTruthy();
  });

  it("respects a custom baseUrl", () => {
    const custom = createPhoton("https://photon.example.com");
    expect(custom.search("Berlin", "en")).toContain("photon.example.com/api/");
  });
});

describe("Photon provider — normalizers", () => {
  const featureCollection = {
    type: "FeatureCollection",
    features: [
      {
        geometry: { coordinates: [13.405, 52.52] },
        properties: {
          name: "Berlin",
          street: "Unter den Linden",
          city: "Berlin",
          country: "Germany",
        },
      },
      {
        geometry: { coordinates: [13.4, 52.5] },
        properties: { name: "Berlin", country: "Germany" },
      },
    ],
  };

  it("maps features to items with a joined display name", () => {
    const items = provider.normalizeSuggest(featureCollection);
    expect(items).toHaveLength(2);
    expect(items[0].lng).toBe("13.405");
    expect(items[0].lat).toBe("52.52");
    expect(items[0].display_name).toBe("Berlin, Unter den Linden, Berlin, Germany");
  });

  it("skips features without coordinates", () => {
    const items = provider.normalizeSuggest({
      features: [{ properties: { name: "No geo" } }],
    });
    expect(items).toHaveLength(0);
  });

  it("returns empty for a non-FeatureCollection payload", () => {
    expect(provider.normalizeSuggest({})).toEqual([]);
    expect(provider.normalizeSuggest(null)).toEqual([]);
  });

  it("normalizeSearch returns first item, normalizeReverse its display name", () => {
    const item = provider.normalizeSearch(featureCollection);
    expect(item?.display_name).toContain("Berlin");
    expect(provider.normalizeReverse(featureCollection)).toBe(item?.display_name);
  });
});

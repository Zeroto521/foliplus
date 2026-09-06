import { describe, expect, it, vi } from "vitest";
import { formatAddress, nominatimUrl } from "#common/geocode.js";

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
});

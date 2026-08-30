import { describe, expect, it } from "vitest";
import { formatAddress } from "#common/geocode.js";

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

  it("drops empty tokens from consecutive or trailing commas", () => {
    expect(formatAddress("Paris,, France,", undefined, "en")).toBe("Paris,France");
  });
});

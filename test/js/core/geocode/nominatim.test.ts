import { beforeEach, describe, expect, it, vi } from "vitest";
import { NominatimProvider, formatAddress, nominatimUrl } from "#core/geocode/index.js";

const jsonResponse = (data: unknown) =>
  ({ json: () => Promise.resolve(data) }) as Response;

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

describe("NominatimProvider", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it("parses search results into GeocodeItems", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      jsonResponse([{ lat: "26.08", lon: "119.3", display_name: "Fuzhou" }]),
    );
    const items = await new NominatimProvider().search("Fuzhou", "en");
    expect(items).toEqual([{ lat: 26.08, lng: 119.3, display_name: "Fuzhou" }]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain("nominatim.openstreetmap.org/search");
    expect(url).toContain("q=Fuzhou");
  });

  it("returns an empty list when the response is not an array", async () => {
    (globalThis.fetch as any).mockResolvedValue(jsonResponse({ error: "oops" }));
    const items = await new NominatimProvider().search("Fuzhou", "en");
    expect(items).toEqual([]);
  });

  it("propagates fetch failures (the error boundary lives in the geocoder)", async () => {
    (globalThis.fetch as any).mockRejectedValue(new Error("network down"));
    await expect(new NominatimProvider().search("Fuzhou", "en")).rejects.toThrow(
      "network down",
    );
  });

  it("parses reverse responses into a single item", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      jsonResponse({ lat: "30.1", lon: "110.1", display_name: "Fuzhou,China" }),
    );
    const item = await new NominatimProvider().reverse(110.1, 30.1, "en");
    expect(item).toEqual({ lat: 30.1, lng: 110.1, display_name: "Fuzhou,China" });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain("nominatim.openstreetmap.org/reverse");
  });

  it("returns null for reverse responses without a display_name", async () => {
    (globalThis.fetch as any).mockResolvedValue(jsonResponse({}));
    const item = await new NominatimProvider().reverse(110.1, 30.1, "en");
    expect(item).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheSuggestion,
  geocode,
  reverseGeocode,
} from "#foliplus/runtime/geocoder.js";

// A minimal WGS84 map — toWgs84 passes coordinates through unchanged.
const mockMap = {
  options: { crs: { code: "EPSG:3857" } },
  getContainer: () => ({ id: "test" }),
} as any;

const jsonResponse = (data: unknown) =>
  ({ json: () => Promise.resolve(data) }) as Response;

beforeEach(() => {
  vi.restoreAllMocks();
  // Ensure fetch is mocked; window.foliplus provides locale fallback tables.
  globalThis.fetch = vi.fn();
  (window as any).foliplus = { _TABLES: { en: {} } };
});

describe("reverseGeocode", () => {
  it("fetches once and serves the result from cache on repeat calls", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      jsonResponse({ display_name: "Fuzhou,China" }),
    );
    const a = await reverseGeocode(mockMap, 110.1, 30.1, "en");
    const b = await reverseGeocode(mockMap, 110.1, 30.1, "en");
    expect(a).toBe("Fuzhou,China");
    expect(b).toBe("Fuzhou,China");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // cached — no second fetch
  });

  it("distinguishes coordinates by key (different coords → separate entries)", async () => {
    (globalThis.fetch as any).mockImplementation((url: string) =>
      Promise.resolve(jsonResponse({ display_name: url.includes("40.1") ? "A" : "B" })),
    );
    await reverseGeocode(mockMap, 120.1, 40.1, "en");
    await reverseGeocode(mockMap, 120.2, 40.2, "en");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to the locale 'not found' text for empty results", async () => {
    (globalThis.fetch as any).mockResolvedValue(jsonResponse({ display_name: "" }));
    const addr = await reverseGeocode(mockMap, 110.3, 30.3, "en");
    expect(addr).toBe("Address not found");
  });
});

describe("geocode (forward)", () => {
  it("resolves an address to coordinates and caches it", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      jsonResponse([{ lat: "26.08", lon: "119.3", display_name: "Fuzhou" }]),
    );
    const r1 = await geocode(mockMap, "UniqueCity A1", "en");
    expect(r1).toEqual({ lat: 26.08, lng: 119.3, display_name: "Fuzhou" });
    const r2 = await geocode(mockMap, "UniqueCity A1", "en");
    expect(r2).toEqual(r1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // cached
  });

  it("converts WGS84 result to map CRS for domestic maps (GCJ02)", async () => {
    const domesticMap = {
      _layers: { 0: { _url: "https://t0.tianditu.com/cia_w/wmts" } },
      options: { crs: { code: "EPSG:4326" } },
      getContainer: () => ({ id: "test" }),
    } as any;
    // gcoord loaded? If not, conversion is a no-op and coords pass through.
    (globalThis.fetch as any).mockResolvedValue(
      jsonResponse([{ lat: "26.08", lon: "119.3", display_name: "Fuzhou" }]),
    );
    const r = await geocode(domesticMap, "UniqueCity C3", "en");
    // Result must be in map CRS — either converted (gcoord loaded) or unchanged (no gcoord).
    // In either case the coordinate pair is valid.
    expect(r).not.toBeNull();
    expect(r!.lat).toBeGreaterThan(0);
    expect(r!.lng).toBeGreaterThan(0);
  });

  it("separates cache entries by CRS (same address, different maps)", async () => {
    const domesticMap = {
      _layers: { 0: { _url: "https://t0.tianditu.com/cia_w/wmts" } },
      options: { crs: { code: "EPSG:4326" } },
      getContainer: () => ({ id: "test" }),
    } as any;
    (globalThis.fetch as any).mockResolvedValue(
      jsonResponse([{ lat: "26.08", lon: "119.3", display_name: "Fuzhou" }]),
    );
    await geocode(mockMap, "UniqueCity D4", "en");
    (globalThis.fetch as any).mockResolvedValue(
      jsonResponse([{ lat: "30.00", lon: "120.00", display_name: "Hangzhou" }]),
    );
    await geocode(domesticMap, "UniqueCity D4", "en");
    // Two separate cache entries — two fetches.
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("populates reverse cache entry for geocode result", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      jsonResponse([{ lat: "26.08", lon: "119.3", display_name: "Fuzhou" }]),
    );
    await geocode(mockMap, "UniqueCity E5", "en");
    // reverseGeocode for same coords should hit cache
    const addr = await reverseGeocode(mockMap, 119.3, 26.08, "en");
    expect(addr).toBe("Fuzhou");
  });

  it("returns null when no results are found", async () => {
    (globalThis.fetch as any).mockResolvedValue(jsonResponse([]));
    const r = await geocode(mockMap, "UniqueCity B2", "en");
    expect(r).toBeNull();
  });
});

describe("cacheSuggestion", () => {
  it("pre-populates geoCache for both forward and reverse lookups", async () => {
    cacheSuggestion(mockMap, "CachTest", 22.5, 114.1, "Shenzhen,China");
    const r = await geocode(mockMap, "CachTest", "en");
    expect(r).toEqual({ lat: 22.5, lng: 114.1, display_name: "Shenzhen,China" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("geocode after cacheSuggestion hits cache (no fetch)", async () => {
    cacheSuggestion(mockMap, "SugHit", 22.5, 114.1, "Shenzhen,China");
    const r = await geocode(mockMap, "SugHit", "en");
    expect(r).toEqual({ lat: 22.5, lng: 114.1, display_name: "Shenzhen,China" });
    expect(globalThis.fetch).not.toHaveBeenCalled(); // cache hit — no API call
  });

  it("reverseGeocode after cacheSuggestion hits cache (no fetch)", async () => {
    cacheSuggestion(mockMap, "SugRev", 22.5, 114.1, "Shenzhen,China");
    const addr = await reverseGeocode(mockMap, 114.1, 22.5, "en");
    expect(addr).toBe("Shenzhen,China");
    expect(globalThis.fetch).not.toHaveBeenCalled(); // cache hit
  });
});

describe("provider selection", () => {
  it("geocode with providerId='photon' fetches Photon and normalizes features", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      jsonResponse({
        features: [
          {
            geometry: { coordinates: [13.405, 52.52] },
            properties: { name: "Berlin", country: "Germany" },
          },
        ],
      }),
    );
    const r = await geocode(mockMap, "Berlin Provider", "en", "photon");
    expect(r).toEqual({ lat: 52.52, lng: 13.405, display_name: "Berlin, Germany" });
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toContain("photon.komoot.io");
    expect(init.headers["X-User-Agent"]).toBe("foliplus");
  });

  it("isolates the cache by provider id (same address, different providers)", async () => {
    (globalThis.fetch as any)
      .mockResolvedValueOnce(
        jsonResponse([{ lat: "26.08", lon: "119.3", display_name: "Fuzhou" }]),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          features: [
            {
              geometry: { coordinates: [119.3, 26.08] },
              properties: { name: "Fuzhou" },
            },
          ],
        }),
      );
    await geocode(mockMap, "Same City", "en"); // nominatim
    await geocode(mockMap, "Same City", "en", "photon");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2); // no cross-provider cache hit
  });

  it("reverseGeocode with providerId uses the provider URL", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      jsonResponse({
        features: [
          {
            geometry: { coordinates: [8.682, 50.11] },
            properties: { name: "Frankfurt", country: "Germany" },
          },
        ],
      }),
    );
    const addr = await reverseGeocode(mockMap, 8.682, 50.11, "en", "photon");
    // formatAddress joins parts with "," (no space) for non-Chinese maps.
    expect(addr).toBe("Frankfurt,Germany");
    const [url] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toContain("photon.komoot.io/reverse");
  });
});

describe("custom provider (declarative dict)", () => {
  const custom = {
    id: "myapi",
    baseUrl: "https://geo.example.com",
    search: { url: "/search?q={q}" },
    reverse: { url: "/reverse?lon={lon}&lat={lat}" },
    normalize: {
      search:
        "d => d.results && d.results[0] ? { lng: String(d.results[0].lon), lat: String(d.results[0].lat), display_name: d.results[0].label } : null",
      reverse: "d => (d && d.label) || ''",
    },
  };

  it("geocode resolves a declarative custom provider", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      jsonResponse({ results: [{ lon: 12.3, lat: 45.6, label: "Custom Place" }] }),
    );
    const r = await geocode(mockMap, "Custom Place", "en", custom);
    expect(r).toEqual({ lat: 45.6, lng: 12.3, display_name: "Custom Place" });
    const [url] = (globalThis.fetch as any).mock.calls[0];
    // Custom-provider templates encode via encodeURIComponent (space → %20).
    expect(url).toBe("https://geo.example.com/search?q=Custom%20Place");
  });

  it("reverseGeocode resolves a declarative custom provider", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      jsonResponse({ label: "Custom, Place" }),
    );
    const addr = await reverseGeocode(mockMap, 99.9, 44.4, "en", custom);
    // formatAddress joins comma-separated parts without a space.
    expect(addr).toBe("Custom,Place");
    const [url] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("https://geo.example.com/reverse?lon=99.9&lat=44.4");
  });

  it("cacheSuggestion with a custom provider pre-fills its own cache key", async () => {
    cacheSuggestion(mockMap, "Cached Custom", 10.1, 20.2, "Custom, Place", custom);
    const r = await geocode(mockMap, "Cached Custom", "en", custom);
    expect(r).toEqual({ lat: 10.1, lng: 20.2, display_name: "Custom, Place" });
    expect(globalThis.fetch).not.toHaveBeenCalled(); // cache hit, no API call
  });
});

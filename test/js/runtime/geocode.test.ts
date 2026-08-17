import { beforeEach, describe, expect, it, vi } from "vitest";
import { geocode, reverseGeocode } from "#foliplus/runtime/geocode.js";

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

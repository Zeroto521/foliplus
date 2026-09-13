import { beforeEach, describe, expect, it, vi } from "vitest";
import { withMapCRS } from "#core/geocode/mapProvider.js";
import type { GeocodeProvider } from "#core/geocode/type.js";

const domesticMap = {
  options: { crs: { code: "EPSG:3857" } },
  _layers: { 1: { _url: "https://webrd01.autonavi.com/tile" } },
} as any;
const foreignMap = {
  options: { crs: { code: "EPSG:3857" } },
  _layers: { 1: { _url: "https://tile.openstreetmap.org" } },
} as any;

const makeProvider = (): GeocodeProvider => ({
  id: "test",
  throttleMs: 0,
  headers: {},
  suggest: vi.fn(
    (q: string, limit: number, center: [number, number] | null) =>
      `s(${q},${String(center)})`,
  ),
  search: vi.fn(),
  reverse: vi.fn((lng: number, lat: number) => `r(${lng},${lat})`),
  normalizeSuggest: vi.fn(() => [{ lng: "100", lat: "20", display_name: "A" }]),
  normalizeSearch: vi.fn(() => ({ lng: "100", lat: "20", display_name: "A" })),
  normalizeReverse: vi.fn(() => "addr"),
});

describe("withMapCRS", () => {
  beforeEach(() => {
    // GCJ02 conversion stub with a fixed +1/+1 offset (see coord.test.ts).
    globalThis.gcoord = {
      BD09: 0,
      GCJ02: 1,
      WGS84: 2,
      transform: vi.fn(([lng, lat]: [number, number]) => [lng + 1, lat + 1]),
    };
  });

  it("converts the suggest bias center map→WGS84 before building the URL", () => {
    const suggest = vi.fn(
      (q: string, limit: number, center: [number, number] | null) =>
        `s(${q},${String(center)})`,
    );
    const wrapped = withMapCRS(
      { ...makeProvider(), suggest } as GeocodeProvider,
      domesticMap,
    );
    const url = wrapped.suggest("x", 5, [120, 30], "en");
    expect(url).toBe("s(x,121,31)");
    expect(suggest).toHaveBeenCalledWith("x", 5, [121, 31], "en");
  });

  it("converts reverse input map→WGS84 before building the URL", () => {
    const wrapped = withMapCRS(makeProvider(), domesticMap);
    expect(wrapped.reverse(120, 30, "en")).toBe("r(121,31)");
  });

  it("converts normalizeSuggest results WGS84→map", () => {
    const wrapped = withMapCRS(makeProvider(), domesticMap);
    const items = wrapped.normalizeSuggest({});
    expect(items[0]).toMatchObject({ lng: "101", lat: "21", display_name: "A" });
  });

  it("converts normalizeSearch results WGS84→map", () => {
    const wrapped = withMapCRS(makeProvider(), domesticMap);
    const item = wrapped.normalizeSearch({});
    expect(item).toMatchObject({ lng: "101", lat: "21" });
  });

  it("passes through on a WGS84 map and when center is null", () => {
    const suggest = vi.fn(
      (q: string, limit: number, center: [number, number] | null) =>
        `s(${q},${String(center)})`,
    );
    const wrapped = withMapCRS(
      { ...makeProvider(), suggest } as GeocodeProvider,
      foreignMap,
    );
    expect(wrapped.suggest("x", 5, [120, 30], "en")).toBe("s(x,120,30)");
    expect(wrapped.suggest("x", 5, null, "en")).toBe("s(x,null)");
    expect(suggest).toHaveBeenNthCalledWith(2, "x", 5, null, "en");
  });

  it("keeps normalizeReverse (address-only) untouched", () => {
    const wrapped = withMapCRS(makeProvider(), domesticMap);
    expect(wrapped.normalizeReverse({})).toBe("addr");
  });
});

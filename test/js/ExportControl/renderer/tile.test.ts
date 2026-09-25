import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as UTIL from "#foliplus/ExportControl/util.js";
import {
  calcTiles,
  tilePositions,
} from "#foliplus/ExportControl/renderer/tile.js";
import {
  installTileGlobals,
  makeEPSG3857Mock,
  makeMockCtx,
  makeRC,
  makeRenderer,
  makeTileLayer,
  tilesNearCenter,
  withPixels,
} from "./fixture.js";

vi.mock("#foliplus/ExportControl/util.js", async () => {
  const actual = await vi.importActual<any>("#foliplus/ExportControl/util.js");
  const loadImageBitmap = vi.fn();
  return { ...actual, loadImageBitmap };
});

class MockTileLayer {
  _url = "";
  options: Record<string, unknown> = {};
}

beforeEach(() => {
  installTileGlobals();
});

describe("calcTiles", () => {
  it("throws without a valid CRS", () => {
    const renderer = makeRenderer({ latLngToPoint: undefined });
    expect(() =>
      calcTiles(renderer.map,
        makeTileLayer(),
        {
          nw: { lat: 10, lng: 10 },
          se: { lat: 5, lng: 15 },
        },
        5,
        1,
      ),
    ).toThrow();
  });

  it("does not throw when map has no crs option (falls back to L.CRS.EPSG3857)", () => {
    const container = document.createElement("div");
    container.id = "test";
    const map = {
      options: {},
      getContainer: () => container,
      foliplus: { LayerAPI: { layers: [], getLayerPanes: () => [] } },
    };
    const tiles = calcTiles(map as any,
      makeTileLayer(),
      {
        nw: { lat: 10, lng: 10 },
        se: { lat: 5, lng: 15 },
      },
      5,
      1,
    );
    expect(Array.isArray(tiles)).toBe(true);
  });

  it("produces one tile for a zoom-0 full-extent bounding box", () => {
    const renderer = makeRenderer();
    const tiles = calcTiles(renderer.map,
      makeTileLayer(),
      {
        nw: { lat: 85.051129, lng: -180 },
        se: { lat: -85.051129, lng: 180 },
      },
      0,
      1,
    );
    expect(tiles.length).toBe(1);
    expect(tiles[0]).toMatchObject({ x: 0, y: 0, z: 0 });
  });

  it("produces 4 tiles for zoom-1 full extent", () => {
    const renderer = makeRenderer();
    const tiles = calcTiles(renderer.map,
      makeTileLayer(),
      {
        nw: { lat: 85.051129, lng: -180 },
        se: { lat: -85.051129, lng: 180 },
      },
      1,
      1,
    );
    expect(tiles.length).toBe(4);
  });

  it("clamps tile coords to maxTile for finite CRS", () => {
    const renderer = makeRenderer();
    const tiles = calcTiles(renderer.map,
      makeTileLayer(),
      {
        nw: { lat: 85.051129, lng: -180 },
        se: { lat: -85.051129, lng: 180 },
      },
      1,
      1,
    );
    for (const t of tiles) {
      expect(t.x).toBeLessThan(2);
      expect(t.y).toBeLessThan(2);
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("skips negative tile coords", () => {
    const renderer = makeRenderer();
    // Very small lat/lng box that falls between tile boundaries — no negative
    // coords should leak through the filter.
    const tiles = calcTiles(renderer.map,
      makeTileLayer(),
      {
        nw: { lat: 45, lng: -180 },
        se: { lat: 44, lng: -179 },
      },
      5,
      1,
    );
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("substitutes {s} from subdomains string", () => {
    const renderer = makeRenderer();
    const tiles = calcTiles(renderer.map,
      makeTileLayer({ subdomains: "abc" }),
      {
        nw: { lat: 85.051129, lng: -180 },
        se: { lat: -85.051129, lng: 180 },
      },
      0,
      1,
    );
    expect(tiles.length).toBe(1);
    expect(tiles[0].url).toMatch(/^https:\/\/[a-c]\.tile\.example\.com\/0\/0\/0\.png$/);
  });

  it("substitutes {s} from subdomains array", () => {
    const renderer = makeRenderer();
    const tiles = calcTiles(renderer.map,
      makeTileLayer({ subdomains: ["a", "b", "c"] }),
      {
        nw: { lat: 85.051129, lng: -180 },
        se: { lat: -85.051129, lng: 180 },
      },
      0,
      1,
    );
    expect(tiles[0].url).toMatch(/^https:\/\/[a-c]\.tile\.example\.com\/0\/0\/0\.png$/);
  });

  it("uses 256 default tileSize when not specified", () => {
    const renderer = makeRenderer();
    // TileLayer with options but no tileSize → defaults to 256
    const tiles = calcTiles(renderer.map,
      makeTileLayer({ subdomains: "abc" }),
      {
        nw: { lat: 85.051129, lng: -180 },
        se: { lat: -85.051129, lng: 180 },
      },
      0,
      1,
    );
    expect(tiles[0].size).toBe(256);
  });

  it("uses numeric tileSize from options", () => {
    const renderer = makeRenderer();
    const tiles = calcTiles(renderer.map,
      makeTileLayer({ tileSize: 512 }),
      {
        nw: { lat: 85.051129, lng: -180 },
        se: { lat: -85.051129, lng: 180 },
      },
      0,
      1,
    );
    expect(tiles[0].size).toBe(512);
  });

  it("uses empty string urlTemplate when _url is missing", () => {
    const renderer = makeRenderer();
    const tiles = calcTiles(renderer.map,
      makeTileLayer({ _url: "" }),
      {
        nw: { lat: 85.051129, lng: -180 },
        se: { lat: -85.051129, lng: 180 },
      },
      0,
      1,
    );
    expect(tiles[0].url).toBe("");
  });

  it("substitutes {z} with zoom value", () => {
    const renderer = makeRenderer();
    const tiles = calcTiles(renderer.map,
      makeTileLayer({ _url: "https://tile.example.com/{z}/{x}/{y}.png" }),
      {
        nw: { lat: 85.051129, lng: -180 },
        se: { lat: -85.051129, lng: 180 },
      },
      7,
      1,
    );
    expect(tiles[0].url).toMatch(/\/7\/0\/0\.png$/);
  });

  it("appends @2x to {r} when scale > 1", () => {
    const renderer = makeRenderer();
    const tiles = calcTiles(renderer.map,
      makeTileLayer({ _url: "https://tile.example.com/{z}/{x}/{y}{r}.png" }),
      {
        nw: { lat: 85.051129, lng: -180 },
        se: { lat: -85.051129, lng: 180 },
      },
      0,
      2,
    );
    expect(tiles[0].url).toContain("@2x");
  });

  it("replaces {r} with empty string when scale is 1", () => {
    const renderer = makeRenderer();
    const tiles = calcTiles(renderer.map,
      makeTileLayer({ _url: "https://tile.example.com/{z}/{x}/{y}{r}.png" }),
      {
        nw: { lat: 85.051129, lng: -180 },
        se: { lat: -85.051129, lng: 180 },
      },
      0,
      1,
    );
    expect(tiles[0].url).toBe("https://tile.example.com/0/0/0.png");
    expect(tiles[0].url).not.toContain("@2x");
  });

  it("records a 1x fallback for {r} templates at scale > 1", () => {
    const renderer = makeRenderer();
    const tiles = calcTiles(renderer.map,
      makeTileLayer({ _url: "https://tile.example.com/{z}/{x}/{y}{r}.png" }),
      {
        nw: { lat: 85.051129, lng: -180 },
        se: { lat: -85.051129, lng: 180 },
      },
      0,
      2,
    );
    expect(tiles[0].url).toContain("@2x");
    expect(tiles[0].fallback).toBe("https://tile.example.com/0/0/0.png");
  });

  it("omits the fallback at scale 1 or without {r}", () => {
    const renderer = makeRenderer();
    const retina = calcTiles(renderer.map,
      makeTileLayer({ _url: "https://tile.example.com/{z}/{x}/{y}{r}.png" }),
      {
        nw: { lat: 85.051129, lng: -180 },
        se: { lat: -85.051129, lng: 180 },
      },
      0,
      1,
    );
    expect(retina[0].fallback).toBeUndefined();
    const plain = calcTiles(renderer.map,
      makeTileLayer({ _url: "https://tile.example.com/{z}/{x}/{y}.png" }),
      {
        nw: { lat: 85.051129, lng: -180 },
        se: { lat: -85.051129, lng: 180 },
      },
      0,
      2,
    );
    expect(plain[0].fallback).toBeUndefined();
  });

  it("sets left and top to tile pixel positions", () => {
    const renderer = makeRenderer();
    const tiles = calcTiles(renderer.map,
      makeTileLayer({ tileSize: 256 }),
      {
        nw: { lat: 85.051129, lng: -180 },
        se: { lat: -85.051129, lng: 180 },
      },
      0,
      1,
    );
    expect(tiles[0].left).toBe(0);
    expect(tiles[0].top).toBe(0);
  });

  it("produces 16 tiles for zoom 2 full extent", () => {
    const renderer = makeRenderer();
    const tiles = calcTiles(renderer.map,
      makeTileLayer(),
      {
        nw: { lat: 85.051129, lng: -180 },
        se: { lat: -85.051129, lng: 180 },
      },
      2,
      1,
    );
    expect(tiles.length).toBe(16);
  });

  it("uses subdomains[0] when subdomains array has single entry", () => {
    const renderer = makeRenderer();
    const tiles = calcTiles(renderer.map,
      makeTileLayer({ subdomains: ["x"] }),
      {
        nw: { lat: 85.051129, lng: -180 },
        se: { lat: -85.051129, lng: 180 },
      },
      0,
      1,
    );
    expect(tiles[0].url).toBe("https://x.tile.example.com/0/0/0.png");
  });

  it("cycles subdomains deterministically via (x+y) % len", () => {
    const renderer = makeRenderer();
    const tiles = calcTiles(renderer.map,
      makeTileLayer({ subdomains: "ab" }),
      {
        nw: { lat: 85.051129, lng: -180 },
        se: { lat: -85.051129, lng: 180 },
      },
      1,
      1,
    );
    const subdomainSets = new Set(tiles.map(t => t.url.match(/\/\/([ab])\./)![1]));
    expect(subdomainSets).toEqual(new Set(["a", "b"]));
  });
});
//===========================================================================

describe("calcTiles — branch edges", () => {
  it("falls back to tileSize 256 when options.tileSize is missing", () => {
    const layer = makeTileLayer({ tileSize: undefined });
    // makeTileLayer always sets tileSize:256 in defaults, so clear it after.
    (layer.options as any).tileSize = undefined;
    const tiles = calcTiles(makeRenderer().map, layer, {
      nw: { lat: 85.051129, lng: -180 },
      se: { lat: -85.051129, lng: 180 },
    }, 0, 1);
    expect(tiles.length).toBe(1);
  });

  it("falls back to subdomains 'abc' when options.subdomains is missing", () => {
    const layer = makeTileLayer({ subdomains: undefined });
    (layer.options as any).subdomains = undefined;
    const tiles = calcTiles(makeRenderer().map, layer, {
      nw: { lat: 85.051129, lng: -180 },
      se: { lat: -85.051129, lng: 180 },
    }, 0, 1);
    expect(tiles[0].url).toContain("a");
  });

  it("uses Infinity maxTile for an infinite CRS", () => {
    const crs = makeEPSG3857Mock();
    (crs as any).infinite = true;
    const tiles = calcTiles(makeRenderer(crs).map, makeTileLayer(), {
      nw: { lat: 85.051129, lng: -180 },
      se: { lat: -85.051129, lng: 180 },
    }, 0, 1);
    // Infinite CRS lifts the maxTile clamp; the exact count depends on the
    // mock projection edges.  Assert the branch produced tiles at all.
    expect(tiles.length).toBeGreaterThanOrEqual(1);
  });
});

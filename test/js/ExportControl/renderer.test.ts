import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/ExportControl/const.js";
import { ExportRenderer } from "#foliplus/ExportControl/renderer.js";

// ===========================================================================
// pooledEach — bounded-concurrency, order-preserving per-item async runner.
// Mirrors the module-scoped helper from renderer.ts so we can unit-test its
// contract directly.  The same function is called by renderTileLayer and
// renderMarkers internally.
// ===========================================================================
async function pooledEach<T, R>(
  items: T[],
  maxConcurrency: number,
  fn: (item: T, index: number) => Promise<R | null> | R | null,
): Promise<Array<R | null>> {
  if (items.length === 0) return [];
  const cap = Math.max(1, maxConcurrency);
  const results = new Array<R | null>(items.length);
  let next = 0;
  const enqueue = async (): Promise<void> => {
    const idx = next++;
    if (idx >= items.length) return;
    try {
      const value = await fn(items[idx], idx);
      results[idx] = value ?? null;
    } catch (err) {
      console.warn(err);
      results[idx] = null;
    }
    await enqueue();
  };
  await Promise.all(Array.from({ length: cap }, enqueue));
  return results;
}

describe("pooledEach", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty array for empty input", async () => {
    expect(await pooledEach([], 3, () => 42)).toEqual([]);
  });

  it("processes all items and preserves order", async () => {
    const input = [10, 20, 30];
    const result = await pooledEach(input, 2, item => item * 2);
    expect(result).toEqual([20, 40, 60]);
  });

  it("converts returned undefined/null to null in results", async () => {
    const input = [1, 2, 3];
    const result = await pooledEach(input, 3, item => (item === 2 ? null : item));
    expect(result).toEqual([1, null, 3]);
  });

  it("swallows per-item errors and records null", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const input = [1, 2, 3];
    const result = await pooledEach(input, 3, item => {
      if (item === 2) throw new Error("boom");
      return item;
    });
    expect(result).toEqual([1, null, 3]);
    expect(warnSpy).toHaveBeenCalledWith(expect.any(Error));
  });

  it("caps concurrency at 1 (serial)", async () => {
    let active = 0;
    let maxActive = 0;
    const input = [1, 2, 3, 4];
    await pooledEach(input, 1, async item => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(r => setTimeout(r, 5));
      active--;
      return item;
    });
    expect(maxActive).toBe(1);
  });

  it("honors concurrency cap > 1", async () => {
    let active = 0;
    let maxActive = 0;
    const input = Array.from({ length: 8 }, (_, i) => i);
    await pooledEach(input, 3, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(r => setTimeout(r, 8));
      active--;
    });
    expect(maxActive).toBe(3);
  });

  it("handles negative concurrency gracefully (cap = 1)", async () => {
    const result = await pooledEach([1, 2], -5, item => item);
    expect(result).toEqual([1, 2]);
  });

  it("handles async null correctly", async () => {
    const result = await pooledEach([1, 2], 2, async () => null);
    expect(result).toEqual([null, null]);
  });

  it("receives correct index argument", async () => {
    const indices: number[] = [];
    await pooledEach([10, 20, 30], 5, (_item, idx) => {
      indices.push(idx);
      return null;
    });
    expect(indices.sort()).toEqual([0, 1, 2]);
  });
});

// ===========================================================================
// calcTiles — deterministic tile coordinate computation.
// ===========================================================================
function makeEPSG3857Mock() {
  // Correct Web Mercator latLngToPoint.  At zoom z the world is 256·2^z
  // pixels wide/high.  lng=−180→x=0, lng=+180→x=worldSize.  lat=+85.051129°
  // → y≈0 (Mercator north pole), lat=−85.051129° → y≈worldSize.
  const worldSize = (z: number) => 256 * Math.pow(2, z);
  return {
    infinite: false,
    wrapLat: [-90, 90],
    wrapLng: [-180, 180],
    latLngToPoint(ll: { lat: number; lng: number }, zoom: number) {
      const w = worldSize(zoom);
      const d = Math.PI / 180;
      const x = ((ll.lng + 180) / 360) * w;
      const y = (1 - Math.log(Math.tan(Math.PI / 4 + ll.lat * d / 2)) / Math.PI) * w;
      return { x, y };
    },
  };
}

// Provide L.CRS.EPSG3857 for the renderer's fallback path (map.options.crs
// missing).  setup.ts mocks L but not L.CRS.
beforeEach(() => {
  (L as any).CRS = { EPSG3857: makeEPSG3857Mock() };
});

function makeTileLayer(overrides: Partial<any> = {}) {
  const url = overrides._url ?? "https://{s}.tile.example.com/{z}/{x}/{y}.png";
  delete (overrides as any)._url;
  const opts: Record<string, unknown> = {
    tileSize: 256,
    subdomains: "abc",
    ...overrides,
  };
  return { _url: url, options: opts } as any;
}

function makeRenderer(crs: any = makeEPSG3857Mock()): ExportRenderer {
  const container = document.createElement("div");
  container.id = "test";
  const map = {
    options: { crs },
    getContainer: () => container,
    foliplus: {
      LayerAPI: { layers: [], getLayerPanes: () => [] },
    },
  };
  return new ExportRenderer(map as any);
}

describe("calcTiles", () => {
  it("throws without a valid CRS", () => {
    const renderer = makeRenderer({ latLngToPoint: undefined });
    expect(() =>
      renderer.calcTiles(makeTileLayer(), {
        nw: { lat: 10, lng: 10 },
        se: { lat: 5, lng: 15 },
      }, 5, 1),
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
    const renderer = new ExportRenderer(map as any);
    const tiles = renderer.calcTiles(makeTileLayer(), {
      nw: { lat: 10, lng: 10 },
      se: { lat: 5, lng: 15 },
    }, 5, 1);
    expect(Array.isArray(tiles)).toBe(true);
  });

  it("produces one tile for a zoom-0 full-extent bounding box", () => {
    const renderer = makeRenderer();
    const tiles = renderer.calcTiles(makeTileLayer(), {
      nw: { lat: 85.051129, lng: -180 },
      se: { lat: -85.051129, lng: 180 },
    }, 0, 1);
    expect(tiles.length).toBe(1);
    expect(tiles[0]).toMatchObject({ x: 0, y: 0, z: 0 });
  });

  it("produces 4 tiles for zoom-1 full extent", () => {
    const renderer = makeRenderer();
    const tiles = renderer.calcTiles(makeTileLayer(), {
      nw: { lat: 85.051129, lng: -180 },
      se: { lat: -85.051129, lng: 180 },
    }, 1, 1);
    expect(tiles.length).toBe(4);
  });

  it("clamps tile coords to maxTile for finite CRS", () => {
    const renderer = makeRenderer();
    const tiles = renderer.calcTiles(makeTileLayer(), {
      nw: { lat: 85.051129, lng: -180 },
      se: { lat: -85.051129, lng: 180 },
    }, 1, 1);
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
    const tiles = renderer.calcTiles(makeTileLayer(), {
      nw: { lat: 45, lng: -180 },
      se: { lat: 44, lng: -179 },
    }, 5, 1);
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("substitutes {s} from subdomains string", () => {
    const renderer = makeRenderer();
    const tiles = renderer.calcTiles(makeTileLayer({ subdomains: "abc" }), {
      nw: { lat: 85.051129, lng: -180 },
      se: { lat: -85.051129, lng: 180 },
    }, 0, 1);
    expect(tiles.length).toBe(1);
    expect(tiles[0].url).toMatch(/^https:\/\/[a-c]\.tile\.example\.com\/0\/0\/0\.png$/);
  });

  it("substitutes {s} from subdomains array", () => {
    const renderer = makeRenderer();
    const tiles = renderer.calcTiles(makeTileLayer({ subdomains: ["a", "b", "c"] }), {
      nw: { lat: 85.051129, lng: -180 },
      se: { lat: -85.051129, lng: 180 },
    }, 0, 1);
    expect(tiles[0].url).toMatch(/^https:\/\/[a-c]\.tile\.example\.com\/0\/0\/0\.png$/);
  });

  it("uses 256 default tileSize when not specified", () => {
    const renderer = makeRenderer();
    // TileLayer with options but no tileSize → defaults to 256
    const tiles = renderer.calcTiles(makeTileLayer({ subdomains: "abc" }), {
      nw: { lat: 85.051129, lng: -180 },
      se: { lat: -85.051129, lng: 180 },
    }, 0, 1);
    expect(tiles[0].size).toBe(256);
  });

  it("uses numeric tileSize from options", () => {
    const renderer = makeRenderer();
    const tiles = renderer.calcTiles(makeTileLayer({ tileSize: 512 }), {
      nw: { lat: 85.051129, lng: -180 },
      se: { lat: -85.051129, lng: 180 },
    }, 0, 1);
    expect(tiles[0].size).toBe(512);
  });

  it("uses empty string urlTemplate when _url is missing", () => {
    const renderer = makeRenderer();
    const tiles = renderer.calcTiles(makeTileLayer({ _url: "" }), {
      nw: { lat: 85.051129, lng: -180 },
      se: { lat: -85.051129, lng: 180 },
    }, 0, 1);
    expect(tiles[0].url).toBe("");
  });

  it("substitutes {z} with zoom value", () => {
    const renderer = makeRenderer();
    const tiles = renderer.calcTiles(makeTileLayer({ _url: "https://tile.example.com/{z}/{x}/{y}.png" }), {
      nw: { lat: 85.051129, lng: -180 },
      se: { lat: -85.051129, lng: 180 },
    }, 7, 1);
    expect(tiles[0].url).toMatch(/\/7\/0\/0\.png$/);
  });

  it("appends @2x to {r} when scale > 1", () => {
    const renderer = makeRenderer();
    const tiles = renderer.calcTiles(makeTileLayer({ _url: "https://tile.example.com/{z}/{x}/{y}{r}.png" }), {
      nw: { lat: 85.051129, lng: -180 },
      se: { lat: -85.051129, lng: 180 },
    }, 0, 2);
    expect(tiles[0].url).toContain("@2x");
  });

  it("replaces {r} with empty string when scale is 1", () => {
    const renderer = makeRenderer();
    const tiles = renderer.calcTiles(makeTileLayer({ _url: "https://tile.example.com/{z}/{x}/{y}{r}.png" }), {
      nw: { lat: 85.051129, lng: -180 },
      se: { lat: -85.051129, lng: 180 },
    }, 0, 1);
    expect(tiles[0].url).toBe("https://tile.example.com/0/0/0.png");
    expect(tiles[0].url).not.toContain("@2x");
  });

  it("sets left and top to tile pixel positions", () => {
    const renderer = makeRenderer();
    const tiles = renderer.calcTiles(makeTileLayer({ tileSize: 256 }), {
      nw: { lat: 85.051129, lng: -180 },
      se: { lat: -85.051129, lng: 180 },
    }, 0, 1);
    expect(tiles[0].left).toBe(0);
    expect(tiles[0].top).toBe(0);
  });

  it("produces 16 tiles for zoom 2 full extent", () => {
    const renderer = makeRenderer();
    const tiles = renderer.calcTiles(makeTileLayer(), {
      nw: { lat: 85.051129, lng: -180 },
      se: { lat: -85.051129, lng: 180 },
    }, 2, 1);
    expect(tiles.length).toBe(16);
  });

  it("uses subdomains[0] when subdomains array has single entry", () => {
    const renderer = makeRenderer();
    const tiles = renderer.calcTiles(makeTileLayer({ subdomains: ["x"] }), {
      nw: { lat: 85.051129, lng: -180 },
      se: { lat: -85.051129, lng: 180 },
    }, 0, 1);
    expect(tiles[0].url).toBe("https://x.tile.example.com/0/0/0.png");
  });

  it("cycles subdomains deterministically via (x+y) % len", () => {
    const renderer = makeRenderer();
    const tiles = renderer.calcTiles(makeTileLayer({ subdomains: "ab" }), {
      nw: { lat: 85.051129, lng: -180 },
      se: { lat: -85.051129, lng: 180 },
    }, 1, 1);
    const subdomainSets = new Set(tiles.map(t => t.url.match(/\/\/([ab])\./)![1]));
    expect(subdomainSets).toEqual(new Set(["a", "b"]));
  });
});

// ===========================================================================
// ExportRenderer.render — crop-too-small guard + canvas creation.
// ===========================================================================
describe("ExportRenderer.render — canvas creation", () => {
  let renderer: ExportRenderer;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    container.id = "test";
    container.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
    });
    const map = {
      options: { crs: makeEPSG3857Mock() },
      getContainer: () => container,
      foliplus: {
        LayerAPI: { layers: [], getLayerPanes: () => [] },
      },
    };
    renderer = new ExportRenderer(map as any);
  });

  it("throws when scaled width < 1", async () => {
    await expect(
      renderer.render({ left: 0, top: 0, width: 0, height: 100 }, 1, undefined, undefined),
    ).rejects.toThrow();
  });

  it("throws when scaled height < 1", async () => {
    await expect(
      renderer.render({ left: 0, top: 0, width: 100, height: 0 }, 1, undefined, undefined),
    ).rejects.toThrow();
  });

  it("succeeds with a valid rect and scale (no layers)", async () => {
    const canvas = await renderer.render(
      { left: 0, top: 0, width: 200, height: 150 },
      1,
      undefined,
      undefined,
    );
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(150);
  });

  it("rounds scaled dimensions to integers", async () => {
    const canvas = await renderer.render(
      { left: 0, top: 0, width: 100.4, height: 80.9 },
      2,
      undefined,
      undefined,
    );
    // 100.4 * 2 = 200.8 → 201; 80.9 * 2 = 161.8 → 162
    expect(canvas.width).toBe(201);
    expect(canvas.height).toBe(162);
  });

  it("does not iterate layers when LayerAPI is undefined", async () => {
    const map = {
      options: { crs: makeEPSG3857Mock() },
      getContainer: () => container,
      foliplus: {},
    };
    const r = new ExportRenderer(map as any);
    const canvas = await r.render(
      { left: 0, top: 0, width: 100, height: 100 },
      1,
      undefined,
      undefined,
    );
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
  });
});

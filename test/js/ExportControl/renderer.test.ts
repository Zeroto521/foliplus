import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/ExportControl/const.js";
import { ExportRenderer, pooledEach } from "#foliplus/ExportControl/renderer.js";
import * as UTIL from "#foliplus/ExportControl/util.js";

// renderer.ts captures loadImageBitmap at import time, and the module's
// exports are getters — vi.spyOn(UTIL, "loadImageBitmap") throws inside
// batch.map, the rejection is swallowed by .catch(() => null), and no tile
// ever loads.  Hoisting a factory instead lets the tests control which tiles
// resolve, which is what the drawn-count assertions measure.

vi.mock("#foliplus/ExportControl/util.js", async () => {
  const actual = await vi.importActual<any>("#foliplus/ExportControl/util.js");
  const loadImageBitmap = vi.fn();
  return { ...actual, loadImageBitmap };
});

//=============================================================================
//  pooledEach — bounded-concurrency, order-preserving per-item async runner.
// Exported from renderer.ts so its contract is unit-testable directly.  It
// is what renderTileLayer and renderMarkers call under the hood.
//=============================================================================

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pooledEach", () => {
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
//===========================================================================
// calcTiles — deterministic tile coordinate computation.
//===========================================================================

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
      const y = (1 - Math.log(Math.tan(Math.PI / 4 + (ll.lat * d) / 2)) / Math.PI) * w;
      return { x, y };
    },
  };
}

class MockTileLayer {
  _url = "";
  options: Record<string, unknown> = {};
}

beforeEach(() => {
  (L as any).CRS = { EPSG3857: makeEPSG3857Mock() };
  (L as any).TileLayer = MockTileLayer;
});

function makeTileLayer(overrides: Partial<any> = {}) {
  const url = overrides._url ?? "https://{s}.tile.example.com/{z}/{x}/{y}.png";
  delete (overrides as any)._url;
  const layer = new MockTileLayer();
  layer._url = url;
  layer.options = { tileSize: 256, subdomains: "abc", ...overrides };
  return layer as any;
}

function makeRenderer(crs: any = makeEPSG3857Mock()): ExportRenderer {
  const container = document.createElement("div");
  container.id = "test";
  const map = {
    options: { crs },
    getContainer: () => container,
    foliplus: { LayerAPI: { layers: [], getLayerPanes: () => [] } },
  };
  return new ExportRenderer(map as any);
}
/** jsdom's 2d context is a no-op stub: drawImage silently does nothing, so a
 *  painted-count assertion built on it would always read 0.  Hand a real no-op
 *  context to the draw pass instead, and let the caller count the calls. */

function makeMockCtx() {
  return {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillStyle: "",
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}
/** A RenderCtx with a stubbed context — jsdom canvas backends do not exist, so
 *  the context cannot come from `canvas.getContext("2d")`. */

function makeRC(w: number, h: number, ctx = makeMockCtx(), scale = 1) {
  return {
    ctx,
    rect: { left: 0, top: 0, width: w, height: h },
    scale,
    contRect: { width: w, height: h } as DOMRect,
    cw: w,
    ch: h,
    sw: w,
    sh: h,
  };
}
/** Tiles centred on the container: 1000x1000 crop at zoom 2 keeps every tile
 *  inside the crop rect, so the viewport filter survives all of them. */

const tilesNearCenter = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    x: 1,
    y: 1,
    z: 2,
    url: `url${i}`,
    left: 256 + (i % 3) * 256,
    top: 512 + Math.floor(i / 3) * 256,
    size: 256,
  }));
/** Give every tile real output coordinates so the draw call has something to
 *  paint and the drawn counter can advance. */

const withPixels = (tiles: unknown[]) =>
  tiles.map(t => ({
    ...t,
    dx: (t as any).left,
    dy: (t as any).top,
    dw: (t as any).size,
    dh: (t as any).size,
  }));
/** Resolve loadImageBitmap to a bitmap for every tile.  Without this every
 *  tile is skipped and nothing is ever painted; the mock is module-scoped, so
 *  the call count doubles as the tile count. */

function stubBitmaps() {
  (UTIL.loadImageBitmap as any).mockResolvedValue({
    close: () => undefined,
  });
}

describe("calcTiles", () => {
  it("throws without a valid CRS", () => {
    const renderer = makeRenderer({ latLngToPoint: undefined });
    expect(() =>
      renderer.calcTiles(
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
    const renderer = new ExportRenderer(map as any);
    const tiles = renderer.calcTiles(
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
    const tiles = renderer.calcTiles(
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
    const tiles = renderer.calcTiles(
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
    const tiles = renderer.calcTiles(
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
    const tiles = renderer.calcTiles(
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
    const tiles = renderer.calcTiles(
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
    const tiles = renderer.calcTiles(
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
    const tiles = renderer.calcTiles(
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
    const tiles = renderer.calcTiles(
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
    const tiles = renderer.calcTiles(
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
    const tiles = renderer.calcTiles(
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
    const tiles = renderer.calcTiles(
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
    const tiles = renderer.calcTiles(
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

  it("sets left and top to tile pixel positions", () => {
    const renderer = makeRenderer();
    const tiles = renderer.calcTiles(
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
    const tiles = renderer.calcTiles(
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
    const tiles = renderer.calcTiles(
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
    const tiles = renderer.calcTiles(
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
//  ExportRenderer.render — crop-too-small guard + canvas creation.
//===========================================================================

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
      renderer.render(
        { left: 0, top: 0, width: 0, height: 100 },
        1,
        undefined,
        undefined,
      ),
    ).rejects.toThrow();
  });

  it("throws when scaled height < 1", async () => {
    await expect(
      renderer.render(
        { left: 0, top: 0, width: 100, height: 0 },
        1,
        undefined,
        undefined,
      ),
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
//===========================================================================
//  ExportRenderer.renderTileLayer — onProgress callback.
//  The renderer reports a percentage after each tile batch; it does not
// interpret or format the value, so no locale dependency lands here.
//===========================================================================

describe("ExportRenderer.renderTileLayer — onProgress", () => {
  let renderer: ExportRenderer;
  beforeEach(() => {
    // renderTileLayer reads getZoom/getCenter; the calcTiles spy below makes
    // the map otherwise irrelevant.
    renderer = makeRenderer();
    (renderer.map as any).getZoom = () => 2;
    (renderer.map as any).getCenter = () => ({ lat: 26.08, lng: 119.3 });
  });

  it("reports the cumulative tiles drawn after each batch", async () => {
    const total = CONST.TILE_CONCURRENCY * 2;
    vi.spyOn(renderer, "calcTiles").mockReturnValue(withPixels(tilesNearCenter(total)));
    stubBitmaps();
    const rc = makeRC(4096, 4096);
    const onProgress = vi.fn();

    await renderer.renderTileLayer(
      rc,
      { nw: { lat: 26.1, lng: 119.2 }, se: { lat: 26.0, lng: 119.4 } },
      makeTileLayer(),
      onProgress,
    );

    // One report per batch, counting the tiles actually painted so far —
    // never the batch index, which would credit tiles that were still loading.
    expect(onProgress.mock.calls.map(c => c[0])).toEqual([
      CONST.TILE_CONCURRENCY,
      total,
    ]);
  });

  it("never calls onProgress when no tiles are visible", async () => {
    vi.spyOn(renderer, "calcTiles").mockReturnValue([]);

    const onProgress = vi.fn();
    await renderer.renderTileLayer(
      makeRC(100, 100),
      { nw: { lat: 26.1, lng: 119.2 }, se: { lat: 26.0, lng: 119.4 } },
      makeTileLayer(),
      onProgress,
    );
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("returns early without touching the tile API when geoBounds is invalid", async () => {
    const calcTiles = vi.spyOn(renderer, "calcTiles");

    await renderer.renderTileLayer(
      makeRC(100, 100),
      {} as any,
      makeTileLayer(),
      vi.fn(),
    );
    expect(calcTiles).not.toHaveBeenCalled();
  });

  it("drops tiles that fall outside the crop rect, so the count tracks what is drawn", async () => {
    // 7 tiles enumerated, one sits off the 1536x512 crop: the batch splits and
    // the final report is the surviving count, not the concurrency cap.
    const survivors = withPixels(tilesNearCenter(CONST.TILE_CONCURRENCY + 1)).map(
      (t, k) => ({
        ...t,
        url: `url${k}`,
        left: k * 256,
        dx: k * 256,
      }),
    );
    vi.spyOn(renderer, "tilePositions").mockReturnValue(survivors as any);
    stubBitmaps();

    const onProgress = vi.fn();
    await renderer.renderTileLayer(
      makeRC(1536, 512),
      { nw: { lat: 26.1, lng: 119.2 }, se: { lat: 26.0, lng: 119.4 } },
      makeTileLayer(),
      onProgress,
    );
    expect(onProgress.mock.calls.map(c => c[0])).toEqual([
      CONST.TILE_CONCURRENCY,
      survivors.length,
    ]);
  });

  it("returns without drawing when a tile's drawImage throws", async () => {
    // drawImage is wrapped in a try/catch so one bad tile cannot abort the
    // whole layer: it is simply left out of the count and the rest is drawn.
    vi.spyOn(renderer, "tilePositions").mockReturnValue(
      withPixels(tilesNearCenter(2)).map((t, k) => ({ ...t, url: `url${k}` })) as any,
    );
    stubBitmaps();
    const ctx = makeMockCtx();
    ctx.drawImage.mockImplementation((src?: unknown) => {
      if (src && typeof src === "object" && (src as { _bad?: boolean })._bad)
        throw new Error("draw failed");
    });
    UTIL.loadImageBitmap
      .mockImplementationOnce(() =>
        Promise.resolve({ _bad: true, close: () => {} } as any),
      )
      .mockResolvedValue({ close: () => {} });

    const onProgress = vi.fn();
    await renderer.renderTileLayer(
      makeRC(4096, 4096, ctx),
      { nw: { lat: 26.1, lng: 119.2 }, se: { lat: 26.0, lng: 119.4 } },
      makeTileLayer(),
      onProgress,
    );

    // Only the second tile was painted, so it is the only one that counts.
    expect(onProgress.mock.calls.map(c => c[0])).toEqual([1]);
  });

  it("caps the final batch at the tile count when it is not a multiple of the concurrency", async () => {
    const total = CONST.TILE_CONCURRENCY + 1;
    vi.spyOn(renderer, "calcTiles").mockReturnValue(withPixels(tilesNearCenter(total)));
    stubBitmaps();

    const onProgress = vi.fn();
    await renderer.renderTileLayer(
      makeRC(4096, 4096),
      { nw: { lat: 26.1, lng: 119.2 }, se: { lat: 26.0, lng: 119.4 } },
      makeTileLayer(),
      onProgress,
    );
    // Two batches: a full one, then the single leftover tile — the last report
    // is the tile count, never the concurrency plus one.
    expect(onProgress.mock.calls.map(c => c[0])).toEqual([
      CONST.TILE_CONCURRENCY,
      total,
    ]);
  });

  it("does not count a tile whose bitmap failed to load", async () => {
    vi.spyOn(renderer, "calcTiles").mockReturnValue(
      withPixels(tilesNearCenter(CONST.TILE_CONCURRENCY)),
    );
    (UTIL.loadImageBitmap as any).mockResolvedValue(null);
    makeMockCtx();

    const onProgress = vi.fn();
    await renderer.renderTileLayer(
      makeRC(4096, 4096),
      { nw: { lat: 26.1, lng: 119.2 }, se: { lat: 26.0, lng: 119.4 } },
      makeTileLayer(),
      onProgress,
    );
    // The tile was fetched and enumerated but nothing reached the canvas, so it
    // earns no progress: counting it would say the map is more done than it is.
    expect(onProgress.mock.calls.map(c => c[0])).toEqual([0]);
  });
});

describe("ExportRenderer.render — onProgress across tile layers", () => {
  let renderer: ExportRenderer;
  let savedMapDesc: PropertyDescriptor | undefined;
  let savedLDesc: PropertyDescriptor | undefined;
  beforeEach(() => {
    // render() reads the module-scoped IIFE free variables `map` and `L`.
    // Redefining the globals retargets them, so the renderer's own map doubles
    // as the module's map and L gains a TileLayer constructor for instanceof.
    renderer = makeRenderer();
    (renderer.map as any).getZoom = () => 2;
    (renderer.map as any).getCenter = () => ({ lat: 26.08, lng: 119.3 });
    (renderer.map as any).getPane = () => null;
    savedMapDesc = Object.getOwnPropertyDescriptor(globalThis, "map")!;
    savedLDesc = Object.getOwnPropertyDescriptor(globalThis, "L")!;
    Object.defineProperty(globalThis, "map", {
      configurable: true,
      writable: true,
      value: renderer.map,
    });
    Object.defineProperty(globalThis, "L", {
      configurable: true,
      writable: true,
      value: { ...L, TileLayer: MockTileLayer },
    });
  });
  afterEach(() => {
    if (savedMapDesc) Object.defineProperty(globalThis, "map", savedMapDesc);
    if (savedLDesc) Object.defineProperty(globalThis, "L", savedLDesc);
  });
  const bigCenter = () => {
    (renderer.map.getContainer() as any).getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 1000,
      right: 1000,
      bottom: 1000,
    });
    renderer.map.getCenter = () => ({ lat: 26.08, lng: 119.3 });
  };
  const runRender = (onProgress: (percent: number) => void) =>
    renderer.render(
      { left: 0, top: 0, width: 1000, height: 1000 },
      1,
      undefined,
      { nw: { lat: 26.1, lng: 119.2 }, se: { lat: 26.0, lng: 119.4 } },
      onProgress,
    );

  const stubCanvas = (ctx: CanvasRenderingContext2D = makeMockCtx()) => {
    // render() builds its own canvas and reads getContext on it; point that at
    // the stub so the drawing passes complete in jsdom.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    return ctx;
  };

  it("climbs monotonically across layers and stops short of 100", async () => {
    bigCenter();
    const c = CONST.TILE_CONCURRENCY;
    // The bottom layer has the fewest tiles, so a per-layer denominator would
    // restart the bar at 0 halfway through — the exact regression here.
    stubBitmaps();
    stubCanvas();
    const bottomLayer = makeTileLayer();
    const topLayer = makeTileLayer();
    const counts = new Map<unknown, number>([
      [topLayer, c * 3],
      [bottomLayer, c],
    ]);
    vi.spyOn(renderer, "calcTiles").mockImplementation((tileLayer: unknown) =>
      tilesNearCenter(counts.get(tileLayer) ?? 0),
    );
    // A vector layer, so the layer range is consumed too: it is what lifts the
    // bar from the top of the tile range to the end of render()'s budget.
    const vector = { options: {} };
    renderer.map.foliplus = {
      LayerAPI: {
        layers: [
          { visible: true, layer: bottomLayer },
          { visible: true, layer: topLayer },
          { visible: true, layer: vector },
        ],
        getLayerPanes: () => [],
      },
    };

    const onProgress = vi.fn();
    await runRender(onProgress);

    const got = onProgress.mock.calls.map(call => call[0]);
    // 4 batches across 2 layers, each one a share of all 24 tiles: the bar
    // never resets when the second layer starts.  It caps at 90 rather than
    // 100 — the canvas still has to be encoded, and that is the manager's.
    expect(got[got.length - 1]).toBe(90);
    expect(got).toEqual([...got].sort((a, b) => a - b));
    expect(Math.min(...got)).toBeGreaterThan(0);
  });

  it("skips invisible and non-tile layers when sizing the denominator", async () => {
    bigCenter();
    const visible = makeTileLayer();
    const hidden = makeTileLayer();
    const calcTiles = vi
      .spyOn(renderer, "calcTiles")
      .mockReturnValue(tilesNearCenter(CONST.TILE_CONCURRENCY));
    stubBitmaps();
    stubCanvas();
    renderer.map.foliplus = {
      LayerAPI: {
        layers: [
          { visible: false, layer: hidden },
          // No `layer` at all: an ImageOverlay that has no URL either.
          { visible: true, layer: {} },
          { visible: true, layer: visible },
        ],
        getLayerPanes: () => [],
      },
    };

    const onProgress = vi.fn();
    await runRender(onProgress);

    // Only the visible TileLayer is sized: the hidden one and the non-tile
    // entry are filtered out before the denominator is summed.  Two calls,
    // both for that layer — once to size the denominator and once for the draw
    // pass — which is what keeps numerator and denominator in agreement.
    expect(calcTiles).toHaveBeenCalledTimes(2);
    for (const call of calcTiles.mock.calls) expect(call[0]).toBe(visible);

    const got = onProgress.mock.calls.map(call => call[0]);
    // Tiles take the tile range, then the non-tile entries take the layer
    // range: the bar ends at 90 and never claims 100 inside render().
    expect(got[got.length - 1]).toBe(90);
    expect(Math.max(...got)).toBeLessThan(100);
  });

  it("keeps a positive progress when every tile layer is clipped out of view", async () => {
    (renderer.map.getContainer() as any).getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
    });
    renderer.map.getCenter = () => ({ lat: 26.08, lng: 119.3 });
    stubCanvas();
    const layer = makeTileLayer();
    // All tiles sit far outside the 100x100 crop, so the sized denominator is
    // zero and this layer never reaches the draw pass.
    vi.spyOn(renderer, "calcTiles").mockReturnValue([
      { x: 99, y: 99, z: 2, url: "far", left: 99999, top: 99999, size: 256 },
    ]);
    const renderTileLayer = vi.spyOn(renderer, "renderTileLayer");
    // A vector entry completes the layer range: with no tile layer left, the
    // bar must still leave the 0-70 range rather than sit at 0.
    const vector = { options: {} };
    renderer.map.foliplus = {
      LayerAPI: {
        layers: [
          { visible: true, layer },
          { visible: true, layer: vector },
        ],
        getLayerPanes: () => [],
      },
    };

    const onProgress = vi.fn();
    await renderer.render(
      { left: 0, top: 0, width: 100, height: 100 },
      1,
      undefined,
      { nw: { lat: 26.1, lng: 119.2 }, se: { lat: 26.0, lng: 119.4 } },
      onProgress,
    );

    // A zero denominator must not divide by zero: there is still a vector pass
    // to report, so the bar starts at the layer range instead of staying at 0.
    expect(onProgress.mock.calls.map(call => call[0])).toEqual([71, 90]);
    expect(renderTileLayer).not.toHaveBeenCalled();
  });

  it("excludes a tile layer with no visible tiles from the denominator", async () => {
    bigCenter();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    stubCanvas();
    const emptyLayer = makeTileLayer();
    const realLayer = makeTileLayer();
    vi.spyOn(renderer, "calcTiles").mockImplementation((tileLayer: unknown) =>
      tileLayer === emptyLayer ? [] : tilesNearCenter(CONST.TILE_CONCURRENCY),
    );
    stubBitmaps();
    const renderTileLayer = vi.spyOn(renderer, "renderTileLayer");
    renderer.map.foliplus = {
      LayerAPI: {
        layers: [
          // Enumerates tiles, but none survive the viewport clip.
          { visible: true, layer: emptyLayer },
          { visible: true, layer: realLayer },
        ],
        getLayerPanes: () => [],
      },
    };

    const onProgress = vi.fn();
    await runRender(onProgress);

    const got = onProgress.mock.calls.map(call => call[0]);
    // The empty layer is dropped before the sum, so the denominator is the real
    // layer's tiles only — without that the bar could never reach the top of
    // the tile range, since the empty layer contributes no draws to the total.
    expect(got[got.length - 1]).toBe(70);
    expect(got).toEqual([...got].sort((a, b) => a - b));
    // renderTileLayer is entered only for the layer that has tiles.
    expect(renderTileLayer.mock.calls.map(c => c[2])).toEqual([realLayer]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("reports the layer range instead of tiles when no tile layers are visible", async () => {
    bigCenter();
    stubCanvas();
    const renderTileLayer = vi.spyOn(renderer, "renderTileLayer");
    const calcTiles = vi.spyOn(renderer, "calcTiles");
    // A vector layer, not a TileLayer instance: a makeTileLayer() fixture would
    // pass the `instanceof L.TileLayer` gate and be sized as a tile layer.
    renderer.map.foliplus = {
      LayerAPI: {
        layers: [{ visible: true, layer: { options: {} } }],
        getLayerPanes: () => [],
      },
    };

    const onProgress = vi.fn();
    await runRender(onProgress);

    // No visible tile layer: the tile range is handed straight to the caller
    // rather than reported as 0/0, and the single vector layer consumes the
    // layer range to reach 90.
    expect(calcTiles).not.toHaveBeenCalled();
    expect(renderTileLayer).not.toHaveBeenCalled();
    expect(onProgress.mock.calls.map(call => call[0])).toEqual([71, 90]);
  });
});

describe("ExportRenderer.renderCanvasElement", () => {
  const rectOf = (width: number, height: number, left = 0, top = 0) =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    }) as DOMRect;

  it("skips a canvas with no area", async () => {
    const ctx = makeMockCtx();
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = () => rectOf(0, 0);
    const load = vi.spyOn(UTIL, "loadImage").mockResolvedValue({} as any);

    await new ExportRenderer(makeRenderer().map).renderCanvasElement(
      makeRC(1000, 1000, ctx),
      canvas,
    );

    expect(load).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("draws nothing when loading the canvas data URL fails", async () => {
    const ctx = makeMockCtx();
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = () => rectOf(200, 200, 10, 10);
    const load = vi.spyOn(UTIL, "loadImage").mockRejectedValue(new Error("boom"));

    await new ExportRenderer(makeRenderer().map).renderCanvasElement(
      makeRC(1000, 1000, ctx),
      canvas,
    );

    expect(load).toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});

describe("ExportRenderer.tilePositions", () => {
  const bounds = { nw: { lat: 26.1, lng: 119.2 }, se: { lat: 26.0, lng: 119.4 } };
  // A centre whose zoom-2 projection is (512, 768): lng 0 puts the viewport
  // left edge at 0, and a 1024x768 container puts the viewport top at
  // 768 - 768/2 = 384.  Both sit on tile grid lines, so a tile's destination
  // rect is its world position minus (0, 384) -- arithmetic, no re-projection.
  const CENTER = { lat: 40.97989806962013, lng: 0 };
  const CONCRECT = { width: 1024, height: 768 };
  const makeRC = (w: number, h: number, scale = 1) => {
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    return {
      // jsdom has no canvas backend, so `getContext` throws; tilePositions
      // never draws, it only computes rects.
      ctx: {} as CanvasRenderingContext2D,
      rect: { left: 0, top: 0, width: w, height: h },
      scale,
      contRect: { ...CONCRECT } as DOMRect,
      cw: w * scale,
      ch: h * scale,
      sw: w * scale,
      sh: h * scale,
    };
  };
  const make = () => {
    const renderer = makeRenderer();
    (renderer.map as any).getZoom = () => 2;
    (renderer.map as any).getCenter = () => CENTER;
    return renderer;
  };
  // Real Web Mercator at zoom 2: world 1024x1024, so tile columns/rows 0-3
  // occupy 0-1024 in both axes.  The crop at 0,0/1000x600 therefore reaches
  // into tile 3 on the right and row 2 at the bottom.
  const tile = (url: string, x: number, y: number) => ({
    x,
    y,
    z: 2,
    url,
    left: x * 256,
    top: y * 256,
    size: 256,
  });

  it("keeps overlapping tiles with their destination rect and drops the rest", () => {
    const renderer = make();
    const calcTiles = vi.spyOn(renderer, "calcTiles").mockReturnValue([
      // World 512-768 x 512-768 overlaps the 1000x600 crop; viewport-relative
      // that is 512-768 x 128-384.
      tile("keep", 2, 2),
      // Its viewport bottom is 128, so it lands fully inside the crop and its
      // destination rect keeps the viewport offset.
      tile("inner", 2, 1),
      // Right of the crop: it starts at 1024, past the crop's 1000 right edge.
      tile("right", 4, 2),
      // Above the viewport: its top is 384 above the crop top and its 256
      // height does not reach back, so dy + dh is still negative.
      tile("above", 2, 0),
      // Below the crop: it starts at viewport y 640, past the crop's 600 bottom.
      tile("below", 2, 4),
      // Starts at viewport y 384 and the crop ends at 600, so only 216 of
      // its 256 pixels lie inside -- the filter still keeps it.
      tile("partial", 2, 3),
    ]);
    const survivors = (renderer as any).tilePositions(
      makeRC(1000, 600),
      bounds,
      makeTileLayer(),
    );
    // The filter reads zoom, center and CRS through the map mock, so the tile
    // list is stubbed while the viewport math is real.
    expect(calcTiles).toHaveBeenCalledWith(makeTileLayer(), bounds, 2, 1);
    expect(survivors.length).toBe(3);
    // The destination rect is the viewport position scaled into crop pixels.
    expect(survivors[0]).toMatchObject({
      url: "keep",
      dx: 512,
      dy: 128,
      dw: 256,
      dh: 256,
    });
    expect(survivors[1]).toMatchObject({
      url: "inner",
      dx: 512,
      dy: -128,
      dw: 256,
      dh: 256,
    });
    expect(survivors[2]).toMatchObject({
      url: "partial",
      dx: 512,
      dy: 384,
      dw: 256,
      dh: 256,
    });
    for (const url of ["right", "above", "below"])
      expect(survivors.map((t: any) => t.url)).not.toContain(url);
  });

  it("scales the destination rect by the render scale", () => {
    const renderer = make();
    vi.spyOn(renderer, "calcTiles").mockReturnValue([
      // Viewport-relative 256-512 x 128-384.  At scale 2 the output is
      // 1000x600, so this tile lands at 512-1024 x 256-768 and intersects
      // the crop -- a wider tile here would be clipped out of the output.
      tile("keep", 1, 2),
    ]);
    // A 500x300 crop at scale 2 renders 1000x600 output pixels, so the
    // destination rect is the viewport value multiplied by the scale.
    const survivors = (renderer as any).tilePositions(
      makeRC(500, 300, 2),
      bounds,
      makeTileLayer(),
    );
    expect(survivors.length).toBe(1);
    expect(survivors[0]).toMatchObject({
      url: "keep",
      dx: 512,
      dy: 256,
      dw: 512,
      dh: 512,
    });
  });

  it("returns an empty list when every tile is outside the crop rect", () => {
    const renderer = make();
    vi.spyOn(renderer, "calcTiles").mockReturnValue([tile("far", 9, 9)]);
    expect(
      (renderer as any).tilePositions(makeRC(1000, 600), bounds, makeTileLayer()),
    ).toEqual([]);
  });

  it("falls back to L.CRS.EPSG3857 when the map has no crs option", () => {
    const renderer = makeRenderer(undefined);
    (renderer.map as any).options = {};
    (renderer.map as any).getZoom = () => 2;
    (renderer.map as any).getCenter = () => CENTER;
    vi.spyOn(renderer, "calcTiles").mockReturnValue([tile("keep", 3, 2)]);
    // Must not throw even though only the global L.CRS provides the CRS.
    const survivors = (renderer as any).tilePositions(
      makeRC(1000, 600),
      bounds,
      makeTileLayer(),
    );
    expect(Array.isArray(survivors)).toBe(true);
  });
});

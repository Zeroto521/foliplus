import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/ExportControl/const.js";
import { ExportRenderer, pooledEach } from "#foliplus/ExportControl/renderer.js";
import * as UTIL from "#foliplus/ExportControl/util.js";

// renderer.ts binds its logger to CONF.name at module-import time, so the
// component name has to be set before the import resolves — setup.ts leaves it
// at "SearchControl".  Must run before the import, not in beforeEach.
window.CONF = { ...window.CONF, name: "ExportControl" };

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
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("tile load failed"),
      expect.any(Error),
    );
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
/** renderTileLayer takes the clipped list, not the layer: build the input it
 *  draws by running the real viewport filter over `tilesNearCenter`.  The
 *  filter is what decides the count, so the drawing tests exercise it for
 *  real instead of feeding a hand-built survivor list. */

const rcTiles = (rc: ReturnType<typeof makeRC>, n: number) => {
  const map: any = {
    options: { crs: makeEPSG3857Mock() },
    getZoom: () => 2,
    getCenter: () => ({ lat: 26.08, lng: 119.3 }),
    getContainer: () => document.createElement("div"),
    foliplus: { LayerAPI: { layers: [], getLayerPanes: () => [] } },
  };
  return new ExportRenderer(map).tilePositions(
    rc,
    withPixels(tilesNearCenter(n)),
  ) as any[];
};
/** Resolve loadImageBitmap to a bitmap for every tile.  Without this every
 *  tile is skipped and nothing is ever painted; the mock is module-scoped, so
 *  the call count doubles as the tile count.  Width and height matter for the
 *  sprite maths, so they are parameterised.
 *
 *  The real loader cannot be used here: CONF.timeout is undefined under
 *  vitest's CONF literal, so AbortSignal.timeout(undefined) throws before
 *  fetch is reached and every bitmap comes back null. */

function stubBitmaps(width = 64, height = 64) {
  (UTIL.loadImageBitmap as any).mockResolvedValue({
    width,
    height,
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
  it("reports the cumulative tiles drawn after each batch", async () => {
    const total = CONST.TILE_CONCURRENCY * 2;
    stubBitmaps();
    const rc = makeRC(4096, 4096);
    const onProgress = vi.fn();

    await makeRenderer().renderTileLayer(rc, rcTiles(rc, total), onProgress);

    // One report per batch, counting the tiles actually painted so far —
    // never the batch index, which would credit tiles that were still loading.
    expect(onProgress.mock.calls.map(c => c[0])).toEqual([
      CONST.TILE_CONCURRENCY,
      total,
    ]);
  });

  it("never calls onProgress when no tiles survive the viewport clip", async () => {
    // render() does the clipping before calling, so an empty list is the only
    // way this pass starts.  The early return must not report anything.
    const onProgress = vi.fn();
    await makeRenderer().renderTileLayer(makeRC(100, 100), [], onProgress);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("drops tiles that fall outside the crop rect, so the count tracks what is drawn", async () => {
    // 7 tiles enumerated, one sits off the 1536x512 crop: the batch splits and
    // the final report is the surviving count, not the concurrency cap.
    const survivors = rcTiles(makeRC(1536, 512), CONST.TILE_CONCURRENCY + 1);
    stubBitmaps();

    const onProgress = vi.fn();
    await makeRenderer().renderTileLayer(makeRC(1536, 512), survivors, onProgress);
    expect(onProgress.mock.calls.map(c => c[0])).toEqual([
      CONST.TILE_CONCURRENCY,
      survivors.length,
    ]);
  });

  it("returns without drawing when a tile's drawImage throws", async () => {
    // drawImage is wrapped in a try/catch so one bad tile cannot abort the
    // whole layer: it is simply left out of the count and the rest is drawn.
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
    await makeRenderer().renderTileLayer(
      makeRC(4096, 4096, ctx),
      rcTiles(makeRC(4096, 4096, ctx), 2),
      onProgress,
    );

    // Only the second tile was painted, so it is the only one that counts.
    expect(onProgress.mock.calls.map(c => c[0])).toEqual([1]);
  });

  it("caps the final batch at the tile count when it is not a multiple of the concurrency", async () => {
    const total = CONST.TILE_CONCURRENCY + 1;
    stubBitmaps();

    const onProgress = vi.fn();
    await makeRenderer().renderTileLayer(
      makeRC(4096, 4096),
      rcTiles(makeRC(4096, 4096), total),
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
    (UTIL.loadImageBitmap as any).mockResolvedValue(null);

    const onProgress = vi.fn();
    await makeRenderer().renderTileLayer(
      makeRC(4096, 4096),
      rcTiles(makeRC(4096, 4096), CONST.TILE_CONCURRENCY),
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
    // entry are filtered out before the denominator is summed.  One call —
    // the extent is enumerated once per export and threaded into the draw
    // pass, which is what keeps numerator and denominator in agreement.
    expect(calcTiles).toHaveBeenCalledTimes(1);
    expect(calcTiles.mock.calls[0][0]).toBe(visible);

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
    expect(renderTileLayer.mock.calls.map(c => c[1])).toHaveLength(1);
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

describe("ExportRenderer.render — layer pass routing", () => {
  let savedMapDesc: PropertyDescriptor | undefined;
  let savedLDesc: PropertyDescriptor | undefined;

  beforeEach(() => {
    // render() reads the module-scoped IIFE free variables `map` and `L`.
    // Retargeting them gives this block a renderer whose own map is also the
    // module map, so calcTiles runs unstubbed and the sizing pass works.
    const container = document.createElement("div");
    container.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 1000,
        height: 1000,
        right: 1000,
        bottom: 1000,
      }) as DOMRect;
    const map = {
      options: { crs: makeEPSG3857Mock() },
      getContainer: () => container,
      getZoom: () => 2,
      getCenter: () => ({ lat: 26.08, lng: 119.3 }),
      foliplus: { LayerAPI: { layers: [], getLayerPanes: () => [] } },
    };
    savedMapDesc = Object.getOwnPropertyDescriptor(globalThis, "map");
    savedLDesc = Object.getOwnPropertyDescriptor(globalThis, "L");
    Object.defineProperty(globalThis, "map", {
      configurable: true,
      writable: true,
      value: map,
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

  const runRender = (onProgress: (percent: number) => void) =>
    new ExportRenderer((globalThis as any).map).render(
      { left: 0, top: 0, width: 1000, height: 1000 },
      1,
      undefined,
      { nw: { lat: 26.1, lng: 119.2 }, se: { lat: 26.0, lng: 119.4 } },
      onProgress,
    );

  it("runs the canvas, pane and marker passes for their layer entries", async () => {
    // LayerAPI order is bottom-to-top, so the canvas layer is drawn first: with
    // two layer entries the bar reads 50 then 100 of the layer range.  Each
    // entry is asserted through the pass it exercises, so the routing itself is
    // what the test pins down rather than just the percentages.
    // render() builds its own canvas; point its getContext at a real no-op ctx
    // so the draw passes complete in jsdom.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      makeMockCtx() as any,
    );
    const canvasLayer = document.createElement("canvas");
    canvasLayer.toDataURL = () => "data:image/png;base64,AAEC";
    vi.spyOn(UTIL, "loadImage").mockResolvedValue({} as any);
    canvasLayer.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 200,
        height: 200,
        right: 200,
        bottom: 200,
      }) as DOMRect;

    const paneSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    paneSvg.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 100,
        height: 100,
        right: 100,
        bottom: 100,
      }) as DOMRect;
    paneSvg.appendChild(
      document.createElementNS("http://www.w3.org/2000/svg", "circle"),
    );
    const roots = document.createElement("div");
    roots.appendChild(paneSvg);

    const vector = { options: {} };
    const getLayerPanes = vi.fn(() => ["vector-pane"]);
    const map = (globalThis as any).map;
    map.foliplus = {
      LayerAPI: {
        layers: [
          { visible: true, canvas: canvasLayer },
          { visible: true, layer: makeTileLayer() },
          { visible: true, layer: vector },
        ],
        getLayerPanes,
      },
    };
    map.getPane = (name: string) => (name === "vector-pane" ? roots : null);

    // Prototype spies so the calls survive the instance being built per test,
    // and so the tile passes can be stubbed without re-implementing them.
    const proto = ExportRenderer.prototype as any;
    const spy = (name: string) => vi.spyOn(proto, name);
    const canvas = spy("renderCanvasElement");
    const paneSVG = spy("renderPaneSVG");
    const paneCanvas = spy("renderPaneCanvas");
    const tileLayer = spy("renderTileLayer");
    // The draw pass reports one step per batch, so the callback is what puts a
    // number on the bar at all.
    tileLayer.mockImplementation(async (_rc: any, _tiles: any, cb: any) => {
      cb(1);
    });
    const markers = spy("collectLayerMarkers");
    // render() reads collectLayerMarkers' return value to decide whether the
    // marker passes run, so an empty stub keeps them out of this test's scope.
    markers.mockResolvedValue([] as any);
    const markerPasses = spy("renderMarkers");
    const iconPasses = spy("renderFontAwesome");
    const textPasses = spy("renderTextLabels");
    const remainingPasses = spy("renderRemaining");

    const onProgress = vi.fn();
    await runRender(onProgress);

    expect(canvas).toHaveBeenCalledWith(expect.anything(), canvasLayer);
    expect(paneSVG).toHaveBeenCalledWith(expect.anything(), roots);
    expect(paneCanvas).toHaveBeenCalledWith(expect.anything(), roots);
    expect(getLayerPanes).toHaveBeenCalledWith(vector);
    expect(markers).toHaveBeenCalledWith(vector);
    expect(markerPasses).not.toHaveBeenCalled();
    expect(iconPasses).not.toHaveBeenCalled();
    expect(textPasses).not.toHaveBeenCalled();
    expect(remainingPasses).not.toHaveBeenCalled();
    // One full-size tile is the whole extent, so the tile phase closes at 70
    // rather than stepping partway; the three layer entries then walk the
    // layer range to its top at 90.
    expect(onProgress.mock.calls.map(call => call[0])).toEqual([70, 81, 90]);
  });

  it("runs the four marker passes when the layer's panes hold markers", async () => {
    // The pane passes do not own marker DOM: collectLayerMarkers strips canvas
    // and svg from the pane and the four marker passes draw whatever is left.
    // Leaving it empty would silently skip all four, so the assertion is that
    // the panes are scanned and the markers survive the sweep.
    const paneSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    paneSvg.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 100,
        height: 100,
        right: 100,
        bottom: 100,
      }) as DOMRect;
    paneSvg.appendChild(
      document.createElementNS("http://www.w3.org/2000/svg", "circle"),
    );
    const markerEl = document.createElement("img");
    markerEl.src = "data:image/png;base64,AAAA";
    const roots = document.createElement("div");
    roots.appendChild(paneSvg);
    roots.appendChild(markerEl);
    // The real filter strips svg by tag name, not by selector: jsdom reports
    // tagName as "svg" in lower case, so the SVG check misses and the pane
    // element would otherwise be swept in as a marker.
    paneSvg.setAttribute("data-foliplus-export", "exclude");

    const vector = { options: {} };
    const map = (globalThis as any).map;
    map.foliplus = {
      LayerAPI: {
        layers: [{ visible: true, layer: vector }],
        getLayerPanes: () => ["vector-pane"],
      },
    };
    map.getPane = () => roots;

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      makeMockCtx() as any,
    );

    const proto = ExportRenderer.prototype as any;
    // The real collectLayerMarkers is used on purpose: it is the filter that
    // decides these passes run at all.  Everything it feeds is stubbed, so the
    // panes are scanned without fetching or drawing in jsdom.
    vi.spyOn(proto, "renderPaneSVG").mockResolvedValue(undefined);
    vi.spyOn(proto, "renderPaneCanvas").mockResolvedValue(undefined);
    const markers = vi.spyOn(proto, "collectLayerMarkers");
    const markerPasses = vi.spyOn(proto, "renderMarkers").mockResolvedValue(undefined);
    const iconPasses = vi
      .spyOn(proto, "renderFontAwesome")
      .mockResolvedValue(undefined);
    const textPasses = vi.spyOn(proto, "renderTextLabels").mockResolvedValue(undefined);
    const remainingPasses = vi
      .spyOn(proto, "renderRemaining")
      .mockResolvedValue(undefined);

    const onProgress = vi.fn();
    await runRender(onProgress);

    expect(markerPasses).toHaveBeenCalledTimes(1);
    expect(iconPasses).toHaveBeenCalledTimes(1);
    expect(textPasses).toHaveBeenCalledTimes(1);
    expect(remainingPasses).toHaveBeenCalledTimes(1);
    // Same single argument across the chain: the roots the sweep produced.
    const rootsArg = markerPasses.mock.calls[0][1];
    expect(rootsArg).toHaveLength(1);
    expect(rootsArg[0]).toBe(markerEl);
    expect(iconPasses.mock.calls[0][1]).toBe(rootsArg);
    expect(textPasses.mock.calls[0][1]).toBe(rootsArg);
    expect(remainingPasses.mock.calls[0][1]).toBe(rootsArg);
    // The collected element is the one that is NOT the svg pane: the sweep
    // skipped the svg even though it sits first in the pane.
    expect(markers.mock.results[0].value).toHaveLength(1);
    // No tile layer, so the range opens at 71 and the one entry closes it.
    expect(onProgress.mock.calls.map(call => call[0])).toEqual([71, 90]);
  });

  it("counts a missing pane as drawn and keeps reporting progress", async () => {
    // map.getPane can return null for a pane name the API still reports, so the
    // guard skips the pane passes — but the layer still consumes its unit of
    // the layer range, otherwise the bar stops short of the top.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      makeMockCtx() as any,
    );
    const vector = { options: {} };
    const map = (globalThis as any).map;
    map.foliplus = {
      LayerAPI: {
        layers: [{ visible: true, layer: vector }],
        getLayerPanes: () => ["gone-pane"],
      },
    };
    map.getPane = () => null;

    const proto = ExportRenderer.prototype as any;
    const paneSVG = vi.spyOn(proto, "renderPaneSVG");
    const paneCanvas = vi.spyOn(proto, "renderPaneCanvas");
    const markers = vi.spyOn(proto, "collectLayerMarkers");
    vi.spyOn(proto, "renderTileLayer").mockResolvedValue(undefined);

    const onProgress = vi.fn();
    await runRender(onProgress);

    expect(paneSVG).not.toHaveBeenCalled();
    expect(paneCanvas).not.toHaveBeenCalled();
    expect(markers).toHaveBeenCalledWith(vector);
    // No visible tile layer: 71 opens the layer range, and the single entry
    // closes it at 90 even though its pane was missing.
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
      positionedRC(1000, 1000, ctx),
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
      positionedRC(1000, 1000, ctx),
      canvas,
    );

    expect(load).toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});

// =============================================================================
//  renderPaneSVG / renderPaneCanvas — the two pane-level passes.  Both read the
//  real element box, so each needs an element whose getBoundingClientRect
//  answers something the crop rect can compare against.
// =============================================================================

/** jsdom reports every box as 0x0, which makes each pass bail out at its first
 *  area guard.  Pin a box on the element under test and let the rest fall
 *  through real. */
const pinBox = (el, left = 0, top = 0, width = 100, height = 100) => {
  el.getBoundingClientRect = () =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    }) as DOMRect;
  return el;
};

/** Both pane passes resolve their image through util.loadImage; jsdom cannot
 *  load an object URL, so stub it for the tests that reach the draw call. */
const stubLoad = () => vi.spyOn(UTIL, "loadImage").mockResolvedValue({} as any);

describe("ExportRenderer.renderPaneSVG", () => {
  const NS = CONST.SVG_NS;

  const pane = () => {
    const p = document.createElement("div");
    p.className = "leaflet-map-pane";
    return p;
  };

  it("paints an svg that carries a shape element", async () => {
    const ctx = makeMockCtx();
    const p = pane();
    const svg = document.createElementNS(NS, "svg");
    pinBox(svg, 0, 0, 200, 200);
    svg.appendChild(document.createElementNS(NS, "path"));
    p.appendChild(svg);
    stubLoad();

    await new ExportRenderer(makeRenderer().map).renderPaneSVG(
      positionedRC(1000, 1000, ctx),
      p,
    );

    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it("counts a g element that itself holds a shape", async () => {
    const ctx = makeMockCtx();
    const p = pane();
    const svg = document.createElementNS(NS, "svg");
    pinBox(svg, 0, 0, 200, 200);
    const g = document.createElementNS(NS, "g");
    g.appendChild(document.createElementNS(NS, "circle"));
    svg.appendChild(g);
    p.appendChild(svg);
    stubLoad();

    await new ExportRenderer(makeRenderer().map).renderPaneSVG(
      positionedRC(1000, 1000, ctx),
      p,
    );

    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it("skips an svg with no content", async () => {
    const ctx = makeMockCtx();
    const p = pane();
    const svg = document.createElementNS(NS, "svg");
    pinBox(svg, 0, 0, 200, 200);
    p.appendChild(svg);
    const load = stubLoad();

    await new ExportRenderer(makeRenderer().map).renderPaneSVG(
      positionedRC(1000, 1000, ctx),
      p,
    );

    expect(load).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("skips an svg with no area", async () => {
    const ctx = makeMockCtx();
    const p = pane();
    const svg = document.createElementNS(NS, "svg");
    pinBox(svg, 0, 0, 0, 0);
    svg.appendChild(document.createElementNS(NS, "path"));
    p.appendChild(svg);
    const load = stubLoad();

    await new ExportRenderer(makeRenderer().map).renderPaneSVG(
      positionedRC(1000, 1000, ctx),
      p,
    );

    expect(load).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});

describe("ExportRenderer.renderPaneCanvas", () => {
  const pane = () => {
    const p = document.createElement("div");
    p.className = "leaflet-map-pane";
    return p;
  };

  const canvasEl = (left, top, width, height) => {
    const ce = document.createElement("canvas");
    ce.className = "leaflet-map-pane foliplus-heatmap-canvas";
    pinBox(ce, left, top, width, height);
    ce.toDataURL = () => "data:image/png;base64,AAAA";
    return ce;
  };

  it("paints a pane canvas in place", async () => {
    const ctx = makeMockCtx();
    const p = pane();
    p.appendChild(canvasEl(10, 10, 200, 200));
    stubLoad();

    await new ExportRenderer(makeRenderer().map).renderPaneCanvas(
      positionedRC(1000, 1000, ctx),
      p,
    );

    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it("skips a pane canvas with no area", async () => {
    const ctx = makeMockCtx();
    const p = pane();
    p.appendChild(canvasEl(0, 0, 0, 0));
    const load = stubLoad();

    await new ExportRenderer(makeRenderer().map).renderPaneCanvas(
      positionedRC(1000, 1000, ctx),
      p,
    );

    expect(load).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("skips a pane canvas outside the crop rect", async () => {
    const ctx = makeMockCtx();
    const p = pane();
    // The rect spans 0..100 on both axes, so a box at 500 is fully outside.
    p.appendChild(canvasEl(500, 500, 200, 200));
    const load = stubLoad();
    await new ExportRenderer(makeRenderer().map).renderPaneCanvas(
      positionedRC(100, 100, ctx),
      p,
    );

    expect(load).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("draws nothing when the data URL cannot load", async () => {
    const ctx = makeMockCtx();
    const p = pane();
    p.appendChild(canvasEl(10, 10, 200, 200));
    vi.spyOn(UTIL, "loadImage").mockRejectedValue(new Error("boom"));

    await new ExportRenderer(makeRenderer().map).renderPaneCanvas(
      positionedRC(1000, 1000, ctx),
      p,
    );

    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});

// =============================================================================
//  Marker passes — collectLayerMarkers plus the four per-marker render passes.
//  collectLayerMarkers resolves panes through the module-level map, so each test
//  points the global at a mock whose LayerAPI returns the pane it wants.
// =============================================================================

/** Pin the module-level map that collectLayerMarkers reads, for the duration of
 *  one test.  Restores whatever the earlier tests left in place. */
const withLayerPanes = (pane, roots) => {
  const prev = globalThis.map;
  Object.defineProperty(globalThis, "map", {
    value: {
      foliplus: { LayerAPI: { getLayerPanes: () => [pane] } },
      getPane: () => roots,
    },
    configurable: true,
  });
  return () => {
    Object.defineProperty(globalThis, "map", { value: prev, configurable: true });
  };
};

/** jsdom has no canvas backend, so any context that must answer real calls is
 *  handed in explicitly rather than read from a canvas element. */
const textCtx = () =>
  ({
    ...makeMockCtx(),
    beginPath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    roundRect: vi.fn(),
    fillText: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textAlign: "",
    textBaseline: "",
  }) as unknown as CanvasRenderingContext2D;

/** makeRC leaves contRect without an origin, so the offsets the passes compute
 *  from it are NaN and every visibility guard silently passes.  Tests that need
 *  a position-relative result state the container origin explicitly. */
const positionedRC = (w: number, h: number, ctx) => {
  const rc = makeRC(w, h, ctx);
  rc.contRect = { left: 0, top: 0, width: w, height: h } as DOMRect;
  return rc;
};

/** document.fonts does not exist in jsdom; both text passes wait on it. */
const stubFonts = () => {
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      load: vi.fn().mockResolvedValue(undefined),
      check: vi.fn().mockReturnValue(true),
      ready: Promise.resolve(),
    },
  });
};

/** Answer computed style from a small prop map.  Both read shapes matter: the
 *  passes read properties directly (cs.backgroundImage) and through
 *  getPropertyValue (the SVG pass copies a fixed prop list). */
const withStyle = (props: Record<string, string>) => {
  const real = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation(() =>
    Object.assign(Object.create(null), props, {
      getPropertyValue: (prop: string) => props[prop] || "",
    }),
  );
  return () => real;
};

describe("ExportRenderer.collectLayerMarkers", () => {
  it("returns the pane's children, skipping canvas and svg", () => {
    const pane = "vector";
    const keep = document.createElement("div");
    const canvas = document.createElement("canvas");
    const svg = document.createElementNS(CONST.SVG_NS, "svg");
    svg.setAttribute("data-foliplus-export", "exclude");
    const roots = document.createElement("div");
    roots.append(canvas, keep, svg);
    const restore = withLayerPanes(pane, roots as any);
    try {
      const map = makeRenderer().map;
      (map as any).getPane = () => roots;
      expect(new ExportRenderer(map).collectLayerMarkers({} as L.Layer)).toEqual([
        keep,
      ]);
    } finally {
      restore();
    }
  });

  it("skips an element marked exclude and one that contains one", () => {
    const skip = document.createElement("div");
    skip.setAttribute("data-foliplus-export", "exclude");
    const nested = document.createElement("div");
    const mark = document.createElement("span");
    mark.setAttribute("data-foliplus-export", "exclude");
    nested.appendChild(mark);
    const keep = document.createElement("div");
    const roots = document.createElement("div");
    roots.append(skip, nested, keep);
    const restore = withLayerPanes("vector", roots as any);
    try {
      const map = makeRenderer().map;
      (map as any).getPane = () => roots;
      expect(new ExportRenderer(map).collectLayerMarkers({} as L.Layer)).toEqual([
        keep,
      ]);
    } finally {
      restore();
    }
  });

  it("returns nothing when the pane is absent", () => {
    const restore = withLayerPanes("missing", null as any);
    try {
      const map = makeRenderer().map;
      (map as any).getPane = () => null;
      expect(new ExportRenderer(map).collectLayerMarkers({} as L.Layer)).toEqual([]);
    } finally {
      restore();
    }
  });
});

describe("ExportRenderer.renderMarkers", () => {
  const markerEl = (bg, opts: Record<string, string> = {}) => {
    const el = document.createElement("div");
    pinBox(el, 10, 10, 20, 20);
    const style = { ...opts, backgroundImage: bg };
    const restore = withStyle(style);
    el.__restoreStyle = restore;
    return el;
  };

  it("draws a sprite through the pooled loader and closes it", async () => {
    const ctx = textCtx();
    const el = markerEl('url("sprite.png")', {
      backgroundSize: "64px 64px",
      backgroundPosition: "0 0",
    });
    stubBitmaps();
    stubLoad();
    await new ExportRenderer(makeRenderer().map).renderMarkers(
      positionedRC(1000, 1000, ctx),
      [el],
    );
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it("scales the sprite source rect by the background size", async () => {
    const ctx = textCtx();
    // A 20x20 element at 125% background-size is 25x25 in CSS pixels, so the
    // sprite source is scaled by 100/25 and the 4px/2px position offsets are
    // scaled by the same ratio.
    const el = markerEl('url("sprite.png")', {
      backgroundSize: "125%",
      backgroundPosition: "4px 2px",
    });
    stubBitmaps(100, 100);
    stubLoad();
    await new ExportRenderer(makeRenderer().map).renderMarkers(
      positionedRC(1000, 1000, ctx),
      [el],
    );
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    const [, sx, sy, sw, sh] = ctx.drawImage.mock.calls[0];
    expect(sx).toBeCloseTo(16);
    expect(sy).toBeCloseTo(8);
    expect(sw).toBeCloseTo(80);
    expect(sh).toBeCloseTo(80);
  });

  it("draws from the auto-sized source using devicePixelRatio", async () => {
    const ctx = textCtx();
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 2,
    });
    const el = markerEl('url("sprite.png")', { backgroundSize: "auto" });
    stubBitmaps();
    stubLoad();
    await new ExportRenderer(makeRenderer().map).renderMarkers(
      positionedRC(1000, 1000, ctx),
      [el],
    );
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it("skips a marker whose sprite window runs off the sprite", async () => {
    const ctx = textCtx();
    // A 20x20 element whose background is 10px wide over a 10x10 sprite maps
    // 1:1, so the 20px background position lands at source offset 20 and the
    // 20px-wide window runs straight off the sprite edge.  The guard must drop
    // it rather than draw a fraction.  A percentage background-size cannot
    // reach this branch: the size is a fraction of the element, so the source
    // window is always no larger than the element.
    const el = markerEl('url("sprite.png")', {
      backgroundSize: "10px 10px",
      backgroundPosition: "20px 20px",
    });
    stubBitmaps(10, 10);
    stubLoad();
    await new ExportRenderer(makeRenderer().map).renderMarkers(
      positionedRC(1000, 1000, ctx),
      [el],
    );
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("skips a marker with no area", async () => {
    const ctx = textCtx();
    const el = markerEl('url("sprite.png")');
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 0, height: 0 }) as DOMRect;
    stubBitmaps();
    stubLoad();
    await new ExportRenderer(makeRenderer().map).renderMarkers(
      positionedRC(1000, 1000, ctx),
      [el],
    );
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});

describe("ExportRenderer.renderFontAwesome", () => {
  it("renders the icon's pseudo-element content", async () => {
    const ctx = textCtx();
    stubFonts();
    const root = document.createElement("div");
    pinBox(root, 10, 10, 20, 20);
    const icon = document.createElement("i");
    pinBox(icon, 0, 0, 20, 20);
    root.appendChild(icon);
    const restore = withStyle({
      fontSize: "14px",
      fontFamily: "FontAwesome",
      color: "#fff",
      content: "\\f000",
      fontWeight: "900",
    });
    try {
      await new ExportRenderer(makeRenderer().map).renderFontAwesome(
        positionedRC(1000, 1000, ctx),
        [root],
      );
      expect(ctx.fillText).toHaveBeenCalledTimes(1);
      expect(ctx.fillText.mock.calls[0][0]).toBe(
        String.fromCharCode(parseInt("f000", 16)),
      );
    } finally {
      restore();
    }
  });

  it("renders a single literal character", async () => {
    const ctx = textCtx();
    stubFonts();
    const root = document.createElement("div");
    pinBox(root, 10, 10, 20, 20);
    const icon = document.createElement("i");
    pinBox(icon, 0, 0, 20, 20);
    root.appendChild(icon);
    const restore = withStyle({
      fontSize: "14px",
      fontFamily: "FontAwesome",
      color: "#fff",
      content: '\"A\"',
      fontWeight: "normal",
    });
    try {
      await new ExportRenderer(makeRenderer().map).renderFontAwesome(
        positionedRC(1000, 1000, ctx),
        [root],
      );
      expect(ctx.fillText.mock.calls[0][0]).toBe("A");
      // "normal" is normalised to 400 in the font spec.
      expect(ctx.font).toContain("400");
    } finally {
      restore();
    }
  });

  it("skips a marker with no icon element", async () => {
    const ctx = textCtx();
    stubFonts();
    const root = document.createElement("div");
    pinBox(root, 10, 10, 20, 20);
    await new ExportRenderer(makeRenderer().map).renderFontAwesome(
      positionedRC(1000, 1000, ctx),
      [root],
    );
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it("skips a marker that falls outside the crop", async () => {
    const ctx = textCtx();
    stubFonts();
    const root = document.createElement("div");
    pinBox(root, 500, 500, 20, 20);
    const icon = document.createElement("i");
    root.appendChild(icon);
    await new ExportRenderer(makeRenderer().map).renderFontAwesome(
      positionedRC(100, 100, ctx),
      [root],
    );
    expect(ctx.fillText).not.toHaveBeenCalled();
  });
});

describe("ExportRenderer.renderTextLabels", () => {
  it("draws text with a rounded background and a border", async () => {
    const ctx = textCtx();
    stubFonts();
    const root = document.createElement("div");
    pinBox(root, 10, 10, 60, 20);
    const label = document.createElement("span");
    label.setAttribute("data-foliplus-export", "label");
    label.textContent = "100 m";
    pinBox(label, 0, 0, 60, 20);
    root.appendChild(label);
    const restore = withStyle({
      backgroundColor: "rgb(20, 20, 20)",
      borderRadius: "4px",
      borderWidth: "1px",
      borderStyle: "solid",
      borderColor: "rgb(255, 255, 255)",
      fontSize: "14px",
      fontFamily: "sans-serif",
      color: "#fff",
      fontWeight: "bold",
    });
    try {
      await new ExportRenderer(makeRenderer().map).renderTextLabels(
        positionedRC(1000, 1000, ctx),
        [root],
      );
      expect(ctx.roundRect).toHaveBeenCalled();
      expect(ctx.strokeRect).not.toHaveBeenCalled();
      expect(ctx.fillText).toHaveBeenCalledWith("100 m", 30, 10);
      expect(ctx.font).toContain("700");
    } finally {
      restore();
    }
  });

  it("draws a square background without a border", async () => {
    const ctx = textCtx();
    stubFonts();
    const root = document.createElement("div");
    pinBox(root, 10, 10, 60, 20);
    root.textContent = "plain";
    const restore = withStyle({
      backgroundColor: "rgb(10, 10, 10)",
      borderRadius: "0px",
      borderWidth: "0px",
      borderStyle: "none",
      fontSize: "14px",
      fontFamily: "sans-serif",
      color: "#fff",
      fontWeight: "400",
    });
    try {
      await new ExportRenderer(makeRenderer().map).renderTextLabels(
        positionedRC(1000, 1000, ctx),
        [root],
      );
      expect(ctx.fillRect).toHaveBeenCalledTimes(1);
      expect(ctx.roundRect).not.toHaveBeenCalled();
      expect(ctx.fillText).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("lays out multi-line text around the label centre", async () => {
    const ctx = textCtx();
    stubFonts();
    const root = document.createElement("div");
    pinBox(root, 10, 10, 60, 40);
    // The label span keeps the newline; the pass reads the box from the label
    // element itself, so it needs its own rect rather than the root's.
    const lines = document.createElement("span");
    lines.setAttribute("data-foliplus-export", "label");
    lines.textContent = "a\nb";
    pinBox(lines, 10, 10, 60, 40);
    root.appendChild(lines);
    // The pass reads the font from the label element, not the root, so the
    // style mock must answer for both.
    const restore = withStyle({
      backgroundColor: "transparent",
      fontSize: "14px",
      fontFamily: "sans-serif",
      color: "#fff",
      fontWeight: "400",
    });
    try {
      await new ExportRenderer(makeRenderer().map).renderTextLabels(
        positionedRC(1000, 1000, ctx),
        [root],
      );
      expect(ctx.fillText).toHaveBeenCalledTimes(2);
      // Two lines sit symmetric about the label centre, spacing 1.2 * fontSize.
      const [y0, y1] = ctx.fillText.mock.calls.map(c => c[2]);
      expect(y1 - y0).toBeCloseTo(14 * 1.2);
      expect(ctx.fillText).toHaveBeenNthCalledWith(1, "a", 40, 21.6);
      expect(ctx.fillText.mock.calls[1][0]).toBe("b");
      expect(ctx.fillText.mock.calls[1][2]).toBeCloseTo(38.4);
    } finally {
      restore();
    }
  });

  it("skips an empty label", async () => {
    const ctx = textCtx();
    stubFonts();
    const root = document.createElement("div");
    pinBox(root, 10, 10, 60, 20);
    root.textContent = "   ";
    await new ExportRenderer(makeRenderer().map).renderTextLabels(
      positionedRC(1000, 1000, ctx),
      [root],
    );
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it("skips a marker that carries an icon", async () => {
    const ctx = textCtx();
    stubFonts();
    const root = document.createElement("div");
    pinBox(root, 10, 10, 60, 20);
    root.textContent = "100 m";
    root.appendChild(document.createElement("i"));
    await new ExportRenderer(makeRenderer().map).renderTextLabels(
      positionedRC(1000, 1000, ctx),
      [root],
    );
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it("skips a marker whose background is a sprite", async () => {
    const ctx = textCtx();
    stubFonts();
    const root = document.createElement("div");
    pinBox(root, 10, 10, 60, 20);
    root.textContent = "100 m";
    const restore = withStyle({ backgroundImage: 'url("sprite.png")' });
    try {
      await new ExportRenderer(makeRenderer().map).renderTextLabels(
        positionedRC(1000, 1000, ctx),
        [root],
      );
      expect(ctx.fillText).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

describe("ExportRenderer.renderRemaining", () => {
  it("draws an img child", async () => {
    const ctx = textCtx();
    stubLoad();
    const root = document.createElement("div");
    pinBox(root, 10, 10, 24, 24);
    const img = document.createElement("img");
    img.src = "https://example.com/m.png";
    root.appendChild(img);
    await new ExportRenderer(makeRenderer().map).renderRemaining(
      positionedRC(1000, 1000, ctx),
      [root],
    );
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it("falls back to the inline svg when the img cannot load", async () => {
    const ctx = textCtx();
    vi.spyOn(UTIL, "loadImage").mockRejectedValue(new Error("boom"));
    const root = document.createElement("div");
    pinBox(root, 10, 10, 24, 24);
    const img = document.createElement("img");
    img.src = "https://example.com/m.png";
    root.appendChild(img);
    await new ExportRenderer(makeRenderer().map).renderRemaining(
      positionedRC(1000, 1000, ctx),
      [root],
    );
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("renders an inline svg through the blob path", async () => {
    const ctx = textCtx();
    stubLoad();
    const root = document.createElement("div");
    pinBox(root, 10, 10, 24, 24);
    const svg = document.createElementNS(CONST.SVG_NS, "svg");
    pinBox(svg, 0, 0, 24, 24);
    svg.appendChild(document.createElementNS(CONST.SVG_NS, "path"));
    root.appendChild(svg);
    await new ExportRenderer(makeRenderer().map).renderRemaining(
      positionedRC(1000, 1000, ctx),
      [root],
    );
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it("fills a background-coloured dot, rounded and bordered", async () => {
    const ctx = textCtx();
    const root = document.createElement("div");
    pinBox(root, 10, 10, 10, 10);
    const restore = withStyle({
      backgroundColor: "rgb(255, 0, 0)",
      backgroundImage: "none",
      borderRadius: "5px",
      borderWidth: "1px",
      borderStyle: "solid",
      borderColor: "rgb(0, 0, 0)",
    });
    try {
      await new ExportRenderer(makeRenderer().map).renderRemaining(
        positionedRC(1000, 1000, ctx),
        [root],
      );
      expect(ctx.roundRect).toHaveBeenCalled();
      expect(ctx.strokeRect).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("fills a plain background colour when there is no border", async () => {
    const ctx = textCtx();
    const root = document.createElement("div");
    pinBox(root, 10, 10, 10, 10);
    const restore = withStyle({
      backgroundColor: "rgb(0, 0, 255)",
      backgroundImage: "none",
      borderRadius: "0px",
      borderWidth: "0px",
      borderStyle: "none",
    });
    try {
      await new ExportRenderer(makeRenderer().map).renderRemaining(
        positionedRC(1000, 1000, ctx),
        [root],
      );
      expect(ctx.fillRect).toHaveBeenCalledTimes(1);
      expect(ctx.roundRect).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("leaves a label element untouched", async () => {
    const ctx = textCtx();
    const root = document.createElement("div");
    pinBox(root, 10, 10, 60, 20);
    root.setAttribute("data-foliplus-export", "label");
    const restore = withStyle({
      backgroundColor: "rgb(20, 20, 20)",
      backgroundImage: "none",
    });
    try {
      await new ExportRenderer(makeRenderer().map).renderRemaining(
        positionedRC(1000, 1000, ctx),
        [root],
      );
      expect(ctx.fillRect).not.toHaveBeenCalled();
      expect(ctx.roundRect).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("does not paint a background over a sprite marker", async () => {
    const ctx = textCtx();
    const root = document.createElement("div");
    pinBox(root, 10, 10, 24, 24);
    const restore = withStyle({
      backgroundColor: "rgb(0, 255, 0)",
      backgroundImage: 'url("sprite.png")',
    });
    try {
      await new ExportRenderer(makeRenderer().map).renderRemaining(
        positionedRC(1000, 1000, ctx),
        [root],
      );
      expect(ctx.fillRect).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

describe("ExportRenderer.tilePositions", () => {
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
    const survivors = (renderer as any).tilePositions(makeRC(1000, 600), [
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
    // The list arrives pre-enumerated: calcTiles ran in render(), so the map
    // mock only has to answer zoom, center and CRS for the viewport math.
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

  it("drops tiles whose viewport position is past the crop, even when they intersect the output", () => {
    // Two guards are separate from isVisible: one rejects a tile that ends
    // above the crop's top, the other one that starts right of the crop's
    // right edge.  Both are cheap skips that keep the draw pass off tiles
    // the crop cannot show -- and neither can be expressed as a destination
    // rect test, because the rect still intersects the output.
    const renderer = make();
    const rc = {
      ...makeRC(1000, 600),
      rect: { left: 0, top: 500, width: 1000, height: 100 },
    };
    const survivors = (renderer as any).tilePositions(rc, [
      // Viewport 512-768 x 128-384, crop 0-1000 x 500-600: the tile ends
      // 116 viewport pixels above the crop top, so the "ends above the crop
      // top" guard rejects it -- in viewport units, a check isVisible
      // cannot make on its own.
      tile("above", 2, 2),
      // Viewport 512-768 x 384-640: it ends exactly on the crop's bottom
      // edge of 500 plus its own height, so it is the tile the crop's lower
      // edge touches and survives every guard.
      tile("edge", 2, 3),
      // World 1024-1280 x 768-1024: viewport 1024-1280 x 384-640 starts
      // past the crop's right edge of 1000, so the right-edge guard drops
      // it even though the destination rect overlaps the output.
      tile("past-right", 4, 3),
    ]);
    expect(survivors.length).toBe(1);
    expect(survivors[0]).toMatchObject({
      url: "edge",
      // The crop is 0-1000 x 500-600; the tile's viewport extent is
      // 512-768 x 384-640, so its top sits 116 viewport pixels above the
      // crop top -- the rect crosses the crop but starts above it.
      dx: 512,
      dy: -116,
      dw: 256,
      dh: 256,
    });
  });

  it("scales the destination rect by the render scale", () => {
    // Viewport-relative 256-512 x 128-384.  At scale 2 the output is
    // 1000x600, so this tile lands at 512-1024 x 256-768 and intersects
    // the crop -- a wider tile here would be clipped out of the output.
    // A 500x300 crop at scale 2 renders 1000x600 output pixels, so the
    // destination rect is the viewport value multiplied by the scale.
    const survivors = make().tilePositions(makeRC(500, 300, 2), [tile("keep", 1, 2)]);
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
    expect(make().tilePositions(makeRC(1000, 600), [tile("far", 9, 9)])).toEqual([]);
  });

  it("falls back to L.CRS.EPSG3857 when the map has no crs option", () => {
    // Must not throw even though only the global L.CRS provides the CRS.
    const renderer = makeRenderer(undefined);
    (renderer.map as any).options = {};
    (renderer.map as any).getZoom = () => 2;
    (renderer.map as any).getCenter = () => CENTER;
    const survivors = (renderer as any).tilePositions(makeRC(1000, 600), [
      tile("keep", 3, 2),
    ]);
    expect(Array.isArray(survivors)).toBe(true);
  });
});

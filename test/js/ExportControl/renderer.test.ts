import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/ExportControl/const.js";
import {
  ExportRenderer,
  isCorsBlocked,
} from "#foliplus/ExportControl/renderer/index.js";
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
/** Tiles centerd on the container: 1000x1000 crop at zoom 2 keeps every tile
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
  const mockLayer = { options: { opacity: 1 } } as L.TileLayer;

  it("reports the cumulative tiles drawn after each batch", async () => {
    const total = CONST.TILE_CONCURRENCY * 2;
    stubBitmaps();
    const rc = makeRC(4096, 4096);
    const onProgress = vi.fn();

    await makeRenderer().renderTileLayer(rc, rcTiles(rc, total), mockLayer, onProgress);

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
    await makeRenderer().renderTileLayer(makeRC(100, 100), [], mockLayer, onProgress);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("drops tiles that fall outside the crop rect, so the count tracks what is drawn", async () => {
    // 7 tiles enumerated, one sits off the 1536x512 crop: the batch splits and
    // the final report is the surviving count, not the concurrency cap.
    const survivors = rcTiles(makeRC(1536, 512), CONST.TILE_CONCURRENCY + 1);
    stubBitmaps();

    const onProgress = vi.fn();
    await makeRenderer().renderTileLayer(
      makeRC(1536, 512),
      survivors,
      mockLayer,
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
    stubBitmaps();
    const ctx = makeMockCtx();
    ctx.drawImage.mockImplementation((src?: unknown) => {
      if (src && typeof src === "object" && (src as { _bad?: boolean })._bad) {
        throw new Error("draw failed");
      }
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
      mockLayer,
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
      mockLayer,
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
      mockLayer,
      onProgress,
    );
    // The tile was fetched and enumerated but nothing reached the canvas, so it
    // earns no progress: counting it would say the map is more done than it is.
    expect(onProgress.mock.calls.map(c => c[0])).toEqual([0]);
  });

  it("falls back to the 1x tile when the retina fetch fails", async () => {
    // A source without retina tiles 404s every {r} URL; the draw pass must
    // retry the recorded 1x fallback instead of blanking the whole layer —
    // otherwise a scale>1 export loses the layer and misreports it as CORS
    // blocking.
    (UTIL.loadImageBitmap as any).mockClear();
    (UTIL.loadImageBitmap as any)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ width: 64, height: 64, close: () => {} });
    const rc = makeRC(4096, 4096);
    const renderer = makeRenderer();
    const tiles = withPixels([
      {
        x: 1,
        y: 1,
        z: 2,
        url: "tile@2x",
        fallback: "tile",
        left: 256,
        top: 512,
        size: 256,
      },
    ]);

    await renderer.renderTileLayer(rc, tiles, mockLayer);

    expect(UTIL.loadImageBitmap).toHaveBeenNthCalledWith(1, "tile@2x");
    expect(UTIL.loadImageBitmap).toHaveBeenNthCalledWith(2, "tile");
    expect(renderer.tileFailures).toEqual([{ total: 1, failed: 0 }]);
  });

  it("still draws every tile when no onProgress callback is passed", async () => {
    // render() always forwards its own callback, but renderTileLayer is also
    // reachable on its own, so the report has to stay optional.
    const ctx = makeMockCtx();
    (UTIL.loadImageBitmap as any).mockClear();
    stubBitmaps();

    await makeRenderer().renderTileLayer(
      makeRC(4096, 4096, ctx),
      rcTiles(makeRC(4096, 4096, ctx), CONST.TILE_CONCURRENCY),
      mockLayer,
    );

    expect(ctx.drawImage).toHaveBeenCalledTimes(CONST.TILE_CONCURRENCY);
  });
});

//===========================================================================
//  tileFailures / isCorsBlocked — per-layer failure stats behind the
//  post-export CORS warning.  renderTileLayer records what each tile layer's
//  fetch achieved; the manager turns a predominantly-failed layer into a
//  warning instead of a bare success.
//===========================================================================

describe("ExportRenderer.tileFailures", () => {
  const mockLayer = { options: { opacity: 1 } } as L.TileLayer;

  it("records one entry per rendered layer, split into drawn and failed", async () => {
    stubBitmaps();
    const rc = makeRC(4096, 4096);
    const renderer = makeRenderer();
    await renderer.renderTileLayer(rc, rcTiles(rc, CONST.TILE_CONCURRENCY), mockLayer);
    expect(renderer.tileFailures).toEqual([
      { total: CONST.TILE_CONCURRENCY, failed: 0 },
    ]);
  });

  it("counts failed loads as failed tiles — the CORS-blocked profile", async () => {
    (UTIL.loadImageBitmap as any).mockClear();
    (UTIL.loadImageBitmap as any).mockResolvedValue(null);
    const rc = makeRC(4096, 4096);
    const renderer = makeRenderer();
    await renderer.renderTileLayer(rc, rcTiles(rc, CONST.TILE_CONCURRENCY), mockLayer);
    expect(renderer.tileFailures).toEqual([
      { total: CONST.TILE_CONCURRENCY, failed: CONST.TILE_CONCURRENCY },
    ]);
    expect(renderer.tileFailures.some(isCorsBlocked)).toBe(true);
  });

  it("does not record a layer with no tiles to draw", async () => {
    const renderer = makeRenderer();
    await renderer.renderTileLayer(makeRC(100, 100), [], mockLayer);
    expect(renderer.tileFailures).toEqual([]);
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

  it("fills the canvas background when a bg color is passed", async () => {
    const ctx = stubCanvas();
    await renderer.render(
      { left: 0, top: 0, width: 100, height: 100 },
      1,
      "#ff0000",
      undefined,
      vi.fn(),
    );
    expect(ctx.fillStyle).toBe("#ff0000");
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 100, 100);
  });

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

  it("records failing tiles end-to-end and resets stats between renders", async () => {
    bigCenter();
    // Every tile of the single visible layer fails: the CORS-blocked profile
    // through the real render() → renderTileLayer pipeline.
    (UTIL.loadImageBitmap as any).mockResolvedValue(null);
    stubCanvas();
    const layer = makeTileLayer();
    vi.spyOn(renderer, "calcTiles").mockReturnValue(
      tilesNearCenter(CONST.TILE_CONCURRENCY),
    );
    renderer.map.foliplus = {
      LayerAPI: {
        layers: [{ visible: true, layer }],
        getLayerPanes: () => [],
      },
    };

    await runRender(() => {});
    expect(renderer.tileFailures).toEqual([
      { total: CONST.TILE_CONCURRENCY, failed: CONST.TILE_CONCURRENCY },
    ]);
    expect(renderer.tileFailures.some(isCorsBlocked)).toBe(true);

    // A second render starts from a clean slate — the previous export's
    // failures must not be carried into the next one.
    await runRender(() => {});
    expect(renderer.tileFailures).toEqual([
      { total: CONST.TILE_CONCURRENCY, failed: CONST.TILE_CONCURRENCY },
    ]);
    expect(renderer.tileFailures).toHaveLength(1);
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
    tileLayer.mockImplementation(
      async (_rc: any, _tiles: any, _layer: any, cb: any) => {
        cb(1);
      },
    );
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

  it("renders a layer's annotation labels right after its content", async () => {
    // Each layer's label canvas mounts in its own pane (map.createPane), a
    // sibling of the content panes the walk visits. render() draws it right
    // after the layer's content — before the next layer up covers it — so the
    // exported stack order matches the map's.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      makeMockCtx() as any,
    );
    const map = (globalThis as any).map;
    const labelPane = document.createElement("div");
    labelPane.className = "foliplus-annotation-pane";
    const annCanvas = document.createElement("canvas");
    annCanvas.className = "foliplus-annotation-canvas";
    labelPane.appendChild(annCanvas);
    map.getPane = (name: string) =>
      name === CONST.ANNOTATION_PANE_PREFIX + "vec" ? labelPane : null;
    map.foliplus = {
      LayerAPI: {
        layers: [{ visible: true, id: "vec", layer: { options: {} } }],
        getLayerPanes: () => [],
      },
    };

    const proto = ExportRenderer.prototype as any;
    const paneCanvas = vi.spyOn(proto, "renderPaneCanvas").mockResolvedValue(undefined);

    await runRender(vi.fn());

    // The label pane is swept once, with the annotation selector, right after
    // the layer's content walk (which passed no panes of its own).
    expect(paneCanvas).toHaveBeenCalledTimes(1);
    expect(paneCanvas).toHaveBeenCalledWith(
      expect.anything(),
      labelPane,
      CONST.SEL.ANNOTATION_CANVAS,
    );
  });

  it("skips the tile pass when tilePane is hidden by a solid-color basemap", async () => {
    // Picking a color removes the tile layers with map.removeLayer and hides
    // tilePane by class — it never goes through applyVisibility, so every
    // li.visible is still true.  Re-fetching the tile URLs would repaint them
    // over the color the user just picked, so the pass judges the pane's
    // computed state instead of the class that produced it.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      makeMockCtx() as any,
    );
    const tilePane = document.createElement("div");
    tilePane.style.visibility = "hidden";
    const map = (globalThis as any).map;
    map.getPane = (name: string) => (name === "tilePane" ? tilePane : null);
    map.foliplus = {
      LayerAPI: {
        layers: [
          { visible: true, layer: makeTileLayer() },
          { visible: true, layer: { options: {} } },
        ],
        getLayerPanes: () => [],
      },
    };

    const tileLayer = vi
      .spyOn(ExportRenderer.prototype as any, "renderTileLayer")
      .mockResolvedValue(undefined);
    const onProgress = vi.fn();

    await runRender(onProgress);

    expect(tileLayer).not.toHaveBeenCalled();
    // No tiles in the denominator, so the bar resumes at the layer range and
    // the surviving vector layer still walks it to the top.
    expect(onProgress.mock.calls.map(call => call[0])).toEqual([71, 90]);
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

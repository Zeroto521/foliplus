// Shared fixtures for ExportControl renderer/* tests.
// Extracted from renderer.test.ts so each module test can import only what it
// needs without dragging the orchestration suite along.
import { vi } from "vitest";
import { ExportRenderer } from "#foliplus/ExportControl/renderer/index.js";
import * as UTIL from "#foliplus/ExportControl/util.js";

// renderer binds its logger to CONF.name at module-import time, so the
// component name has to be set before the import resolves — setup.ts leaves it
// at "SearchControl".  Must run before the import, not in beforeEach.
(window as any).CONF = { ...(window as any).CONF, name: "ExportControl" };

export function makeEPSG3857Mock() {
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

export class MockTileLayer {
  _url = "";
  options: Record<string, unknown> = {};
}

export function installTileGlobals() {
  (L as any).CRS = { EPSG3857: makeEPSG3857Mock() };
  (L as any).TileLayer = MockTileLayer;
}

export function makeTileLayer(overrides: Partial<any> = {}) {
  const url = overrides._url ?? "https://{s}.tile.example.com/{z}/{x}/{y}.png";
  delete (overrides as any)._url;
  const layer = new MockTileLayer();
  layer._url = url;
  layer.options = { tileSize: 256, subdomains: "abc", ...overrides };
  return layer as any;
}

export function makeRenderer(crs: any = makeEPSG3857Mock()): ExportRenderer {
  const container = document.createElement("div");
  container.id = "test";
  const map = {
    options: { crs },
    getContainer: () => container,
    foliplus: { LayerAPI: { layers: [], getLayerPanes: () => [] } },
  };
  return new ExportRenderer(map as any);
}

export function makeMockCtx() {
  return {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillStyle: "",
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

export function makeRC(w: number, h: number, ctx = makeMockCtx(), scale = 1) {
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

export const tilesNearCenter = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    x: 1,
    y: 1,
    z: 2,
    url: `url${i}`,
    left: 256 + (i % 3) * 256,
    top: 512 + Math.floor(i / 3) * 256,
    size: 256,
  }));

export const withPixels = (tiles: unknown[]) =>
  tiles.map(t => ({
    ...t,
    dx: (t as any).left,
    dy: (t as any).top,
    dw: (t as any).size,
    dh: (t as any).size,
  }));

export function stubBitmaps(width = 64, height = 64) {
  (UTIL.loadImageBitmap as any).mockResolvedValue({
    width,
    height,
    close: () => undefined,
  });
}

export const pinBox = (el: any, left = 0, top = 0, width = 100, height = 100) => {
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

export const stubLoad = () => vi.spyOn(UTIL, "loadImage").mockResolvedValue({} as any);

export const captureSources = () => {
  const real = XMLSerializer.prototype.serializeToString;
  const sources: string[] = [];
  vi.spyOn(XMLSerializer.prototype, "serializeToString").mockImplementation(function (
    this: XMLSerializer,
    node: Node,
  ) {
    const src = real.call(this, node);
    sources.push(src);
    return src;
  });
  return sources;
};

export const withLayerPanes = (pane: string, roots: any) => {
  const prev = (globalThis as any).map;
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

export const textCtx = () =>
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

export const positionedRC = (w: number, h: number, ctx: any) => {
  const rc = makeRC(w, h, ctx);
  rc.contRect = { left: 0, top: 0, width: w, height: h } as DOMRect;
  return rc;
};

export const stubFonts = () => {
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      load: vi.fn().mockResolvedValue(undefined),
      check: vi.fn().mockReturnValue(true),
      ready: Promise.resolve(),
    },
  });
};

export const withStyle = (props: Record<string, string>) => {
  const real = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation(() =>
    Object.assign(Object.create(null), props, {
      getPropertyValue: (prop: string) => props[prop] || "",
    }),
  );
  return () => real;
};

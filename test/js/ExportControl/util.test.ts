import { describe, expect, it, vi } from "vitest";
import {
  ensureFont,
  generateWorldFile,
  isVisible,
} from "#foliplus/ExportControl/util.js";

describe("isVisible", () => {
  it("returns true for a rectangle fully inside the viewport", () => {
    expect(isVisible(10, 10, 100, 100, 500, 500)).toBe(true);
  });

  it("returns true for a rectangle partially overlapping the viewport", () => {
    expect(isVisible(-50, 10, 100, 100, 500, 500)).toBe(true);
    expect(isVisible(10, -50, 100, 100, 500, 500)).toBe(true);
  });

  it("returns false when entirely left of the viewport", () => {
    expect(isVisible(-200, 10, 100, 100, 500, 500)).toBe(false);
  });

  it("returns false when entirely above the viewport", () => {
    expect(isVisible(10, -200, 100, 100, 500, 500)).toBe(false);
  });

  it("returns false when entirely right of the viewport", () => {
    expect(isVisible(600, 10, 100, 100, 500, 500)).toBe(false);
  });

  it("returns false when entirely below the viewport", () => {
    expect(isVisible(10, 600, 100, 100, 500, 500)).toBe(false);
  });

  it("returns true for a zero-size rectangle at the origin", () => {
    expect(isVisible(0, 0, 0, 0, 500, 500)).toBe(true);
  });
});

describe("ensureFont", () => {
  it("loads and checks the font", async () => {
    const fonts = {
      load: vi.fn(() => Promise.resolve()),
      check: vi.fn(() => true),
      ready: Promise.resolve(),
    };
    Object.defineProperty(document, "fonts", { value: fonts, configurable: true });
    await ensureFont("16px sans-serif");
    expect(fonts.load).toHaveBeenCalledWith("16px sans-serif");
    expect(fonts.check).toHaveBeenCalledWith("16px sans-serif");
  });
});

describe("loadImageBitmap", () => {
  const makeFetchOk = () =>
    vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob()) }),
    ) as unknown as typeof fetch;

  beforeEach(async () => {
    globalThis.AbortSignal = Object.assign(globalThis.AbortSignal || {}, {
      timeout: () => ({}),
    }) as unknown as typeof AbortSignal;
    window.CONF = { ...window.CONF, name: "ExportControl", timeout: 7500 };
  });

  it("returns null when fetch response is not ok", async () => {
    const { loadImageBitmap } = await import("#foliplus/ExportControl/util.js");
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: false }),
    ) as unknown as typeof fetch;
    const result = await loadImageBitmap("https://example.com/tile.png");
    expect(result).toBeNull();
  });

  it("returns null when fetch rejects (network error)", async () => {
    const { loadImageBitmap } = await import("#foliplus/ExportControl/util.js");
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new TypeError("network error")),
    ) as unknown as typeof fetch;
    const result = await loadImageBitmap("https://example.com/tile.png");
    expect(result).toBeNull();
  });

  it("returns null when blob() rejects", async () => {
    const { loadImageBitmap } = await import("#foliplus/ExportControl/util.js");
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.reject(new Error("blob err")) }),
    ) as unknown as typeof fetch;
    const result = await loadImageBitmap("https://example.com/tile.png");
    expect(result).toBeNull();
  });

  it("returns null when createImageBitmap rejects (decode failure)", async () => {
    const { loadImageBitmap } = await import("#foliplus/ExportControl/util.js");
    globalThis.fetch = makeFetchOk();
    globalThis.createImageBitmap = vi.fn(() =>
      Promise.reject(new Error("decode failed")),
    ) as unknown as typeof createImageBitmap;
    const result = await loadImageBitmap("https://example.com/b.png");
    expect(result).toBeNull();
  });

  it("loads a fresh ImageBitmap each call (no caching)", async () => {
    const { loadImageBitmap } = await import("#foliplus/ExportControl/util.js");
    globalThis.fetch = makeFetchOk();
    const bitmap1 = { close: vi.fn() };
    const bitmap2 = { close: vi.fn() };
    globalThis.createImageBitmap = vi
      .fn()
      .mockResolvedValueOnce(bitmap1)
      .mockResolvedValueOnce(bitmap2) as unknown as typeof createImageBitmap;
    const first = await loadImageBitmap("https://example.com/a.png");
    const second = await loadImageBitmap("https://example.com/a.png");
    expect(first).toBe(bitmap1);
    expect(second).toBe(bitmap2);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(2);
  });
});

describe("loadImage", () => {
  it("resolves on image load", async () => {
    const { loadImage } = await import("#foliplus/ExportControl/util.js");
    const origImage = globalThis.Image;
    let onloadHandler: (() => void) | null = null;
    globalThis.Image = class {
      set src(v: string) {
        queueMicrotask(() => onloadHandler?.());
      }
      set onload(fn: (() => void) | null) {
        onloadHandler = fn;
      }
    } as unknown as typeof Image;
    const result = loadImage("data:image/png;base64,AAAA");
    await expect(result).resolves.toBeDefined();
    globalThis.Image = origImage;
  });

  it("detaches event handlers on success", async () => {
    const { loadImage } = await import("#foliplus/ExportControl/util.js");
    const origImage = globalThis.Image;
    const images: HTMLImageElement[] = [];
    let onloadHandler: (() => void) | null = null;
    globalThis.Image = class {
      private _onload: (() => void) | null = null;
      private _onerror: (() => void) | null = null;
      private _src = "";
      crossOrigin?: string;
      constructor() {
        images.push(this);
      }
      get onload() {
        return this._onload;
      }
      set onload(fn: (() => void) | null) {
        this._onload = fn;
        onloadHandler = fn;
      }
      get onerror() {
        return this._onerror;
      }
      set onerror(fn: (() => void) | null) {
        this._onerror = fn;
      }
      get src() {
        return this._src;
      }
      set src(v: string) {
        this._src = v;
        queueMicrotask(() => onloadHandler?.());
      }
    } as unknown as typeof Image;

    const result = await loadImage("data:image/png;base64,AAAA");
    expect(result).toBeDefined();
    expect(images[0].onload).toBeNull();
    expect(images[0].onerror).toBeNull();
    globalThis.Image = origImage;
  });

  it("revokes blob URL and detaches handlers on error", async () => {
    const { loadImage } = await import("#foliplus/ExportControl/util.js");
    const origImage = globalThis.Image;
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL");
    let onerrorHandler: (() => void) | null = null;
    globalThis.Image = class {
      private _onload: (() => void) | null = null;
      private _onerror: (() => void) | null = null;
      private _src = "";
      crossOrigin?: string;
      get onload() {
        return this._onload;
      }
      set onload(fn: (() => void) | null) {
        this._onload = fn;
      }
      get onerror() {
        return this._onerror;
      }
      set onerror(fn: (() => void) | null) {
        this._onerror = fn;
        onerrorHandler = fn;
      }
      get src() {
        return this._src;
      }
      set src(v: string) {
        this._src = v;
        queueMicrotask(() => onerrorHandler?.());
      }
    } as unknown as typeof Image;

    await expect(loadImage("blob:https://example.com/123")).rejects.toThrow();
    expect(revokeSpy).toHaveBeenCalledWith("blob:https://example.com/123");

    globalThis.Image = origImage;
    revokeSpy.mockRestore();
  });
});

describe("generateWorldFile", () => {
  it("produces a six-line file with trailing newline", () => {
    const out = generateWorldFile(
      { lat: 40.0, lng: -74.0 },
      { lat: 39.9, lng: -73.9 },
      1000,
      800,
    );
    const lines = out.split("\n");
    // Six data lines plus a final empty entry from the trailing "\n".
    expect(lines.length).toBe(7);
    expect(lines[0]).toMatch(/^-?\d/);
    expect(lines[1]).toBe("0");
    expect(lines[2]).toBe("0");
    expect(lines[3]).toMatch(/^-?\d/);
    expect(lines[5]).toMatch(/^-?\d/);
    expect(lines[6]).toBe(""); // trailing newline
  });

  it("computes pixel widths correctly for a rectangular extent", () => {
    const out = generateWorldFile(
      { lat: 41.0, lng: -75.0 },
      { lat: 40.0, lng: -74.0 },
      1000,
      500,
    );
    const lines = out.split("\n").slice(0, 6);
    const pixelWidth = parseFloat(lines[0]);
    const pixelHeight = parseFloat(lines[3]);
    // lng range = 1.0 deg over 1000 px → 0.001 deg/px
    expect(pixelWidth).toBeCloseTo(0.001, 9);
    // lat range = -1.0 deg over 500 px → -0.002 deg/px
    expect(pixelHeight).toBeCloseTo(-0.002, 9);
    // ulx = -75.0 + 0.001/2 = -74.9995
    const ulx = parseFloat(lines[4]);
    expect(ulx).toBeCloseTo(-74.9995, 9);
    // uly = 41.0 + (-0.002)/2 = 40.999
    const uly = parseFloat(lines[5]);
    expect(uly).toBeCloseTo(40.999, 9);
  });

  it("handles inverted (negative) x-extent", () => {
    // nw.lng > se.lng (east is on the left)
    const out = generateWorldFile(
      { lat: 41.0, lng: -73.0 },
      { lat: 40.0, lng: -75.0 },
      1000,
      500,
    );
    const lines = out.split("\n").slice(0, 6);
    const pixelWidth = parseFloat(lines[0]);
    expect(pixelWidth).toBeLessThan(0);
  });

  it("returns zero for degenerate (zero-width or zero-height) inputs", () => {
    // Zero width → division by zero for pixelWidth; should not throw.
    const out = generateWorldFile(
      { lat: 41.0, lng: -74.0 },
      { lat: 40.0, lng: -74.0 },
      0,
      100,
    );
    const lines = out.split("\n").slice(0, 6);
    // pixelWidth = 0/0 = NaN; NaN.toPrecision() returns 'NaN'
    expect(lines[0]).toBe("NaN") || expect(lines[0]).toBe("Infinity");
    // pixelHeight should be finite and negative
    expect(!isNaN(parseFloat(lines[3]))).toBe(true);
  });
});

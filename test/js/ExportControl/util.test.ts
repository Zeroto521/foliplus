import { describe, expect, it, vi } from "vitest";
import { ensureFont, isVisible } from "#foliplus/ExportControl/util.js";

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


import { ensureFont, isVisible } from "#foliplus/ExportControl/util.js";
import { describe, expect, it, vi } from "vitest";

describe("isVisible", () => {
  it("returns true for a rectangle fully inside the viewport", () => {
    expect(isVisible(10, 10, 100, 100, 500, 500)).toBe(true);
  });

  it("returns true for a rectangle partially overlapping the viewport", () => {
    // Sprite extends left of the viewport (dx < 0) but still overlaps
    expect(isVisible(-50, 10, 100, 100, 500, 500)).toBe(true);
    // Sprite starts above but overlaps vertically
    expect(isVisible(10, -50, 100, 100, 500, 500)).toBe(true);
  });

  it("returns false when the rectangle is entirely left of the viewport", () => {
    // dx + dw < 0 → fully off the left edge
    expect(isVisible(-200, 10, 100, 100, 500, 500)).toBe(false);
  });

  it("returns false when entirely above the viewport", () => {
    // dy + dh < 0 → fully off the top edge
    expect(isVisible(10, -200, 100, 100, 500, 500)).toBe(false);
  });

  it("returns false when entirely right of the viewport", () => {
    // dx > cw → fully off the right edge
    expect(isVisible(600, 10, 100, 100, 500, 500)).toBe(false);
  });

  it("returns false when entirely below the viewport", () => {
    // dy > ch → fully off the bottom edge
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
  beforeEach(async () => {
    // AbortSignal.timeout may be undefined in jsdom; provide a stub.
    globalThis.AbortSignal = Object.assign(globalThis.AbortSignal || {}, {
      timeout: () => ({}),
    }) as unknown as typeof AbortSignal;
    window.CONF = { ...window.CONF, name: "ExportControl", timeout: 7500 };
    // The module-level bitmap cache persists between tests; start fresh.
    const { clearBitmapCache } = await import("#foliplus/ExportControl/util.js");
    clearBitmapCache();
  });

  it("returns null when fetch response is not ok", async () => {
    const { loadImageBitmap } = await import("#foliplus/ExportControl/util.js");
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: false }),
    ) as unknown as typeof fetch;
    const result = await loadImageBitmap("https://example.com/tile.png");
    expect(result).toBeNull();
  });

  it("loads and caches an ImageBitmap", async () => {
    const { loadImageBitmap } = await import("#foliplus/ExportControl/util.js");
    const fakeBitmap = { close: vi.fn() };
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob()) }),
    ) as unknown as typeof fetch;
    globalThis.createImageBitmap = vi.fn(() =>
      Promise.resolve(fakeBitmap),
    ) as unknown as typeof createImageBitmap;
    const first = await loadImageBitmap("https://example.com/a.png");
    const second = await loadImageBitmap("https://example.com/a.png");
    expect(first).toBe(fakeBitmap);
    expect(second).toBe(fakeBitmap);
    // Cache hit → fetch called only once
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns null when createImageBitmap rejects (nothing leaked to close)", async () => {
    const { loadImageBitmap } = await import("#foliplus/ExportControl/util.js");
    const fakeBitmap = { close: vi.fn() };
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob()) }),
    ) as unknown as typeof fetch;
    // Decode failure: nothing is created, so nothing should be closed.
    globalThis.createImageBitmap = vi.fn(() =>
      Promise.reject(new Error("bitmap decode failed")),
    ) as unknown as typeof createImageBitmap;
    const result = await loadImageBitmap("https://example.com/b.png");
    expect(result).toBeNull();
    expect(fakeBitmap.close).not.toHaveBeenCalled();
  });

  it("closes the evicted bitmap when the cache exceeds TILE_MAX", async () => {
    const { loadImageBitmap } = await import("#foliplus/ExportControl/util.js");
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob()) }),
    ) as unknown as typeof fetch;
    const bitmaps: Array<{ close: ReturnType<typeof vi.fn> }> = [];
    globalThis.createImageBitmap = vi.fn(() => {
      const b = { close: vi.fn() };
      bitmaps.push(b);
      return Promise.resolve(b);
    }) as unknown as typeof createImageBitmap;
    // Fill the cache up to TILE_MAX (1000 entries).
    for (let i = 0; i < 1000; i++) {
      await loadImageBitmap(`https://example.com/t${i}.png`);
    }
    // The 1001st insert evicts and closes the oldest entry.
    await loadImageBitmap("https://example.com/t1000.png");
    expect(bitmaps[0].close).toHaveBeenCalledTimes(1);
    expect(bitmaps[1].close).not.toHaveBeenCalled();
  });

  it("clearBitmapCache closes all cached bitmaps", async () => {
    const { loadImageBitmap, clearBitmapCache } =
      await import("#foliplus/ExportControl/util.js");
    const fakeBitmap1 = { close: vi.fn() };
    const fakeBitmap2 = { close: vi.fn() };
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob()) }),
    ) as unknown as typeof fetch;
    globalThis.createImageBitmap = vi
      .fn()
      .mockResolvedValueOnce(fakeBitmap1)
      .mockResolvedValueOnce(fakeBitmap2) as unknown as typeof createImageBitmap;

    await loadImageBitmap("https://example.com/a.png");
    await loadImageBitmap("https://example.com/b.png");

    clearBitmapCache();
    expect(fakeBitmap1.close).toHaveBeenCalledTimes(1);
    expect(fakeBitmap2.close).toHaveBeenCalledTimes(1);
  });
});

describe("loadImage", () => {
  it("resolves on image load", async () => {
    const { loadImage } = await import("#foliplus/ExportControl/util.js");
    // jsdom Image does not fire onload for data URIs reliably; mock it.
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
    // Accessor-based mock: fields would shadow the setters, so track state in
    // a private backing field and expose getters for post-condition asserts.
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
    // Handlers should be detached after success
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

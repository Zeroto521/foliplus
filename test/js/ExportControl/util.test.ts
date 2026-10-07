import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureFont,
  isExportExcluded,
  isVisible,
  resolveExportBackground,
} from "#foliplus/ExportControl/util.js";

describe("isExportExcluded", () => {
  it("is true when the element matches SKIP_EXPORT", () => {
    const el = document.createElement("div");
    el.setAttribute("data-foliplus-export", "exclude");
    expect(isExportExcluded(el)).toBe(true);
  });

  it("is true when an ancestor matches SKIP_EXPORT", () => {
    const host = document.createElement("div");
    host.setAttribute("data-foliplus-export", "exclude");
    const child = document.createElement("canvas");
    host.appendChild(child);
    document.body.appendChild(host);
    try {
      expect(isExportExcluded(child)).toBe(true);
    } finally {
      host.remove();
    }
  });

  it("is false for an unmarked element with no marked ancestor", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    try {
      expect(isExportExcluded(el)).toBe(false);
    } finally {
      el.remove();
    }
  });
});

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

  it("defers on document.fonts.ready when the check reports the font missing", async () => {
    let releaseReady: (() => void) | null = null;
    const fonts = {
      load: vi.fn(() => Promise.resolve()),
      check: vi.fn(() => false),
      ready: new Promise<void>(resolve => {
        releaseReady = resolve;
      }),
    };
    Object.defineProperty(document, "fonts", { value: fonts, configurable: true });
    try {
      const pending = ensureFont("16px sans-serif");
      // Still pending while `ready` is held — proves the await is actually taken
      // rather than skipped by an empty catch.
      const stillPending = await Promise.race([
        pending.then(() => false),
        Promise.resolve(true),
      ]);
      expect(stillPending).toBe(true);

      releaseReady!();
      await pending;
      expect(fonts.check).toHaveBeenCalledWith("16px sans-serif");
    } finally {
      Object.defineProperty(document, "fonts", {
        value: document.fonts,
        configurable: true,
      });
    }
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
    window.CONFIG = { ...window.CONFIG, name: "ExportControl", timeout: 7500 };
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

describe("resolveExportBackground", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);

  it("returns undefined for 'transparent'", () => {
    const spy = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      backgroundColor: "transparent",
    } as unknown as CSSStyleDeclaration);
    expect(resolveExportBackground(container)).toBeUndefined();
    spy.mockRestore();
  });

  it("returns undefined for 'rgba(0, 0, 0, 0)'", () => {
    const spy = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      backgroundColor: "rgba(0, 0, 0, 0)",
    } as unknown as CSSStyleDeclaration);
    expect(resolveExportBackground(container)).toBeUndefined();
    spy.mockRestore();
  });

  it("returns the color for an opaque value", () => {
    const spy = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      backgroundColor: "rgb(220, 30, 30)",
    } as unknown as CSSStyleDeclaration);
    expect(resolveExportBackground(container)).toBe("rgb(220, 30, 30)");
    spy.mockRestore();
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
        images.push(this as unknown as HTMLImageElement);
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

  for (const [crossOrigin, wanted] of [
    ["anonymous", "anonymous"],
    [undefined, undefined],
  ] as const) {
    it(`sets crossOrigin="${String(crossOrigin)}" on the image element`, async () => {
      const { loadImage } = await import("#foliplus/ExportControl/util.js");
      const origImage = globalThis.Image;
      const instances: Array<{ crossOrigin?: string }> = [];
      let onloadHandler: (() => void) | null = null;
      globalThis.Image = class {
        crossOrigin?: string;
        constructor() {
          instances.push(this);
        }
        set onload(fn: (() => void) | null) {
          onloadHandler = fn;
        }
        set onerror(_fn: (() => void) | null) {}
        set src(_v: string) {
          queueMicrotask(() => onloadHandler?.());
        }
      } as unknown as typeof Image;

      try {
        const loaded = await loadImage("data:image/png;base64,AAAA", crossOrigin);
        expect(loaded).toBe(instances[0]);
        expect(instances[0].crossOrigin).toBe(wanted);
      } finally {
        globalThis.Image = origImage;
      }
    });
  }

  it("rejects without revoking a non-blob URL", async () => {
    const { loadImage } = await import("#foliplus/ExportControl/util.js");
    const origImage = globalThis.Image;
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL");
    let onerrorHandler: (() => void) | null = null;
    globalThis.Image = class {
      crossOrigin?: string;
      set onload(_fn: (() => void) | null) {}
      set onerror(fn: (() => void) | null) {
        onerrorHandler = fn;
      }
      set src(_v: string) {
        queueMicrotask(() => onerrorHandler?.());
      }
    } as unknown as typeof Image;

    try {
      await expect(loadImage("data:image/png;base64,broken")).rejects.toThrow();
      expect(revokeSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.Image = origImage;
      revokeSpy.mockRestore();
    }
  });
});

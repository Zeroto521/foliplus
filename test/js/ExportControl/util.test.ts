import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REVOKE_DELAY,
  download,
  ensureFont,
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

describe("download", () => {
  let createdUrls: string[];
  let revokedUrls: string[];
  let lastAnchor: any;

  beforeEach(() => {
    createdUrls = [];
    revokedUrls = [];
    lastAnchor = null;

    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => {
        const url = `blob:fake-${createdUrls.length}`;
        createdUrls.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => revokedUrls.push(url)),
    });

    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(tag => {
      if (String(tag).toLowerCase() === "a") {
        const a = origCreate("a") as HTMLAnchorElement;
        a.click = vi.fn();
        const realRemove = a.remove.bind(a);
        a.remove = vi.fn(() => {
          if (a.isConnected) realRemove();
        });
        lastAnchor = a;
        return a;
      }
      return origCreate(tag);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("downloads the blob under the given filename", () => {
    const blob = new Blob(["geojson"], { type: "application/geo+json" });
    download(blob, "measurements.geojson");

    expect(lastAnchor.download).toBe("measurements.geojson");
    expect(lastAnchor.href).toBe(createdUrls[0]);
    expect(lastAnchor.rel).toBe("noopener");
    expect(lastAnchor.click).toHaveBeenCalled();
    expect(createdUrls).toHaveLength(1);
  });

  it("passes the blob through to createObjectURL untouched", () => {
    const blob = new Blob(["abc"], { type: "text/csv" });
    download(blob, "x.csv");

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
  });

  it("releases the object URL after the default delay", () => {
    vi.useFakeTimers();
    download(new Blob(["x"], { type: "text/plain" }), "x.txt");

    expect(revokedUrls).toHaveLength(0);
    vi.advanceTimersByTime(DEFAULT_REVOKE_DELAY - 1);
    expect(revokedUrls).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(revokedUrls).toEqual([createdUrls[0]]);
  });

  it("honours a custom revoke delay", () => {
    vi.useFakeTimers();
    download(new Blob(["x"], { type: "text/plain" }), "x.txt", 150);

    vi.advanceTimersByTime(150);
    expect(revokedUrls).toEqual([createdUrls[0]]);
  });

  it("detaches the anchor instead of leaving it in the DOM", () => {
    download(new Blob(["x"], { type: "text/plain" }), "x.txt");

    expect(lastAnchor.remove).toHaveBeenCalled();
    expect(document.body.contains(lastAnchor)).toBe(false);
  });

  it("hides the anchor so it never shows as a visible link", () => {
    download(new Blob(["x"], { type: "text/plain" }), "x.txt");
    expect(lastAnchor.style.display).toBe("none");
  });

  it("detaches the anchor and schedules revoke when click() throws", () => {
    vi.useFakeTimers();
    // The anchor only exists once createElement runs, so the throwing click is
    // injected at creation time rather than patched on afterwards.
    vi.spyOn(document, "createElement").mockImplementationOnce(tag => {
      const a = document.createElement(String(tag)) as HTMLAnchorElement;
      a.click = vi.fn(() => {
        throw new Error("blocked by browser");
      });
      lastAnchor = a;
      return a;
    });

    // Captured rather than .toThrow(): that matcher rethrows the original
    // error, which would mask the cleanup finally already performed.
    let thrown: unknown = null;
    try {
      download(new Blob(["x"], { type: "text/plain" }), "x.txt");
    } catch (err) {
      thrown = err;
    }
    expect(String(thrown)).toContain("blocked by browser");

    // The error still reaches the caller, but the URL must be released on
    // schedule — a throw is exactly the case the leak would otherwise hit.
    expect(document.body.contains(lastAnchor)).toBe(false);
    expect(revokedUrls).toHaveLength(0);
    vi.advanceTimersByTime(DEFAULT_REVOKE_DELAY);
    expect(revokedUrls).toEqual([createdUrls[0]]);
  });
});

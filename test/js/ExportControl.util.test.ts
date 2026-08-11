import { ensureFont, isVisible } from "#foliplus/ExportControl/ExportControl.util.js";
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
  beforeEach(() => {
    // AbortSignal.timeout may be undefined in jsdom; provide a stub.
    globalThis.AbortSignal = Object.assign(globalThis.AbortSignal || {}, {
      timeout: () => ({}),
    });
    window.CONF = { ...window.CONF, name: "ExportControl", timeout: 7500 };
  });

  it("returns null when fetch response is not ok", async () => {
    const { loadImageBitmap } =
      await import("#foliplus/ExportControl/ExportControl.util.js");
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false }));
    const result = await loadImageBitmap("https://example.com/tile.png");
    expect(result).toBeNull();
  });

  it("loads and caches an ImageBitmap", async () => {
    const { loadImageBitmap } =
      await import("#foliplus/ExportControl/ExportControl.util.js");
    const fakeBitmap = { close: vi.fn() };
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob()) }),
    );
    globalThis.createImageBitmap = vi.fn(() => Promise.resolve(fakeBitmap));
    const first = await loadImageBitmap("https://example.com/a.png");
    const second = await loadImageBitmap("https://example.com/a.png");
    expect(first).toBe(fakeBitmap);
    expect(second).toBe(fakeBitmap);
    // Cache hit → fetch called only once
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("loadImage", () => {
  it("resolves on image load", async () => {
    const { loadImage } = await import("#foliplus/ExportControl/ExportControl.util.js");
    // jsdom Image does not fire onload for data URIs reliably; mock it.
    const origImage = globalThis.Image;
    let onloadHandler;
    globalThis.Image = class {
      set src(v) {
        queueMicrotask(() => onloadHandler?.());
      }
      set onload(fn) {
        onloadHandler = fn;
      }
    };
    const result = loadImage("data:image/png;base64,AAAA");
    await expect(result).resolves.toBeDefined();
    globalThis.Image = origImage;
  });
});

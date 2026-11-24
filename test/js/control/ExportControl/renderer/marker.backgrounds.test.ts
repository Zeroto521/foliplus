// renderer/marker.backgrounds — unit tests for the icon-background pass and
// the render's asset-failure accounting. Extracted from marker.test.ts so that
// file stays under the test-size cap; both mirror renderer/marker.ts.
import { makeRenderer, pinBox, positionedRC, textCtx, withStyle } from "./fixture.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  renderIconBackgrounds,
  renderMarkers,
  renderRemaining,
} from "#control/ExportControl/renderer/marker.js";
import type { RenderCtx } from "#control/ExportControl/type.js";
import * as UTIL from "#control/ExportControl/util.js";

vi.mock("#control/ExportControl/util.js", async () => {
  const actual = await vi.importActual<any>("#control/ExportControl/util.js");
  const loadImageBitmap = vi.fn();
  return { ...actual, loadImageBitmap };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderIconBackgrounds", () => {
  type StyleMap = Record<string, string>;
  const BASE: StyleMap = {
    display: "block",
    visibility: "visible",
    opacity: "1",
    backgroundImage: "none",
    backgroundColor: "transparent",
    maskImage: "none",
    borderStyle: "none",
    borderWidth: "0px",
    borderColor: "transparent",
    borderRadius: "0px",
  };
  const mockStyles = (map: Map<Element, StyleMap>) => {
    vi.spyOn(window, "getComputedStyle").mockImplementation(((el: Element) => {
      const props = map.get(el) ?? BASE;
      return Object.assign(Object.create(null), props, {
        getPropertyValue: (prop: string) => props[prop] ?? "",
      });
    }) as any);
  };
  const boxOf = (el: any, left: number, top: number, w: number, h: number) => {
    el.getBoundingClientRect = () =>
      ({ left, top, width: w, height: h, right: left + w, bottom: top + h }) as DOMRect;
    return el;
  };

  it("paints a descendant's flat background and border", () => {
    // A DivIcon's pin body is a child element: the root that Leaflet creates
    // is transparent.  The export used to look only at the root, so the pin
    // never reached the canvas.
    const ctx = textCtx();
    const root = boxOf(document.createElement("div"), 10, 10, 40, 40);
    const child = boxOf(document.createElement("div"), 15, 15, 20, 20);
    root.appendChild(child);
    mockStyles(
      new Map<Element, StyleMap>([
        [
          child,
          {
            ...BASE,
            backgroundColor: "rgb(0, 204, 102)",
            borderStyle: "solid",
            borderWidth: "2px",
            borderColor: "rgb(0, 68, 0)",
            borderRadius: "50%",
          },
        ],
      ]),
    );

    renderIconBackgrounds(makeRenderer().container, positionedRC(1000, 1000, ctx), [
      root,
    ]);

    expect(ctx.fillStyle).toBe("rgb(0, 204, 102)");
    // 50% of the 20x20 box is a 10px corner radius (the pill becomes a circle).
    expect(ctx.roundRect).toHaveBeenCalledWith(15, 15, 20, 20, 10);
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.strokeStyle).toBe("rgb(0, 68, 0)");
    expect(ctx.lineWidth).toBe(2);
  });

  it("leaves sprite, mask and label paints to their own channels", () => {
    const ctx = textCtx();
    const root = boxOf(document.createElement("div"), 10, 10, 80, 80);
    const sprite = boxOf(document.createElement("div"), 20, 20, 20, 20);
    const masked = boxOf(document.createElement("div"), 40, 40, 20, 20);
    const label = boxOf(document.createElement("div"), 10, 60, 40, 16);
    label.setAttribute("data-foliplus-export", "label");
    const labelChild = boxOf(document.createElement("span"), 12, 62, 10, 10);
    label.appendChild(labelChild);
    const plain = boxOf(document.createElement("div"), 60, 60, 12, 12);
    root.append(sprite, masked, label, plain);
    mockStyles(
      new Map<Element, StyleMap>([
        [sprite, { ...BASE, backgroundImage: 'url("sprite.png")' }],
        [
          masked,
          { ...BASE, maskImage: 'url("mask.png")', backgroundColor: "rgb(255, 0, 0)" },
        ],
        [labelChild, { ...BASE, backgroundColor: "rgb(0, 0, 255)" }],
        [plain, { ...BASE, backgroundColor: "rgb(1, 2, 3)" }],
      ]),
    );

    renderIconBackgrounds(makeRenderer().container, positionedRC(1000, 1000, ctx), [
      root,
    ]);

    // Sprite (renderMarkers), mask chassis (renderMarkers) and label chrome
    // (renderTextLabels) keep their own painter; only the plain child lands
    // here.
    expect(ctx.fillStyle).toBe("rgb(1, 2, 3)");
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).toHaveBeenCalledWith(60, 60, 12, 12);
  });
});

describe("renderRemaining — painted backgrounds and asset failures", () => {
  const boxOf = (el: any, left: number, top: number, w: number, h: number) => {
    el.getBoundingClientRect = () =>
      ({ left, top, width: w, height: h, right: left + w, bottom: top + h }) as DOMRect;
    return el;
  };

  it("does not repaint a background the icon-background pass already filled", async () => {
    const ctx = textCtx();
    const root = boxOf(document.createElement("div"), 10, 10, 24, 24);
    const restore = withStyle({
      display: "block",
      visibility: "visible",
      opacity: "1",
      backgroundImage: "none",
      backgroundColor: "rgb(10, 20, 30)",
      borderStyle: "none",
      borderWidth: "0px",
      borderColor: "transparent",
      borderRadius: "0px",
    });
    try {
      const rc = positionedRC(1000, 1000, ctx) as RenderCtx;
      rc.paintedBackgrounds = new WeakSet<HTMLElement>([root]);
      await renderRemaining(makeRenderer().container, rc, [root]);
      expect(ctx.fillRect).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("counts an icon image it could not read back", async () => {
    const ctx = textCtx();
    const img = document.createElement("img");
    img.src = "https://example.test/icon.png";
    boxOf(img, 10, 10, 24, 24);
    vi.spyOn(UTIL, "loadImage").mockRejectedValue(new Error("network down"));
    const rc = positionedRC(1000, 1000, ctx) as RenderCtx;

    await renderRemaining(makeRenderer().container, rc, [img]);

    expect(rc.failedAssets).toEqual([
      { src: "https://example.test/icon.png", reason: "network down" },
    ]);
  });
});

describe("renderMarkers — asset failure reporting", () => {
  it("counts and deduplicates a sprite it could not load", async () => {
    const ctx = textCtx();
    const root = pinBox(document.createElement("div"), 10, 10, 40, 40);
    const restore = withStyle({
      display: "block",
      visibility: "visible",
      opacity: "1",
      backgroundImage: 'url("sprite.png")',
      backgroundSize: "64px 64px",
      backgroundPosition: "0 0",
      backgroundColor: "transparent",
    });
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });
    (UTIL.loadImageBitmap as any).mockImplementation(
      (_url: string, onError?: (error: unknown) => void) => {
        onError?.(new Error("HTTP 403"));
        return Promise.resolve(null);
      },
    );
    try {
      const rc = positionedRC(1000, 1000, ctx) as RenderCtx;
      await renderMarkers(makeRenderer().container, rc, [root]);
      // Two roots referencing the same sprite must not double-report it.
      await renderMarkers(makeRenderer().container, rc, [root]);

      expect(rc.failedAssets).toEqual([{ src: "sprite.png", reason: "HTTP 403" }]);
    } finally {
      restore();
    }
  });
});

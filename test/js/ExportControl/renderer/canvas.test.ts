import { afterEach, describe, expect, it, vi } from "vitest";
import * as UTIL from "#foliplus/ExportControl/util.js";
import {
  renderCanvasElement,
  renderPaneCanvas,
} from "#foliplus/ExportControl/renderer/canvas.js";
import {
  makeMockCtx,
  makeRenderer,
  pinBox,
  positionedRC,
  stubLoad,
} from "./fixture.js";

vi.mock("#foliplus/ExportControl/util.js", async () => {
  const actual = await vi.importActual<any>("#foliplus/ExportControl/util.js");
  const loadImageBitmap = vi.fn();
  return { ...actual, loadImageBitmap };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderCanvasElement", () => {
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

    await renderCanvasElement(makeRenderer().container,
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

    await renderCanvasElement(makeRenderer().container,
      positionedRC(1000, 1000, ctx),
      canvas,
    );

    expect(load).toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("applies element opacity via ctx.globalAlpha when less than 1", async () => {
    const ctx = makeMockCtx();
    ctx.globalAlpha = 1;
    let alphaDuringDraw = 0;
    ctx.drawImage = vi.fn(() => {
      alphaDuringDraw = ctx.globalAlpha;
    });
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = () => rectOf(100, 100, 200, 200);
    canvas.style.opacity = "0.5";
    vi.spyOn(UTIL, "loadImage").mockResolvedValue({} as any);
    await renderCanvasElement(makeRenderer().container,
      positionedRC(1000, 1000, ctx),
      canvas,
    );
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(alphaDuringDraw).toBe(0.5);
    expect(ctx.globalAlpha).toBe(1);
  });
});

describe("renderPaneCanvas", () => {
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

    await renderPaneCanvas(makeRenderer().container,
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

    await renderPaneCanvas(makeRenderer().container,
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
    await renderPaneCanvas(makeRenderer().container,
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

    await renderPaneCanvas(makeRenderer().container,
      positionedRC(1000, 1000, ctx),
      p,
    );

    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("applies canvas opacity via ctx.globalAlpha when less than 1", async () => {
    const ctx = makeMockCtx();
    ctx.globalAlpha = 1;
    let alphaDuringDraw = 0;
    ctx.drawImage = vi.fn(() => {
      alphaDuringDraw = ctx.globalAlpha;
    });
    const p = pane();
    const ce = canvasEl(10, 10, 200, 200);
    ce.style.opacity = "0.5";
    p.appendChild(ce);
    stubLoad();
    await renderPaneCanvas(makeRenderer().container,
      positionedRC(1000, 1000, ctx),
      p,
    );
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(alphaDuringDraw).toBe(0.5);
    expect(ctx.globalAlpha).toBe(1);
  });
});

describe("renderCanvasElement / renderPaneCanvas — branch edges", () => {
  it("skips a canvas that falls outside the crop rect (isVisible false)", async () => {
    const ctx = makeMockCtx();
    const canvas = document.createElement("canvas");
    // Box far to the right of a 100x100 crop.
    canvas.getBoundingClientRect = () =>
      ({ left: 5000, top: 0, width: 100, height: 100, right: 5100, bottom: 100 }) as DOMRect;
    const load = vi.spyOn(UTIL, "loadImage").mockResolvedValue({} as any);
    await renderCanvasElement(makeRenderer().container, positionedRC(100, 100, ctx), canvas);
    expect(load).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("skips a pane canvas that falls outside the crop rect", async () => {
    const ctx = makeMockCtx();
    const p = document.createElement("div");
    const ce = document.createElement("canvas");
    ce.getBoundingClientRect = () =>
      ({ left: 5000, top: 5000, width: 50, height: 50, right: 5050, bottom: 5050 }) as DOMRect;
    p.appendChild(ce);
    const load = vi.spyOn(UTIL, "loadImage").mockResolvedValue({} as any);
    await renderPaneCanvas(makeRenderer().container, positionedRC(100, 100, ctx), p);
    expect(load).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  renderCanvasElement,
  renderCanvasSnapshot,
  renderPaneCanvas,
  snapshotPaneCanvases,
} from "#foliplus/ExportControl/renderer/canvas.js";
import * as UTIL from "#foliplus/ExportControl/util.js";
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

    await renderCanvasElement(
      makeRenderer().container,
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

    await renderCanvasElement(
      makeRenderer().container,
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
    await renderCanvasElement(
      makeRenderer().container,
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

  const canvasEl = (left: number, top: number, width: number, height: number) => {
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

    await renderPaneCanvas(makeRenderer().container, positionedRC(1000, 1000, ctx), p);

    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it("skips a pane canvas with no area", async () => {
    const ctx = makeMockCtx();
    const p = pane();
    p.appendChild(canvasEl(0, 0, 0, 0));
    const load = stubLoad();

    await renderPaneCanvas(makeRenderer().container, positionedRC(1000, 1000, ctx), p);

    expect(load).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("skips a pane canvas outside the crop rect", async () => {
    const ctx = makeMockCtx();
    const p = pane();
    // The rect spans 0..100 on both axes, so a box at 500 is fully outside.
    p.appendChild(canvasEl(500, 500, 200, 200));
    const load = stubLoad();
    await renderPaneCanvas(makeRenderer().container, positionedRC(100, 100, ctx), p);

    expect(load).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("draws nothing when the data URL cannot load", async () => {
    const ctx = makeMockCtx();
    const p = pane();
    p.appendChild(canvasEl(10, 10, 200, 200));
    vi.spyOn(UTIL, "loadImage").mockRejectedValue(new Error("boom"));

    await renderPaneCanvas(makeRenderer().container, positionedRC(1000, 1000, ctx), p);

    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("skips a canvas self-marked with data-foliplus-export=exclude", async () => {
    const ctx = makeMockCtx();
    const p = pane();
    const marked = canvasEl(10, 10, 200, 200);
    marked.setAttribute("data-foliplus-export", "exclude");
    p.appendChild(marked);
    const load = stubLoad();

    await renderPaneCanvas(makeRenderer().container, positionedRC(1000, 1000, ctx), p);

    expect(load).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("skips a canvas nested under a data-foliplus-export=exclude ancestor", async () => {
    const ctx = makeMockCtx();
    const p = pane();
    const host = document.createElement("div");
    host.setAttribute("data-foliplus-export", "exclude");
    host.appendChild(canvasEl(10, 10, 200, 200));
    p.appendChild(host);
    const load = stubLoad();

    await renderPaneCanvas(makeRenderer().container, positionedRC(1000, 1000, ctx), p);

    expect(load).not.toHaveBeenCalled();
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
    await renderPaneCanvas(makeRenderer().container, positionedRC(1000, 1000, ctx), p);
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
      ({
        left: 5000,
        top: 0,
        width: 100,
        height: 100,
        right: 5100,
        bottom: 100,
      }) as DOMRect;
    const load = vi.spyOn(UTIL, "loadImage").mockResolvedValue({} as any);
    await renderCanvasElement(
      makeRenderer().container,
      positionedRC(100, 100, ctx),
      canvas,
    );
    expect(load).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("skips a pane canvas that falls outside the crop rect", async () => {
    const ctx = makeMockCtx();
    const p = document.createElement("div");
    const ce = document.createElement("canvas");
    ce.getBoundingClientRect = () =>
      ({
        left: 5000,
        top: 5000,
        width: 50,
        height: 50,
        right: 5050,
        bottom: 5050,
      }) as DOMRect;
    p.appendChild(ce);
    const load = vi.spyOn(UTIL, "loadImage").mockResolvedValue({} as any);
    await renderPaneCanvas(makeRenderer().container, positionedRC(100, 100, ctx), p);
    expect(load).not.toHaveBeenCalled();
  });
});

describe("snapshotPaneCanvases", () => {
  const labelPane = () => {
    const p = document.createElement("div");
    p.className = "leaflet-map-pane foliplus-label-pane";
    return p;
  };

  const labelCanvas = (left: number, top: number, width: number, height: number) => {
    const ce = document.createElement("canvas");
    ce.className = "foliplus-label-canvas";
    pinBox(ce, left, top, width, height);
    ce.toDataURL = () => "data:image/png;base64,LABEL";
    return ce;
  };

  it("snapshots a label canvas with its geometry and opacity", () => {
    const p = labelPane();
    const ce = labelCanvas(10, 10, 200, 200);
    ce.style.opacity = "0.5";
    p.appendChild(ce);
    const rc = positionedRC(1000, 1000, makeMockCtx());

    const snap = snapshotPaneCanvases(makeRenderer().container, rc, p);

    expect(snap.held).toBe(1);
    expect(snap.snaps).toHaveLength(1);
    expect(snap.snaps[0].dataUrl).toBe("data:image/png;base64,LABEL");
    expect(snap.snaps[0].dx).toBe(10);
    expect(snap.snaps[0].dy).toBe(10);
    expect(snap.snaps[0].dw).toBe(200);
    expect(snap.snaps[0].dh).toBe(200);
    expect(snap.snaps[0].opacity).toBe(0.5);
  });

  it("does not count a canvas outside the crop as seen", () => {
    // A canvas fully outside the crop is not a label this export is expected
    // to carry, so it must not be held (which would report a loss).
    const p = labelPane();
    p.appendChild(labelCanvas(5000, 5000, 50, 50));
    const rc = positionedRC(100, 100, makeMockCtx());

    const snap = snapshotPaneCanvases(makeRenderer().container, rc, p);

    expect(snap.held).toBe(0);
    expect(snap.snaps).toHaveLength(0);
  });

  it("does not count a zero-area canvas as seen", () => {
    const p = labelPane();
    p.appendChild(labelCanvas(0, 0, 0, 0));
    const rc = positionedRC(100, 100, makeMockCtx());

    const snap = snapshotPaneCanvases(makeRenderer().container, rc, p);

    expect(snap.held).toBe(0);
    expect(snap.snaps).toHaveLength(0);
  });

  it("marks a canvas whose toDataURL throws as held but not serialized", () => {
    const p = labelPane();
    const ce = labelCanvas(10, 10, 200, 200);
    ce.toDataURL = () => {
      throw new Error("boom");
    };
    p.appendChild(ce);
    const rc = positionedRC(1000, 1000, makeMockCtx());

    const snap = snapshotPaneCanvases(makeRenderer().container, rc, p);

    // The canvas is inside the crop with real size, so the caller must report
    // a loss (held 1, snaps empty) rather than "no labels".
    expect(snap.held).toBe(1);
    expect(snap.snaps).toHaveLength(0);
  });

  it("skips a canvas self-marked data-foliplus-export=exclude", () => {
    const p = labelPane();
    const ce = labelCanvas(10, 10, 200, 200);
    ce.setAttribute("data-foliplus-export", "exclude");
    p.appendChild(ce);
    const rc = positionedRC(1000, 1000, makeMockCtx());

    const snap = snapshotPaneCanvases(makeRenderer().container, rc, p);

    expect(snap.held).toBe(0);
    expect(snap.snaps).toHaveLength(0);
  });

  it("returns an empty result for a pane with no canvas", () => {
    const p = labelPane();
    const rc = positionedRC(1000, 1000, makeMockCtx());

    const snap = snapshotPaneCanvases(makeRenderer().container, rc, p);

    expect(snap.held).toBe(0);
    expect(snap.snaps).toHaveLength(0);
  });

  it("counts a pane where one of two canvases failed to serialize as a partial loss", () => {
    // Two canvases inside the crop; one toDataURL throws. The pane held two
    // labels this export should carry, but only one serialized — a partial
    // loss, which held > snaps.length lets the caller report.
    const p = labelPane();
    p.appendChild(labelCanvas(10, 10, 200, 200));
    const broken = labelCanvas(300, 10, 200, 200);
    broken.toDataURL = () => {
      throw new Error("boom");
    };
    p.appendChild(broken);
    const rc = positionedRC(1000, 1000, makeMockCtx());

    const snap = snapshotPaneCanvases(makeRenderer().container, rc, p);

    expect(snap.held).toBe(2);
    expect(snap.snaps).toHaveLength(1);
  });
});

describe("renderCanvasSnapshot", () => {
  const snap = (
    overrides: Partial<Parameters<typeof renderCanvasSnapshot>[1]> = {},
  ) => ({
    dataUrl: "data:image/png;base64,LABEL",
    dx: 10,
    dy: 10,
    dw: 200,
    dh: 40,
    opacity: 1,
    ...overrides,
  });

  it("draws the frozen pixels at the snapshot geometry", async () => {
    const ctx = makeMockCtx();
    vi.spyOn(UTIL, "loadImage").mockResolvedValue({} as any);
    await renderCanvasSnapshot(positionedRC(1000, 1000, ctx), snap());

    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it("applies opacity via ctx.globalAlpha when less than 1", async () => {
    const ctx = makeMockCtx();
    ctx.globalAlpha = 1;
    let alphaDuringDraw = 0;
    ctx.drawImage = vi.fn(() => {
      alphaDuringDraw = ctx.globalAlpha;
    });
    vi.spyOn(UTIL, "loadImage").mockResolvedValue({} as any);
    await renderCanvasSnapshot(positionedRC(1000, 1000, ctx), snap({ opacity: 0.5 }));

    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(alphaDuringDraw).toBe(0.5);
    expect(ctx.globalAlpha).toBe(1);
  });

  it("draws nothing when the data URL cannot load", async () => {
    const ctx = makeMockCtx();
    vi.spyOn(UTIL, "loadImage").mockRejectedValue(new Error("boom"));
    await renderCanvasSnapshot(positionedRC(1000, 1000, ctx), snap());

    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("draws at the snapshot geometry even if the crop grew after capture", async () => {
    // Design test-plan item 4: the geometry is frozen at snapshot time, so a
    // grow/setView on the enlarged path after the snapshot cannot move the
    // label out from under the pixels. The snapshot's dx/dy/dw/dh are what is
    // drawn, regardless of the live container rect at pass time.
    const ctx = makeMockCtx();
    vi.spyOn(UTIL, "loadImage").mockResolvedValue({} as any);
    const rc = positionedRC(1000, 1000, ctx);
    // Grow the crop after the snapshot was taken (simulate the enlarged path).
    rc.rect = { left: -100, top: -100, width: 1200, height: 1200 } as DOMRect;
    await renderCanvasSnapshot(rc, snap());

    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 10, 10, 200, 40);
  });
});

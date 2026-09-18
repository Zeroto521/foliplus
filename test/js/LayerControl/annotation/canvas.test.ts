// AnnotationCanvas unit tests — one canvas per layer, mounted in that layer's
// own pane; it paints the slice the manager hands it and nothing else.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnnotationCanvas } from "#foliplus/LayerControl/annotation/canvas.js";
import type { PlacedLabel } from "#foliplus/LayerControl/annotation/layout.js";

const makeCtx = () => ({
  font: "",
  textAlign: "",
  textBaseline: "",
  lineJoin: "",
  strokeStyle: "",
  lineWidth: 0,
  fillStyle: "",
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  strokeText: vi.fn(),
  fillText: vi.fn(),
});

/** A planned label at a given box (the plan has already positioned it). */
const placed = (text: string, box = { x: 10, y: 20, w: 40, h: 12 }): PlacedLabel => ({
  id: text,
  text,
  atPoint: true,
  priority: 50,
  anchor: { x: 0, y: 0 },
  box,
});

let ctx: ReturnType<typeof makeCtx>;

beforeEach(() => {
  ctx = makeCtx();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  (window.L as unknown as { DomUtil: unknown }).DomUtil = {
    getPosition: vi.fn(() => ({ x: 10, y: 20 })),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const makeEnv = () => {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
  const mapPane = document.createElement("div");
  const map = {
    getContainer: () => container,
    getPanes: () => ({ mapPane }),
  } as unknown as L.Map;

  const pane = document.createElement("div");
  const canvas = new AnnotationCanvas(map, pane);
  return { container, mapPane, pane, canvas };
};

const elOf = (canvas: AnnotationCanvas) =>
  (canvas as unknown as { canvas: HTMLCanvasElement }).canvas;

describe("AnnotationCanvas", () => {
  it("mounts a non-interactive canvas in the pane it is given, DPR-scaled", () => {
    const { pane, canvas } = makeEnv();

    const el = pane.querySelector("canvas")!;
    expect(el).toBe(elOf(canvas));
    expect(el.className).toBe("foliplus-annotation-canvas");
    // Labels must never intercept a click meant for the feature.
    expect(el.style.pointerEvents).toBe("none");
    // jsdom devicePixelRatio is 1; the container box is what was measured.
    expect(el.width).toBe(800);
    expect(el.height).toBe(600);
  });

  it("cancels mapPane's pan translation so the canvas stays put", () => {
    const el = elOf(makeEnv().canvas);

    // getPosition is stubbed to {10, 20} — the canvas offsets by the negative so
    // the labels do not ride the pan twice.
    expect(el.style.left).toBe("-10px");
    expect(el.style.top).toBe("-20px");
  });

  it("tolerates a map without a mapPane", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(container, "clientHeight", {
      value: 600,
      configurable: true,
    });
    const map = {
      getContainer: () => container,
      getPanes: () => ({}),
    } as unknown as L.Map;
    const pane = document.createElement("div");

    const canvas = new AnnotationCanvas(map, pane);
    // paint calls updatePosition, which bails on the missing mapPane.
    expect(() => canvas.paint([])).not.toThrow();
    expect(elOf(canvas).style.left).toBe("");
  });

  it("hides and re-shows via visibility, leaving the drawn pixels intact", () => {
    const { canvas } = makeEnv();
    const el = elOf(canvas);
    canvas.paint([placed("alpha")]);

    canvas.setVisible(false);
    expect(el.style.visibility).toBe("hidden");
    // A hide is purely visual — the frame is not re-painted.
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);

    canvas.setVisible(true);
    expect(el.style.visibility).toBe("");
  });

  it("paints the labels it is handed, and clears the previous frame", () => {
    const { canvas } = makeEnv();

    canvas.paint([placed("alpha")]);
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith(
      "alpha",
      expect.any(Number),
      expect.any(Number),
    );

    ctx.fillText.mockClear();
    canvas.paint([placed("beta")]);
    expect(ctx.fillText).toHaveBeenCalledWith(
      "beta",
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("draws the text at the box's centre", () => {
    const { canvas } = makeEnv();

    canvas.paint([placed("alpha", { x: 100, y: 200, w: 40, h: 12 })]);

    expect(ctx.fillText).toHaveBeenCalledWith("alpha", 120, 206);
  });

  it("clears and draws nothing for an empty plan", () => {
    const { canvas } = makeEnv();

    canvas.paint([]);

    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it("re-measures the container on every paint", () => {
    const { container, canvas } = makeEnv();
    const el = elOf(canvas);

    Object.defineProperty(container, "clientWidth", {
      value: 1200,
      configurable: true,
    });
    canvas.paint([placed("alpha")]);

    expect(el.width).toBe(1200);
  });

  it("destroy removes the canvas from the pane", () => {
    const { pane, canvas } = makeEnv();

    canvas.destroy();

    expect(pane.querySelector("canvas")).toBeNull();
  });
});

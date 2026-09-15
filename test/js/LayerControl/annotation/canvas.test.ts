// AnnotationCanvas unit tests — the overlay's own logic: element setup, pane
// mounting, cancelling mapPane's pan translation, layer-visibility filtering,
// label hand-off and teardown. Draw calls land on a recording context; what the
// pixels actually look like is the browser tests' job.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AnnotationCanvas,
  type LayerLabel,
} from "#foliplus/LayerControl/annotation/canvas.js";

const mocks = vi.hoisted(() => ({ exportHandlers: [] as Array<() => void> }));

vi.mock("#core/event/index.js", () => ({
  EVENTS: { BEFORE_EXPORT: "before-export", AFTER_EXPORT: "after-export" },
  ensureEvents: () => ({
    on: (_event: string, cb: () => void) => {
      mocks.exportHandlers.push(cb);
      return vi.fn();
    },
    emit: vi.fn(),
  }),
}));

vi.mock("#common/throttle.js", () => ({
  // Synchronous: these tests are about what a scheduled draw *does*, not about
  // frame coalescing (common/throttle has its own tests for that).
  throttleRaf: (fn: () => void) => {
    const wrapped = () => fn();
    wrapped.cancel = vi.fn();
    return wrapped;
  },
}));

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

const label = (id: string, text: string): LayerLabel => ({
  id,
  text,
  latlng: { lat: 0, lng: 0 } as L.LatLng,
  atPoint: true,
  priority: 50,
});

const makeEnv = (isLayerOnMap: (id: string) => boolean = () => true) => {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
  const mapPane = document.createElement("div");
  // The canvas asks for its own pane and falls back to createPane, so the mock
  // backs both the way Leaflet does: one registry, created on demand.
  const panes: Record<string, HTMLElement> = {};
  const on = vi.fn();
  const off = vi.fn();
  const map = {
    getContainer: () => container,
    getPanes: () => ({ mapPane }),
    getPane: (name: string) => panes[name] ?? null,
    createPane: (name: string) => (panes[name] = document.createElement("div")),
    on,
    off,
    latLngToContainerPoint: (ll: { lat: number; lng: number }) => ({
      x: 100 + ll.lat,
      y: 50 + ll.lng,
    }),
  } as unknown as L.Map;

  const canvas = new AnnotationCanvas(map, isLayerOnMap);
  return {
    container,
    mapPane,
    on,
    off,
    canvas,
    annotationPane: panes["foliplus-annotation-pane"]!,
  };
};

let ctx: ReturnType<typeof makeCtx>;

beforeEach(() => {
  ctx = makeCtx();
  mocks.exportHandlers.length = 0;
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

describe("AnnotationCanvas construction", () => {
  it("mounts one non-interactive canvas in the label pane, DPR-scaled", () => {
    const { annotationPane, canvas } = makeEnv();

    const el = annotationPane.querySelector("canvas")!;
    expect(el).toBe(canvas["canvas"]);
    expect(el.className).toBe("foliplus-annotation-canvas");
    // The pane is the one LayerManager z-orders above the data panes.
    expect(annotationPane.classList.contains("foliplus-annotation-pane")).toBe(true);
    // Labels must never intercept a click meant for the feature.
    expect(el.style.pointerEvents).toBe("none");
    // jsdom devicePixelRatio is 1; the container box is what was measured.
    expect(el.width).toBe(800);
    expect(el.height).toBe(600);
    expect(el.style.width).toBe("800px");
  });

  it("cancels mapPane's pan translation so the canvas stays put", () => {
    const { canvas } = makeEnv();

    // getPosition is stubbed to {10, 20} (see beforeEach) — the canvas offsets
    // itself by the negative so the labels do not ride the pan twice.
    const el = canvas["canvas"];
    expect(el.style.left).toBe("-10px");
    expect(el.style.top).toBe("-20px");
  });

  it("subscribes to the map events that require a redraw", () => {
    const { on } = makeEnv();

    const names = on.mock.calls.map(c => c[0]);
    expect(names).toContain("resize");
    expect(on.mock.calls.some(c => c[0].includes("layeradd"))).toBe(true);
  });
});

describe("AnnotationCanvas.draw", () => {
  it("draws a layer's labels in container-pixel coordinates", () => {
    const { canvas } = makeEnv();

    canvas.setLayerLabels("l1", [label("a", "alpha")]);

    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith(
      "alpha",
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("skips a layer whose visibility callback says it is hidden", () => {
    const { canvas } = makeEnv(id => id === "shown");

    canvas.setLayerLabels("shown", [label("a", "alpha")]);
    canvas.setLayerLabels("hidden", [label("b", "beta")]);
    ctx.fillText.mockClear();
    canvas.setLayerLabels("shown", [label("a", "alpha")]);

    const drawn = ctx.fillText.mock.calls.map(c => c[0]);
    expect(drawn).toContain("alpha");
    expect(drawn).not.toContain("beta");
  });

  it("draws nothing (but clears) when every layer is hidden", () => {
    const { canvas } = makeEnv(() => false);

    canvas.setLayerLabels("l1", [label("a", "alpha")]);

    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it("drops a layer's labels on removeLayerLabels", () => {
    const { canvas } = makeEnv();

    canvas.setLayerLabels("l1", [label("a", "alpha")]);
    expect(ctx.fillText).toHaveBeenCalled();

    ctx.fillText.mockClear();
    canvas.removeLayerLabels("l1");

    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it("removeLayerLabels is a no-op for an unknown layer", () => {
    const { canvas } = makeEnv();
    ctx.clearRect.mockClear();

    canvas.removeLayerLabels("never-registered");

    expect(ctx.clearRect).not.toHaveBeenCalled();
  });
});

describe("AnnotationCanvas.map reactions", () => {
  const handler = (on: ReturnType<typeof vi.fn>, name: string) =>
    on.mock.calls.find(c => c[0] === name)?.[1] as () => void;
  const elOf = (canvas: unknown) => (canvas as { canvas: HTMLCanvasElement }).canvas;

  it("redraws on resize", () => {
    const { on, canvas } = makeEnv();
    canvas.setLayerLabels("l1", [label("a", "alpha")]);
    ctx.clearRect.mockClear();

    handler(on, "resize")();

    expect(ctx.clearRect).toHaveBeenCalled();
  });

  it("hides through a zoom transition and redraws on the far side", () => {
    const { on, canvas } = makeEnv();
    canvas.setLayerLabels("l1", [label("a", "alpha")]);
    const el = elOf(canvas);

    handler(on, "zoomstart")();
    expect(el.style.visibility).toBe("hidden");

    ctx.fillText.mockClear();
    handler(on, "zoomend")();
    expect(el.style.visibility).toBe("");
    expect(ctx.fillText).toHaveBeenCalled();
  });

  it("redraws on the export events", () => {
    const { canvas } = makeEnv();
    canvas.setLayerLabels("l1", [label("a", "alpha")]);

    ctx.clearRect.mockClear();
    mocks.exportHandlers.forEach(cb => cb());

    expect(ctx.clearRect).toHaveBeenCalled();
  });
});

describe("AnnotationCanvas.destroy", () => {
  it("unbinds the map listeners and removes the canvas", () => {
    const { annotationPane, off, canvas } = makeEnv();

    canvas.destroy();

    expect(annotationPane.querySelector("canvas")).toBeNull();
    const offNames = off.mock.calls.map(c => c[0]);
    expect(offNames).toContain("resize");
    expect(offNames.some(n => n.includes("layeradd"))).toBe(true);
  });
});

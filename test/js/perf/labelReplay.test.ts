// Wall-clock gate for LayerControl/annotation/index.ts — the label replay
// (renderLabels) a content change runs. Attribution for `test/js/perf/` (the
// boundary is spelled out in collision.test.ts): real elapsed time, vitest
// process. The functional half (coalescing, gates, teardown, flush) lives in
// test/js/LayerControl/ui/style/label.test.ts, and the per-face coverage in
// test/js/LayerControl/ui/lifecycle.test.ts.
//
// The gate is RELATIVE, not absolute. The old bar was a flat 20ms per rebuild,
// and it measured the host, not the code: this rebuild takes ~4.5ms on an idle
// box, 22.6ms while other builds were running on it, and 26.55ms with a 16-core
// burner saturated — so the bar failed while the code was untouched. What the
// per-layer replay exists to keep is a *ratio*: one
// layer's content replay must stay far cheaper than the paint-then-refresh-all
// round it replaced (renderLabels' own comment: "one final paint of this
// layer's canvas, never a paint-[]-then-refresh-all pair"). That naive round is
// still reachable through the map's own event contract — the settled-zoom
// repaint (zoomend → showLabels → refresh) plans and paints EVERY label canvas
// — so both sides are timed in the same process, on the same map, back to back:
// both are synchronous and CPU-bound, host speed and scheduler contention scale
// them together, and only their ratio is asserted.
//
// Measured on a 16-core Windows box over three process runs per condition
// (one median per run, both densities, the 12-layer map below): 8.4–20.8× idle
// and 8.2–63.3× with 16 CPU burners saturating the box — the spread is
// per-process host noise, not per-density. Only the floor is load-bearing: the
// noise pushes the ratio up, never down, so REPAINT_DIVISOR = 4 keeps ≥2×
// headroom under the worst run measured in either condition. The regression
// this guards is the documented fall-back — a content change that also
// refreshes every layer — which measures 0.9–1.4×, ~3× past the gate.
//
// What the number deliberately does not buy is resolution. The median over nine
// rounds filters the one GC pause that lands inside a measurement, and it also
// hides a single slow replay round: a replay that occasionally doubles still
// passes. Resolution is ~2× on the aggregate (a replay that is twice as
// expensive lands at ~3.5×), and tightening the divisor to chase more (5–6)
// makes the gate red on the floor above, so 2× is the trade, not a knob. That
// is still a better trade than the old absolute bar: ~4× resolution on an idle
// host (4.5ms measured against a 20ms budget) and none at all on a loaded one.
//
// jsdom + stub canvas is a LOWER bound: real canvas painting costs more, so the
// absolute ms is not a browser promise. Nothing here asserts one.
import { describe, expect, it, vi } from "vitest";
import { AnnotationManager } from "#foliplus/LayerControl/annotation/index.js";

const mocks = vi.hoisted(() => {
  const instances: any[] = [];

  class MockCanvas {
    paint = vi.fn();
    setVisible = vi.fn();
    destroy = vi.fn();
    setLayerAlpha = vi.fn();
    constructor() {
      instances.push(this);
    }
  }
  return { MockCanvas, instances };
});
vi.mock("#foliplus/LayerControl/annotation/canvas.js", () => ({
  AnnotationCanvas: mocks.MockCanvas,
}));

/** How many labelled layers the map carries. The repaint side is one plan +
 *  paint per layer, so this sets the baseline's size — and with it the ratio a
 *  healthy replay shows (measured, see the header). Twelve dense layers is a
 *  heavy but real session; the point is a map whose full repaint is worth
 *  avoiding, not the largest one the code survives. */
const LAYER_COUNT = 12;

/** How much cheaper than one full repaint a single layer's replay has to be.
 *  Every measured run clears this by ≥2× (floor 8.2×); see the header for the
 *  measurements and why a tighter divisor is not free. */
const REPAINT_DIVISOR = 4;

/** Median of the per-round ratios of two operations timed back to back.
 *
 *  Timing both in the same round is what makes the ratio independent of load:
 *  one contention window applies to both, so it cancels. The median over the
 *  rounds then filters the GC pause that does land inside one measurement. */
const medianRepaintRatio = (repaint: () => void, replay: () => void): number => {
  const warmup = 2;
  const rounds = 9;
  for (let i = 0; i < warmup; i++) {
    repaint();
    replay();
  }
  const ratios: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    repaint();
    const t1 = performance.now();
    replay();
    ratios.push((t1 - t0) / (performance.now() - t1));
  }
  return ratios.sort((a, b) => a - b)[Math.floor(ratios.length / 2)];
};

/** A map with LAYER_COUNT labelled layers of `n` point features each.
 *
 *  Every anchor projects to the same container point: the worst case for the
 *  collision sweep, which keeps the measurement on the plan rather than on the
 *  projection call. `zoomend` is captured because that is the public path to a
 *  full repaint — a settled zoom asks every canvas to re-plan, which is exactly
 *  the naive round the per-layer replay replaced. */
const makeMap = (n: number) => {
  const firstCanvas = mocks.instances.length;
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", {
    value: 800,
    configurable: true,
  });
  Object.defineProperty(container, "clientHeight", {
    value: 600,
    configurable: true,
  });
  const panes: Record<string, HTMLElement> = {};
  const handlers: Record<string, Array<() => void>> = {};
  const mapPane = document.createElement("div");
  const map: any = {
    getContainer: () => container,
    getPane: (name: string) => (panes[name] ??= document.createElement("div")),
    createPane: (name: string) => (panes[name] ??= document.createElement("div")),
    getPanes: () => ({ mapPane }),
    latLngToContainerPoint: () => ({ x: 10, y: 10 }),
    hasLayer: () => true,
    on: (event: string, fn: () => void) => {
      for (const name of event.split(" ")) (handlers[name] ??= []).push(fn);
    },
    off: () => {},
  };

  const groups: Record<string, any> = {};
  for (let layer = 0; layer < LAYER_COUNT; layer++) {
    const id = `L${layer}`;
    const leaves = Array.from({ length: n }, (_, i) => ({
      options: {},
      feature: { properties: { name: `p${layer}_${i}` } },
      getLatLng: () => ({ lat: 1 + i * 1e-4, lng: 2 }),
    }));
    groups[id] = {
      options: {},
      eachLayer: (fn: (leaf: any) => void) => leaves.forEach(fn),
    };
  }

  const mgr = new AnnotationManager({
    map,
    layerFind: (id: string) => groups[id] ?? null,
  });
  for (const id of Object.keys(groups)) {
    mgr.setConfig(id, { ...mgr.defaultConfig(), show: true, field: "name" });
    // Builds that layer's canvas and its first plan.
    mgr.renderLabels(id);
  }

  const repaint = () => {
    for (const fn of handlers.zoomend ?? []) fn();
  };
  return { mgr, repaint, canvases: mocks.instances.slice(firstCanvas) };
};

describe("label replay cost", () => {
  it(
    "one layer's content replay stays far cheaper than a full label repaint",
    { timeout: 300_000 },
    ctx => {
      for (const n of [500, 2000]) {
        const { mgr, repaint, canvases } = makeMap(n);

        // A clock that cannot advance cannot support a timing assertion — the
        // one hard skip, and deliberately not a `process.env.CI` opt-out: a
        // loaded CI is exactly where the old absolute gate used to fail.
        const probe = performance.now();
        repaint();
        if (performance.now() === probe) {
          ctx.skip("performance.now() did not advance; this host cannot time");
        }

        // Structure before timing: the ratio only means something while each
        // side still does its documented work. Two ways to make this gate green
        // by doing less — both measured as passing before these guards existed:
        // an empty replay (show=false / missing field / gone layer plans
        // nothing, yet measures `176.7×`) and a half-sized baseline (a repaint
        // restricted to 6 of the 12 layers reads `5.85×`). The flat assertions
        // below are what makes those two silent, not slower.
        const clearPaints = () => canvases.forEach(c => c.paint.mockClear());
        const painted = () => canvases.filter(c => c.paint.mock.calls.length > 0);
        const paints = () =>
          canvases.reduce((sum, c) => sum + c.paint.mock.calls.length, 0);

        clearPaints();
        const replayed = mgr.renderLabels("L0");
        expect(replayed.length, "the replay must plan every label of its layer").toBe(
          n,
        );
        expect(
          canvases.length,
          "the replay must reuse its canvas, not rebuild one",
        ).toBe(LAYER_COUNT);
        expect(painted(), "the replay must paint exactly one canvas").toHaveLength(1);
        expect(paints(), "the replay must paint that canvas once").toBe(1);
        expect(
          painted()[0].paint.mock.calls[0][0].length,
          "the replay must hand a non-empty plan to its canvas",
        ).toBeGreaterThan(0);

        clearPaints();
        repaint();
        expect(
          painted(),
          "the baseline must repaint every layer's canvas",
        ).toHaveLength(LAYER_COUNT);
        expect(paints(), "the baseline is one paint per layer").toBe(LAYER_COUNT);

        const ratio = medianRepaintRatio(repaint, () => mgr.renderLabels("L0"));
        console.log(
          `[perf] label replay n=${n}: ${ratio.toFixed(1)}x cheaper than a full repaint`,
        );
        expect(
          ratio,
          `one layer's replay must stay ${REPAINT_DIVISOR}× cheaper than one settled-zoom repaint of all ${LAYER_COUNT} layers; got ${ratio.toFixed(1)}×`,
        ).toBeGreaterThanOrEqual(REPAINT_DIVISOR);
      }
    },
  );
});

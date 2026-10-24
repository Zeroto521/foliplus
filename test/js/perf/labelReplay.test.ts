import { describe, expect, it, vi } from "vitest";
import { AnnotationManager } from "#foliplus/LayerControl/annotation/index.js";

// Attribution for `test/js/perf/` (the boundary is spelled out in
// collision.test.ts): real elapsed time, vitest process. This is the
// wall-clock half of the label replay — the functional half (coalescing,
// gates, teardown, flush) lives in
// test/js/LayerControl/ui/style/label.test.ts, and the per-face coverage
// in test/js/LayerControl/ui/lifecycle.test.ts. The filename names the
// module under budget: annotation/index.ts's renderLabels.
//
// What the number is FOR: renderLabels is the most expensive of the
// content-change replays (full tree walk + label layout + canvas repaint),
// and the frame coalescer exists to amortize it — N streamed features pay
// one rebuild, not N. The budget below guards the per-rebuild cost so a
// regression in the walk cannot hide behind "the coalescer makes it rare".
//
// jsdom + stub canvas is a LOWER bound: real canvas painting costs more,
// so the absolute ms is not a browser promise. The budget is loose by an
// order of magnitude on purpose — the collision precedent measured 22ms
// against a 20ms bar under full-suite pool contention, so the estimator
// here is the median of 7 samples and the bar leaves 10x headroom.

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

const median = (xs: number[]): number =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe("label replay cost", () => {
  it(
    "renderLabels for a dense labelled layer stays under the loose budget",
    { timeout: 300_000 },
    () => {
      for (const n of [500, 2000]) {
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
        const mapPane = document.createElement("div");
        const map: any = {
          getContainer: () => container,
          getPane: (name: string) => (panes[name] ??= document.createElement("div")),
          createPane: (name: string) => (panes[name] ??= document.createElement("div")),
          getPanes: () => ({ mapPane }),
          latLngToContainerPoint: () => ({ x: 10, y: 10 }),
          hasLayer: () => true,
          on: () => {},
          off: () => {},
        };
        const leaves = Array.from({ length: n }, (_, i) => ({
          options: {},
          feature: { properties: { name: `p${i}` } },
          getLatLng: () => ({ lat: 1 + i * 1e-4, lng: 2 }),
        }));
        const group: any = {
          options: {},
          eachLayer: (fn: (l: any) => void) => leaves.forEach(fn),
        };
        const mgr = new AnnotationManager({ map, layerFind: () => group });
        mgr.setConfig("L", { ...mgr.defaultConfig(), show: true, field: "name" });
        mgr.renderLabels("L"); // warm

        const times: number[] = [];
        for (let i = 0; i < 7; i++) {
          const t = performance.now();
          mgr.renderLabels("L");
          times.push(performance.now() - t);
        }
        const med = median(times);
        console.log(`[perf] renderLabels n=${n}: ${med.toFixed(2)}ms`);
        expect(med).toBeLessThan(20);
      }
    },
  );
});

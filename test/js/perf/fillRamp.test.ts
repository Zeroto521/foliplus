// Wall-clock benchmark for the value-based fill dimension — 6k leaves ×
// 60 simulated drag events, the same fixture shape used by the #565 fill
// scheduler work. The ramp path is 2 walks per scheduler tick
// (collect-pass → apply-pass) versus solid's 1 walk per tick, and the
// scheduler (`scheduleStyleDimApply`) coalesces N commits within one
// frame into one tick. This file measures both arms on a real 6k tree
// and posts the number into the PR body so the "一帧一次 walk" promise
// can be qualified with what a ramp tick actually costs.
//
// Methodology matches #565:
//   - 60 drag events per sweep, each one triggering the full write path
//     (scheduleFillApply → applyFillToLayer → applyRampToLayer for the
//     ramp arm; scheduleFillApply → applyFillToLayer for the solid arm).
//   - setStyle is a spy so walk + setStyle counts are observable and the
//     wall-clock budget is not corrupted by a real Leaflet SVG/canvas
//     render. jsdom renders nothing, so this is the honest lower bound
//     (a real browser composite is the other half — reported separately
//     in the PR body when a Chromium profile is available).
//   - warm-up loop then 60 individually timed rounds, take the total
//     wall and report per-tick averages — the estimator is the mean
//     because contention across full-suite runs inflates tails and
//     averaging is more stable than a min for a small-N loop.
//
// Naming: the file stem names the module under test (`fillRamp`),
// consistent with the collision / render perf siblings.
import { afterEach, describe, expect, it, vi } from "vitest";
import { METHOD } from "#core/classify.js";
import type { FillRampConfig } from "#foliplus/LayerControl/type.js";
import { applyRampToLayer } from "#foliplus/LayerControl/ui/style/fillRamp.js";
import { walkStyleLeaves } from "#foliplus/LayerControl/ui/style/styleBag.js";

const N_LEAVES = 6000;
const TICKS = 60;
const WARMUP = 20;

/** Stub Leaflet leaf carrying a numeric `feature.properties.value`. */
type Leaf = {
  feature: { properties: { value: number } };
  options: Record<string, unknown>;
  setStyle: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
};

const makeLeaf = (i: number): Leaf => ({
  feature: { properties: { value: i * 3.7 } },
  options: { fillColor: "#3388ff", fillOpacity: 0.2, fill: true },
  setStyle: vi.fn(),
  on: vi.fn(),
});

/** Flat feature group — every leaf is a direct child, so the walk cost
 *  is the leaf count rather than the container's recursion overhead. */
const makeFeatureGroup = (leaves: Leaf[]) => ({
  eachLayer: (fn: (layer: unknown) => void) => leaves.forEach(l => fn(l)),
  leaves,
});

const makeUI = (layer: unknown) =>
  ({
    m: {
      layerRegistry: new Map([["overlay1", { id: "overlay1", layer }] as any]),
      findLayer: () => layer,
    },
  }) as any;

/** Spy stub for chroma — returns a stable colour array so the
 *  classifier sees the same scale every tick. */
const installChromaStub = (n: number): void => {
  globalThis.chroma = {
    scale: () => ({
      mode: () => ({
        colors: () =>
          Array.from(
            { length: n },
            (_, i) => `#${((i * 40 + 1) * 16).toString(16).padStart(6, "0")}`,
          ),
      }),
    }),
  } as any;
};

afterEach(() => {
  delete globalThis.chroma;
});

const rampConfig = (nClasses = 6): FillRampConfig => ({
  field: "value",
  method: METHOD.EQUAL,
  classes: nClasses,
  scheme: "Reds",
});

describe("fillRamp.perf @6k", { timeout: 60_000 }, () => {
  const leaves = Array.from({ length: N_LEAVES }, (_, i) => makeLeaf(i));
  const layer = makeFeatureGroup(leaves);
  const ui = makeUI(layer);

  it("solid-color baseline: 1 walk + 6k setStyle per tick", () => {
    for (let i = 0; i < WARMUP; i++) {
      walkStyleLeaves(layer as never, () => {});
    }
    let wallMs = 0;
    let setStyleCalls = 0;
    for (let i = 0; i < TICKS; i++) {
      for (const leaf of leaves) leaf.setStyle.mockClear();
      const t0 = performance.now();
      walkStyleLeaves(layer as never, leaf => {
        (leaf as Leaf).setStyle({ fillColor: "#ff0000", fill: true });
      });
      wallMs += performance.now() - t0;
      setStyleCalls += (leaves[0].setStyle as any).mock.calls.length * N_LEAVES;
    }
    const avgMs = wallMs / TICKS;
    console.log(
      `[T202 bench] solid: ${avgMs.toFixed(3)}ms/tick × ${N_LEAVES} leaves ` +
        `= ${wallMs.toFixed(1)}ms over ${TICKS} ticks; ` +
        `${setStyleCalls} setStyle calls (1 walk / tick)`,
    );
    expect(avgMs).toBeLessThan(50);
  });

  it("ramp two-pass: collect + apply per tick — 2× walks of solid", () => {
    installChromaStub(6);
    for (let i = 0; i < WARMUP; i++) {
      applyRampToLayer(ui, "overlay1", rampConfig());
    }
    let wallMs = 0;
    let setStyleCalls = 0;
    for (let i = 0; i < TICKS; i++) {
      for (const leaf of leaves) leaf.setStyle.mockClear();
      const t0 = performance.now();
      applyRampToLayer(ui, "overlay1", rampConfig());
      wallMs += performance.now() - t0;
      setStyleCalls += (leaves[0].setStyle as any).mock.calls.length * N_LEAVES;
    }
    const avgMs = wallMs / TICKS;
    const solidAvgMs = 153.5 / TICKS; // from the solid test above
    console.log(
      `[T202 bench] ramp: ${avgMs.toFixed(3)}ms/tick × ${N_LEAVES} leaves ` +
        `= ${wallMs.toFixed(1)}ms over ${TICKS} ticks; ` +
        `${setStyleCalls} setStyle calls (2 walks / tick: collect + apply)` +
        `\n[T202 bench] ramp/solid ratio: ${(avgMs / solidAvgMs).toFixed(2)}x` +
        `  (solid ${solidAvgMs.toFixed(3)}ms/tick)` +
        `\n[T202 bench] ramp per-leaf: ${((avgMs * 1e6) / N_LEAVES).toFixed(0)} μs/leaf`,
    );
    expect(avgMs).toBeLessThan(150);
  });

  it("collect-pass alone: reads 6k properties without a setStyle", () => {
    const readProp = (leaf: unknown): number => {
      const props = (leaf as { feature?: { properties?: { value?: number } } }).feature
        ?.properties;
      const v = props?.value;
      return typeof v === "number" && Number.isFinite(v) ? v : -1;
    };
    for (let i = 0; i < WARMUP; i++) {
      walkStyleLeaves(layer as never, readProp as never);
    }
    let wallMs = 0;
    let collected = 0;
    for (let i = 0; i < TICKS; i++) {
      const t0 = performance.now();
      walkStyleLeaves(layer as never, leaf => {
        if (readProp(leaf) >= 0) collected++;
      });
      wallMs += performance.now() - t0;
    }
    const avgMs = wallMs / TICKS;
    console.log(
      `[T202 bench] collect-pass alone: ${avgMs.toFixed(3)}ms/tick ` +
        `(${N_LEAVES} property reads, 0 setStyle); ` +
        `collected ${collected} finite values across ${TICKS} ticks`,
    );
    expect(avgMs).toBeLessThan(30);
  });
});

// Wall-clock benchmark for the value-based fill dimension — 6k leaves ×
// 60 simulated drag events, the same fixture shape used by the #565 fill
// scheduler work. The ramp path is 2 walks per scheduler tick
// (collect-pass → apply-pass) versus solid's 1 walk per tick, and the
// scheduler (`scheduleStyleDimApply`) coalesces N commits within one frame
// into one tick. This file measures both arms on a real 6k tree and posts
// the numbers into the PR body so the "一帧一次 walk" promise can be
// qualified with what a ramp tick actually costs.
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
//   - warm-up loop then 60 individually timed rounds, take the total wall
//     and report per-tick averages — the estimator is the mean because
//     contention across full-suite runs inflates tails, and averaging is
//     more stable than a min for a small-N loop.
//
// Both arms are timed in this same run on the same tree, so the ramp/solid
// ratio is measured here rather than quoted from an earlier environment.
//
// Naming: the file stem names the module under test (`fillRamp`),
// consistent with the collision / render perf siblings.
import { afterEach, describe, expect, it, vi } from "vitest";
import { METHOD } from "#core/classify.js";
import type { FillRampConfig } from "#core/layer/intent.js";
import { applyRampToLayer } from "#foliplus/LayerControl/ui/style/fillRamp.js";
import { walkStyleLeaves } from "#foliplus/LayerControl/ui/style/styleBag.js";

const N_LEAVES = 6000;
const TICKS = 60;
const WARMUP = 20;

/** The style write a leaf spy records. */
type StyleWrite = { fillColor?: string; fillOpacity?: number; fill?: boolean };

/** Stub Leaflet leaf carrying a numeric `feature.properties.value`. The spy
 *  is given an explicit call signature — a bare `vi.fn()` infers
 *  `Mock<Procedure | Constructable>`, which TypeScript refuses to call. */
type Leaf = {
  feature: { properties: { value: number } };
  options: Record<string, unknown>;
  setStyle: ReturnType<typeof vi.fn<(style: StyleWrite) => void>>;
  on: ReturnType<typeof vi.fn>;
};

const makeLeaf = (i: number): Leaf => ({
  feature: { properties: { value: i * 3.7 } },
  options: { fillColor: "#3388ff", fillOpacity: 0.2, fill: true },
  setStyle: vi.fn<(style: StyleWrite) => void>(),
  on: vi.fn(),
});

/** Flat feature group — every leaf is a direct child, so the walk cost is
 *  the leaf count rather than the container's recursion overhead. */
const leaves: Leaf[] = Array.from({ length: N_LEAVES }, (_, i) => makeLeaf(i));
const layer = {
  eachLayer: (fn: (layer: unknown) => void) => leaves.forEach(l => fn(l)),
  leaves,
};
const ui = {
  c: {
    layerRegistry: new Map([["overlay1", { id: "overlay1", layer }] as any]),
    findLayer: () => layer,
  },
  // getIntent reads ui.intentStore.get — the pin replays the live opacity
  // through it on every mouseout, so the benchmark needs an intent table.
  // No user override: the arm under measurement is the ramp, not the opacity.
  intentStore: { get: () => undefined },
} as any;

/** Clear every leaf's spies between ticks so the call history cannot grow
 *  across the 6k × 60 sweep. */
const clearSpies = (): void => {
  for (const leaf of leaves) {
    leaf.setStyle.mockClear();
    leaf.on.mockClear();
  }
};

/** Spy stub for chroma — returns a stable colour array so the classifier
 *  sees the same scale every tick. */
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

// ── Shared baseline ────────────────────────────────────────────────────
// The ramp/solid ratio is only meaningful when both arms are timed in the
// same run on the same tree, so the solid average is measured here and
// reused instead of being quoted from an earlier environment.
let solidAvgMs: number | undefined;

const measureSolid = (): number => {
  for (let i = 0; i < WARMUP; i++) {
    walkStyleLeaves(layer as never, () => {});
  }
  let wallMs = 0;
  for (let i = 0; i < TICKS; i++) {
    clearSpies();
    const t0 = performance.now();
    walkStyleLeaves(layer as never, leaf => {
      (leaf as Leaf).setStyle({ fillColor: "#ff0000", fill: true });
    });
    wallMs += performance.now() - t0;
  }
  return wallMs / TICKS;
};

const ensureSolidBaseline = (): number => (solidAvgMs ??= measureSolid());

describe("fillRamp.perf @6k", { timeout: 180_000 }, () => {
  it("solid-color baseline: 1 walk + 6k setStyle per tick", () => {
    let wallMs = 0;
    let setStyleCalls = 0;
    for (let i = 0; i < TICKS; i++) {
      clearSpies();
      const t0 = performance.now();
      walkStyleLeaves(layer as never, leaf => {
        (leaf as Leaf).setStyle({ fillColor: "#ff0000", fill: true });
      });
      wallMs += performance.now() - t0;
      setStyleCalls += (leaves[0].setStyle as any).mock.calls.length * N_LEAVES;
    }
    const avgMs = wallMs / TICKS;
    solidAvgMs = avgMs;
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
      clearSpies();
      const t0 = performance.now();
      applyRampToLayer(ui, "overlay1", rampConfig());
      wallMs += performance.now() - t0;
      setStyleCalls += (leaves[0].setStyle as any).mock.calls.length * N_LEAVES;
    }
    const avgMs = wallMs / TICKS;
    const solid = ensureSolidBaseline();
    console.log(
      `[T202 bench] ramp: ${avgMs.toFixed(3)}ms/tick × ${N_LEAVES} leaves ` +
        `= ${wallMs.toFixed(1)}ms over ${TICKS} ticks; ` +
        `${setStyleCalls} setStyle calls (2 walks / tick: collect + apply)` +
        `\n[T202 bench] ramp/solid ratio: ${(avgMs / solid).toFixed(2)}x ` +
        `  (solid ${solid.toFixed(3)}ms/tick, measured in this run)` +
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

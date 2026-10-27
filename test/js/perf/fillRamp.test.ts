// Wall-clock benchmark for the value-based fill dimension - 6k leaves x
// 60 ticks, the same fixture shape as the #565 fill scheduler work.
//
// Both arms enter through the production write path - applyFillToLayer,
// which resolves the arm and delegates to applyRampToLayer for the ramp -
// so the numbers are what the panel actually pays: areal probe, style bag,
// highlight pin. No hand-written walk that skips them.
// The two arms are timed in the same run, interleaved one tick at a time,
// so a warm/cold ordering cannot manufacture the ratio.
//
// The ramp arm is 2 walks per tick (collect then apply) against solid's 1,
// but both arms write one setStyle per leaf. A restore followed by a commit
// would have doubled the DOM and SVG attribute work on top of the walk, and
// the write count below is where that is ruled out.
//
// The wall-clock ceilings are deliberately generous: jsdom timings here
// move ~10x between an isolated run and a full-suite run with 197
// workers, so only the write count and the ramp/solid ratio are hard
// assertions. The absolute numbers are reported for the PR body, not
// for the gate.
//
// Methodology matches #565:
//   - warm-up loop, then 60 individually timed ticks; the estimator is the
//     mean wall clock per tick, because contention across full-suite runs
//     inflates tails and a mean is more stable than a min for a small-N loop.
//   - setStyle is a spy, so walk and setStyle counts are observable and the
//     wall clock is not corrupted by a real Leaflet SVG/canvas render. jsdom
//     renders nothing, so this is the honest lower bound (a real browser
//     composite is the other half - reported separately in the PR body when
//     a Chromium profile is available).
//   - clearSpies between ticks keeps the call history from growing across the
//     6k x 60 sweep.
//
// Naming: the file stem names the module under test (fillRamp),
// consistent with the collision / render perf siblings.
import { afterEach, describe, expect, it, vi } from "vitest";
import { METHOD } from "#core/classify.js";
import type { FillRampConfig } from "#core/layer/intent.js";
import { applyFillToLayer } from "#foliplus/LayerControl/ui/style/fill.js";
import { walkFillLeaves } from "#foliplus/LayerControl/ui/style/styleBag.js";

const N_LEAVES = 6000;
const TICKS = 60;
const WARMUP = 10;

/** One coordinate ring. walkFillLeaves gates on the same areal probe
 *  layerCanFill uses, and a leaf with neither a ring nor a radius would fall
 *  out of the walk rather than being measured. */
const RING: unknown[] = [
  [
    { lat: 0, lng: 0 },
    { lat: 1, lng: 0 },
    { lat: 0, lng: 1 },
  ],
];

/** The style write a leaf spy records. */
type StyleWrite = { fillColor?: string; fillOpacity?: number; fill?: boolean };

/** Stub Leaflet leaf carrying a numeric feature.properties.value. The spy
 *  is given an explicit call signature - a bare vi.fn() infers
 *  Mock<Procedure | Constructable>, which TypeScript refuses to call. */
type Leaf = {
  feature: { properties: { value: number }; geometry: { type: string } };
  options: Record<string, unknown>;
  getLatLngs: () => unknown[];
  setStyle: ReturnType<typeof vi.fn<(style: StyleWrite) => void>>;
  on: ReturnType<typeof vi.fn>;
};

const makeLeaf = (i: number): Leaf => ({
  feature: { properties: { value: i * 3.7 }, geometry: { type: "Polygon" } },
  options: { fillColor: "#3388ff", fillOpacity: 0.2, fill: true },
  getLatLngs: () => RING,
  setStyle: vi.fn<(style: StyleWrite) => void>(),
  on: vi.fn(),
});

/** Flat feature group - every leaf is a direct child, so the walk cost is
 *  the leaf count rather than the container's recursion overhead. */
const leaves: Leaf[] = Array.from({ length: N_LEAVES }, (_, i) => makeLeaf(i));
const layer = {
  eachLayer: (fn: (layer: unknown) => void) => leaves.forEach(l => fn(l)),
  leaves,
};

/** The live intent table both arms read through getIntent. Only the keys a
 *  test sets are answered, so the arm under measurement is the one it names
 *  and nothing else leaks into the write. */
let intents: Record<string, unknown> = {};
const ui = {
  c: {
    layerRegistry: new Map([["overlay1", { id: "overlay1", layer }] as any]),
    findLayer: () => layer,
  },
  intentStore: { get: (_id: string, key: string) => intents[key] },
  // The paint path resolves a stored ramp field against the layer's numeric
  // fields (the shared display/paint rule). The real LayerUI caches that list
  // on the runtime store; this fixture feeds the same one-entry answer so the
  // benchmark still measures the apply walk, not a field scan.
  runtimeStore: {
    getFields: () => [{ name: "value", numeric: true }],
    setFields: () => {},
    deleteFields: () => {},
    deleteSnapshot: () => {},
  },
  annotation: { collectFields: () => [], invalidateAutoField: () => {} },
} as any;

/** Clear every leaf's spies between ticks so the call history cannot grow
 *  across the 6k x 60 sweep. */
const clearSpies = (): void => {
  for (const leaf of leaves) {
    leaf.setStyle.mockClear();
    leaf.on.mockClear();
  }
};

/** Spy stub for chroma - returns a stable colour array so the classifier
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
  intents = {};
  delete globalThis.chroma;
});

const rampConfig = (nClasses = 6): FillRampConfig => ({
  field: "value",
  method: METHOD.EQUAL,
  classes: nClasses,
  scheme: "Reds",
});

/** Time one apply tick for the currently armed intent. Returns the wall
 *  clock for the tick and how many setStyle calls one leaf saw in it. */
const tick = (): { ms: number; perLeaf: number } => {
  clearSpies();
  const t0 = performance.now();
  applyFillToLayer(ui, "overlay1");
  return {
    ms: performance.now() - t0,
    perLeaf: leaves[0].setStyle.mock.calls.length,
  };
};

describe("fillRamp.perf @6k", { timeout: 300_000 }, () => {
  it("one setStyle per leaf per tick on both arms - the write is not the difference", () => {
    installChromaStub(6);
    const solidIntent = { fillColor: "#ff0000" };
    const rampIntent = { fillRamp: rampConfig() };
    for (let i = 0; i < WARMUP; i++) {
      intents = solidIntent;
      applyFillToLayer(ui, "overlay1");
      intents = rampIntent;
      applyFillToLayer(ui, "overlay1");
    }
    let solidMs = 0;
    let rampMs = 0;
    let solidPerLeaf = 0;
    let rampPerLeaf = 0;
    for (let i = 0; i < TICKS; i++) {
      intents = solidIntent;
      solidMs += tick().ms;
      solidPerLeaf = leaves[0].setStyle.mock.calls.length;
      intents = rampIntent;
      rampMs += tick().ms;
      rampPerLeaf = leaves[0].setStyle.mock.calls.length;
    }
    const solidAvg = solidMs / TICKS;
    const rampAvg = rampMs / TICKS;
    console.log(
      `[fill-ramp bench] solid arm ${solidAvg.toFixed(3)}ms/tick, ramp arm` +
        ` ${rampAvg.toFixed(3)}ms/tick x ${N_LEAVES} leaves` +
        ` - ramp/solid ${(rampAvg / solidAvg).toFixed(2)}x` +
        `\n[fill-ramp bench] writes per leaf per tick: solid ${solidPerLeaf}, ramp` +
        ` ${rampPerLeaf}` +
        `\n[fill-ramp bench] ramp per-leaf ${((rampAvg * 1e3) / N_LEAVES).toFixed(3)}` +
        ` us/leaf (2 walks / tick: collect + apply)`,
    );
    // The invariant: one write per leaf per tick on both arms. A restore
    // followed by a commit would read 2 here, and so would any second pass
    // over the same face.
    expect(solidPerLeaf).toBe(1);
    expect(rampPerLeaf).toBe(1);
    // The whole ramp premium is the extra collect walk, not an extra write.
    // The ceilings are contention-tolerant: observed 305ms solid and
    // 1.15x ramp/solid with the full 197-worker suite running alongside,
    // 22ms and 1.15x in isolation.
    expect(rampAvg / solidAvg).toBeLessThan(2);
    expect(solidAvg).toBeLessThan(600);
  });

  it("collect-pass alone: reads 6k properties without a setStyle", () => {
    const readProp = (leaf: unknown): number => {
      const props = (leaf as { feature?: { properties?: { value?: number } } }).feature
        ?.properties;
      const v = props?.value;
      return typeof v === "number" && Number.isFinite(v) ? v : -1;
    };
    for (let i = 0; i < WARMUP; i++) {
      walkFillLeaves(layer as never, readProp as never);
    }
    let wallMs = 0;
    let collected = 0;
    for (let i = 0; i < TICKS; i++) {
      const t0 = performance.now();
      walkFillLeaves(layer as never, leaf => {
        if (readProp(leaf) >= 0) collected++;
      });
      wallMs += performance.now() - t0;
    }
    const avgMs = wallMs / TICKS;
    console.log(
      `[fill-ramp bench] collect-pass alone: ${avgMs.toFixed(3)}ms/tick` +
        ` (${N_LEAVES} property reads, 0 setStyle);` +
        ` collected ${collected} finite values across ${TICKS} ticks`,
    );
    // Contention-tolerant ceiling, same reasoning: 3.3ms in isolation,
    // 48ms with the full suite running alongside.
    expect(avgMs).toBeLessThan(150);
  });
});

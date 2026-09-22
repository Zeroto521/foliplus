import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Collision from "#foliplus/MeasureControl/collision.js";

// Attribution for `test/js/perf/`: a test belongs here iff BOTH
//   (a) it reads real elapsed time (not a fake clock), AND
//   (b) it runs inside the vitest process.
// Operational check: "would removing load change the number?" If yes,
// it's a wall-clock gate and belongs in perf/. The directory exists as
// a boundary so vitest's pool / serialisation strategy can be scoped.
//
// Real-browser timing does NOT belong here — it lives in
// test/js/browser/<Component>/ and is driven by the Python harness via
// the `_js("LayerControl/...")` convention. Don't move those.
//
// Another real wall-clock gate, named here so a future clean-up doesn't
// move or delete it by mistake: test/python/test_LayerControl.py::
// test_toggle_performance (lines 2967-2985) — browser fixture +
// test/js/browser/LayerControl/performance_toggle.js, 5 toggle-layer +
// 3 toggle-all = 8 samples, asserted on the Python side as
// `for r in results: assert r["ms"] < 100`. Hard 100ms budget. No
// flake evidence today (the five past failures were all `Page.goto`
// timeouts, unrelated to this gate). If it ever flakes under load, fix
// it the same way this file does: multiple samples + fastest / median
// estimator + relative gate + raised timeout — not by moving the
// directory.
//
// The wall-clock half of MeasureControl/collision.ts's tests. Its
// functional half stays in test/js/MeasureControl/collision.test.ts.
//
// The directory names the kind of test, the filename names the module —
// the same rule the browser/ and script/ groups follow. That keeps the
// naming guard usable if it is ever extended beyond test/js/script/:
// this file's stem is `collision`, which is the module it tests, so no
// exception entry is owed. `vitest.config.mjs` includes
// `test/js/**/*.test.ts`, so the group is picked up without a config
// change.
//
// This file itself flaked once, under full-suite load. `vitest run
// --pool=threads` spreads 127 files over ~21 workers on a 22-core box,
// so a budget taken against `performance.now()` was competing for the
// CPU it was budgeting. Before this change the n=200 bar measured
// 22.05 ms against a 20 ms budget on the first full-suite run and
// passed when run alone.
//
// Three changes:
//   1. Own file, so the 23 functional tests above no longer share a
//      worker and a warm-up budget with the benchmarks.
//   2. The estimator. `meanMs` averaged 5 plans, which folds contention
//      from the other test files straight into the number being budgeted.
//      Each plan is now timed separately and the fastest is kept — the
//      least-contended sample is the closest thing a loaded machine has
//      to the code's own speed. Measured 2.5-7.1 ms for n=200 across
//      four full-suite runs (three uninstrumented, one `--coverage` as
//      CI runs it). The budgets were deliberately NOT tightened to fit
//      that: a tighter bar would make the gate drift with CI runner
//      speed instead of with the code. Resolution of the absolute bars
//      is ~4x — they catch a constant-factor regression of that size or
//      larger, and every asymptotic regression. The ground in between
//      is the ratio gate below, which is what keeps the suite honest
//      when the absolute bars are too coarse to notice.
//   3. A scaling gate. Small and large are timed back to back in the
//      same round, so one contention window applies to both and cancels
//      in the ratio. That half cannot go blind under load.
//
// As before, the bars are calibrated against an uninstrumented run:
// `--coverage` roughly triples placeLabels, and the budgets carry
// headroom for it.

type Box = { x: number; y: number; w: number; h: number };

const WARMUP = 5;
const SAMPLES = 20;

const PERF_CONTAINER_LEFT = 100;
const PERF_CONTAINER_TOP = 60;
const PERF_COLS = 25;
const PERF_STEP_X = 400;
const PERF_STEP_Y = 60;
const PERF_CHIP_W = 100;
const PERF_CHIP_H = 18;

const chipOf: Collision.ChipOf = marker =>
  (marker as unknown as { _el?: HTMLElement })._el ?? null;

/** Mock a chip's rect. jsdom reports all zeros, so the geometry must come
 *  from here for the planner's boxes to be realistic. */
const perfRectOf = (
  el: HTMLElement,
  left: number,
  top: number,
  w: number,
  h: number,
): void => {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    left,
    top,
    width: w,
    height: h,
    right: left + w,
    bottom: top + h,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);
};

/** The map container. Its offset feeds the chip coords so container-relative
 *  math in mapProjector is exercised for real. */
const makePerfContainer = (): HTMLElement => {
  const el = document.createElement("div");
  perfRectOf(el, PERF_CONTAINER_LEFT, PERF_CONTAINER_TOP, 1600, 900);
  document.body.appendChild(el);
  return el;
};

/** Real DOM chip at `box` (container-relative). */
const labelAt = (box: Box, perfContainer: HTMLElement): Collision.CollidableLabel => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  perfRectOf(el, box.x + PERF_CONTAINER_LEFT, box.y + PERF_CONTAINER_TOP, box.w, box.h);
  return {
    marker: { _el: el, getElement: () => el } as unknown as L.Marker,
    priority: 60,
  };
};

/** Worst case for the sweep: every chip in one x band and one y band, so
 *  nothing hides early and `shown` grows to n. Each chip compares against all. */
const ribbon = (n: number): Box[] =>
  Array.from({ length: n }, (_, i) => ({
    x: i * 60, // 60px step on a 100px chip → overlapping
    y: Math.floor(i / 40) * 2, // same y band, tiny jitter
    w: PERF_CHIP_W,
    h: PERF_CHIP_H,
  }));

/** Best case: chips well clear of each other. `shown` still grows to n, but
 *  every comparison short-circuits on the vertical-overlap test. */
const grid = (n: number): Box[] =>
  Array.from({ length: n }, (_, i) => ({
    x: (i % PERF_COLS) * PERF_STEP_X,
    y: Math.floor(i / PERF_COLS) * PERF_STEP_Y,
    w: PERF_CHIP_W,
    h: PERF_CHIP_H,
  }));

const planFor = (boxes: Box[], perfContainer: HTMLElement): (() => void) => {
  const projector = Collision.mapProjector({
    getContainer: () => perfContainer,
  } as unknown as L.Map);
  const labels = boxes.map(b => labelAt(b, perfContainer));
  return () => Collision.placeLabels(labels, projector, true, chipOf);
};

/** WARMUP untimed rounds, then SAMPLES individually timed rounds. */
const fastestMs = (plan: () => void): number => {
  for (let i = 0; i < WARMUP; i++) plan();
  let best = Infinity;
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = performance.now();
    plan();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
};

/** Median of the per-round ratios of two plans timed back to back.
 *
 * Timing both in the same round is what makes the ratio independent of load:
 * one contention window applies to both, so it cancels. The median over the
 * rounds then filters the GC pause that does land inside one measurement. */
const medianRatio = (small: () => void, large: () => void): number => {
  for (let i = 0; i < WARMUP; i++) {
    small();
    large();
  }
  const ratios: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const a0 = performance.now();
    small();
    const b0 = performance.now();
    large();
    ratios.push((performance.now() - b0) / (b0 - a0));
  }
  return ratios.sort((x, y) => x - y)[Math.floor(ratios.length / 2)];
};

// The timeouts are raised from vitest's 5 s default: a plan is measured 25
// times (5 warm-up + 20 timed), so a genuine regression — which is what these
// tests exist to catch — must be allowed room to fail on the assertion rather
// than on a timeout.
describe("collision.perf", { timeout: 30_000 }, () => {
  let perfContainer: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    perfContainer = makePerfContainer();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  // 500 labels in one band is not a real foliplus map — a distance of 100
  // segments is already an extreme session. These bars assert the order of
  // magnitude at that scale, not a frame budget.
  it("plans 500 heavily-overlapping labels in under 100ms", () => {
    expect(fastestMs(planFor(ribbon(500), perfContainer))).toBeLessThan(100);
  });

  it("plans 500 well-separated labels in under 50ms", () => {
    expect(fastestMs(planFor(grid(500), perfContainer))).toBeLessThan(50);
  });

  // n=200 is the bound documented in collision.ts. Without this test the
  // bound would be asserted in a comment only.
  it("plans 200 labels — the documented bound — in under 20ms", () => {
    expect(fastestMs(planFor(ribbon(200), perfContainer))).toBeLessThan(20);
  });

  // 500/200 labels is 2.5x the work; 6.25x would mean the sweep picked up a
  // quadratic term. This is the half of the gate that is independent of how
  // loaded the machine is, so a real regression cannot be drowned out by it.
  it("scales with the label count, not with its square", () => {
    expect(
      medianRatio(
        planFor(ribbon(200), perfContainer),
        planFor(ribbon(500), perfContainer),
      ),
    ).toBeLessThan(4);
  });
});

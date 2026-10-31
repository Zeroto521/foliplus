// Wall-clock gate for LayerControl/ui/listPanel/list.ts — syncRowOrder × 200
// layers. Named for the logic script it exercises, same as render.test.ts.
//
// The gate is RELATIVE, not absolute. A fixed millisecond ceiling measures the
// host, not the code: this reorder round was measured at ~65ms idle and 965ms
// while a full `test/js` suite saturated the same 22-core machine — no absolute
// number separates that flake from a real regression. What the incremental
// reconcile exists to keep is a *ratio*: a reorder round must stay an order of
// magnitude cheaper than the full list rebuild (`rebuildList`, reached through
// `ui.reindexAfterMove()`) that the old per-move path performed. That rebuild
// is timed in the same process, on the same 200-row panel, right after the
// round — both operations are synchronous and CPU-bound, so host speed and
// scheduler contention scale them together and only their ratio is asserted.
//
// Measured ratios (round ÷ the fastest of three rebuilds): 1/62 on the 22-core
// Windows box this gate was diagnosed on, measured while other builds were
// running on it (186ms round vs an 11.5s rebuild); 1/25 with 40 cores
// saturated (2.3s round vs a 56.0s rebuild) — the worst case seen, where the
// old fixed 500ms ceiling failed long before this gate would. The reviewer's
// box read 1/50–1/115 idle (56–267ms rounds). The milliseconds are provenance:
// the machine and its load set them, so only the ratio is asserted.
//
// The baseline is the FASTEST of three consecutive rebuilds, not one sample.
// The rebuild's own cost swings hard under load — 6.2s / 8.4s / 24.2s / 15.2s
// within one fixture run, and 2.8s / 9.5s / 19.8s across three idle runs — so
// one sample can inflate the denominator up to ~7× and make this gate that much
// easier to pass, with the same assertion then varying in strictness by the
// same factor. The minimum pins the denominator to the code's own speed (the
// least-contended sample is the closest thing a loaded machine has to it — the
// estimator `test/js/perf/collision.test.ts` already uses for its absolute
// bars); the residual variance is the gap between the fastest and the
// next-fastest rebuild, which the headroom absorbs. REBUILD_DIVISOR = 8 leaves
// ~3× headroom on the worst measured ratio (1/25 under 40 saturated cores), and
// a regression that rebuilds the list per move — ~2.4 rebuilds for the up+down
// round — measures 0.4×, i.e. ~20× past the gate. The other two tests pin the
// operation counts, so the ratio is never the only evidence.
import { describe, expect, it, vi } from "vitest";
import { attachedPanel, initFixture } from "../LayerControl/ui/fixture.js";

const benchData = (overlays: number, bases: number) => [
  ...Array.from({ length: overlays }, (_, i) => ({
    id: `overlay_${i}`,
    name: `Overlay ${i}`,
    role: "overlay" as const,
  })),
  ...Array.from({ length: bases }, (_, i) => ({
    id: `base_${i}`,
    name: `Base ${i}`,
    role: "base" as const,
  })),
];

/** How much cheaper than one full rebuild a reorder round has to be. Chosen
 *  from the measured spread (1/25 under 40 saturated cores) with ~3× headroom;
 *  a regression to the per-move rebuild path measures 0.4×. */
const REBUILD_DIVISOR = 8;

/** Rebuild samples per run. The baseline takes the fastest of three because its
 *  own cost swings up to ~7× between samples under load; see the header. */
const REBUILD_SAMPLES = 3;

describe("perf/list syncRowOrder", () => {
  it("keeps a 200-layer reorder round far cheaper than a full rebuild", ctx => {
    window.localStorage.clear();
    const { manager, ui } = initFixture({ data: benchData(198, 2) });
    const target = "overlay_99";

    // The round must actually relocate a row: a no-op move would measure ~0ms
    // and clear any bar. The op-count tests below pin the write counts; this
    // pins that the timed round is the operation the ratio is about.
    const orderOf = (id: string) => manager.layers.findIndex(l => l.id === id);
    const home = orderOf(target);
    manager.moveLayerUp(target);
    expect(orderOf(target), "moveLayerUp must relocate the row").toBe(home - 1);
    manager.moveLayerDown(target);
    expect(orderOf(target), "moveLayerDown must restore it").toBe(home);

    // Warm both paths once: first-call JIT, layout and cache misses belong to
    // neither operation, and folding them into a sample only adds noise.
    ui.reindexAfterMove();

    // The measurement: median of three up+down rounds, so one GC or scheduler
    // stall cannot decide the result.
    const rounds: number[] = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      manager.moveLayerUp(target);
      manager.moveLayerDown(target);
      rounds.push(performance.now() - start);
    }
    rounds.sort((a, b) => a - b);
    const roundElapsed = rounds[1];

    // The baseline: the fastest of REBUILD_SAMPLES full rebuilds of the same
    // 200-row panel, timed last so that timer or listener carry-over from the
    // measured path can only inflate them (the safe direction), never the
    // measurement itself. The minimum keeps one contention spike from turning
    // the same gate into a looser one; see the header.
    let rebuildElapsed = Infinity;
    for (let i = 0; i < REBUILD_SAMPLES; i++) {
      const start = performance.now();
      ui.reindexAfterMove();
      rebuildElapsed = Math.min(rebuildElapsed, performance.now() - start);
    }

    // A clock that cannot advance cannot support a timing assertion — the one
    // hard skip, and deliberately not a `process.env.CI` opt-out: a loaded CI
    // is exactly where the old absolute gate used to fail.
    if (!Number.isFinite(rebuildElapsed) || rebuildElapsed <= 0) {
      ctx.skip("performance.now() did not advance; this host cannot time");
    }

    const ratio = rebuildElapsed / roundElapsed;
    console.log(
      `[perf] reorder round ${roundElapsed.toFixed(1)}ms vs fastest of ${REBUILD_SAMPLES} rebuilds ${rebuildElapsed.toFixed(1)}ms -> ${ratio.toFixed(1)}x`,
    );
    expect(
      ratio,
      `reorder round ${roundElapsed.toFixed(1)}ms must stay ${REBUILD_DIVISOR}× cheaper than one full rebuild (${rebuildElapsed.toFixed(1)}ms); got ${ratio.toFixed(1)}×`,
    ).toBeGreaterThanOrEqual(REBUILD_DIVISOR);
    // The timeout covers the fixture attach sweep, the warm-up rebuild and
    // REBUILD_SAMPLES baseline rebuilds — all raw wall clock, so under heavy
    // load the budget has to grow with the host rather than tune the gate. With
    // 40 saturated cores this test has measured ~296s against the old 300s
    // budget (4s of margin); the assertion itself runs in tens of ms.
  }, 600_000);

  it("moves two nodes for a round and runs no rebuild pass", () => {
    // The structural guard behind the wall-clock gate: absolute times vary
    // with CI load, but the operation counts are exact. A regression to the
    // full-rebuild path breaks these loudly and for the right reason.
    window.localStorage.clear();
    const { manager, ui } = initFixture({ data: benchData(198, 2) });
    const insertBefore = vi.spyOn(attachedPanel(ui), "insertBefore");
    const applyUserState = vi.spyOn(ui, "applyUserState");
    const refreshAllCounts = vi.spyOn(ui, "refreshAllCounts");
    const target = "overlay_99";

    manager.moveLayerUp(target);
    // One single-step move relocates exactly one row.
    expect(insertBefore).toHaveBeenCalledTimes(1);
    manager.moveLayerDown(target);
    expect(insertBefore).toHaveBeenCalledTimes(2);
    // No projection sweep, no count repaint: a position change touches
    // neither row state nor membership.
    expect(applyUserState).not.toHaveBeenCalled();
    expect(refreshAllCounts).not.toHaveBeenCalled();
  }, 120_000);

  it("pins the long-forward reconcile ceiling at one write per sibling", () => {
    // The reconcile is a single in-place pass, not a minimum-write one:
    // moving the first row to the last slot relocates every displaced
    // sibling on the way — 197 writes for 198 overlays, still no rebuild.
    // Pinned so the follow-up minimum-write reconcile changes this number
    // deliberately, and a regression past it cannot slip in silently.
    window.localStorage.clear();
    const { manager, ui } = initFixture({ data: benchData(198, 2) });
    const insertBefore = vi.spyOn(attachedPanel(ui), "insertBefore");

    manager.reorderLayer("overlay_0", "overlay_197");

    expect(insertBefore).toHaveBeenCalledTimes(197);
    const order = manager.layers.map(l => l.id);
    expect(order[order.indexOf("overlay_197") + 1]).toBe("overlay_0");
  }, 120_000);
});

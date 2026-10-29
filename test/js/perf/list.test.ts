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
// Measured ratios (round ÷ full rebuild): ~1/41 idle, ~1/59 under 16 saturated
// cores, ~1/41 under a full parallel `test/js` run. REBUILD_DIVISOR = 8 leaves
// ~5× headroom on that spread, while a regression that rebuilds the list per
// move costs ~2 rebuilds for the up+down round — ~16× past the gate. The other
// two tests pin the operation counts, so the ratio is never the only evidence.
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
 *  from the measured spread (41–59×) with ~5× headroom; a regression to the
 *  per-move rebuild path lands at ~2×. */
const REBUILD_DIVISOR = 8;

describe("perf/list syncRowOrder", () => {
  it("keeps a 200-layer reorder round far cheaper than a full rebuild", ctx => {
    window.localStorage.clear();
    const { manager, ui } = initFixture({ data: benchData(198, 2) });
    const target = "overlay_99";

    // Warm both paths once: first-call JIT, layout and cache misses belong to
    // neither operation, and folding them into a sample only adds noise.
    manager.moveLayerUp(target);
    manager.moveLayerDown(target);
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

    // The baseline: one full rebuild of the same 200-row panel, timed last so
    // that any timer or listener carry-over from the measured path can only
    // inflate it (the safe direction), never the measurement itself.
    const rebuildStart = performance.now();
    ui.reindexAfterMove();
    const rebuildElapsed = performance.now() - rebuildStart;

    // A clock that cannot advance cannot support a timing assertion — the one
    // hard skip, and deliberately not a `process.env.CI` opt-out: a loaded CI
    // is exactly where the old absolute gate used to fail.
    if (!Number.isFinite(rebuildElapsed) || rebuildElapsed <= 0) {
      ctx.skip("performance.now() did not advance; this host cannot time");
    }

    const ratio = rebuildElapsed / roundElapsed;
    expect(
      ratio,
      `reorder round ${roundElapsed.toFixed(1)}ms must stay ${REBUILD_DIVISOR}× cheaper than one full rebuild (${rebuildElapsed.toFixed(1)}ms); got ${ratio.toFixed(1)}×`,
    ).toBeGreaterThanOrEqual(REBUILD_DIVISOR);
    // The timeout covers the fixture's attach sweep plus the one baseline
    // rebuild (the assertion itself runs in tens of ms). Both of those are raw
    // wall clock, so their budget has to grow with host load rather than tune
    // the gate.
  }, 300_000);

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

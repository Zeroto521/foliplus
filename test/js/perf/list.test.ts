// Wall-clock gate for LayerControl/ui/listPanel/list.ts — syncRowOrder × 200
// layers. Named for the logic script it exercises, same as render.test.ts.
//
// Decision rule (pre-set): a panel reorder must stay interactive. The full
// rebuild this path replaced cost ~4.4s for one up+down round at n=200 in
// the same environment; the incremental reconcile measures ~45ms standalone
// (the rest is ListCursor's tabindex repaint, sub-millisecond in a browser).
// The gate sits at 500ms — multiples of the standalone number, to absorb a
// loaded CI — so a regression that reintroduces the per-move rebuild trips
// an order of magnitude below the old cost.
import { describe, expect, it, vi } from "vitest";
import { attachedPanel, initFixture } from "../LayerControl/ui/fixture.js";

const benchData = (overlays: number, bases: number) => [
  ...Array.from({ length: overlays }, (_, i) => ({
    id: `overlay_${i}`,
    name: `Overlay ${i}`,
    group: "overlay" as const,
  })),
  ...Array.from({ length: bases }, (_, i) => ({
    id: `base_${i}`,
    name: `Base ${i}`,
    group: "base" as const,
  })),
];

describe("perf/list syncRowOrder", () => {
  it("keeps a 200-layer reorder round in the millisecond range", () => {
    window.localStorage.clear();
    const { manager } = initFixture({ data: benchData(198, 2) });
    const target = "overlay_99";

    const start = performance.now();
    manager.moveLayerUp(target);
    manager.moveLayerDown(target);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
    // The timeout covers the fixture's own attach sweep (the content-path
    // scan, not the reorder), which costs seconds at n=200 and more under a
    // loaded CI.
  }, 120_000);

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

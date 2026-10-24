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
import { describe, expect, it } from "vitest";
import { initFixture } from "../LayerControl/ui/fixture.js";

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
});

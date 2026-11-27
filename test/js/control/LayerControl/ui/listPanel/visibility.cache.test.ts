// The role table cache: one table per panel state per synchronous pass.
//
// `roleAggregates` is read by the role header, every folder row, the
// toggle-all sync and the checkbox handler, several times per render. The
// cache is keyed by the state the table derives from, so the repeated reads
// share one pass, and a state change rebuilds the table on the next read.
import { initFixture } from "../fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTENT, ROLE } from "#core/layer/index.js";
import { applyVisibility } from "#control/LayerControl/ui/listPanel/index.js";
import { roleAggregates } from "#control/LayerControl/ui/listPanel/visibility.js";

const overlayData = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `ov${i}`,
    name: `Overlay ${i}`,
    role: "overlay" as const,
    layer: { options: {} },
  }));

/** Let the queued epoch bump run: the attach-time table belongs to the
 *  previous synchronous pass, which is the "next render" this suite reads. */
const nextPass = () => Promise.resolve();

describe("roleAggregates cache", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("builds one table for every consumer in a render pass", async () => {
    const { ui } = initFixture({ data: overlayData(4) });
    await nextPass();
    // The spy is armed before the act: it counts the per-layer policy read
    // inside one aggregate pass.
    const reads = vi.spyOn(ui.intentStore, "isUserSet");

    const first = roleAggregates(ui, ROLE.OVERLAY);
    // The pass read the policy once per registered layer, base row included.
    const readsInFirstPass = reads.mock.calls.length;
    expect(readsInFirstPass).toBe(ui.c.layerRegistry.items.length);

    const second = roleAggregates(ui, ROLE.OVERLAY);
    const base = roleAggregates(ui, ROLE.BASE);

    expect(first.total).toBe(4);
    expect(second).toBe(first);
    // Repeats are map lookups: no second pass, and a role whose row the
    // fixture already registered is served from the same table.
    expect(reads).toHaveBeenCalledTimes(readsInFirstPass);
    expect(base.total).toBe(1);
  });

  it("rebuilds when a layer is registered or unregistered", async () => {
    const { ui } = initFixture({ data: overlayData(2) });
    await nextPass();
    expect(roleAggregates(ui, ROLE.OVERLAY).total).toBe(2);

    ui.c.registerLayer({
      id: "late",
      name: "Late",
      role: "overlay",
      layer: { options: {} },
    });
    expect(roleAggregates(ui, ROLE.OVERLAY).total).toBe(3);

    ui.c.unregisterLayer("late");
    expect(roleAggregates(ui, ROLE.OVERLAY).total).toBe(2);
  });

  it("rebuilds when a visibility intent changes", async () => {
    const { ui } = initFixture({ data: overlayData(2) });
    await nextPass();
    const before = roleAggregates(ui, ROLE.OVERLAY);
    expect(before.on).toBe(2);

    applyVisibility(ui, "ov0", false);

    const after = roleAggregates(ui, ROLE.OVERLAY);
    expect(after).not.toBe(before);
    // The hidden layer leaves the "on" count but stays in the total:
    // visibility aggregates count every registered layer of the role.
    expect(after.total).toBe(2);
    expect(after.on).toBe(1);
  });

  it("rebuilds when the fold opinion changes", async () => {
    const { ui } = initFixture({ data: overlayData(2) });
    await nextPass();
    const before = roleAggregates(ui, ROLE.OVERLAY);

    ui.listPanel.foldedRoles[ROLE.OVERLAY] = true;

    const after = roleAggregates(ui, ROLE.OVERLAY);
    expect(after).not.toBe(before);
    // Folding repaints the group rows; it does not change the numbers.
    expect(after.total).toBe(before.total);
    expect(after.on).toBe(before.on);
  });

  it("keeps the table when only a style intent changes", async () => {
    const { ui } = initFixture({ data: overlayData(2) });
    await nextPass();
    const before = roleAggregates(ui, ROLE.OVERLAY);

    ui.intentStore.setValue("ov0", INTENT.OPACITY, 0.5);

    // A paint edit cannot move a visibility count, so it must not pay for a
    // rebuild of the table.
    expect(roleAggregates(ui, ROLE.OVERLAY)).toBe(before);
  });

  it("counts a layer whose author declared it hidden only when it is on", async () => {
    const { ui } = initFixture({
      data: [
        {
          id: "shown",
          name: "Shown",
          role: "overlay" as const,
          layer: { options: {} },
        },
        {
          id: "hidden",
          name: "Hidden",
          role: "overlay" as const,
          layer: { options: {} },
          show: false,
        },
      ],
    });
    await nextPass();

    const table = roleAggregates(ui, ROLE.OVERLAY);
    expect(table.total).toBe(2);
    expect(table.on).toBe(1);
  });
});

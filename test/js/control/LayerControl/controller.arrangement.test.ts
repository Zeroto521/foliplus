// test/js/control/LayerControl/controller.arrangement — persisted-tree reconciliation (T1) + #1383 parity.
// T1: a layer that unregisters while an unrelated layer registers must return to
// its recorded parent block (reconcileArrangement used to write back hydrate's
// projection, pruning the orphaned node so it returned to ROOT, not its folder).
// #1383 parity: after a registry reorder, projectRows' intra-role layer order
// follows the registry (replaces #1383's browser assertion
// test_drag_reorder_syncs_panel_rows; evidence from the #1383 branch).
import { describe, expect, it } from "vitest";
import { createLayerControllerFixture, teardownLayerControllerFixture } from "./controller.fixture.js";
import { hydrate, projectRows } from "#core/layer/index.js";
import type { LayerController } from "#control/LayerControl/controller.js";
import type { RegisterLayerOpts } from "#core/layer/index.js";

const rowsOf = (manager: LayerController, role: string): string[] =>
  projectRows(hydrate((manager as unknown as { arrangement: Parameters<typeof hydrate>[0] }).arrangement, manager.layers), role as never);
const mk = (id: string, name: string, folder?: string): RegisterLayerOpts => ({ id, name, role: "overlay" as const, layer: new (window as any).L.TileLayer(), ...(folder ? { folder } : {}) });

describe("arrangement reconciliation", () => {
  it("T1: an unregistered layer returns to its recorded folder after an unrelated registration", () => {
    const { manager } = createLayerControllerFixture();
    try {
      manager.registerLayer(mk("r1", "R1", "roads"));
      manager.registerLayer(mk("r2", "R2", "roads"));
      manager.registerLayer(mk("a", "A"));
      manager.unregisterLayer("r1");
      // The trigger: an unrelated registration between unregister and re-register.
      manager.registerLayer(mk("b", "B"));
      manager.registerLayer(mk("r1", "R1", "roads"));
      const rows = rowsOf(manager, "overlay");
      const folderIdx = rows.indexOf("folder:overlay:roads");
      const r1Idx = rows.indexOf("layer:r1");
      const r2Idx = rows.indexOf("layer:r2");
      const rootHasR1 = rows.filter((r, i) => r === "layer:r1" && i < folderIdx);
      // The tombstone must hold: r1 returns to its RECORDED slot inside the
      // roads folder. Each new member is prepended (v2 contract), so r2
      // (registered second) sits ABOVE r1 (registered first); the tombstone
      // must keep r1 BELOW r2 — not the folder top (a fresh prepend), not the
      // folder bottom, not the role root.
      expect(r1Idx).toBeGreaterThan(folderIdx);
      expect(r1Idx).toBeGreaterThan(r2Idx);
      expect(rootHasR1).toEqual([]);
    } finally { teardownLayerControllerFixture(manager); }
  });
  it("#1383 parity: after a registry reorder, intra-role row order follows the registry", () => {
    const { manager } = createLayerControllerFixture();
    try {
      manager.registerLayer(mk("a", "A", "alpha"));
      manager.registerLayer(mk("b", "B", "alpha"));
      manager.registerLayer(mk("c", "C"));
      manager.registerLayer(mk("d", "D"));
      manager.bringLayerToFront("d");
      const rows = rowsOf(manager, "overlay");
      const rowIds = rows.filter(r => r.startsWith("layer:")).map(r => r.slice(6));
      const overlayReg = manager.layers.filter(l => l.role === "overlay" && l.id !== "foliplus_color_map").map(l => l.id);
      expect(rowIds).toEqual(overlayReg);
    } finally { teardownLayerControllerFixture(manager); }
  });
});

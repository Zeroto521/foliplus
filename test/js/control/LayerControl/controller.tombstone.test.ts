// test/js/control/LayerControl/controller.tombstone — unregister keeps the tree slot;
// deleteLayer truly removes the node (the two-sided tombstone contract).
import {
  createLayerControllerFixture,
  teardownLayerControllerFixture,
} from "./controller.fixture.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LayerController } from "#control/LayerControl/controller.js";

// The tree slot of a layer id within its role-root sequence. Returns the id's
// 0-based position among the role's top-level nodes (a root layer is its own
// node; a folder member's slot is reported as the folder node's position — the
// member order is tracked separately by the folder's children).
const treeIndexOf = (manager: LayerController, id: string): number => {
  const arr: any = (manager as any).arrangement;
  for (const role of Object.keys(arr.roles)) {
    const nodes: any[] = arr.roles[role] ?? [];
    for (let i = 0; i < nodes.length; i += 1) {
      const n = nodes[i];
      if (n.kind === "layer" && n.id === id) return i;
      if (n.kind === "folder" && n.children.some((c: any) => c.id === id)) return i;
    }
  }
  return -1;
};

// Whether the tree still carries the id anywhere (root or a folder member).
const treeCarries = (manager: LayerController, id: string): boolean =>
  treeIndexOf(manager, id) !== -1;

describe("LayerController tombstone contract", () => {
  let manager: LayerController;

  beforeEach(() => {
    ({ manager } = createLayerControllerFixture());
  });

  afterEach(() => {
    teardownLayerControllerFixture(manager);
  });

  it("unregister keeps the tree node, so re-register returns to the SAME slot (not the tail)", () => {
    manager.registerLayer({ id: "A", name: "A", layer: new window.L.TileLayer() });
    manager.registerLayer({ id: "B", name: "B", layer: new window.L.TileLayer() });
    manager.registerLayer({ id: "C", name: "C", layer: new window.L.TileLayer() });
    const original = treeIndexOf(manager, "B");
    expect(original).toBeGreaterThanOrEqual(0);

    expect(manager.unregisterLayer("B")).toBe(true);
    // Unregister removes the registry entry but NOT the tree node (tombstone).
    expect(manager.layerRegistry.has("B")).toBe(false);
    expect(treeCarries(manager, "B")).toBe(true);

    manager.registerLayer({ id: "B", name: "B", layer: new window.L.TileLayer() });
    // Re-register returns to the tombstone slot — not the tail.
    expect(treeIndexOf(manager, "B")).toBe(original);
    expect(manager.layers.map(l => l.id)).toContain("B");
  });

  it("deleteLayer truly drops the tree node (tombstone removed, not kept)", () => {
    manager.registerLayer({ id: "A", name: "A", layer: new window.L.TileLayer() });
    manager.registerLayer({ id: "B", name: "B", layer: new window.L.TileLayer() });
    manager.registerLayer({ id: "C", name: "C", layer: new window.L.TileLayer() });

    expect(manager.deleteLayer("B")).toBe(true);
    expect(manager.layerRegistry.has("B")).toBe(false);
    // The ONLY path that removes a node: after a delete the tree no longer
    // carries the id, so a fresh registration would take the default slot.
    expect(treeCarries(manager, "B")).toBe(false);
  });
});

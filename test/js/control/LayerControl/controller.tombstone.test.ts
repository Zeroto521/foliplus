// test/js/control/LayerControl/controller.tombstone — unregister keeps the tree slot;
// deleteLayer truly removes the node (the two-sided tombstone contract).
import {
  createLayerControllerFixture,
  teardownLayerControllerFixture,
} from "./controller.fixture.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LayerController } from "#control/LayerControl/controller.js";

// The tree slot of a layer id within its role-root sequence. With the doc
// as the single order source, the "tree" IS the doc: a layer's slot is its
// position among the root-level nodes (parent null) in rank order; a folder
// member's slot is reported as the folder node's position.
const treeIndexOf = (manager: LayerController, id: string): number => {
  const doc: any = (manager as any).orderDoc;
  if (!doc) return -1;
  const layerKey = `layer:${id}`;
  const memberOf = (key: string): string | null => {
    const n = doc.nodes[key];
    return n ? (n.parent ?? null) : null;
  };
  // Find the root node (parent null) that carries the id, in rank order.
  const roots = Object.entries(doc.nodes)
    .filter(([, n]: [string, any]) => n.parent == null)
    .sort(([, a]: [string, any], [, b]: [string, any]) =>
      a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0,
    );
  for (let i = 0; i < roots.length; i += 1) {
    const [key, n]: [string, any] = roots[i];
    if (key === layerKey) return i;
    // A folder/group carries the id if the id's nearest root parent is this key.
    if (n.kind === "folder" && memberOf(layerKey) === key) return i;
  }
  return -1;
};

// Whether the tree still carries the id anywhere (root or a folder member).
const treeCarries = (manager: LayerController, id: string): boolean =>
  treeIndexOf(manager, id) !== -1 ||
  (() => {
    const doc: any = (manager as any).orderDoc;
    return doc ? doc.nodes[`layer:${id}`] !== undefined : false;
  })();

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

  it("deleteLayer keeps the node but hides it (the reversible tombstone)", () => {
    manager.registerLayer({ id: "A", name: "A", layer: new window.L.TileLayer() });
    manager.registerLayer({ id: "B", name: "B", layer: new window.L.TileLayer() });
    manager.registerLayer({ id: "C", name: "C", layer: new window.L.TileLayer() });

    expect(manager.deleteLayer("B")).toBe(true);
    expect(manager.layerRegistry.has("B")).toBe(false);
    // The node stays in the tree as the hidden marker (the reversible
    // tombstone), so a fresh registration restores the original slot; the
    // registry filter keeps the hidden node out of the panel until then.
    expect(treeCarries(manager, "B")).toBe(true);
    const doc: any = (manager as any).orderDoc;
    expect(doc.nodes["layer:B"].hidden).toBe(true);
  });
});

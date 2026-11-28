// test/js/core/layer/order/resolve.test.ts — kind-generic projection over the order document.
import { describe, expect, it } from "vitest";
import {
  ORDER_KIND,
  type OrderDoc,
  childrenOf,
  leafKeysOf,
  resolveView,
  subtreeLeaves,
} from "#core/layer/index.js";

const doc = (nodes: OrderDoc["nodes"]): OrderDoc => ({ nodes });

describe("childrenOf", () => {
  it("orders siblings by rank lexicographically", () => {
    const d = doc({
      "layer:a": { kind: ORDER_KIND.LAYER, parent: null, rank: "a2" },
      "layer:b": { kind: ORDER_KIND.LAYER, parent: null, rank: "a0" },
      "layer:c": { kind: ORDER_KIND.LAYER, parent: null, rank: "a1" },
    });
    expect(childrenOf(d, null)).toEqual(["layer:b", "layer:c", "layer:a"]);
  });

  it("tie-breaks by declaration index then id", () => {
    const d = doc({
      "layer:b": { kind: ORDER_KIND.LAYER, parent: null, rank: "a0" },
      "layer:a": { kind: ORDER_KIND.LAYER, parent: null, rank: "a0" },
    });
    expect(childrenOf(d, null)).toEqual(["layer:b", "layer:a"]);
  });

  it("groups by parent", () => {
    const d = doc({
      "folder:overlay:f": {
        kind: ORDER_KIND.FOLDER,
        parent: null,
        rank: "a0",
        name: "F",
        role: "overlay",
      },
      "layer:a": { kind: ORDER_KIND.LAYER, parent: "folder:overlay:f", rank: "a0" },
      "layer:b": { kind: ORDER_KIND.LAYER, parent: null, rank: "a1" },
    });
    expect(childrenOf(d, "folder:overlay:f")).toEqual(["layer:a"]);
  });
});

describe("subtreeLeaves", () => {
  it("collects nested leaves in DFS order (no nesting drop)", () => {
    const d = doc({
      "folder:overlay:f": {
        kind: ORDER_KIND.FOLDER,
        parent: null,
        rank: "a0",
        name: "F",
        role: "overlay",
      },
      "group:g": {
        kind: ORDER_KIND.GROUP,
        parent: "folder:overlay:f",
        rank: "a0",
        name: "G",
      },
      "layer:x": { kind: ORDER_KIND.LAYER, parent: "group:g", rank: "a0" },
      "layer:y": { kind: ORDER_KIND.LAYER, parent: "folder:overlay:f", rank: "a1" },
    });
    expect(subtreeLeaves(d, "folder:overlay:f")).toEqual(["layer:x", "layer:y"]);
  });
});

describe("leafKeysOf", () => {
  it("returns present leaves in DFS order, skipping dormant", () => {
    const d = doc({
      "layer:a": { kind: ORDER_KIND.LAYER, parent: null, rank: "a0" },
      "layer:b": { kind: ORDER_KIND.LAYER, parent: null, rank: "a1" },
      "layer:c": { kind: ORDER_KIND.LAYER, parent: null, rank: "a2" },
    });
    const present = (k: string) => k !== "layer:b";
    expect(leafKeysOf(d, present)).toEqual(["layer:a", "layer:c"]);
  });
  it("walks nested folders and groups to present leaves", () => {
    const d = doc({
      "folder:overlay:f": {
        kind: ORDER_KIND.FOLDER,
        parent: null,
        rank: "a0",
        name: "F",
        role: "overlay",
      },
      "group:g": {
        kind: ORDER_KIND.GROUP,
        parent: "folder:overlay:f",
        rank: "a0",
        name: "G",
      },
      "layer:x": { kind: ORDER_KIND.LAYER, parent: "group:g", rank: "a0" },
      "layer:y": { kind: ORDER_KIND.LAYER, parent: "folder:overlay:f", rank: "a1" },
    });
    expect(leafKeysOf(d, () => true)).toEqual(["layer:x", "layer:y"]);
  });
});

describe("resolveView", () => {
  it("projects rows, leaves and blocks kind-generically", () => {
    const d = doc({
      "layer:a": { kind: ORDER_KIND.LAYER, parent: null, rank: "a0" },
      "folder:overlay:f": {
        kind: ORDER_KIND.FOLDER,
        parent: null,
        rank: "a1",
        name: "F",
        role: "overlay",
      },
      "group:g": {
        kind: ORDER_KIND.GROUP,
        parent: "folder:overlay:f",
        rank: "a0",
        name: "G",
      },
      "layer:x": { kind: ORDER_KIND.LAYER, parent: "group:g", rank: "a0" },
      "layer:y": { kind: ORDER_KIND.LAYER, parent: "folder:overlay:f", rank: "a1" },
      "layer:z": { kind: ORDER_KIND.LAYER, parent: null, rank: "a2", hidden: true },
    });
    const present = (k: string) => k !== "layer:z";
    const v = resolveView(d, present);
    // Render contract: cap 2. x sits at depth 3 (under group g), so it is
    // dropped from rows and leaves; the z ladder keeps only present, visible
    // leaves, and a container lists only its in-cap leaves.
    expect(v.leaves).toEqual(["layer:a", "layer:y"]);
    expect(v.rows.map(r => r.key)).toEqual([
      "layer:a",
      "folder:overlay:f",
      "group:g",
      "layer:y",
    ]);
    expect(
      v.containers.map(b => ({ kind: b.kind, key: b.key, children: b.children })),
    ).toEqual([
      {
        kind: ORDER_KIND.FOLDER,
        key: "folder:overlay:f",
        children: ["layer:y"],
      },
      { kind: ORDER_KIND.GROUP, key: "group:g", children: [] },
    ]);
    expect(v.rows.find(r => r.key === "layer:z")).toBeUndefined();
  });

  it("drops a subtree deeper than the depth cap from rows/leaves", () => {
    const d = doc({
      "folder:overlay:a": {
        kind: ORDER_KIND.FOLDER,
        parent: null,
        rank: "a0",
        name: "A",
        role: "overlay",
      },
      "folder:overlay:b": {
        kind: ORDER_KIND.FOLDER,
        parent: "folder:overlay:a",
        rank: "a0",
        name: "B",
        role: "overlay",
      },
      "folder:overlay:c": {
        kind: ORDER_KIND.FOLDER,
        parent: "folder:overlay:b",
        rank: "a0",
        name: "C",
        role: "overlay",
      },
      "layer:x": { kind: ORDER_KIND.LAYER, parent: "folder:overlay:c", rank: "a0" },
    });
    const v = resolveView(d, () => true);
    expect(v.leaves).toEqual([]);
    expect(v.rows.map(r => r.key)).toEqual([
      "folder:overlay:a",
      "folder:overlay:b",
    ]);
  });
});

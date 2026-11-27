// test/js/core/order/resolve.test.ts — kind-generic projection over the order document.
import { describe, expect, it } from "vitest";
import {
  type OrderDoc,
  childrenOf,
  leafKeysOf,
  resolveView,
  subtreeLeaves,
} from "#core/order/index.js";

const doc = (nodes: OrderDoc["nodes"]): OrderDoc => ({ nodes });

describe("childrenOf", () => {
  it("orders siblings by rank lexicographically", () => {
    const d = doc({
      "layer:a": { kind: "layer", parent: null, rank: "a2" },
      "layer:b": { kind: "layer", parent: null, rank: "a0" },
      "layer:c": { kind: "layer", parent: null, rank: "a1" },
    });
    expect(childrenOf(d, null)).toEqual(["layer:b", "layer:c", "layer:a"]);
  });

  it("tie-breaks by declaration index then id", () => {
    const d = doc({
      "layer:b": { kind: "layer", parent: null, rank: "a0" },
      "layer:a": { kind: "layer", parent: null, rank: "a0" },
    });
    expect(childrenOf(d, null)).toEqual(["layer:b", "layer:a"]);
  });

  it("groups by parent", () => {
    const d = doc({
      "folder:overlay:f": { kind: "folder", parent: null, rank: "a0", name: "F", role: "overlay" },
      "layer:a": { kind: "layer", parent: "folder:overlay:f", rank: "a0" },
      "layer:b": { kind: "layer", parent: null, rank: "a1" },
    });
    expect(childrenOf(d, "folder:overlay:f")).toEqual(["layer:a"]);
  });
});

describe("subtreeLeaves", () => {
  it("collects nested leaves in DFS order (no nesting drop)", () => {
    const d = doc({
      "folder:overlay:f": { kind: "folder", parent: null, rank: "a0", name: "F", role: "overlay" },
      "group:g": { kind: "group", parent: "folder:overlay:f", rank: "a0", name: "G" },
      "layer:x": { kind: "layer", parent: "group:g", rank: "a0" },
      "layer:y": { kind: "layer", parent: "folder:overlay:f", rank: "a1" },
    });
    expect(subtreeLeaves(d, "folder:overlay:f")).toEqual(["layer:x", "layer:y"]);
  });
});

describe("leafKeysOf", () => {
  it("returns present leaves in DFS order, skipping dormant", () => {
    const d = doc({
      "layer:a": { kind: "layer", parent: null, rank: "a0" },
      "layer:b": { kind: "layer", parent: null, rank: "a1" },
      "layer:c": { kind: "layer", parent: null, rank: "a2" },
    });
    const present = (k: string) => k !== "layer:b";
    expect(leafKeysOf(d, present)).toEqual(["layer:a", "layer:c"]);
  });
  it("walks nested folders and groups to present leaves", () => {
    const d = doc({
      "folder:overlay:f": { kind: "folder", parent: null, rank: "a0", name: "F", role: "overlay" },
      "group:g": { kind: "group", parent: "folder:overlay:f", rank: "a0", name: "G" },
      "layer:x": { kind: "layer", parent: "group:g", rank: "a0" },
      "layer:y": { kind: "layer", parent: "folder:overlay:f", rank: "a1" },
    });
    expect(leafKeysOf(d, () => true)).toEqual(["layer:x", "layer:y"]);
  });
});

describe("resolveView", () => {
  it("projects rows, leaves and blocks kind-generically", () => {
    const d = doc({
      "layer:a": { kind: "layer", parent: null, rank: "a0" },
      "folder:overlay:f": { kind: "folder", parent: null, rank: "a1", name: "F", role: "overlay" },
      "group:g": { kind: "group", parent: "folder:overlay:f", rank: "a0", name: "G" },
      "layer:x": { kind: "layer", parent: "group:g", rank: "a0" },
      "layer:y": { kind: "layer", parent: "folder:overlay:f", rank: "a1" },
      "layer:z": { kind: "layer", parent: null, rank: "a2", hidden: true },
    });
    const present = (k: string) => k !== "layer:z";
    const v = resolveView(d, present);
    expect(v.leaves).toEqual(["layer:a", "layer:x", "layer:y"]);
    expect(v.rows.map(r => r.key)).toEqual([
      "layer:a",
      "folder:overlay:f",
      "group:g",
      "layer:x",
      "layer:y",
    ]);
    expect(
      v.blocks.map(b => ({ kind: b.kind, key: b.key, children: b.children })),
    ).toEqual([
      { kind: "folder", key: "folder:overlay:f", children: ["layer:x", "layer:y"] },
      { kind: "group", key: "group:g", children: ["layer:x"] },
    ]);
    expect(v.rows.find(r => r.key === "layer:z")).toBeUndefined();
  });

  it("drops a subtree deeper than the depth cap from rows/leaves", () => {
    const d = doc({
      "folder:overlay:a": { kind: "folder", parent: null, rank: "a0", name: "A", role: "overlay" },
      "folder:overlay:b": { kind: "folder", parent: "folder:overlay:a", rank: "a0", name: "B", role: "overlay" },
      "folder:overlay:c": { kind: "folder", parent: "folder:overlay:b", rank: "a0", name: "C", role: "overlay" },
      "layer:x": { kind: "layer", parent: "folder:overlay:c", rank: "a0" },
    });
    const v = resolveView(d, () => true);
    expect(v.leaves).toEqual([]);
    expect(v.rows.map(r => r.key)).toEqual(["folder:overlay:a", "folder:overlay:b", "folder:overlay:c"]);
  });
});

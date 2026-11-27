// test/js/core/order/resolve.test.ts — kind-generic projection over the order document.
import { describe, expect, it } from "vitest";
import type { OrderDoc } from "#core/order/doc.js";
import {
  childrenOf,
  leafKeysOf,
  resolveView,
  subtreeLeaves,
} from "#core/order/resolve.js";

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
      "folder:f": { kind: "folder", parent: null, rank: "a0", name: "F" },
      "layer:a": { kind: "layer", parent: "folder:f", rank: "a0" },
      "layer:b": { kind: "layer", parent: null, rank: "a1" },
    });
    expect(childrenOf(d, "folder:f")).toEqual(["layer:a"]);
  });
});

describe("subtreeLeaves", () => {
  it("collects nested leaves in DFS order (no nesting drop)", () => {
    const d = doc({
      "folder:f": { kind: "folder", parent: null, rank: "a0", name: "F" },
      "group:g": { kind: "group", parent: "folder:f", rank: "a0", name: "G" },
      "layer:x": { kind: "layer", parent: "group:g", rank: "a0" },
      "layer:y": { kind: "layer", parent: "folder:f", rank: "a1" },
    });
    expect(subtreeLeaves(d, "folder:f")).toEqual(["layer:x", "layer:y"]);
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
});

describe("resolveView", () => {
  it("projects rows, leaves and blocks kind-generically", () => {
    const d = doc({
      "layer:a": { kind: "layer", parent: null, rank: "a0" },
      "folder:f": { kind: "folder", parent: null, rank: "a1", name: "F" },
      "group:g": { kind: "group", parent: "folder:f", rank: "a0", name: "G" },
      "layer:x": { kind: "layer", parent: "group:g", rank: "a0" },
      "layer:y": { kind: "layer", parent: "folder:f", rank: "a1" },
      "layer:z": { kind: "layer", parent: null, rank: "a2", hidden: true },
    });
    const present = (k: string) => k !== "layer:z";
    const v = resolveView(d, present);
    expect(v.leaves).toEqual(["layer:a", "layer:x", "layer:y"]);
    expect(v.rows.map(r => r.key)).toEqual([
      "layer:a",
      "folder:f",
      "group:g",
      "layer:x",
      "layer:y",
    ]);
    expect(
      v.blocks.map(b => ({ kind: b.kind, key: b.key, children: b.children })),
    ).toEqual([
      { kind: "folder", key: "folder:f", children: ["layer:x", "layer:y"] },
      { kind: "group", key: "group:g", children: ["layer:x"] },
    ]);
    expect(v.rows.find(r => r.key === "layer:z")).toBeUndefined();
  });

  it("drops a subtree deeper than the depth cap from rows/leaves", () => {
    const d = doc({
      "folder:a": { kind: "folder", parent: null, rank: "a0", name: "A" },
      "folder:b": { kind: "folder", parent: "folder:a", rank: "a0", name: "B" },
      "folder:c": { kind: "folder", parent: "folder:b", rank: "a0", name: "C" },
      "layer:x": { kind: "layer", parent: "folder:c", rank: "a0" },
    });
    const v = resolveView(d, () => true);
    expect(v.leaves).toEqual([]);
    expect(v.rows.map(r => r.key)).toEqual(["folder:a", "folder:b", "folder:c"]);
  });
});

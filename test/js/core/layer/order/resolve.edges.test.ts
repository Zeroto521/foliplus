// test/js/core/layer/order/resolve.edges.test.ts — drive the resolver's edge branches
// (declaration-order tie-break, unknown keys, depth cap, missing names).
import { describe, expect, it } from "vitest";
import {
  ORDER_KIND,
  type OrderDoc,
  childrenOf,
  leafKeysOf,
  resolveView,
  subtreeLeaves,
} from "#core/layer/order/index.js";

const doc = (nodes: OrderDoc["nodes"]): OrderDoc => ({ nodes });

const alwaysPresent = () => true;

describe("resolve edges", () => {
  it("childrenOf breaks a rank tie by id when the explicit order lacks the nodes", () => {
    const d = doc({
      "layer:b": { kind: ORDER_KIND.LAYER, parent: null, rank: "a0" },
      "layer:a": { kind: ORDER_KIND.LAYER, parent: null, rank: "a0" },
    });
    // Both nodes have equal rank and are absent from the explicit order, so
    // the tie-break falls through to the id comparison.
    const out = childrenOf(d, null, ["other"]);
    expect(out).toEqual(["layer:a", "layer:b"]);
  });

  it("childrenOf uses the declaration order index when present", () => {
    const d = doc({
      "layer:b": { kind: ORDER_KIND.LAYER, parent: null, rank: "a0" },
      "layer:a": { kind: ORDER_KIND.LAYER, parent: null, rank: "a1" },
    });
    const out = childrenOf(d, null, ["layer:b", "layer:a"]);
    expect(out).toEqual(["layer:b", "layer:a"]);
  });

  it("subtreeLeaves returns empty for an unknown key", () => {
    const d = doc({ "layer:a": { kind: ORDER_KIND.LAYER, parent: null, rank: "a0" } });
    expect(subtreeLeaves(d, "layer:nope")).toEqual([]);
  });

  it("leafKeysOf flattens every present leaf regardless of depth", () => {
    // The z ladder must be complete: a deep leaf (past the render cap) still
    // needs a z-index, so leafKeysOf does NOT clamp by depth. The 2-level
    // render cap is a resolveView (row/container) concern only.
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
      "layer:deep": {
        kind: ORDER_KIND.LAYER,
        parent: "folder:overlay:c",
        rank: "a0",
      },
    });
    const leaves = leafKeysOf(d, alwaysPresent);
    expect(leaves).toEqual(["layer:deep"]);
  });

  it("resolveView defaults a missing block name to empty", () => {
    const d = doc({
      "folder:overlay:f": {
        kind: ORDER_KIND.FOLDER,
        parent: null,
        rank: "a0",
        role: "overlay",
      },
    });
    const view = resolveView(d, alwaysPresent);
    expect(view.containers[0].name).toBe("");
  });
});

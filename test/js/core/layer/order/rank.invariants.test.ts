// test/js/core/order/rank.invariants - the layer-order design rank invariants.
// Ranks are base62 fractional strings; inserting between two ranks must never grow the
// stored rank without bound, ties break by declaration index then id, and
// suppress/restore must return a layer to its exact prior rank and parent.
import { describe, expect, it } from "vitest";
import {
  type LayerDeclaration,
  type Present,
  childrenOf,
  defaultDoc,
  layerKeyOf,
  rankAfter,
  rankBetween,
  rankStart,
  resolveView,
  restore,
  suppress,
} from "#core/layer/index.js";

const presentAll = (): Present => () => true;

describe("rank invariants (design)", () => {
  it("100 mid-inserts never grow the rank string unboundedly", () => {
    const low = rankStart();
    const high = rankAfter(low);
    let lo = low;
    let maxLen = 0;
    for (let i = 0; i < 100; i += 1) {
      const mid = rankBetween(lo, high);
      expect(mid > lo && mid < high).toBe(true);
      lo = mid;
      maxLen = Math.max(maxLen, mid.length);
    }
    // After 100 inserts the rank string must not have grown to encode the full
    // insertion history (base62 fractional keeps it compact).
    expect(maxLen).toBeLessThanOrEqual(30);
    expect(high.length).toBeLessThanOrEqual(16);
  });

  it("tie-break is declaration index then id", () => {
    const declarations: LayerDeclaration[] = [
      { id: "b", role: "base" },
      { id: "a", role: "base" },
    ];
    const doc = defaultDoc(declarations);
    // Same rank is impossible from defaultDoc (each node gets a distinct rank), so the
    // tie-break only shows when two nodes share one rank. Force it: both at "a0".
    const tied = { nodes: { ...doc.nodes } };
    tied.nodes[layerKeyOf("a")] = { ...tied.nodes[layerKeyOf("a")], rank: "a0" };
    tied.nodes[layerKeyOf("b")] = { ...tied.nodes[layerKeyOf("b")], rank: "a0" };
    const v = resolveView(tied, presentAll());
    // Declaration order (b at index 0, a at index 1) decides the tie.
    expect(v.rows.map(r => r.key)).toEqual(["layer:b", "layer:a"]);
  });

  it("suppress then restore returns to the same rank and parent", () => {
    const declarations: LayerDeclaration[] = [
      { id: "a", role: "overlay" },
      { id: "b", role: "overlay" },
    ];
    const doc = defaultDoc(declarations);
    const bKey = layerKeyOf("b");
    const before = doc.nodes[bKey];
    const suppressed = suppress(doc, bKey);
    expect(suppressed.nodes[bKey].hidden).toBe(true);
    // Suppressed layers stay in the projection as rows carrying the hidden marker
    // (reversible delete: the panel renders them greyed, not removed).
    const sRows = resolveView(suppressed, presentAll()).rows;
    expect(sRows.map(r => r.key)).toEqual([layerKeyOf("a"), layerKeyOf("b")]);
    expect(sRows.find(r => r.key === bKey)?.hidden).toBe(true);
    const restored = restore(suppressed, bKey);
    expect(restored.nodes[bKey].hidden).toBeUndefined();
    // Exact rank and parent preserved (the reversible-delete invariant).
    expect(restored.nodes[bKey].rank).toBe(before.rank);
    expect(restored.nodes[bKey].parent).toBe(before.parent);
    // And it is back in the projection at its slot.
    expect(childrenOf(restored, null)).toEqual([layerKeyOf("a"), layerKeyOf("b")]);
  });
});

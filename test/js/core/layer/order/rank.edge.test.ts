// test/js/core/layer/order/rank.edge.test.ts — additional rank engine edges (bounded growth).
import { describe, expect, it } from "vitest";
import { rankAfter, rankBetween, rankStart } from "#core/layer/index.js";

describe("rank edges", () => {
  it("rankStart is the minimum and rankAfter grows", () => {
    const s = rankStart();
    const a = rankAfter(s);
    expect(s < a).toBe(true);
  });

  it("inserts before the first rank (lower unbounded)", () => {
    const b = rankAfter(rankStart());
    const x = rankBetween(null, b);
    expect(x < b).toBe(true);
  });

  it("inserts after the last rank (upper unbounded)", () => {
    const a = rankAfter(rankStart());
    const x = rankBetween(a, null);
    expect(a < x).toBe(true);
  });

  it("100 consecutive inserts into one gap stay short (bounded growth)", () => {
    let lo = rankStart();
    const hi = rankAfter(rankStart());
    let maxLen = 0;
    for (let i = 0; i < 100; i += 1) {
      const mid = rankBetween(lo, hi);
      expect(lo < mid && mid < hi).toBe(true);
      lo = mid;
      maxLen = Math.max(maxLen, mid.length);
    }
    expect(maxLen).toBeLessThanOrEqual(30);
  });

  it("repeated appends never renumber and keep keys short", () => {
    let last = rankStart();
    const keys = [last];
    for (let i = 0; i < 50; i += 1) {
      const next = rankBetween(last, null);
      expect(last < next).toBe(true);
      last = next;
      keys.push(next);
    }
    const sorted = [...keys].sort();
    expect(sorted.join("|")).toBe(keys.join("|"));
  });
});

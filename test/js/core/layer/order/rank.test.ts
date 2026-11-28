// test/js/core/layer/order/rank.test.ts — fractional rank key properties (RED edge).
import { describe, expect, it } from "vitest";
import { ALPHABET, rankAfter, rankBetween, rankStart } from "#core/layer/index.js";

const lt = (a: string, b: string): boolean => a < b;

describe("rankBetween", () => {
  it("start ranks before a first child", () => {
    const a = rankStart();
    const b = rankBetween(a, null);
    expect(lt(a, b)).toBe(true);
  });

  it("inserts between two ranks", () => {
    const a = rankStart();
    const b = rankAfter(a);
    const mid = rankBetween(a, b);
    expect(lt(a, mid)).toBe(true);
    expect(lt(mid, b)).toBe(true);
  });

  it("inserts before the first rank", () => {
    const b = rankAfter(rankStart());
    const a = rankBetween(null, b);
    expect(lt(a, b)).toBe(true);
  });

  it("appends after the last rank", () => {
    const a = rankAfter(rankStart());
    const b = rankBetween(a, null);
    expect(lt(a, b)).toBe(true);
  });

  it("100 consecutive inserts into a shrinking gap grow logarithmically", () => {
    let lo: string | null = rankStart();
    const hi: string | null = rankAfter(rankStart());
    let maxLen = 0;
    for (let i = 0; i < 100; i += 1) {
      const mid = rankBetween(lo, hi);
      expect(lt(lo!, mid)).toBe(true);
      expect(lt(mid, hi!)).toBe(true);
      lo = mid;
      maxLen = Math.max(maxLen, mid.length);
    }
    expect(maxLen).toBeLessThanOrEqual(30);
  });

  it("inserts a run between every adjacent pair of a long list (all sorted)", () => {
    const ranks: string[] = [rankStart()];
    for (let i = 1; i < 20; i += 1) ranks.push(rankAfter(ranks[i - 1]));
    const expected: string[] = [];
    for (let i = 0; i < ranks.length; i += 1) {
      expected.push(ranks[i]);
      if (i < ranks.length - 1) expected.push(rankBetween(ranks[i], ranks[i + 1]));
    }
    for (let i = 0; i < expected.length - 1; i += 1) {
      expect(lt(expected[i], expected[i + 1])).toBe(true);
    }
  });

  it("inserts between ranks sharing a fractional prefix", () => {
    // "a01" < "a011" < "a02" — the midpoint recursion walks the shared prefix.
    const a = "a01";
    const b = "a02";
    const mid = rankBetween(a, b);
    expect(lt(a, mid)).toBe(true);
    expect(lt(mid, b)).toBe(true);
  });

  it("alphabet is 62 distinct ordered symbols", () => {
    expect(ALPHABET.length).toBe(62);
    expect(new Set(ALPHABET.split("")).size).toBe(62);
  });
});

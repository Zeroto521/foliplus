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

describe("rank defensive guards + overflow edges", () => {
  const smallestInt = `A${"0".repeat(26)}`;
  const maxIntHead = `z${"z".repeat(26)}`;

  it("rejects a key whose integer part is shorter than its head encodes", () => {
    expect(() => rankBetween("a", null)).toThrow(/invalid order key/);
  });

  it("rejects the smallest integer key", () => {
    expect(() => rankBetween(smallestInt, null)).toThrow(/invalid order key/);
  });

  it("rejects a key whose fractional part ends in the zero digit", () => {
    expect(() => rankBetween("a00", null)).toThrow(/invalid order key/);
  });

  it("rejects equal keys (midpoint a>=b guard)", () => {
    expect(() => rankBetween("a1", "a1")).toThrow();
  });

  it("appends past the max integer head via the fractional midpoint", () => {
    const x = rankBetween(maxIntHead, null);
    expect(maxIntHead < x).toBe(true);
  });

  it("inserts before a key with the smallest integer part plus a fraction", () => {
    const b = `${smallestInt}1`;
    const x = rankBetween(null, b);
    expect(x < b).toBe(true);
  });
});

describe("rank overflow + prefix edges", () => {
  it("shares a multi-character prefix (midpoint recursion)", () => {
    const mid = rankBetween("a001", "a002");
    expect("a001" < mid && mid < "a002").toBe(true);
  });

  it("returns the head when the fractional gap is 1 and b is long", () => {
    const x = rankBetween("a0V", "a0WW");
    expect("a0V" < x && x < "a0WW").toBe(true);
  });

  it("increment crosses an integer-length boundary upward", () => {
    const x = rankBetween("bzz", null);
    expect("bzz" < x).toBe(true);
  });

  it("increment stays at the max head via length-delta zero", () => {
    const x = rankBetween(`y${"z".repeat(26)}`, null);
    expect(`y${"z".repeat(26)}` < x).toBe(true);
  });

  it("decrement crosses an integer-length boundary downward", () => {
    const x = rankBetween(null, "b00");
    expect(x < "b00").toBe(true);
  });

  it("inserts before a key with a short integer part and a long fraction", () => {
    const x = rankBetween(null, "azzzzz");
    expect(x < "azzzzz").toBe(true);
  });
});

it("increment crosses an integer-length boundary downward", () => {
  const x = rankBetween(`Y${"z".repeat(2)}`, null);
  expect(`Y${"z".repeat(2)}` < x).toBe(true);
});

it("decrement crosses an integer-length boundary upward", () => {
  const x = rankBetween(null, "Z0");
  expect(x < "Z0").toBe(true);
});

it("increment stays at a constant integer length across a head boundary", () => {
  const x = rankBetween("Zz", null);
  expect("Zz" < x).toBe(true);
});

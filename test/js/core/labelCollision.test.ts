import { describe, expect, it } from "vitest";
import { HIDE_OVERLAP, hides, planVisible } from "#foliplus/core/labelCollision.js";

/** A label at (x, y) that is `w` wide and one line tall. */
const at = (x: number, y: number, priority: number, w = 40) => ({
  box: { x, y, w, h: 16 },
  priority,
  tag: `(${x},${y})`,
});

describe("hides", () => {
  it("is symmetric in its arguments", () => {
    // The sweep hands pairs in arbitrary order, so the predicate must not care.
    const a = at(0, 0, 50).box;
    const b = at(10, 4, 50).box;

    expect(hides(a, b)).toBe(hides(b, a));
  });

  it("does not hide labels that are separated vertically", () => {
    // Same x band, different rows: they share a screen column but never touch.
    const a = at(0, 0, 50).box;
    const b = at(0, 40, 50).box;

    expect(hides(a, b)).toBe(false);
  });

  it("does not hide a light horizontal graze", () => {
    // Only the last few pixels of the narrower box overlap — well under the
    // threshold, and hiding on this would flicker labels in normal use.
    const a = at(0, 0, 50).box;
    const b = at(40 - 40 * HIDE_OVERLAP * 0.5, 2, 50).box;

    expect(hides(a, b)).toBe(false);
  });

  it("hides when the overlap covers the threshold of the narrower box", () => {
    const a = at(0, 0, 50, 40).box;
    const b = at(40 - 40 * HIDE_OVERLAP, 2, 50, 40).box;

    expect(hides(a, b)).toBe(true);
  });

  it("judges against the narrower box, so a wide label can lose to a narrow one", () => {
    // 15px of the narrow 20px label is covered — exactly the threshold, so it
    // hides — even though those 15px are a sliver of the 100px label underneath.
    const wide = at(0, 0, 50, 100).box;
    const narrow = at(100 - 20 * HIDE_OVERLAP, 2, 50, 20).box;

    expect(hides(wide, narrow)).toBe(true);
  });
});

describe("planVisible", () => {
  it("returns every label when nothing overlaps", () => {
    const labels = [at(0, 0, 50), at(200, 0, 50), at(400, 0, 50)];

    expect(planVisible(labels).size).toBe(3);
  });

  it("keeps the higher priority and drops the rest of an overlapping group", () => {
    const low = at(0, 0, 10);
    const high = at(2, 1, 90);
    const labels = [low, high];

    const survivors = planVisible(labels);

    expect(survivors.has(high)).toBe(true);
    expect(survivors.has(low)).toBe(false);
  });

  it("drops a low-priority label even when it is listed first", () => {
    // The verdict is a function of (priority, width, position), never of the
    // order the caller happened to build the list in.
    const high = at(0, 0, 90);
    const low = at(2, 1, 10);

    const survivors = planVisible([high, low]);

    expect(survivors.has(high)).toBe(true);
    expect(survivors.size).toBe(1);
  });

  it("breaks a priority tie toward the wider label", () => {
    const narrow = at(0, 0, 50, 20);
    const wide = at(5, 1, 50, 60);

    const survivors = planVisible([narrow, wide]);

    expect(survivors.has(wide)).toBe(true);
    expect(survivors.has(narrow)).toBe(false);
  });

  it("is order-independent for an overlapping group", () => {
    const labels = [at(0, 0, 30), at(3, 1, 70), at(6, 2, 50)];
    const forward = planVisible(labels);
    const backward = planVisible([...labels].reverse());

    expect([...forward]).toEqual([...backward]);
  });

  it("keeps labels that only touch the hidden one, not its winner", () => {
    // The survivor claims space for the rest of the sweep: a third label that
    // clears the winner stays, even though it overlaps the one that dropped.
    const winner = at(0, 0, 90, 40);
    const dropped = at(2, 1, 10, 40);
    const clear = at(100, 0, 50, 40);

    const survivors = planVisible([winner, dropped, clear]);

    expect(survivors.has(winner)).toBe(true);
    expect(survivors.has(dropped)).toBe(false);
    expect(survivors.has(clear)).toBe(true);
  });

  it("returns an empty set for no labels", () => {
    expect(planVisible([]).size).toBe(0);
  });

  it("takes the threshold from the caller", () => {
    // The default suits flat text bars; a caller with taller labels can demand
    // more overlap before it drops one. Same pair, two verdicts.
    const low = at(0, 0, 10, 40);
    const high = at(40 - 40 * 0.5, 1, 90, 40); // half covered

    expect(planVisible([low, high]).has(low)).toBe(true); // default 0.75: both stay
    expect(planVisible([low, high], 0.5).has(low)).toBe(false);
  });
});

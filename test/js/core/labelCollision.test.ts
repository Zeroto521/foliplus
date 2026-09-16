import { describe, expect, it } from "vitest";
import {
  HIDE_OVERLAP,
  hides,
  planVisible,
  withinRect,
} from "#foliplus/core/labelCollision.js";

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

describe("withinRect", () => {
  it("keeps only the labels whose box falls inside the rect", () => {
    const inside = at(0, 0, 50);
    const outside = at(2000, 2000, 50);

    const kept = withinRect([inside, outside], { x: 0, y: 0, w: 400, h: 300 });

    expect(kept).toEqual([inside]);
  });

  it("keeps a label sitting exactly on the boundary", () => {
    // Culling drops nothing that could still be (partly) on screen: a label on
    // the edge draws once, and dropping it would read as a missing label.
    const onEdge = at(400, 300, 50);

    expect(withinRect([onEdge], { x: 0, y: 0, w: 400, h: 300 })).toEqual([onEdge]);
  });
});

// ───────────────────────── grid-index equivalence ─────────────────────────
// The spatial grid is an evaluation strategy, not a rule change. This pins its
// survivors to what the original pairwise sweep returns, on a set dense enough
// that cell sharing actually decides the outcome.

interface RefLabel {
  box: { x: number; y: number; w: number; h: number };
  priority: number;
}

/** The pairwise sweep this module used before the grid — the reference. */
const pairwise = <T extends RefLabel>(
  labels: readonly T[],
  overlap: number = HIDE_OVERLAP,
): Set<T> => {
  const ranked = [...labels]
    .map((label, index) => ({ label, index }))
    .sort((a, b) => {
      if (b.label.priority !== a.label.priority) {
        return b.label.priority - a.label.priority;
      }
      if (b.label.box.w !== a.label.box.w) return b.label.box.w - a.label.box.w;
      return a.index - b.index;
    })
    .map(entry => entry.label);

  const survivors = new Set<T>();
  const claimed: RefLabel["box"][] = [];
  for (const label of ranked) {
    if (claimed.some(box => hides(label.box, box, overlap))) continue;
    survivors.add(label);
    claimed.push(label.box);
  }
  return survivors;
};

describe("planVisible — grid index", () => {
  /** Deterministic PRNG, so a mismatch reproduces. */
  const makeRng = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  it("returns exactly the pairwise survivors on a dense set", () => {
    const rand = makeRng(20240915);
    const labels = Array.from({ length: 800 }, (_, index) => ({
      index,
      priority: Math.floor(rand() * 100),
      box: {
        x: rand() * 1200,
        y: rand() * 800,
        w: 20 + rand() * 90,
        h: 12 + rand() * 8,
      },
    }));

    const ids = (set: Set<(typeof labels)[number]>) =>
      [...set].map(label => label.index).sort((a, b) => a - b);

    expect(ids(planVisible(labels))).toEqual(ids(pairwise(labels)));
  });

  it("stays equivalent with one far larger box in the set", () => {
    // A single very long label must not change the outcome — and, because the
    // cell size is fixed, must not pack everyone else into a few buckets.
    const rand = makeRng(99);
    const labels = Array.from({ length: 300 }, (_, index) => ({
      index,
      priority: Math.floor(rand() * 100),
      box: { x: rand() * 800, y: rand() * 600, w: 20 + rand() * 60, h: 12 },
    }));
    labels.push({ index: 999, priority: 50, box: { x: 0, y: 0, w: 4000, h: 16 } });

    const ids = (set: Set<(typeof labels)[number]>) =>
      [...set].map(label => label.index).sort((a, b) => a - b);

    expect(ids(planVisible(labels))).toEqual(ids(pairwise(labels)));
  });

  it("matches pairwise when coordinates snap to cell multiples", () => {
    // The worst case for bucketing: x/y land on (or half a pixel either side
    // of) a 64px multiple, so boxes start and end exactly on cell borders.
    const rand = makeRng(4321);
    const snap = (v: number) => Math.round(v / 64) * 64 + (rand() < 0.5 ? -0.5 : 0.5);
    const labels = Array.from({ length: 500 }, (_, index) => ({
      index,
      priority: Math.floor(rand() * 100),
      box: {
        x: snap(rand() * 1000),
        y: snap(rand() * 800),
        w: 20 + rand() * 90,
        h: 12,
      },
    }));

    const ids = (set: Set<(typeof labels)[number]>) =>
      [...set].map(label => label.index).sort((a, b) => a - b);

    expect(ids(planVisible(labels))).toEqual(ids(pairwise(labels)));
  });
});

describe("planVisible — grid edges", () => {
  const lbl = (
    index: number,
    box: { x: number; y: number; w: number; h: number },
    priority = 50,
  ) => ({ index, priority, box });

  /** Pad a small set past GRID_THRESHOLD — below it the pairwise sweep is
   *  selected on purpose, and these cases are about the grid. The filler sits
   *  far away and never overlaps, so it cannot affect the pair under test. */
  const withGrid = (labels: Array<ReturnType<typeof lbl>>) => [
    ...labels,
    ...Array.from({ length: 300 }, (_, i) => ({
      index: 100000 + i,
      priority: 50,
      box: { x: 200000 + i * 100, y: 200000, w: 20, h: 12 },
    })),
  ];

  it("returns nothing for an empty set", () => {
    expect(planVisible([]).size).toBe(0);
  });

  it("keeps a lone label", () => {
    const only = lbl(0, { x: 0, y: 0, w: 40, h: 16 });
    expect(planVisible([only]).has(only)).toBe(true);
  });

  it("indexes negative coordinates (labels off the top-left of the viewport)", () => {
    const a = lbl(0, { x: -200, y: -90, w: 40, h: 16 });
    const b = lbl(1, { x: -195, y: -85, w: 40, h: 16 }); // overlaps a

    const kept = planVisible(withGrid([a, b]));

    expect(kept.has(a)).toBe(true);
    expect(kept.has(b)).toBe(false);
  });

  it("keeps unindexable boxes without hanging, and they block nothing", () => {
    // Non-finite would leave the cell loop unbounded; a finite-but-astronomic
    // span would touch millions of buckets. Both survive unindexed.
    const infinite = lbl(0, { x: 0, y: 0, w: Infinity, h: 16 });
    const nan = lbl(1, { x: NaN, y: NaN, w: 10, h: 10 });
    const huge = lbl(2, { x: 0, y: 0, w: 1e9, h: 16 });
    const normal = lbl(3, { x: 50, y: 0, w: 40, h: 16 });

    const kept = planVisible(withGrid([infinite, nan, huge, normal]));

    expect(kept.has(infinite)).toBe(true);
    expect(kept.has(nan)).toBe(true);
    expect(kept.has(huge)).toBe(true);
    expect(kept.has(normal)).toBe(true);
  });

  it("compares two boxes that only meet across a cell boundary", () => {
    // Both span cells 0 and 1 — the overlap sits on the boundary, and the pair
    // must still be compared.
    const a = lbl(0, { x: 0, y: 0, w: 64, h: 16 }, 90);
    const b = lbl(1, { x: 10, y: 0, w: 64, h: 16 }, 10); // 10..74, 54px of overlap

    const kept = planVisible(withGrid([a, b]));

    expect(kept.has(a)).toBe(true);
    expect(kept.has(b)).toBe(false);
  });

  it("handles large coordinates", () => {
    const a = lbl(0, { x: -1e7, y: -1e7, w: 40, h: 16 }, 90);
    const b = lbl(1, { x: -1e7 + 10, y: -1e7, w: 40, h: 16 }, 10);

    const kept = planVisible(withGrid([a, b]));

    expect(kept.has(a)).toBe(true);
    expect(kept.has(b)).toBe(false);
  });

  it("states its precondition: a zero-width box degenerates the rule", () => {
    // Not a behaviour to preserve — the contract. The grid's equivalence rests
    // on "hidden ⇒ the boxes share a cell", which needs a strictly positive
    // threshold; at a zero width the criterion collapses to `hOverlap >= 0`,
    // which even a separated pair satisfies. Both callers pass real widths.
    const zeroWidth = { x: 0, y: 0, w: 0, h: 16 };
    const apart = { x: 200, y: 0, w: 40, h: 16 };

    expect(hides(zeroWidth, apart, HIDE_OVERLAP)).toBe(true);
  });
});

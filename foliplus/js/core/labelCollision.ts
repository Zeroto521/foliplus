// core/labelCollision — pure label-collision geometry.
//
// Text labels drawn over a map collide when they overlap, so the least important
// one drops out instead of drifting away from its anchor: a label that moves is
// worse than a label that is missing. This module owns only the geometry — which
// labels are eligible, how large they render and how one is hidden belong to the
// renderer (MeasureControl's DOM chips, LayerControl's canvas text), so both can
// share one planner instead of each growing its own rules.
//
// Two rules decide a hide, and both must hold:
//   1. the boxes intersect on the y-axis — labels fully separated vertically can
//      never collide, however much their x ranges coincide;
//   2. the horizontal overlap covers at least HIDE_OVERLAP of the narrower box's
//      width. Labels are flat horizontal bars, so readability fails
//      horizontally; judging on that axis (not 2D area) is what keeps a light
//      edge graze from flickering a label out.

/** Axis-aligned pixel box, container-relative. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A label the planner may hide. The renderer supplies the box it measured and
 *  a priority; anything else it needs to draw the survivor is its own. */
interface PlacedLabel {
  box: Box;
  /** 0–100; the lowest values drop out first when two labels overlap heavily. */
  priority: number;
}

/**
 * A label is hidden only when the horizontal overlap covers at least this
 * fraction of the narrower label's width. 0.75 lets labels coexist while merely
 * grazing or overlapping lightly, and only drops one when they are effectively
 * stacked.
 */
const HIDE_OVERLAP = 0.75;

/** Horizontal overlap width of two boxes, or 0 when they do not overlap on the
 *  x-axis. */
const hOverlap = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));

/** Vertical overlap height of two boxes, or 0 when they do not overlap on the
 *  y-axis. */
const vOverlap = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** True when two labels overlap enough on screen to warrant hiding one.
 *  `hides(a, b) ≡ hides(b, a)` — symmetric by `Math.min` and the symmetric
 *  y-overlap test, so the sweep's argument order is irrelevant.
 *
 *  `overlap` is the caller's threshold, defaulted to {@link HIDE_OVERLAP}: how
 *  much of the narrower label must be covered before one of them drops. Only the
 *  caller knows its label shape — flat bars tolerate the default, taller or
 *  boxier ones may want more before a hide is worth it. */
const hides = (a: Box, b: Box, overlap: number = HIDE_OVERLAP): boolean =>
  vOverlap(a, b) > 0 && hOverlap(a, b) >= Math.min(a.w, b.w) * overlap;

/**
 * Which labels survive one pass: for every heavily-overlapping group the
 * strongest keeps its place and the rest drop out.
 *
 * Order-independent by construction — labels are ranked by strength (priority
 * desc, width desc, then the caller's own order to break ties) and swept
 * strongest-first, so the survivor set is a function of (priority, width,
 * position) alone and never of the order they arrived in.
 *
 * Returns the survivors; the caller hides everything else. `collide: false` is
 * the caller's business too: with nothing hidden there is nothing to plan.
 *
 * A spatial grid keeps this near-linear instead of O(n²) — the cell is sized to
 * the widest box, so a box touches at most 2×2 cells and a lookup only tests
 * that handful of candidates. A colliding pair always shares a cell (overlap
 * implies cell intersection), so the survivors are exactly what the pairwise
 * sweep would return: the same rule, evaluated faster.
 */
const planVisible = <T extends PlacedLabel>(
  labels: readonly T[],
  overlap: number = HIDE_OVERLAP,
): Set<T> => {
  const ranked = labels
    .map((label, index) => ({ label, index }))
    .sort((a, b) => {
      if (b.label.priority !== a.label.priority) {
        return b.label.priority - a.label.priority;
      }
      if (b.label.box.w !== a.label.box.w) return b.label.box.w - a.label.box.w;
      return a.index - b.index;
    })
    .map(entry => entry.label);

  let cell = 1;
  for (const label of ranked) {
    cell = Math.max(cell, label.box.w, label.box.h);
  }

  const buckets = new Map<string, Box[]>();
  const survivors = new Set<T>();

  for (const label of ranked) {
    const box = label.box;
    const x0 = Math.floor(box.x / cell);
    const y0 = Math.floor(box.y / cell);
    const x1 = Math.floor((box.x + box.w) / cell);
    const y1 = Math.floor((box.y + box.h) / cell);

    let collides = false;
    for (let cx = x0; cx <= x1 && !collides; cx++) {
      for (let cy = y0; cy <= y1 && !collides; cy++) {
        const bucket = buckets.get(`${cx},${cy}`);
        if (bucket?.some(claimed => hides(box, claimed, overlap))) collides = true;
      }
    }
    if (collides) continue;

    survivors.add(label);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = `${cx},${cy}`;
        const bucket = buckets.get(key);
        if (bucket) bucket.push(box);
        else buckets.set(key, [box]);
      }
    }
  }
  return survivors;
};

/**
 * Whether two boxes intersect at all, edges included. The inclusive edge is
 * deliberate for culling: a label sitting exactly on the boundary is still
 * (partly) on screen, and keeping it costs one draw while dropping it reads as
 * a missing label.
 */
const intersects = (a: Box, b: Box): boolean =>
  !(a.x > b.x + b.w || a.x + a.w < b.x || a.y > b.y + b.h || a.y + a.h < b.y);

/**
 * The labels whose box falls inside `rect` — the culling half of the same
 * geometry, for a renderer that would otherwise measure and draw every label the
 * layer owns rather than every label on screen.
 *
 * `rect` must be the extent the caller is actually rendering, which is not
 * always the live viewport: a render target that paints some *other* extent has
 * to pass that extent (or suspend culling), or it loses every label outside the
 * current view. The annotation canvas passes its own container box, which is
 * also the extent an export of that container captures, so culling by it is
 * safe on both paths.
 */
const withinRect = <T extends PlacedLabel>(labels: readonly T[], rect: Box): T[] =>
  labels.filter(label => intersects(label.box, rect));

export {
  HIDE_OVERLAP,
  hOverlap,
  hides,
  intersects,
  planVisible,
  vOverlap,
  withinRect,
  type Box,
  type PlacedLabel,
};

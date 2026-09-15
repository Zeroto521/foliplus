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
 * O(n²) — a `shown.some` per label. Fine for the few hundred labels a map shows
 * at once; a caller that expects thousands should cull by viewport first.
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

  const survivors = new Set<T>();
  const claimed: Box[] = [];
  for (const label of ranked) {
    if (claimed.some(box => hides(label.box, box, overlap))) continue;
    survivors.add(label);
    claimed.push(label.box);
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
 * `rect` is the caller's definition of "visible", and getting that right is the
 * caller's job: the live viewport normally, but **not** during an export, which
 * renders an extent the user may not be looking at. A caller that culls has to
 * suspend it (or pass the export's rect) while an export runs, or the exported
 * image loses every label outside the current view.
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

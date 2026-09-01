// MeasureControl label collision detection — pure geometry, no CONF, no
// manager.
//
// Every measure label sits on its segment midpoint (or the shape centroid).
// When two chips overlap heavily they are unreadable, so the least important
// one drops out instead of drifting away from its measurement point — labels
// never move off their anchor. Chips are only hidden when they intersect on
// the y-axis AND overlap most of the narrower chip's width on the x-axis;
// chips that are merely stacked vertically (same x band, different y) are
// left alone — they share screen column but never touch. A light edge graze
// does nothing, so labels are not flickered out in normal, well-spaced use.
//
// Boxes are read from the live DOM, so the per-type icon anchor and centering
// are both accounted for for free. `visibility: hidden` is used (not
// display:none) so the chip keeps its layout box — important so a later plan
// that frees the space can restore it in place, and so the PNG exporter still
// sees it during the split second before hiding.

/** A label eligible for collision hiding. */
export interface CollidableLabel {
  /** Marker that owns the chip; the chip is re-resolved every plan so a
   *  `setIcon` during a drag never leaves a stale element reference. */
  marker: L.Marker;
  /** 0–100; the lowest values drop out first when two chips overlap heavily. */
  priority: number;
}

/** Resolve a marker's label chip, or null when it is not on the map. */
export type ChipOf = (marker: L.Marker) => HTMLElement | null;

/** Everything the planner needs from the map. */
export interface Projector {
  /** Container-relative box of a chip in its current state. */
  box: (el: HTMLElement) => Box;
}

/** Axis-aligned pixel box. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Fallback chip size while it is not rendered yet. */
const MIN_W = 64;
const MIN_H = 18;

/**
 * A chip is hidden only when the horizontal overlap covers at least this
 * fraction of the narrower chip's width. 0.75 keeps labels from being
 * flickered out when they merely graze on the edge or overlap lightly —
 * only chips that are nearly stacked on top of each other are hidden. Chips
 * are flat horizontal bars, so readability failure (number text being
 * covered) is a horizontal phenomenon; we judge on that axis rather than 2D
 * area.
 */
const HIDE_OVERLAP = 0.75;

export const mapProjector = (map: L.Map): Projector => {
  // Cache the container rect once per plan: it does not change between chips,
  // so we avoid a layout read (getBoundingClientRect) for every label.
  const container = map.getContainer().getBoundingClientRect();
  return {
    box: el => {
      const r = el.getBoundingClientRect();
      return {
        x: r.left - container.left,
        y: r.top - container.top,
        w: r.width || MIN_W,
        h: r.height || MIN_H,
      };
    },
  };
};

/** Horizontal overlap width of two boxes, or 0 when they do not overlap on
 *  the x-axis. */
const hOverlap = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));

/** Vertical overlap height of two boxes, or 0 when they do not overlap on the
 *  y-axis. */
const vOverlap = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** True when two chips overlap enough on screen to warrant hiding one. Two
 *  conditions must both hold:
 *  (1) the chips intersect on the y-axis (vOverlap > 0) — chips that are
 *      fully separated vertically can never visually collide, no matter how
 *      much their x ranges coincide (e.g. labels on two near-vertical polygon
 *      edges at very different y share an x band but are perfectly readable).
 *  (2) the horizontal overlap covers at least HIDE_OVERLAP of the narrower
 *      chip's width — the actual text-collision criterion.
 *  `hides(a, b) ≡ hides(b, a)` — symmetric by Math.min and the symmetric
 *  y-overlap test, so argument order in the sweep is irrelevant. */
const hides = (a: Box, b: Box): boolean =>
  vOverlap(a, b) > 0 && hOverlap(a, b) >= Math.min(a.w, b.w) * HIDE_OVERLAP;

/**
 * Hide the least-important chip among every heavily-overlapping group, leaving
 * all others on their anchor. Chips that are already `visibility: hidden`
 * (from a previous plan) re-enter the competition when geometry changes, so a
 * chip dropped by collision comes back once the map zooms out.
 *
 * The planner is order-independent: the survivor set depends only on each chip's
 * (priority, width, position), not on label registration order. Chips are ranked
 * by strength (priority desc, width desc) and swept strongest-first — a chip is
 * hidden iff it heavily overlaps any already-shown chip; otherwise it claims its
 * space for the rest of the sweep. Two chips decide by priority (lower loses);
 * a tie breaks to the narrower chip's width, so the wider label keeps its anchor.
 *
 * Chips must be rendered before this runs: the caller defers the call to a
 * `requestAnimationFrame`, which also keeps the forced layout reads off the
 * paint path.
 *
 * With `collide` false every visible chip is shown untouched and no chip is
 * hidden.
 */
export const placeLabels = (
  labels: CollidableLabel[],
  projector: Projector,
  collide: boolean,
  chipOf: ChipOf,
): number => {
  const boxOf = (el: HTMLElement): Box => projector.box(el);

  const entries = labels
    .map((lb, idx) => ({
      lb,
      el: chipOf(lb.marker),
      idx,
    }))
    .filter(
      (x): x is { lb: CollidableLabel; el: HTMLElement; idx: number } => x.el !== null,
    )
    .map(e => ({
      ...e,
      box: boxOf(e.el),
    }));

  // Collision off: restore any chip we currently own that is hidden (i.e. ones
  // we hid in a prior plan). Only chips present in the current plan (i.e. on the
  // map and registered) are restored; chips hidden by the caller (destroy)
  // sit outside this function and are untouched.
  if (!collide) {
    entries
      .filter(e => e.el.style.visibility === "hidden")
      .forEach(e => {
        e.el.style.visibility = "";
      });
    return 0;
  }

  // Sort by strength (priority desc, width desc, then stable index) so the
  // survivor set is a function of (priority, width, position) alone — invariant
  // under any permutation of `labels`. Width, not area, because the hide
  // criterion (hides) is a 1D horizontal rule that never looks at height; the
  // sort winner must match the hide-rules winner.
  // O(n^2) overall (shown.some per chip) — acceptable for n <= ~200 labels.
  entries.sort((a, b) => {
    if (b.lb.priority !== a.lb.priority) return b.lb.priority - a.lb.priority;
    if (b.box.w !== a.box.w) return b.box.w - a.box.w;
    return a.idx - b.idx;
  });

  // Sweep strongest-first: each chip is hidden iff it heavily overlaps any
  // already-shown chip; otherwise it is shown and claims its space.
  const shown: Box[] = [];
  const toHide = new Set<HTMLElement>();
  for (const e of entries) {
    if (shown.some(s => hides(e.box, s))) {
      toHide.add(e.el);
      e.el.style.visibility = "hidden";
    } else {
      shown.push(e.box);
    }
  }

  for (const e of entries) {
    if (toHide.has(e.el)) continue;
    e.el.style.visibility = "";
  }
  return toHide.size;
};

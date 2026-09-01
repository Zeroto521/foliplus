// MeasureControl label collision detection — pure geometry, no CONF, no
// manager.
//
// Every measure label sits on its segment midpoint (or the shape centroid).
// When two chips overlap heavily they are unreadable, so the least important
// one drops out instead of drifting away from its measurement point — labels
// never move off their anchor. Chips are only hidden when the overlap covers
// most of a chip (>= half of the smaller box's area); a light edge graze
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
 * A chip is hidden only when the overlap covers at least this fraction of the
 * smaller chip's area. Below this threshold the overlap is treated as a light
 * edge graze and left alone — that keeps labels from being flickered out in
 * normal, well-spaced use.
 */
const HIDE_OVERLAP = 0.5;

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

/** Axis-aligned overlap area of two boxes, or 0 when they do not intersect. */
const overlapArea = (a: Box, b: Box): number => {
  const x0 = Math.max(a.x, b.x);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y0 = Math.max(a.y, b.y);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
};

/** True when the overlap is heavy enough to warrant hiding a chip. */
const hides = (a: Box, b: Box): boolean => {
  const area = overlapArea(a, b);
  return area >= Math.min(a.w * a.h, b.w * b.h) * HIDE_OVERLAP;
};

/**
 * Hide the least-important chip among every heavily-overlapping pair, leaving
 * all others on their anchor. Chips that are already `visibility: hidden`
 * (from a previous plan or `show_labels`) are skipped, so they never block
 * another chip from showing.
 *
 * Two chips decide by priority (lower loses); a tie breaks to the smaller
 * chip's area, so the more compact label gets hidden over the wider one. A
 * chip competes against every other — adjacent segment labels of one polygon
 * must not overlap either.
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
  const entries = labels
    .map(lb => ({ lb, el: chipOf(lb.marker) }))
    .filter((x): x is { lb: CollidableLabel; el: HTMLElement } => x.el !== null);

  // Collision off: restore any chip we currently own that is hidden (i.e. ones
  // we hid in a prior plan). This mirrors the original behaviour and lets
  // toggling collision off bring dropped labels back. Chips hidden by the
  // caller (show_labels/destroy) sit outside this function, so restoring
  // unconditionally here is safe.
  if (!collide) {
    entries
      .filter(e => e.el.style.visibility === "hidden")
      .forEach(e => {
        e.el.style.visibility = "";
      });
    return 0;
  }

  // Snapshot which chips are hidden before this call so we can skip them as
  // competitors (they claim no space).
  const preHidden = new Set(
    entries.filter(e => e.el.style.visibility === "hidden").map(e => e.el),
  );

  const toHide = new Set<HTMLElement>();
  const box = (el: HTMLElement): Box => projector.box(el);

  for (let i = 0; i < entries.length; i++) {
    const { lb: ai, el: ei } = entries[i]!;
    if (preHidden.has(ei) || toHide.has(ei)) continue;
    const bi = box(ei);

    for (let j = i + 1; j < entries.length; j++) {
      const { lb: aj, el: ej } = entries[j]!;
      if (preHidden.has(ej) || toHide.has(ej)) continue;
      const bj = box(ej);

      if (!hides(bi, bj)) continue;

      // Heavy overlap — hide the lower-priority (tie: smaller area) chip.
      if (
        ai.priority > aj.priority ||
        (ai.priority === aj.priority && bi.w * bi.h >= bj.w * bj.h)
      ) {
        toHide.add(ej);
        ej.style.visibility = "hidden";
      } else {
        toHide.add(ei);
        ei.style.visibility = "hidden";
        break;
      }
    }
  }

  // Show any entry that survives and was not externally hidden.
  for (const e of entries) {
    if (preHidden.has(e.el) || toHide.has(e.el)) continue;
    e.el.style.visibility = "";
  }
  return toHide.size;
};

// MeasureControl label collision detection — pure geometry, no CONF, no
// manager.
//
// Every measure label sits on its segment midpoint (or the shape centroid), so
// a dense polygon stacks dozens of chips on top of each other. Each chip
// registers its push directions and a priority; the manager re-plans after
// every layout change. Chips that collide step aside along the segment
// normal, and when a run of labels cannot be pushed apart at all the least
// important ones drop out instead of leaving an unreadable overlap.
//
// Chips are nudged with the standalone CSS `translate` property, which composes
// on top of each chip's own centering `transform` and its entrance animation
// without disturbing either — see the note in css/MeasureControl.css. Boxes
// are read from the live DOM, so the per-type icon anchor and centering are
// both accounted for for free.

/** A label awaiting placement. */
export interface CollidableLabel {
  /** Marker that owns the chip; the chip is re-resolved every plan so a
   *  `setIcon` during a drag never leaves a stale element reference. */
  marker: L.Marker;
  /** Push directions, recomputed per plan: nodes are draggable, so the
   *  segment a label sits on (and therefore its normal) changes under you. */
  candidates: (p: Projector) => Array<[number, number]>;
  /** 0–100; the lowest values drop out first when room runs out. */
  priority: number;
}

/** Resolve a marker's label chip, or null when it is not on the map. */
export type ChipOf = (marker: L.Marker) => HTMLElement | null;

/** Everything the planner needs from the map. */
export interface Projector {
  /** lat/lng → pixel point, for computing segment directions. */
  px: (latlng: L.LatLng) => L.Point;
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
/** Gap between chips before two labels register as colliding (px). */
const PAD = 4;
/** Pixels per push step away from the anchor. */
const STEP = 18;
/** Push directions tried before a label drops out. */
const MAX_ATTEMPTS = 3;
/** Distances tried along each direction. */
const MAX_STEPS = 3;
/** Standalone CSS `translate` property; composed on top of `transform`. */
const TRANSLATE = "translate";

export const mapProjector = (map: L.Map): Projector => ({
  px: latlng => map.latLngToLayerPoint(latlng),
  box: el => {
    const r = el.getBoundingClientRect();
    const c = map.getContainer().getBoundingClientRect();
    return {
      x: r.left - c.left,
      y: r.top - c.top,
      w: r.width || MIN_W,
      h: r.height || MIN_H,
    };
  },
});

/** Unit pixel-space direction of a segment; `[1, 0]` for a zero-length one. */
export const segmentDir = (
  p: Projector,
  from: L.LatLng,
  to: L.LatLng,
): [number, number] => {
  const a = p.px(from);
  const b = p.px(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return len < 1e-6 ? [1, 0] : [dx / len, dy / len];
};

/**
 * Push directions for a segment: its perpendicular first, then a fan around
 * it. The extra rays let a run of labels spread along a corridor wider than
 * the single normal — that is what makes a long zig-zag leg fit.
 */
export const perpCandidates = (dir: [number, number]): Array<[number, number]> => {
  const [dx, dy] = dir;
  const len = Math.hypot(dx, dy) || 1;
  const base = Math.atan2(dy / len, dx / len);
  return (
    [
      Math.PI / 2,
      -Math.PI / 2,
      Math.PI / 4,
      -Math.PI / 4,
      (3 * Math.PI) / 4,
      -(3 * Math.PI) / 4,
    ] as const
  ).map(off => {
    const a = base + off;
    return [Math.cos(a), Math.sin(a)] as [number, number];
  });
};

/** True when two boxes overlap, each grown by `pad` on all sides. */
const intersects = (a: Box, b: Box, pad: number): boolean =>
  a.x + pad < b.x + b.w - pad &&
  a.x + a.w - pad > b.x + pad &&
  a.y + pad < b.y + b.h - pad &&
  a.y + a.h - pad > b.y + pad;

/** Box centered at `box`'s center + (ox, oy), scaled about that point. Chips
 *  pushed far from their anchor get a larger footprint so a label cannot land
 *  halfway over its own leg. */
const grown = (box: Box, ox: number, oy: number, s: number): Box => {
  const w = box.w * s;
  const h = box.h * s;
  const cx = box.x + box.w / 2 + ox;
  const cy = box.y + box.h / 2 + oy;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
};

/** Footprint growth for a push of `dist` px — used both when testing a
 *  candidate and when claiming the box it settles on. */
const scaleFor = (dist: number): number => 1 + dist / 64;

/**
 * Pick a placement for one label. It is tried at its anchor first, then along
 * each push candidate at increasing distances — with or without the PAD gap the
 * anchor box keeps, so a chip whose anchor drifted away from a claimed box can
 * still move on instead of being dropped for the gap alone. `visibility: hidden`
 * when nothing fits. Labels placed earlier claim their box first, so they always
 * beat a label that arrives later — which is what makes priority ordering mean
 * anything.
 */
const planLabel = (
  el: HTMLElement,
  candidates: Array<[number, number]>,
  own: Box,
  taken: Box[],
): [number, number] => {
  const free = (box: Box) => !taken.some(b => intersects(box, b, PAD));
  if (free(own)) {
    el.style.visibility = "";
    return [0, 0];
  }

  for (let i = 0; i < Math.min(candidates.length, MAX_ATTEMPTS); i++) {
    const [dx, dy] = candidates[i]!;
    const dir = [dx * STEP, dy * STEP];
    for (let step = 1; step <= MAX_STEPS; step++) {
      const box = grown(own, dir[0] * step, dir[1] * step, scaleFor(STEP * step));
      if (free(box)) {
        el.style.visibility = "";
        return [dir[0] * step, dir[1] * step];
      }
    }
  }

  // Nothing fits — drop the label rather than leave an unreadable overlap. The
  // chip returns to its anchor (translate is cleared by the caller), so it
  // reappears there if a later plan frees the space.
  el.style.visibility = "hidden";
  return [0, 0];
};

/**
 * Plan and apply a placement for every label, returning how many were hidden
 * because they did not fit.
 *
 * Labels are placed in priority order (highest first), each claiming the
 * first candidate that is still free, and every label competes against every
 * other — adjacent segment labels of one polygon must not overlap either.
 * Chips must be rendered before this runs: the caller defers the call to a
 * `requestAnimationFrame`, which also keeps the forced layout reads off the
 * paint path.
 *
 * With `collide` false every chip returns to its anchor untouched.
 */
export const placeLabels = (
  labels: CollidableLabel[],
  projector: Projector,
  collide: boolean,
  chipOf: ChipOf,
): number => {
  if (!collide) {
    labels.forEach(lb => {
      const el = chipOf(lb.marker);
      el?.style.removeProperty(TRANSLATE);
      if (el) el.style.visibility = "";
    });
    return 0;
  }

  const entries = labels
    .map(lb => ({ lb, el: chipOf(lb.marker) }))
    .filter((x): x is { lb: CollidableLabel; el: HTMLElement } => x.el !== null);

  // Reset the pushes before reading any box: the first box() below forces one
  // layout with every reset applied, and the rest are served from that same
  // layout, so a plan never thrashes layout read-by-read.
  entries.forEach(e => e.el.style.removeProperty(TRANSLATE));

  entries.sort((a, b) => b.lb.priority - a.lb.priority);

  const taken: Box[] = [];
  let hidden = 0;
  for (const { lb, el } of entries) {
    const box = projector.box(el);
    const [ox, oy] = planLabel(el, lb.candidates(projector), box, taken);
    if (ox || oy) el.style.setProperty(TRANSLATE, `${ox}px ${oy}px`);
    else el.style.removeProperty(TRANSLATE);
    if (el.style.visibility === "hidden") {
      // Invisible, so it claims no space and cannot crowd a later label.
      hidden++;
      continue;
    }
    // The chip moved, so claim the box at its new spot with the same growth
    // rule the candidate was tested with.
    taken.push(grown(box, ox, oy, scaleFor(Math.hypot(ox, oy))));
  }
  return hidden;
};

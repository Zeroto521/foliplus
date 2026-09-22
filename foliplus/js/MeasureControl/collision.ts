// MeasureControl label collision detection — the DOM adapter over
// core/labelCollision.
//
// Every measure label sits on its segment midpoint (or the shape centroid).
// When two chips overlap heavily they are unreadable, so the least important one
// drops out instead of drifting away from its measurement point — labels never
// move off their anchor. The geometry (which pairs collide, who survives) lives
// in core/labelCollision and is shared with LayerControl's annotation labels;
// what stays here is what is specific to a DOM chip: reading its box off the live
// DOM, and hiding it.
//
// Boxes are read from the live DOM, so the per-type icon anchor and centering are
// both accounted for for free. `visibility: hidden` is used (not `display: none`)
// so the chip keeps its layout box — important so a later plan that frees the
// space can restore it in place, and so the PNG exporter still sees it during the
// split second before hiding.
import { type Box, planVisible } from "#core/labelCollision.js";

/** A label eligible for collision hiding. */
interface CollidableLabel {
  /** Marker that owns the chip; the chip is re-resolved every plan so a
   *  `setIcon` during a drag never leaves a stale element reference. */
  marker: L.Marker;
  /** 0–100; the lowest values drop out first when two chips overlap heavily. */
  priority: number;
}

/** Resolve a marker's label chip, or null when it is not on the map. */
type ChipOf = (marker: L.Marker) => HTMLElement | null;

/** Everything the planner needs from the map. */
interface Projector {
  /** Container-relative box of a chip in its current state. */
  box: (el: HTMLElement) => Box;
}

/** Fallback chip size used while a chip is not rendered yet (no DOM box to
 *  read). Roughly matches the typical rendered label so an early plan does
 *  not under-estimate its footprint. */
const FALLBACK_CHIP_W = 64;
const FALLBACK_CHIP_H = 18;

const mapProjector = (map: L.Map): Projector => {
  // Cache the container rect once per plan: it does not change between chips,
  // so we avoid a layout read (getBoundingClientRect) for every label.
  const container = map.getContainer().getBoundingClientRect();
  return {
    box: el => {
      const r = el.getBoundingClientRect();
      return {
        x: r.left - container.left,
        y: r.top - container.top,
        w: r.width || FALLBACK_CHIP_W,
        h: r.height || FALLBACK_CHIP_H,
      };
    },
  };
};

/** Result of a placement pass — how many chips were hidden and which ones, so
 *  callers (export, telemetry, other controls) can reason about the outcome. */
interface PlanResult {
  hidden: number;
  elements: Set<HTMLElement>;
}

/**
 * Hide the least-important chip among every heavily-overlapping group, leaving
 * all others on their anchor. Chips that are already `visibility: hidden` (from
 * a previous plan) re-enter the competition when geometry changes, so a chip
 * dropped by collision comes back once the map zooms out.
 *
 * Chips must be rendered before this runs: the caller defers the call to a
 * `requestAnimationFrame`, which also keeps the forced layout reads off the
 * paint path.
 *
 * With `collide` false every visible chip is shown untouched and no chip is
 * hidden.
 */
const placeLabels = (
  labels: CollidableLabel[],
  projector: Projector,
  collide: boolean,
  chipOf: ChipOf,
): PlanResult => {
  const entries = labels
    .map(lb => ({ lb, el: chipOf(lb.marker) }))
    .filter((x): x is { lb: CollidableLabel; el: HTMLElement } => x.el !== null)
    .map(e => ({ ...e, box: projector.box(e.el), priority: e.lb.priority }));

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
    return { hidden: 0, elements: new Set() };
  }

  const survivors = planVisible(entries);
  const toHide = new Set<HTMLElement>();
  for (const entry of entries) {
    if (survivors.has(entry)) continue;
    toHide.add(entry.el);
    entry.el.style.visibility = "hidden";
  }
  for (const entry of entries) {
    if (survivors.has(entry)) entry.el.style.visibility = "";
  }
  return { hidden: toHide.size, elements: toHide };
};

export { type CollidableLabel, type PlanResult, mapProjector, placeLabels };

// ui/placement — Pure geometry kernel for floating-surface placement.
/**
 * Pure geometry kernel for floating-surface placement.
 *
 * The project's floating surfaces (row panel, SearchControl panel, scheme
 * picker, listbox, slider bubble, MeasureControl readout, overflow menu) each
 * hand-wrote the "measure anchor -> measure surface -> decide below/above ->
 * clamp -> re-measure" loop, and their coordinate / bounds / flip definitions
 * diverged. This module is the single source of truth for that geometry: a
 * pure function with zero DOM dependencies, so a unit test can feed
 * rectangles directly.
 *
 * The DOM adapter layer (added in later migration steps) is responsible for
 * measuring `anchor` / `surface` / `bounds` and for writing the returned
 * `top` / `left` / `side` / `maxWidth` / `maxHeight` back onto the element.
 */
import type { Placement, PlacementBox, PlacementOpts, SurfaceSize } from "./type.js";

/**
 * Clamp `value` into `[min, max]`. When `min > max` (a degenerate range, e.g.
 * the surface is wider than the bounds) it returns `min`, so a caller that
 * clamps a position against an over-capacity bound still lands on the edge.
 */
const clamp = (value: number, min: number, max: number): number => {
  if (min > max) return min;
  return Math.min(Math.max(value, min), max);
};

/**
 * The intersection of two axis-aligned rectangles. A non-overlapping pair
 * yields a degenerate rectangle (`top >= bottom` or `left >= right`), which
 * {@link isDegenerate} detects.
 */
const intersect = (a: PlacementBox, b: PlacementBox): PlacementBox => ({
  top: Math.max(a.top, b.top),
  right: Math.min(a.right, b.right),
  bottom: Math.min(a.bottom, b.bottom),
  left: Math.max(a.left, b.left),
});

/** True when a rectangle has zero or negative area. */
const isDegenerate = (rect: PlacementBox): boolean =>
  rect.top >= rect.bottom || rect.left >= rect.right;

const widthOf = (r: PlacementBox): number => r.right - r.left;
const heightOf = (r: PlacementBox): number => r.bottom - r.top;

/**
 * Place a floating surface relative to an anchor within a set of bounds.
 *
 * Algorithm (each step is a pure computation):
 *
 * 1. **Width strategy** — the preferred width is the anchor's width, a fixed
 *    number, or the surface's natural width; `maxWidth` shrinks to the bounds
 *    when the preferred width does not fit.
 * 2. **Flip** — try below first; flip to above only when the surface does not
 *    fit below and there is more room above.
 * 3. **Height cap** — the surface height is capped to the available space in
 *    the chosen strip, and floored at `minRows * rowHeight` when the caller
 *    wants a minimum number of rows visible.
 * 4. **Vertical clamp** — `top` is clamped so the surface stays inside the
 *    bounds.
 * 5. **Horizontal** — the surface is right-aligned to the anchor, then
 *    clamped into the bounds.
 * 6. Returns `side` so the adapter can choose the arrow / transform.
 */
const computePlacement = (
  anchor: PlacementBox,
  surface: SurfaceSize,
  bounds: PlacementBox,
  opts: PlacementOpts = {},
): Placement => {
  const gap = opts.gap ?? 0;
  const naturalW = opts.natural?.width ?? surface.width;
  const naturalH = opts.natural?.height ?? surface.height;

  const anchorW = widthOf(anchor);
  const boundsW = widthOf(bounds);
  const boundsH = heightOf(bounds);

  // ① Width strategy.
  const preferredW =
    opts.width === "anchor"
      ? anchorW
      : typeof opts.width === "number"
        ? opts.width
        : naturalW;
  const maxWidth = Math.max(0, Math.min(preferredW, boundsW));

  // Available space in each strip, clamped to the bounds so an anchor that
  // sits outside the bounds cannot yield a strip taller than the bounds.
  const availBelow = clamp(bounds.bottom - anchor.bottom - gap, 0, boundsH);
  const availAbove = clamp(anchor.top - bounds.top - gap, 0, boundsH);

  // Row floor: the caller wants at least `minRows` rows visible, but never
  // more than the bounds can hold.
  const rowFloor = (opts.minRows ?? 0) * (opts.rowHeight ?? 0);
  const floorCapped = Math.min(rowFloor, boundsH);
  const desiredH = Math.max(naturalH, floorCapped);

  // ② Flip: below first; flip to above only when below does not fit and
  //    above has more room.
  const side: "below" | "above" =
    availBelow >= desiredH || availAbove <= availBelow ? "below" : "above";

  // ③ Height cap: capped to the chosen strip's available space, then the
  //    row floor is applied but capped at the bounds height, and the result
  //    is bounded by the bounds.
  const availH = side === "below" ? availBelow : availAbove;
  const stripCapped = Math.min(desiredH, availH);
  const maxHeight = Math.max(0, Math.min(boundsH, Math.max(stripCapped, floorCapped)));

  // ④ Vertical clamp.
  const naturalTop =
    side === "below" ? anchor.bottom + gap : anchor.top - gap - maxHeight;
  const top = clamp(naturalTop, bounds.top, bounds.bottom - maxHeight);

  // ⑤ Horizontal: right-align to the anchor, then clamp into the bounds.
  const naturalLeft = anchor.right - maxWidth;
  const left = clamp(naturalLeft, bounds.left, bounds.right - maxWidth);

  return { top, left, side, maxWidth, maxHeight };
};

export { clamp, computePlacement, intersect, isDegenerate };

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
 * Three consumers already call it in production — the row panel
 * (core/leaflet/panel.ts), the SearchControl result panel
 * (control/SearchControl/logic/panel.ts) and the LayerControl overflow menu
 * (control/LayerControl/ui/overlayPanel/menu.ts) — and the listbox engine
 * (ui/listbox.ts, behind both the shared dropdown and the scheme picker) now
 * calls it too, so all of them share ONE flip / clamp / height-cap engine.
 * Each surface's historical rule is a strategy parameter, not a second
 * implementation:
 *
 *   - `minRoom` — flip above by a two-row minimum (dropdown) or by the whole
 *     surface height (picker, overflow menu, row panel, SearchControl);
 *   - `width` — the box width: the anchor's width, an explicit number, or the
 *     surface's natural width by default;
 *   - `edgeGap` — the inset every floating surface keeps from the bounds
 *     (the 8px viewport edge of the listbox / picker; `{ x, y }` insets one
 *     axis only, which the row panel's horizontal-only edge needs);
 *   - `align` — "right" right-aligns to the anchor (row panel, menu,
 *     SearchControl), "left" left-aligns (listbox), "center" centres on it.
 *
 * When a surface changes its placement rule, the change lands in this file.
 * The adapters measure `anchor` / `surface` / `bounds` and write the returned
 * `top` / `left` / `side` / `maxWidth` / `maxHeight` onto the element; a
 * correct adapter contains no flip or clamp that duplicates the kernel.
 * Surface-specific policy (the row panel's comfort floor) stays documented at
 * that surface.
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
 * 1. **Frame** — the bounds are inset by `edgeGap` (a number insets both
 *    axes, `{ x, y }` one axis at a time); every strip, cap and clamp below is
 *    measured against that frame.
 * 2. **Width strategy** — `width` picks the box width: "anchor" uses the
 *    anchor's width, a number is that fixed width, and the default uses the
 *    surface's natural width. `maxWidth` shrinks to the frame when the
 *    preferred width does not fit.
 * 3. **Flip** — try below first; flip to above only when the below strip
 *    holds less than `minRoom` (the two-row-minimum threshold, default the
 *    surface's full height) and above has more room.
 * 4. **Height cap** — the surface height is capped to the available space in
 *    the chosen strip, and floored at `minRows * rowHeight` when the caller
 *    wants a minimum number of rows visible.
 * 5. **Vertical clamp** — `top` is clamped so the surface stays inside the
 *    frame.
 * 6. **Horizontal** — the surface is aligned to the anchor (`align`
 *    left/right/center, default right), then clamped into the frame.
 * 7. Returns `side` so the adapter can choose the arrow / transform.
 */
const computePlacement = (
  anchor: PlacementBox,
  surface: SurfaceSize,
  bounds: PlacementBox,
  opts: PlacementOpts = {},
): Placement => {
  const gap = opts.gap ?? 0;
  const edgeX =
    typeof opts.edgeGap === "number" ? opts.edgeGap : (opts.edgeGap?.x ?? 0);
  const edgeY =
    typeof opts.edgeGap === "number" ? opts.edgeGap : (opts.edgeGap?.y ?? 0);

  // ① Frame: inset the bounds so a floating surface that must keep an edge
  // gap measures its strips against the inset box. A number insets both axes;
  // { x, y } lets one surface keep the gap horizontally only.
  const frame: PlacementBox = {
    top: bounds.top + edgeY,
    right: bounds.right - edgeX,
    bottom: bounds.bottom - edgeY,
    left: bounds.left + edgeX,
  };
  const frameW = Math.max(0, widthOf(frame));
  const frameH = Math.max(0, heightOf(frame));

  const anchorW = widthOf(anchor);

  // ② Width strategy. `width` is the box width the surface will render (the
  // anchor's width, an explicit number, or the natural width by default); the
  // clamp below and the horizontal placement both use that one number, so a
  // caller that resolves its own width (the listbox's content/owning-cell
  // rule) cannot end up positioned against a different width than it paints.
  const preferredW =
    opts.width === "anchor"
      ? anchorW
      : typeof opts.width === "number"
        ? opts.width
        : surface.width;
  const maxWidth = Math.max(0, Math.min(preferredW, frameW));

  // Available space in each strip, clamped to the frame so an anchor that
  // sits outside the frame cannot yield a strip taller than the frame.
  const availBelow = clamp(frame.bottom - anchor.bottom - gap, 0, frameH);
  const availAbove = clamp(anchor.top - frame.top - gap, 0, frameH);

  // Row floor: the caller wants at least `minRows` rows visible, but never
  // more than the frame can hold.
  const rowFloor = (opts.minRows ?? 0) * (opts.rowHeight ?? 0);
  const floorCapped = Math.min(rowFloor, frameH);
  const desiredH = Math.max(surface.height, floorCapped);

  // ③ Flip threshold. minRoom lets a two-row-minimum rule flip above while
  // the below strip still holds part of the surface; the default (desiredH)
  // keeps the historical flip-only-when-below-cannot-hold-everything rule.
  const flipRoom = opts.minRoom ?? desiredH;

  // ④ Flip: below first; flip to above only when below does not fit the
  // flip threshold and above has more room.
  const side: "below" | "above" =
    availBelow >= flipRoom || availAbove <= availBelow ? "below" : "above";

  // ⑤ Height cap: capped to the chosen strip's available space, then the
  // row floor is applied but capped at the frame height, and the result
  // is bounded by the frame.
  const availH = side === "below" ? availBelow : availAbove;
  const stripCapped = Math.min(desiredH, availH);
  const maxHeight = Math.max(0, Math.min(frameH, Math.max(stripCapped, floorCapped)));

  // ⑥ Vertical clamp.
  const naturalTop =
    side === "below" ? anchor.bottom + gap : anchor.top - gap - maxHeight;
  const top = clamp(naturalTop, frame.top, frame.bottom - maxHeight);

  // ⑦ Horizontal alignment, then clamp into the frame.
  const naturalLeft =
    opts.align === "left"
      ? anchor.left
      : opts.align === "center"
        ? anchor.left + anchorW / 2 - maxWidth / 2
        : anchor.right - maxWidth;
  const left = clamp(naturalLeft, frame.left, frame.right - maxWidth);

  return { top, left, side, maxWidth, maxHeight };
};

export { clamp, computePlacement, intersect, isDegenerate };

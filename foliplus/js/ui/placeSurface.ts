// ui/placeSurface — the shared DOM adapter for floating-surface placement.
/**
 * Measure, ask the kernel, write the result — in one place.
 *
 * Every surface that follows the placement kernel goes through here for its
 * inline coordinates, so `top` / `left` / `side` are written the same way
 * everywhere: the box edge or its centre (when the element's CSS transform
 * centres it), and `data-side` when the stylesheet's arrow reads it. Surfaces
 * that keep extra placement policy (the row panel's top inset, the listbox's
 * width preference and bottom anchor) still write those bits themselves.
 *
 * The surface size defaults to its border box; callers that already measured a
 * different box (a max-content popup, a transformed bubble) pass it in. Bounds
 * default to the viewport; a surface inside a map or a clip box passes its own.
 */
import { computePlacement } from "./placement.js";
import type { Placement, PlacementBox, PlacementOpts, SurfaceSize } from "./type.js";

/** The viewport as a placement box — the default bounds. */
const viewportBounds = (): PlacementBox => ({
  left: 0,
  top: 0,
  right: window.innerWidth,
  bottom: window.innerHeight,
});

interface PlaceSurfaceOpts extends PlacementOpts {
  /** The anchor box (usually `anchor.getBoundingClientRect()`). */
  anchor: PlacementBox;
  /** The bounds to place inside. Defaults to the viewport. */
  bounds?: PlacementBox;
  /** The surface's measured size. Defaults to its border box. */
  size?: SurfaceSize;
  /** Write inline `left` as the box centre (the element's transform centres it). */
  origin?: "left" | "center";
  /** Write the resolved side to this data attribute (`"side"` -> `data-side`). */
  sideAttribute?: string;
  /** Called with the resolved side, for class-driven side markers. */
  onSide?: (side: Placement["side"]) => void;
}

/**
 * Place `surface` against `anchor` and write its inline coordinates.
 *
 * Returns the kernel's placement so the caller can still write its size caps
 * (`maxWidth` / `maxHeight`) or read the side.
 */
const placeSurface = (surface: HTMLElement, opts: PlaceSurfaceOpts): Placement => {
  const {
    anchor,
    bounds = viewportBounds(),
    size = { width: surface.offsetWidth, height: surface.offsetHeight },
    origin = "left",
    sideAttribute,
    onSide,
    ...placementOpts
  } = opts;
  const placement = computePlacement(anchor, size, bounds, placementOpts);
  const left =
    origin === "center" ? placement.left + placement.maxWidth / 2 : placement.left;
  surface.style.left = `${String(left)}px`;
  surface.style.top = `${String(placement.top)}px`;
  if (sideAttribute) surface.dataset[sideAttribute] = placement.side;
  onSide?.(placement.side);
  return placement;
};

export { placeSurface };

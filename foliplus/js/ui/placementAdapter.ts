// ui/placementAdapter — the shared DOM adapter for floating-surface placement.
/**
 * Measure, ask the kernel, apply the result — in one place.
 *
 * `placeSurface` is the one-call path: measure (or take a measured size and
 * bounds), call `computePlacement`, write the coordinates. `applyPlacement`
 * writes an already-computed placement, for a surface that must inspect the
 * result before writing (the row panel's zero-height branch).
 *
 * Coordinates are written the same way everywhere: `left` as the box edge or
 * its centre (when the element's CSS transform centres it), `top` — or the
 * bottom offset for an above-flipped portal around a bottom-anchored CSS
 * contract — and `data-side` when the stylesheet's arrow reads it. Surfaces
 * keep their own policy through options (width preference, height floor, top
 * inset) instead of writing coordinates themselves.
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

interface PlacementApplyOpts {
  /** Write inline `left` as the box centre (the element's transform centres it). */
  origin?: "left" | "center";
  /**
   * Write the bottom offset instead of `top` when the resolved side is above.
   * For a portal whose CSS contract anchors an up-flipped box by its bottom.
   */
  bottomWhenAbove?: boolean;
  /** Skip the vertical write for a horizontal-only placement. Defaults to false. */
  writeTop?: boolean;
  /** Clamp the written `top` to at least this value (surface policy, e.g. an edge inset). */
  minTop?: number;
  /** The bounds the placement was computed against (needed for the bottom offset). */
  bounds?: PlacementBox;
  /**
   * The surface's natural (border-box) size. Its height feeds the bottom
   * offset; the rendered height is `min(size.height, maxHeight)`.
   */
  size?: SurfaceSize;
  /** Write the resolved side to this data attribute (`"side"` -> `data-side`). */
  sideAttribute?: string;
  /** Called with the resolved side, for class-driven side markers. */
  onSide?: (side: Placement["side"]) => void;
}

interface PlaceSurfaceOpts extends PlacementOpts, PlacementApplyOpts {
  /** The anchor box (usually `anchor.getBoundingClientRect()`). */
  anchor: PlacementBox;
}

/**
 * Write an existing placement's coordinates onto `surface`.
 *
 * The default vertical write is `top`; a surface that anchors an up-flipped
 * box by its bottom edge passes `bottomWhenAbove`. The bottom offset uses the
 * height the box renders (`min(size.height, maxHeight)`, with `size.height`
 * the surface's natural height), so a cap taller than the content does not
 * shift it.
 */
const applyPlacement = (
  surface: HTMLElement,
  placement: Placement,
  opts: PlacementApplyOpts = {},
): void => {
  const left =
    opts.origin === "center" ? placement.left + placement.maxWidth / 2 : placement.left;
  surface.style.left = `${String(left)}px`;
  if (opts.writeTop !== false) {
    if (opts.bottomWhenAbove && placement.side === "above") {
      const bounds = opts.bounds ?? viewportBounds();
      const size = opts.size ?? {
        width: surface.offsetWidth,
        height: surface.offsetHeight,
      };
      const rendered = Math.min(size.height, placement.maxHeight);
      surface.style.top = "";
      surface.style.bottom = `${String(bounds.bottom - placement.top - rendered)}px`;
    } else {
      const top =
        opts.minTop === undefined
          ? placement.top
          : Math.max(placement.top, opts.minTop);
      surface.style.bottom = "";
      surface.style.top = `${String(top)}px`;
    }
  }
  if (opts.sideAttribute) surface.dataset[opts.sideAttribute] = placement.side;
  opts.onSide?.(placement.side);
};

/**
 * Place `surface` against `anchor` and write its inline coordinates.
 *
 * Returns the kernel's placement so the caller can still write its size caps
 * (`maxWidth` / `maxHeight`) or read the side.
 */
const placeSurface = (surface: HTMLElement, opts: PlaceSurfaceOpts): Placement => {
  const {
    anchor,
    origin,
    bottomWhenAbove,
    writeTop,
    minTop,
    bounds,
    size,
    sideAttribute,
    onSide,
    ...placementOpts
  } = opts;
  const measuredSize = size ?? {
    width: surface.offsetWidth,
    height: surface.offsetHeight,
  };
  const measuredBounds = bounds ?? viewportBounds();
  const placement = computePlacement(
    anchor,
    measuredSize,
    measuredBounds,
    placementOpts,
  );
  applyPlacement(surface, placement, {
    origin,
    bottomWhenAbove,
    writeTop,
    minTop,
    bounds: measuredBounds,
    size: measuredSize,
    sideAttribute,
    onSide,
  });
  return placement;
};

export { applyPlacement, placeSurface, viewportBounds };

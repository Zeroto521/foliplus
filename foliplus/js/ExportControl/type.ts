// ExportControl shared type definitions — crop-box geometry, export format key,
// render/tile descriptors, and persisted bounds. Decoupled from the entry module
// so crop/session/persistence/manager can consume them without pulling value code.
// Crop/drag state machines and the per-format descriptor live with their owners
// (manager.ts, const.ts); geo geometry comes from core/geo.
import type { LatLngPoint } from "#core/geo/index.js";

/** A screen-space rectangle. */
interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Export format key — mirrors Python's `ExportControl.FORMAT` literal. */
type ExportFormat = "png" | "jpeg" | "webp" | "geotiff";

/** Loaded saved bounds from storage. */
interface SavedBounds {
  nw: LatLngPoint;
  se: LatLngPoint;
}

/** Render context threaded through all rendering passes. */
interface RenderCtx {
  ctx: CanvasRenderingContext2D;
  rect: { left: number; top: number; width: number; height: number };
  scale: number;
  contRect: DOMRect;
  cw: number;
  ch: number;
  sw: number;
  sh: number;
  /** Reports how far the render has progressed, 0..90.  Never decreases. */
  onProgress?: (percent: number) => void;
}

/** A tile descriptor computed by calcTiles. */
interface TileDesc {
  x: number;
  y: number;
  z: number;
  url: string;
  /** 1x URL to fall back to when a retina-only source 404s every {r} tile. */
  fallback?: string;
  left: number;
  top: number;
  size: number;
  dx?: number;
  dy?: number;
  dw?: number;
  dh?: number;
}

/** Per-layer tile load statistics, for the post-export CORS warning. */
interface TileLoadStats {
  /** Tiles the draw pass attempted to fetch. */
  total: number;
  /** Tiles whose fetch failed (CORS rejection, timeout, 404). */
  failed: number;
}

export type { CropRect, ExportFormat, RenderCtx, SavedBounds, TileDesc, TileLoadStats };

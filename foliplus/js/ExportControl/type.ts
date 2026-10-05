// ExportControl shared type definitions — crop-box geometry, drag state, export
// format descriptors, and persisted bounds. Decoupled from the entry module so
// crop/session/persistence/manager can consume them without pulling value code.

/** A screen-space rectangle. */
interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A lat/lng point. */
interface LatLngPoint {
  lat: number;
  lng: number;
}

/** Geo bounds for the crop area. */
interface GeoBounds {
  nw: LatLngPoint;
  se: LatLngPoint;
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

export type {
  CropRect,
  ExportFormat,
  GeoBounds,
  LatLngPoint,
  RenderCtx,
  SavedBounds,
};

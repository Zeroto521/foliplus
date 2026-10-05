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

/** Drag state for interactive crop box adjustment. */
interface DragState {
  dragging: boolean;
  dragType: string | null;
  lastX: number;
  lastY: number;
}

/** Crop box state machine. */
interface CropState {
  overlay: HTMLElement;
  box: HTMLElement;
  rect: CropRect;
  locked: boolean;
  actions: HTMLElement;
  geoBounds?: GeoBounds;
  savedGeoBounds?: GeoBounds;
}

/** Export format key — mirrors Python's `ExportControl.FORMAT` literal. */
type ExportFormat = "png" | "jpeg" | "webp" | "geotiff";

/** Per-format descriptor. */
interface FormatSpec {
  /** `toBlob()` / `toDataURL()` mime type. */
  mime: string;
  /** File extension (no dot). */
  ext: string;
  /** Lossy codec — the single compress pass happens at write time. */
  lossy: boolean;
  /** Routed through `downloadGeoTiff` instead of a plain blob download. */
  geotiff: boolean;
}

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
  CropState,
  DragState,
  ExportFormat,
  FormatSpec,
  GeoBounds,
  LatLngPoint,
  RenderCtx,
  SavedBounds,
};

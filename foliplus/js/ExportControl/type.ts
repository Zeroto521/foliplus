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
  TileDesc,
  TileLoadStats,
};

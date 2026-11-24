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

/** Export format key — mirrors Python's `ExportControl.FORMAT` Literal type. */
type ExportImageFormat = "png" | "jpeg" | "webp" | "geotiff";

/** Export session phase — the single owner of the component's mode claim.
 *  `idle`: no session; `crop`: the crop box holds "selecting"; `exporting`:
 *  the render holds "exporting". */
type ExportPhase = "idle" | "crop" | "exporting";

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
  /** Images (sprites, icons, inline-SVG blobs) the export could not read
   *  back. Optional so a pass-level test can build a bare context; a real
   *  render initialises it and the renderer aggregates it into RenderStats. */
  failedAssets?: AssetFailure[];
  /** Elements whose flat background/border was already painted by the
   *  icon-background pass, so the remaining pass does not paint them twice
   *  (a second fill under alpha would deepen the paint). */
  paintedBackgrounds?: WeakSet<HTMLElement>;
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

/** One image the export could not read back, with the reason it failed.
 *  Reported on the console and counted in RenderStats so a missing asset is
 *  never a silent hole in the picture. */
interface AssetFailure {
  /** The image URL (or a stable label for a synthetic source, e.g. a blob). */
  src: string;
  /** Human-readable failure reason (HTTP status, network/CORS error). */
  reason: string;
}

/** What the last render drew — diagnostics and test surface. The manager
 *  exposes it as lastRenderStats; it is not part of the Python-facing
 *  result contract. */
interface RenderStats {
  /** Layer entries the export snapshot saw. */
  layers: number;
  /** Layers whose content was actually painted. */
  drawn: number;
  /** Layers whose label canvas was lost mid-export. */
  labelCanvasesMissing: number;
  /** Images the canvas could not read back. */
  failedAssets: number;
}

/** Per-layer tile load statistics, for the post-export CORS warning. */
interface TileLoadStats {
  /** Tiles the draw pass attempted to fetch. */
  total: number;
  /** Tiles whose fetch failed (CORS rejection, timeout, 404). */
  failed: number;
}

export type {
  AssetFailure,
  CropRect,
  ExportImageFormat,
  ExportPhase,
  RenderCtx,
  RenderStats,
  SavedBounds,
  TileDesc,
  TileLoadStats,
};

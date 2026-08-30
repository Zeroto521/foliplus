/** Crop-box constraints. */
export const CROP = {
  MIN_SIZE: 40,
  PADDING_RATIO: 0.25,
  CONTAINER_PADDING: 200,
  /** Pixels the crop box moves per arrow-key nudge (unlocked state). */
  NUDGE_STEP: 10,
};

/** Arrow keys that nudge the crop box position (unlocked state). */
export const NUDGE_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];

/** Persistent storage key for the last crop rectangle. */
export const STORAGE = { KEY: `foliplus_export_rect_${map.getContainer().id}` };

/** Timing / delay constants. */
export const TIMING = {
  URL_REVOKE_DELAY: 10000,
  TIMEOUT: CONF.timeout,
  RESTORE_DELAY: 200,
};

// MIME type lookup (format → toBlob mime, toDataURL mime)
export const MIME = {
  DEFAULT: "image/png", // Default MIME when CONF.format is not in MIME
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  tif: "image/tiff",
};

/** CSS class names used during render. */
export const CLASSES = {
  COLLAPSED: "collapsed",
  EXPANDED: "expanded",
  TOOL_BTN: "foliplus-tool-btn",
  MODE: "foliplus-export-mode",
  BOX: "foliplus-export-box",
  HANDLE: "foliplus-export-handle",
  CENTER: "foliplus-export-center",
  PREVIEW: "foliplus-export-preview",
  CLOSE: "foliplus-close-btn",
  HIDDEN: "foliplus-hidden",
  LOCKED: "locked",
  ACTIVE: "active",
  CONFIRM: "confirm",
  CANCEL: "cancel",
  DRAGGING: "dragging",
};

export const SVG_NS = "http://www.w3.org/2000/svg";

/** DOM selectors used during render. */
export const SEL = {
  CANVAS: ".leaflet-map-pane canvas.foliplus-heatmap-canvas",
  CONTROL: ".leaflet-control-container, .foliplus-export-ctrl",
  LABEL: "[data-foliplus-export='label']",
  /**
   * Opt-out attribute for export.  Set this attribute on any element
   * that should NOT appear in the exported image.
   *
   * Usage:  `<div data-foliplus-export="exclude">...</div>`
   *
   * Components that add elements to a layer pane can use this to
   * exclude internal UI (delete buttons, resize handles, etc.)
   * from the export canvas without needing to update ExportControl.
   */
  SKIP_EXPORT: '[data-foliplus-export="exclude"]',
};

// ============================================================================
// Auto-detected tile download concurrency.
//
// During export we fetch many raster tiles in parallel.  Browsers cap the
// number of in-flight connections to a single origin (typically ~6 for HTTP/1.x).
// Tiles are ~256 KB, so saturating slow links wastes RTTs.  We read
// navigator.connection (downlink first, then effectiveType, then a default of 6)
// to pick a sensible parallelism for the observed network.  No CONF override —
// the detector handles all cases.
// ============================================================================

const DEFAULT_CONCURRENCY = 6; // HTTP/1.x-era per-origin default

const CONN_CONCURRENCY: Record<string, number> = {
  "slow-2g": 2,
  "2g": 2,
  "3g": 4,
  "4g": DEFAULT_CONCURRENCY,
  bluetooth: DEFAULT_CONCURRENCY,
  wifi: DEFAULT_CONCURRENCY,
};

const DEFAULT_CONN_CONCURRENCY: Record<string, number> = {
  offline: 0,
  "slow-2g": 2,
  "2g": 2,
  "3g": 4,
  "4g": DEFAULT_CONCURRENCY,
};

/**
 * Best-effort concurrency guess from the Network Information API.
 *
 * Priority of signals (highest to lowest):
 *   1. `downlink` (Mbps) — most accurate, present in modern browsers.
 *   2. `effectiveType` ("slow-2g"/"2g"/"3g"/"4g") — coarse but stable.
 *   3. Fallback default (~6).
 *
 * We prefer `downlink` even when `effectiveType` is missing because a fast
 * link with a stale "3g" label should still download tiles in parallel.
 *
 * Vendor-prefixed accessors (moz/webkit) are consulted so Firefox and older
 * Safari work.  Standard `navigator.connection` wins when present.
 */
export const detectConcurrency = (): number => {
  const conn =
    (navigator as any).connection ||
    (navigator as any).mozConnection ||
    (navigator as any).webkitConnection;
  if (!conn) return DEFAULT_CONCURRENCY;

  const down = typeof conn.downlink === "number" ? conn.downlink : 0;
  if (down > 0) {
    if (down < 0.1) return 1;
    if (down < 1) return 2;
    if (down < 5) return 4;
    return DEFAULT_CONCURRENCY;
  }

  if (typeof conn.effectiveType !== "string") return DEFAULT_CONCURRENCY;
  const et = conn.effectiveType.toLowerCase();
  return CONN_CONCURRENCY[et] ?? DEFAULT_CONN_CONCURRENCY[et] ?? DEFAULT_CONCURRENCY;
};

/**
 * Maximum concurrent tile fetches during render.  Auto-detected at module
 * load — no user-configurable override.
 */
export const TILE_CONCURRENCY: number = detectConcurrency();

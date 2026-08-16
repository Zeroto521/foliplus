/** Crop-box constraints. */
export const CROP = {
  MIN_SIZE: 40,
  PADDING_RATIO: 0.25,
  CONTAINER_PADDING: 200,
};

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
  SKIP_EXPORT: '[data-foliplus-export="exclude"]',
};

/** Cache limits. */
export const CACHE = { UNDO_MAX: 20, TILE_MAX: 1000 };

// ============================================================================
// Auto-detected tile download concurrency.
//
// During export we fetch many raster tiles in parallel.  Browsers cap the
// number of in-flight connections to a single origin (typically ~6 for HTTP/1.x,
// unlimited for HTTP/2).  A fixed value works, but is a bad guess for mobile
// / slow networks.  Instead we:
//   1. Read CONF.tile_concurrency when the user wants a fixed number.
//   2. Otherwise use navigator.connection (downlink + effectiveType) to pick
//      a sensible default that matches the observed network quality.
//   3. Fall back to the classic ~6 when no signal is available.
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
 * Priority of signals (highest → lowest):
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
export function detectConcurrency(): number {
  const conn =
    (navigator as any).connection ||
    (navigator as any).mozConnection ||
    (navigator as any).webkitConnection;
  if (!conn) return DEFAULT_CONCURRENCY;

  // Prefer downlink (Mbps) when present — much better signal than effectiveType.
  // A ~256 KB tile saturates slow links, so we scale in-flight count down.
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
}

/**
 * Resolve an arbitrary CONF.tile_concurrency value to a concrete number.
 *
 * Recognised inputs:
 *   - a positive number        → fixed concurrency (legacy behaviour)
 *   - 0 or negative            → clamped to 1 (never zero, which would stall export)
 *   - the string "auto"        → detect from navigator.connection
 *   - any other numeric string  → parsed and clamped like a number
 *   - true                     → treat as "auto"
 *   - anything else            → detect from navigator.connection
 *
 * Exported so tests can cover every branch without re-importing the module.
 */
export function resolveTileConcurrency(raw: unknown): number {
  if (raw === undefined || raw === "auto" || raw === true) return detectConcurrency();
  if (typeof raw === "number")
    return Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : detectConcurrency();
  if (typeof raw === "string") {
    const n = Number(raw);
    if (!Number.isNaN(n)) return Math.max(1, Math.floor(n));
  }
  return detectConcurrency();
}

/**
 * Maximum concurrent tile fetches during render.
 * Evaluated once at module load from CONF.tile_concurrency.
 */
export const TILE_CONCURRENCY: number = resolveTileConcurrency(CONF.tile_concurrency);

/** Crop-box constraints. */
export const CROP = {
  MIN_SIZE: 40,
  PADDING_RATIO: 0.25,
  CONTAINER_PADDING: 200,
};

/** Persistent storage key for the last crop rectangle. */
export const STORAGE = {
  KEY: `foliplus_export_rect_${map.getContainer().id}`,
};

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

/** CSS class names used by the control. */
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

/** Cache limits. */
export const CACHE = {
  UNDO_MAX: 20, // Max number of crop-box adjustment steps kept for undo
  TILE_MAX: 1000,
};

// Max concurrent tile fetches during render (higher = faster for large
// exports, but may hit browser connection limits ~6 per domain).
export const TILE_CONCURRENCY = 6;

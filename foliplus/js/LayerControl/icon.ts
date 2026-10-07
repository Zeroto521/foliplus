/** Layer Control SVG icons. */
const ICON_LAYERS = `
  <svg viewBox="0 0 24 24">
    <polygon points="12 2 22 7 12 12 2 7"/>
    <polygon points="2 11 12 16 22 11"/>
    <polygon points="2 16 12 21 22 16"/>
  </svg>`;

const ICON_DRAG_HANDLE = `
  <svg viewBox="0 0 16 16" class="drag-handle">
    <circle cx="4.5" cy="3" r="1.75" fill="currentColor"/>
    <circle cx="11.5" cy="3" r="1.75" fill="currentColor"/>
    <circle cx="4.5" cy="8" r="1.75" fill="currentColor"/>
    <circle cx="11.5" cy="8" r="1.75" fill="currentColor"/>
    <circle cx="4.5" cy="13" r="1.75" fill="currentColor"/>
    <circle cx="11.5" cy="13" r="1.75" fill="currentColor"/>
  </svg>`;

const ICON_POINT = `
  <svg viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="4" class="solid"/>
  </svg>`;

const ICON_LINE = `
  <svg viewBox="0 0 24 24">
    <path d="M3 20 L9 6 L15 18 L21 4"/>
  </svg>`;

const ICON_POLYGON = `
  <svg viewBox="0 0 24 24">
    <polygon points="12,4 20,9 17,19 7,19 4,9"/>
  </svg>`;

const ICON_EMPTY = `
  <svg viewBox="0 0 24 24">
    <rect x="4" y="4" width="16" height="16" rx="2" class="dashed"/>
  </svg>`;

const ICON_UNKNOWN = `
  <svg viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="9" class="dashed"/>
    <path d="M9.5 9.5c0-1.5 1-2.5 2.5-2.5s2.5 1 2.5 2.5c0 1.5-2.5 2-2.5 4"
          fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="12" cy="17" r="1.5" class="solid"/>
  </svg>`;

const ICON_COLOR = `
  <svg viewBox="0 0 24 24">
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c1.1 0 2-.9 2-2v-1c0-.6.4-1 1-1h2c3.3 0 6-2.7 6-6 0-5.5-4.5-10-10-10z"/>
    <circle cx="7.5" cy="9.5" r="1.5" class="solid"/>
    <circle cx="12" cy="7" r="1.5" class="solid"/>
    <circle cx="16.5" cy="9.5" r="1.5" class="solid"/>
    <circle cx="16" cy="14" r="1" class="solid"/>
    <circle cx="8" cy="14" r="1" class="solid"/>
  </svg>`;

const ICON_FOLD = `
  <svg viewBox="0 0 24 24">
    <polyline points="18 15 12 9 6 15"/>
  </svg>`;

/** Vertical three-dot "more" icon for the layer item overflow menu. */
const ICON_MORE = `
  <svg viewBox="9 3 6 18">
    <circle cx="12" cy="6" r="1.75" fill="currentColor"/>
    <circle cx="12" cy="12" r="1.75" fill="currentColor"/>
    <circle cx="12" cy="18" r="1.75" fill="currentColor"/>
  </svg>`;

/** "Focus on layer" icon — corner brackets (extent) + center dot (aim). */
const ICON_FOCUS = `
  <svg viewBox="0 0 24 24">
    <path d="M3 9 V3 H9 M15 3 H21 V9 M21 15 V21 H15 M9 21 H3 V15"/>
    <circle cx="12" cy="12" r="2.2" class="solid"/>
  </svg>`;

/** "Layer style" glyph — a capital T, the classic type/style mark. The
 *  style panel currently exposes the label dimension; further dimensions
 *  (color, opacity) join the same menu under this same glyph. */
const ICON_STYLE = `
  <svg viewBox="0 0 24 24">
    <path d="M5 4 H19 M12 4 V20"/>
  </svg>`;

export {
  ICON_COLOR,
  ICON_DRAG_HANDLE,
  ICON_EMPTY,
  ICON_FOCUS,
  ICON_FOLD,
  ICON_LAYERS,
  ICON_LINE,
  ICON_MORE,
  ICON_POINT,
  ICON_POLYGON,
  ICON_STYLE,
  ICON_UNKNOWN,
};

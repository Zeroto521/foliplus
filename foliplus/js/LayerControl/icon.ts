/** Layer Control SVG icons. */
export const LAYERS = `
  <svg viewBox="0 0 24 24">
    <polygon points="12 2 22 7 12 12 2 7"/>
    <polygon points="2 11 12 16 22 11"/>
    <polygon points="2 16 12 21 22 16"/>
  </svg>`;

export const DRAG_HANDLE = `
  <svg viewBox="0 0 24 24" class="drag-handle">
    <circle cx="8" cy="6" r="1.5" fill="currentColor"/>
    <circle cx="16" cy="6" r="1.5" fill="currentColor"/>
    <circle cx="8" cy="12" r="1.5" fill="currentColor"/>
    <circle cx="16" cy="12" r="1.5" fill="currentColor"/>
    <circle cx="8" cy="18" r="1.5" fill="currentColor"/>
    <circle cx="16" cy="18" r="1.5" fill="currentColor"/>
  </svg>`;

export const POINT = `
  <svg viewBox="4 4 16 16">
    <circle cx="12" cy="12" r="6"/>
  </svg>`;

export const LINE = `
  <svg viewBox="2 2 22 20">
    <path d="M4 20 L10 6 L16 18 L22 4"/>
  </svg>`;

export const POLYGON = `
  <svg viewBox="1 1 22 22">
    <polygon points="12,3 21,9 18,21 6,21 3,9"/>
  </svg>`;

export const EMPTY = `
  <svg viewBox="2 2 20 20">
    <rect x="4" y="4" width="16" height="16" rx="2" class="dashed"/>
  </svg>`;

export const UNKNOWN = `
  <svg viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="10" class="dashed"/>
    <path d="M9.5 9.5c0-1.5 1-2.5 2.5-2.5s2.5 1 2.5 2.5c0 1.5-2.5 2-2.5 4"
          fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="12" cy="17" r="1.2" class="solid"/>
  </svg>`;

export const COLOR = `
  <svg viewBox="0 0 24 24">
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c1.1 0 2-.9 2-2v-1c0-.6.4-1 1-1h2c3.3 0 6-2.7 6-6 0-5.5-4.5-10-10-10z"/>
    <circle cx="7.5" cy="9.5" r="1.5" class="solid"/>
    <circle cx="12" cy="7" r="1.5" class="solid"/>
    <circle cx="16.5" cy="9.5" r="1.5" class="solid"/>
    <circle cx="16" cy="14" r="1" class="solid"/>
    <circle cx="8" cy="14" r="1" class="solid"/>
  </svg>`;

export const FOLD = `
  <svg viewBox="0 0 24 24">
    <polyline points="18 15 12 9 6 15"/>
  </svg>`;

/** Vertical three-dot "more" icon for the layer item overflow menu (reserved). */
export const MORE = `
  <svg viewBox="9 3 6 18">
    <circle cx="12" cy="6"  r="1.4" fill="currentColor"/>
    <circle cx="12" cy="12" r="1.4" fill="currentColor"/>
    <circle cx="12" cy="18" r="1.4" fill="currentColor"/>
  </svg>`;

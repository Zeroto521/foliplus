// FullscreenControl SVG icons (ES module).
// Imported by `FullscreenControl.js` and bundled by esbuild.
const MAXIMIZE = `
  <svg viewBox="0 0 24 24">
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
  </svg>`;

const MINIMIZE = `
  <svg viewBox="0 0 24 24">
    <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
  </svg>`;

const ZOOM_IN = `
  <svg viewBox="0 0 24 24">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>`;

const ZOOM_OUT = `
  <svg viewBox="0 0 24 24">
    <line x1="5" y1="12" x2="19" y2="12"/>
  </svg>`;

const ROTATE = `
  <svg viewBox="0 0 24 24">
    <path d="M7.5 2h9l4.6 4.6v9l-4.6 4.6h-9L2.9 15.6v-9L7.5 2Zm0 2L4.9 6.6h2.6v9l2.6 2.6h9L21.7 15.6v-9l-2.6-2.6h-9Z"/>
    <rect x="12.75" y="8.5" width="3.5" height="7" rx="0.75"/>
    <path d="M20 12.5h1.5" stroke-linecap="round"/>
    <path d="M3 11.5H1.5" stroke-linecap="round"/>
    <path d="M15.5 6.2 13.9 7.5l1.6 1.3"/><path d="M8.5 17.8l1.6-1.3-1.6-1.3"/>
  </svg>`;

export { MAXIMIZE, MINIMIZE, ROTATE, ZOOM_IN, ZOOM_OUT };

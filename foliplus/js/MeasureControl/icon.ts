const RULER = `
  <svg viewBox="0 0 24 24">
    <g transform="rotate(-45 12 12)">
      <rect x="1" y="7" width="22" height="9" rx="1"/>
      <path d="M5 7v3M9 7v2M13 7v3M17 7v2"/>
    </g>
  </svg>`;

const CIRCLE = `
  <svg viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="9"/>
    <circle cx="12" cy="12" r="1.5" class="solid"/>
  </svg>`;

const POLYGON = `
  <svg viewBox="0 0 24 24">
    <polygon points="12,3 21,9 18,21 6,21 3,9"/>
    <circle cx="12" cy="3" r="1.5" class="solid"/>
    <circle cx="21" cy="9" r="1.5" class="solid"/>
    <circle cx="18" cy="21" r="1.5" class="solid"/>
    <circle cx="6" cy="21" r="1.5" class="solid"/>
    <circle cx="3" cy="9" r="1.5" class="solid"/>
  </svg>`;

const EDIT_NODES = `
  <svg viewBox="0 0 24 24">
    <path d="M12 20h9"/>
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
  </svg>`;

export { CIRCLE, EDIT_NODES, POLYGON, RULER };

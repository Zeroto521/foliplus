// ──────────────────────────────────────────────────────────────────────────────
// Shared SVG Icons for the foliplus runtime.
// These are loaded once per map as part of the shared header. Component-specific
// icons live in each component's own `{Name}.icon.js` file instead.
// ──────────────────────────────────────────────────────────────────────────────

export const LOADING = `<svg class="foliplus-spin" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>`;

export const CLOSE = `
    <svg viewBox="0 0 24 24">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>`;

export const PIN_ICON = `
    <div class="foliplus-pin">
      <svg width="24" height="36" viewBox="0 0 24 36">
        <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24 C24 5.4 18.6 0 12 0z"
            fill="currentColor" stroke="#fff" stroke-width="1.5"/>
      <circle cx="12" cy="12" r="4.5" fill="#fff"/>
      </svg>
    </div>`;

export const LOCATE = `
    <svg viewBox="0 0 24 24">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
      <circle cx="12" cy="9" r="2.5"/>
    </svg>`;

export const GLOBE = `
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10"/>
      <ellipse cx="12" cy="12" rx="4" ry="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
    </svg>`;

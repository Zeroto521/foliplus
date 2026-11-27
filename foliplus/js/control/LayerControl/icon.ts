// control/LayerControl/icon — SVG icon sources for the layer control's rows and buttons.

/** Layer Control SVG icons. */
const ICON_LAYERS = `
  <svg viewBox="0 0 24 24">
    <polygon points="12 2 22 7 12 12 2 7"/>
    <polygon points="2 11 12 16 22 11"/>
    <polygon points="2 16 12 21 22 16"/>
  </svg>`;

/** Group glyph — two overlapping rounded squares (the design's
 *  container-row icon). The back square is drawn as the visible L only, so
 *  nothing has to be masked: a surface-filled front square painted a white
 *  patch that stayed white on a hovered or checked row. Stroke and weight are
 *  inherited from the type-icon family rule (currentColor,
 *  --foliplus-stroke-icon) so the glyph reads at the same weight as the
 *  point/line/polygon icons. */
const ICON_GROUP = `
  <svg viewBox="0 0 24 24">
    <path d="M15 9 V7 A2 2 0 0 0 13 5 H7 A2 2 0 0 0 5 7 V13 A2 2 0 0 0 7 15 H9"/>
    <rect x="9" y="9" width="10" height="10" rx="2"/>
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
    <polyline points="9 6 15 12 9 18"/>
  </svg>`;

/** "Expand all" glyph — two chevrons pointing down: the tree opens downward.
 *  Distinct from ICON_FOLD (the single row chevron) so the two role-menu
 *  entries cannot read as the same action. */
const ICON_EXPAND_ALL = `
  <svg viewBox="0 0 24 24">
    <polyline points="7 5 12 10 17 5"/>
    <polyline points="7 13 12 18 17 13"/>
  </svg>`;

/** "Collapse all" glyph — two chevrons pointing up: the tree closes upward. */
const ICON_COLLAPSE_ALL = `
  <svg viewBox="0 0 24 24">
    <polyline points="7 11 12 6 17 11"/>
    <polyline points="7 19 12 14 17 19"/>
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

/** "Layer filter" glyph — a funnel (the classic filter mark). */
const ICON_FILTER = `
  <svg viewBox="0 0 24 24">
    <path d="M3 5 H21 L14 13 V20 L10 18 V13 Z"/>
  </svg>`;

/** Folder glyph — a closed folder with a rounded tab. Fixed per folder row
 *  (does not change with the fold state; the fold arrow is the single source).
 *
 *  Drawn in the same language as the container glyph: 2px corner radius, a
 *  tab that curves into the body instead of meeting it at a sharp diagonal,
 *  and the body inset from the 24-box edge so it reads at the same optical
 *  weight as the point/line/polygon icons. */
const ICON_FOLDER = `
  <svg viewBox="0 0 24 24">
    <path d="M3.5 8 A2.5 2.5 0 0 1 6 5.5 H9.3 A2 2 0 0 1 10.8 6.1 L12.1 7.5 H18 A2.5 2.5 0 0 1 20.5 10 V16 A2.5 2.5 0 0 1 18 18.5 H6 A2.5 2.5 0 0 1 3.5 16 Z"/>
  </svg>`;

export {
  ICON_COLLAPSE_ALL,
  ICON_COLOR,
  ICON_GROUP,
  ICON_EXPAND_ALL,
  ICON_DRAG_HANDLE,
  ICON_EMPTY,
  ICON_FILTER,
  ICON_FOCUS,
  ICON_FOLD,
  ICON_FOLDER,
  ICON_LAYERS,
  ICON_LINE,
  ICON_MORE,
  ICON_POINT,
  ICON_POLYGON,
  ICON_STYLE,
  ICON_UNKNOWN,
};

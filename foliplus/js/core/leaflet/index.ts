// Leaflet-touching shared modules — the Leaflet-facing side of the shared
// layer. Kept out of platform/ so the platform layer stays DOM/map-pure.
export {
  DEL_ICON_CHAR,
  DEL_ICON_MARKER_ANCHOR,
  DEL_ICON_SELECTOR,
  DEL_ICON_Z_OFFSET,
  attachDelClick,
  bindDelIconToPopup,
  hideDelIcons,
  buildDelIcon,
  toggleDelIcon,
} from "./delicon.js";
export { mountDelIcon } from "./deliconMount.js";
export { cancelMapPaneTranslate } from "./domAdapter.js";
export { bindMapEvents, unbindMapEvents } from "./mapEvent.js";
export type { MapEventHandlers } from "./type.js";
export { attachPanel, bindPanelPress, createPanel } from "./panelController.js";
export type { Dismiss, PanelController, PanelSpec } from "./panelController.js";
export {
  ROW_PANEL_EDGE,
  ROW_PANEL_MIN_HEIGHT,
  adjustPanelZIndex,
  bindFoldToggle,
  bindMapSync,
  bindOutsideCollapse,
  bindPanelToggle,
  createFoldControl,
  createPanelControl,
  createPanelHeader,
  createRowPanel,
  pinRowPanel,
  unpinRowPanel,
} from "./panel.js";
export {
  applyIconToLeaves,
  applyIconColorToLeaves,
  applyMarkerColorToLeaves,
  authorGlyphName,
  authorGlyphPrefix,
  buildMarkerIcon,
  captureAuthorIcon,
  isIconLeaf,
  parseColorAlpha,
  composeColorAlpha,
  resetIconLeaves,
} from "./markerIcon.js";
export type { AuthorGlyph } from "./markerIcon.js";
export {
  PICKER_GLYPHS,
  glyphAvailable,
  glyphHtml,
  isGlyphSyntax,
  resolveGlyph,
} from "./glyphSource.js";
export {
  HIDDEN_CLASS,
  bindControlZoomRange,
  intersectsMapZoom,
  isZoomRange,
  readZoomRange,
  unreachableZoomRange,
  unusableZoomRange,
} from "./zoomRange.js";

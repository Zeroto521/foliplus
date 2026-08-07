// FullscreenControl constants — CSS class names.
const CLASSES = {
  PSEUDO_FULLSCREEN: "leaflet-pseudo-fullscreen",
  TOOL_BTN: "foliplus-tool-btn",
  FULLSCREEN_BAR: "foliplus-fullscreen-bar",
  ZOOM_IN: "foliplus-zoom-in",
  ZOOM_OUT: "foliplus-zoom-out",
  FS_TOGGLE: "foliplus-fullscreen-toggle",
  HIDDEN: "foliplus-hidden",
};

const containerId = (name, position) => `${name}_${position}_container`;

export { CLASSES, containerId };

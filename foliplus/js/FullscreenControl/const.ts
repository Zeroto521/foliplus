// FullscreenControl constants — CSS class names.
const CLASSES = {
  PSEUDO_FULLSCREEN: "leaflet-pseudo-fullscreen",
  TOOL_BTN: "foliplus-tool-btn",
  ZOOM_IN: "foliplus-zoom-in",
  ZOOM_OUT: "foliplus-zoom-out",
  TOGGLE: "foliplus-fullscreen-toggle",
  HIDDEN: "foliplus-hidden",
};

const containerId = (name: string, position: string) => `${name}_${position}_container`;

export { CLASSES, containerId };

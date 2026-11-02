// FullscreenControl constants — CSS class names.
import { generateId } from "#core/component.js";
import { PSEUDO_FULLSCREEN_CLASS } from "#core/fullscreen.js";

const CLASSES = {
  PSEUDO_FULLSCREEN: PSEUDO_FULLSCREEN_CLASS,
  TOOL_BTN: "foliplus-tool-btn",
  ZOOM_IN: "foliplus-zoom-in",
  ZOOM_OUT: "foliplus-zoom-out",
  TOGGLE: "foliplus-fullscreen-toggle",
  HIDDEN: "foliplus-hidden",
};

const containerId = (name: string, position: string) =>
  generateId(name, `${position}_container`);

export { CLASSES, containerId };

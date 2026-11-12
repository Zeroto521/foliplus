// FullscreenControl constants — CSS class names. foliplus-hidden is the
// shared panel vocabulary (ui/panelClassName), not a component class.
import { generateId } from "#core/lifecycle/index.js";
import { PSEUDO_FULLSCREEN_CLASS } from "#platform/fullscreen.js";

const CLASSES = {
  PSEUDO_FULLSCREEN: PSEUDO_FULLSCREEN_CLASS,
  TOOL_BTN: "foliplus-tool-btn",
  ZOOM_IN: "foliplus-zoom-in",
  ZOOM_OUT: "foliplus-zoom-out",
  TOGGLE: "foliplus-fullscreen-toggle",
};

const containerId = (name: string, position: string) =>
  generateId(name, `${position}_container`);

export { CLASSES, containerId };

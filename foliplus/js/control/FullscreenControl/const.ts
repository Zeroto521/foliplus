// FullscreenControl constants — CSS class names. foliplus-hidden and
// foliplus-tool-btn are the shared panel vocabulary (ui/panelClassName),
// not component classes.
import { generateId } from "#core/lifecycle/index.js";
import { PSEUDO_FULLSCREEN_CLASS } from "#platform/fullscreen.js";

const CLASSES = {
  PSEUDO_FULLSCREEN: PSEUDO_FULLSCREEN_CLASS,
  ZOOM_IN: "foliplus-zoom-in",
  ZOOM_OUT: "foliplus-zoom-out",
  TOGGLE: "foliplus-fullscreen-toggle",
  /** The fullscreen bar shell (the fold container that holds the zoom buttons). */
  FULLSCREEN_BAR: "foliplus-fullscreen-bar",
};

const containerId = (name: string, position: string) =>
  generateId(name, `${position}_container`);

export { CLASSES, containerId };

// FullscreenControl constants — CSS class names.
import { generateId } from "#core/component.js";

const CLASSES = {
  PSEUDO_FULLSCREEN: "leaflet-pseudo-fullscreen",
  TOOL_BTN: "foliplus-tool-btn",
  ZOOM_IN: "foliplus-zoom-in",
  ZOOM_OUT: "foliplus-zoom-out",
  TOGGLE: "foliplus-fullscreen-toggle",
  HIDDEN: "foliplus-hidden",
  // Crossfade scrim, mounted on the map container by anim.ts.
  DIM: "foliplus-dim",
  // Toggled on the map container; sets scrim opacity to 1 (full --dim-color).
  DIM_ACTIVE: "foliplus-dim-active",
};

const containerId = (name: string, position: string) =>
  generateId(name, `${position}_container`);

export { CLASSES, containerId };
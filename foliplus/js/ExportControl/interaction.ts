// ExportControl interaction — keyboard + mouse event registration.
import { ensureInteraction } from "#core/interaction.js";
import * as CONST from "./const.js";
import type { ExportManager } from "./manager.js";

// Keys that confirm / reset / nudge the crop box. They require map container
// focus (so typing into other inputs elsewhere doesn't move the box) and are
// all routed through onKeyDown.
const CROP_KEYS = ["Enter", "r", "R", ...CONST.NUDGE_KEYS];

const registerInteractions = (mgr: ExportManager): (() => void) => {
  const im = ensureInteraction(mgr.map);
  const container = mgr.map.getContainer();

  // All shortcuts registered under a single component name so the returned
  // cleanup function unregisters them all at once when the crop box is removed.
  return im.register(CONF.name, [
    // Escape: global — dismiss crop box from anywhere.
    { key: "Escape", handler: e => mgr.onKeyDown(e as KeyboardEvent) },
    // Enter / R / arrows: container-bound, routed through onKeyDown.
    ...CROP_KEYS.map(key => ({
      key,
      container,
      handler: (e: Event) => mgr.onKeyDown(e as KeyboardEvent),
    })),
    // Arrow keyup: restore the box transition that nudging suppressed (its
    // default transition makes repeated nudges chase the key instead of
    // tracking it). Container-bound like the keydown above.
    ...CONST.NUDGE_KEYS.map(key => ({
      key,
      event: "keyup",
      container,
      handler: (e: Event) => mgr.onKeyUp(e as KeyboardEvent),
    })),
  ]);
};

const registerDrag = (mgr: ExportManager): (() => void) => {
  return ensureInteraction(mgr.map).register(`${CONF.name}-drag`, [
    { event: "mousemove", handler: (e: Event) => mgr.onMouseMove(e as MouseEvent) },
    {
      event: "mouseup",
      handler: () => {
        mgr.onMouseUp();
      },
    },
  ]);
};

const registerCropMouseDown = (
  mgr: ExportManager,
  element: HTMLElement,
): (() => void) => {
  return ensureInteraction(mgr.map).register(`${CONF.name}-crop`, [
    {
      event: "mousedown",
      element,
      handler: (e: Event) => mgr.onMouseDown(e as MouseEvent),
    },
  ]);
};

export { registerInteractions, registerDrag, registerCropMouseDown };

// ExportControl interaction — keyboard + mouse event registration.
import { ensureInteraction } from "#core/interaction.js";
import type { ExportManager } from "./manager.js";

const registerInteractions = (mgr: ExportManager): (() => void) => {
  const im = ensureInteraction(mgr.map);
  const container = mgr.map.getContainer();
  // All shortcuts registered under a single component name so the returned
  // cleanup function unregisters them all at once when the crop box is removed.
  return im.register(CONF.name, [
    // Escape: global — dismiss crop box from anywhere.
    // Bail out when document is in fullscreen so the browser handles
    // exit-fullscreen natively (JS cannot intercept Esc in fullscreen).
    {
      key: "Escape",
      handler: e => {
        if (document.fullscreenElement) return;
        mgr.onKeyDown(e as KeyboardEvent);
      },
    },
    // Enter / Ctrl+Z / Ctrl+Shift+Z: require map container focus
    {
      key: "Enter",
      container,
      handler: e => mgr.onKeyDown(e as KeyboardEvent),
    },
    {
      key: "z",
      ctrl: true,
      container,
      handler: e => mgr.onKeyDown(e as KeyboardEvent),
    },
    {
      key: "z",
      ctrl: true,
      shift: true,
      container,
      handler: e => mgr.onKeyDown(e as KeyboardEvent),
    },
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

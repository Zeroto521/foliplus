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
    {
      key: "Escape",
      handler: e => mgr.onKeyDown(e as KeyboardEvent),
    },
    // Enter: require map container focus — confirm export / lock crop box
    {
      key: "Enter",
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

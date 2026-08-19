// ExportControl interaction — keyboard + mouse event registration.
import { ensureInteraction } from "#core/interaction.js";
import type { ExportManager } from "./manager.js";

const registerInteractions = (mgr: ExportManager): (() => void) => {
  const im = ensureInteraction(mgr.map);
  const container = mgr.map.getContainer();
  // Escape: global, no container restriction
  im.register(`${CONF.name}-escape`, [
    { key: "Escape", handler: e => mgr.onKeyDown(e as KeyboardEvent) },
  ]);
  // Enter / Ctrl+Z / Ctrl+Shift+Z: require map container focus
  return im.register(
    CONF.name,
    [
      { key: "Enter", handler: e => mgr.onKeyDown(e as KeyboardEvent) },
      { key: "z", ctrl: true, handler: e => mgr.onKeyDown(e as KeyboardEvent) },
      {
        key: "z",
        ctrl: true,
        shift: true,
        handler: e => mgr.onKeyDown(e as KeyboardEvent),
      },
    ],
    container,
  );
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

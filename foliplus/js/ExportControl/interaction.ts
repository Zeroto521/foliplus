// ExportControl interaction — keyboard + mouse event registration.
import { ensureInteraction } from "#core/interaction.js";
import type { ExportManager } from "./manager.js";

const registerInteractions = (mgr: ExportManager): (() => void) => {
  return ensureInteraction(mgr.map).register(
    CONF.name,
    [
      { key: "Escape", handler: e => mgr.onKeyDown(e as KeyboardEvent) },
      { key: "Enter", handler: e => mgr.onKeyDown(e as KeyboardEvent) },
      { key: "z", ctrl: true, handler: e => mgr.onKeyDown(e as KeyboardEvent) },
      {
        key: "z",
        ctrl: true,
        shift: true,
        handler: e => mgr.onKeyDown(e as KeyboardEvent),
      },
    ],
    mgr.map.getContainer(),
  );
};

const registerDrag = (mgr: ExportManager): (() => void) => {
  return ensureInteraction(mgr.map).register(CONF.name + "-drag", [
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
  return ensureInteraction(mgr.map).register(CONF.name + "-crop", [
    {
      event: "mousedown",
      element,
      handler: (e: Event) => mgr.onMouseDown(e as MouseEvent),
    },
  ]);
};

export { registerInteractions, registerDrag, registerCropMouseDown };

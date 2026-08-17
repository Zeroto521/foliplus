// ExportControl interaction — keyboard + mouse event registration.
import { ensureInteraction } from "#core/interaction.js";
import type { ExportManager } from "./manager.js";

/** Register all ExportControl interactions. Returns cleanup function. */
export function registerInteractions(mgr: ExportManager): () => void {
  return ensureInteraction(mgr.map).register(CONF.name, [
    { key: "Escape", handler: () => mgr.onKeyDown({ key: "Escape" } as KeyboardEvent) },
    { key: "Enter", handler: () => mgr.onKeyDown({ key: "Enter" } as KeyboardEvent) },
    { key: "z", ctrl: true, handler: () => mgr.onKeyDown({ key: "z", ctrlKey: true } as KeyboardEvent) },
    { key: "z", ctrl: true, shift: true, handler: () => mgr.onKeyDown({ key: "z", ctrlKey: true, shiftKey: true } as KeyboardEvent) },
  ], mgr.map.getContainer());
}

/** Register drag interactions (mousemove/mouseup on document). Returns cleanup. */
export function registerDrag(mgr: ExportManager): () => void {
  return ensureInteraction(mgr.map).register(CONF.name + "-drag", [
    { event: "mousemove", handler: (e: Event) => mgr.onMouseMove(e as MouseEvent) },
    { event: "mouseup", handler: () => { mgr.onMouseUp(); } },
  ]);
}

/** Register mousedown on a crop box element. Returns cleanup. */
export function registerCropMouseDown(mgr: ExportManager, element: HTMLElement): () => void {
  return ensureInteraction(mgr.map).register(CONF.name, [
    { event: "mousedown", element, handler: (e: Event) => mgr.onMouseDown(e as MouseEvent) },
  ]);
}

// MeasureControl interaction — keyboard + mouse event registration.
import { ensureInteraction } from "#core/interaction.js";
import type { MeasureManager } from "./manager.js";

const registerInteractions = (mgr: MeasureManager): (() => void) => {
  return ensureInteraction(mgr.map).register(CONF.name, [
    { key: "Escape", handler: e => mgr.onKeyDown(e as KeyboardEvent) },
  ]);
};

/** Bind the export toolbar button's click via the shared interaction manager. */
const registerExportClick = (
  mgr: MeasureManager,
  element: HTMLElement,
): (() => void) => {
  return ensureInteraction(mgr.map).register(CONF.name + "-export", [
    { event: "click", element, handler: e => mgr.onExportClick(e) },
  ]);
};

export { registerExportClick, registerInteractions };

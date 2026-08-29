// MeasureControl interaction — keyboard + mouse event registration.
import { ensureInteraction } from "#core/interaction.js";
import type { MeasureManager } from "./manager.js";

const registerInteractions = (mgr: MeasureManager): (() => void) => {
  return ensureInteraction(mgr.map).register(CONF.name, [
    { key: "Escape", handler: e => mgr.onKeyDown(e as KeyboardEvent) },
  ]);
};

/**
 * Register a high-priority Escape so it wins over all container-bound
 * shortcuts (LayerControl/ExportControl) while a measurement is in
 * progress. priority=1 overrides the default 0 that those use.
 * Returns a cleanup function to unregister when the mode ends.
 */
const registerActiveEscape = (mgr: MeasureManager): (() => void) => {
  return ensureInteraction(mgr.map).register(`${CONF.name}-escape-active`, [
    {
      key: "Escape",
      priority: 1,
      handler: () => mgr.clearActiveMode(),
    },
  ]);
};

/** Bind the export toolbar button's click via the shared interaction manager. */
const registerExportClick = (
  mgr: MeasureManager,
  element: HTMLElement,
): (() => void) => {
  return ensureInteraction(mgr.map).register(`${CONF.name}-export`, [
    { event: "click", element, handler: e => mgr.onExportClick(e) },
  ]);
};

export { registerActiveEscape, registerExportClick, registerInteractions };

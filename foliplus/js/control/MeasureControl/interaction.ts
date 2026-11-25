// MeasureControl interaction — keyboard + mouse event registration.
import type { MeasureManager } from "./manager.js";
import { ensureInteraction } from "#core/interaction/index.js";

const registerInteractions = (mgr: MeasureManager): (() => void) => {
  const interaction = ensureInteraction(mgr.map);
  return interaction.register(mgr.config.name, [
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
  const interaction = ensureInteraction(mgr.map);
  return interaction.register(`${mgr.config.name}-escape-active`, [
    {
      key: "Escape",
      priority: 1,
      handler: () => {
        // An in-flight drawing whose geometry is already complete commits on
        // Escape rather than being discarded; its finish path ends the mode
        // itself (clearActiveMode), so we return without clearing again.
        if (mgr.modeInstance?.finishOnExit() === true) return;
        mgr.clearActiveMode();
      },
    },
  ]);
};

/** Bind the export toolbar button's click via the shared interaction manager. */
const registerExportClick = (
  mgr: MeasureManager,
  element: HTMLElement,
): (() => void) => {
  const interaction = ensureInteraction(mgr.map);
  return interaction.register(`${mgr.config.name}-export`, [
    { event: "click", element, handler: e => mgr.onExportClick(e) },
  ]);
};

export { registerActiveEscape, registerExportClick, registerInteractions };

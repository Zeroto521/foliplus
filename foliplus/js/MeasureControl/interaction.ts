// MeasureControl interaction — keyboard shortcut registration.
import { ensureInteraction } from "#core/interaction.js";
import type { MeasureManager } from "./manager.js";

const registerInteractions = (mgr: MeasureManager): (() => void) => {
  return ensureInteraction(mgr.map).register(CONF.name, [
    { key: "Escape", handler: e => mgr.onKeyDown(e as KeyboardEvent) },
  ]);
};

export { registerInteractions };

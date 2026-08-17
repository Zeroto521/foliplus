// MeasureControl interaction — keyboard shortcut registration.
import { ensureInteraction } from "#core/interaction.js";
import type { MeasureManager } from "./manager.js";

/** Register all MeasureControl interactions. Returns cleanup function. */
export function registerInteractions(mgr: MeasureManager): () => void {
  return ensureInteraction(mgr.map).register(CONF.name, [
    { key: "Escape", handler: () => mgr.onKeyDown({ key: "Escape" } as KeyboardEvent) },
  ], mgr.map.getContainer());
}

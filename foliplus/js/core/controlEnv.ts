// core/controlEnv — shared component entry bootstrap.
// Lives in core (not common) because it depends on the hint icon registry;
// common must stay free of #core imports.
import { requireRuntime } from "#common/guard.js";
import { registerHintIcon } from "./hint.js";

/**
 * Create the standard control environment (runtime guard + hint icon registration).
 * Replaces the boilerplate at the top of every component entry file.
 *
 * @param CONFIG - Component configuration (from IIFE).
 * @param icon - SVG icon string for the hint icon. Optional (ScaleControl omits it).
 */
const createControlEnv = (CONFIG: { name: string }, icon?: string): void => {
  requireRuntime(CONFIG.name);
  if (icon) registerHintIcon(CONFIG.name, icon);
};

export { createControlEnv };

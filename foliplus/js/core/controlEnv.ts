// core/controlEnv — shared component entry bootstrap.
// Lives in core (not common) because it depends on the hint icon registry;
// common must stay free of #core imports.
import { requireRuntime } from "#common/guard.js";
import { registerHintIcon } from "./hint.js";

/**
 * Create the standard control environment (runtime guard + hint icon registration).
 * Replaces the boilerplate at the top of every component entry file.
 *
 * @param CONF - Component configuration (from IIFE).
 * @param icon - SVG icon string for the hint icon. Optional (ScaleControl omits it).
 */
const createControlEnv = (CONF: { name: string }, icon?: string): void => {
  requireRuntime(CONF.name);
  if (icon) registerHintIcon(CONF.name, icon);
};

export { createControlEnv };

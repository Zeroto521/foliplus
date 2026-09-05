// Runtime guard — ensures foliplus runtime is loaded before component init.
// Throws a clear error when runtime is missing, stopping the component early
// rather than letting it fail later at an obscure DOM access.
import { registerHintIcon } from "#core/hint.js";

const requireRuntime = (componentName: string): void => {
  if (!window.foliplus)
    throw new Error(`[${componentName}] foliplus runtime not found, plugin disabled.`);
};

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

export { requireRuntime, createControlEnv };

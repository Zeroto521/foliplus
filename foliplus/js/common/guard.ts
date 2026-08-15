// Runtime guard — ensures foliplus runtime is loaded before component init.
// Throws a clear error when runtime is missing, stopping the component early
// rather than letting it fail later at an obscure DOM access.
import { createTranslator } from "./locale.js";

export const requireRuntime = (componentName: string): void => {
  const foliplus = window.foliplus || {};
  if (!foliplus || typeof foliplus.showHint !== "function")
    throw new Error(`[${componentName}] foliplus runtime not found, plugin disabled.`);
};

/**
 * Create the standard control environment (translator + runtime guard + hint icon).
 * Replaces the 4-line boilerplate at the top of every component entry file.
 *
 * @param CONF - Component configuration (from IIFE).
 * @param icon - SVG icon string for the hint icon. Optional (ScaleControl omits it).
 */
export const createControlEnv = (
  CONF: { name: string },
  icon?: string,
): { _: (key: string) => string; foliplus: Foliplus } => {
  requireRuntime(CONF.name);
  const foliplus = window.foliplus;
  const _ = createTranslator(CONF);
  if (icon) foliplus.registerHintIcon(CONF.name, icon);
  return { _, foliplus };
};

// core/controlEnv — shared component entry bootstrap.
// Lives in core (not common) because it depends on the hint icon registry;
// common must stay free of #core imports.
import { requireRuntime } from "#common/guard.js";
import { LOADING } from "#common/icon.js";
import { registerHintIcon } from "./hint.js";

/**
 * Create the standard control environment (runtime guard + hint icon registration).
 * Replaces the boilerplate at the top of every component entry file.
 *
 * A loading-state hint icon is registered under `<name>-loading`: components
 * show a spinner via `showHint(\`${name}-loading\`, …)` and `hideHint(name)`
 * still clears it through the hint key-prefix match. Both icons go through
 * the sanitize allowlist gate.
 *
 * @param CONF - Component configuration (from IIFE).
 * @param icon - SVG icon string for the hint icon. Optional (ScaleControl omits it).
 */
const createControlEnv = (CONF: { name: string }, icon?: string): void => {
  requireRuntime(CONF.name);
  if (icon) {
    registerHintIcon(CONF.name, icon);
    registerHintIcon(`${CONF.name}-loading`, LOADING);
  }
};

export { createControlEnv };

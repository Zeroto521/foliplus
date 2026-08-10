// Runtime guard — ensures foliplus runtime is loaded before component init.
// Throws a clear error when runtime is missing, stopping the component early
// rather than letting it fail later at an obscure DOM access.
import { HINT_DURATION } from "./hint.js";
import { createTranslator } from "./locale.js";

export const requireRuntime = componentName => {
  const foliplus = window.foliplus || {};
  // The runtime singleton (runtime.min.js) exposes hint + geocode on the
  // global. Pure helpers are statically imported, so check a runtime API.
  if (!foliplus || typeof foliplus.showHint !== "function") {
    throw new Error(`[${componentName}] foliplus runtime not found, plugin disabled.`);
  }
};

/**
 * Guard that the LayerControl (foliplus.LayerAPI) is available.
 * Shows a persistent hint and throws when the required API is missing.
 * Used by components that depend on LayerControl (Export, Heatmap, Measure).
 *
 * @param {string} componentName - CONF.name, used as hint key and error prefix.
 * @param {Function} _ - Translator function (from createTranslator).
 */
export const requireLayerAPI = (componentName, _) => {
  const foliplus = window.foliplus || {};
  if (!foliplus || !foliplus.LayerAPI) {
    const msg = _(`${componentName}.no_layercontrol`);
    foliplus.showHint(componentName, msg, HINT_DURATION.PERSIST);
    throw new Error(`[${componentName}] ${msg}`);
  }
};

/**
 * Create the standard control environment (translator + runtime guard + hint icon).
 * Replaces the 4-line boilerplate at the top of every component entry file.
 *
 * @param {Object} CONF - Component configuration (from IIFE).
 * @param {string} [icon] - SVG icon string for the hint icon. Optional (ScaleControl omits it).
 * @returns {{ _: Function, foliplus: Object }}
 */
export const createControlEnv = (CONF, icon) => {
  requireRuntime(CONF.name);
  const foliplus = window.foliplus;
  const _ = createTranslator(CONF);
  if (icon) foliplus.registerHintIcon(CONF.name, icon);
  return { _, foliplus };
};

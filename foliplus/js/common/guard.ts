// Runtime guard — ensures foliplus runtime is loaded before component init.
// Throws a clear error when runtime is missing, stopping the component early
// rather than letting it fail later at an obscure DOM access.
import { ensureLayerAPI } from "#core/layer/api.js";
import { HINT_DURATION } from "./hint.js";
import { createTranslator } from "./locale.js";

export { ensureLayerAPI };

export const requireRuntime = (componentName: string): void => {
  const foliplus = window.foliplus || {};
  if (!foliplus || typeof foliplus.showHint !== "function")
    throw new Error(`[${componentName}] foliplus runtime not found, plugin disabled.`);
};

/**
 * Guard that the LayerControl (map.foliplus.LayerAPI) is available.
 * Shows a persistent hint and throws when the required API is missing.
 * Used by components that depend on LayerControl (Export, Heatmap, Measure).
 *
 * @param componentName - CONF.name, used as hint key and error prefix.
 * @param _ - Translator function (from createTranslator).
 * @param map - Leaflet map instance (per-map LayerAPI namespace).
 */
export const requireLayerAPI = (
  componentName: string,
  _: (key: string) => string,
  map: L.Map,
): LayerAPI => {
  if (!map.foliplus?.LayerAPI) {
    const msg = _(`${componentName}.no_layercontrol`);
    const foliplus = window.foliplus || {};
    if (foliplus.showHint) foliplus.showHint(componentName, msg, HINT_DURATION.PERSIST);
    throw new Error(`[${componentName}] ${msg}`);
  }
  return map.foliplus.LayerAPI;
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

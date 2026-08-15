// Runtime guard — ensures foliplus runtime is loaded before component init.
// Throws a clear error when runtime is missing, stopping the component early
// rather than letting it fail later at an obscure DOM access.
import { LayerFactory } from "#core/layer/LayerFactory.js";
import { PaneManager } from "#core/layer/PaneManager.js";
import { HINT_DURATION } from "./hint.js";
import { createTranslator } from "./locale.js";

export const requireRuntime = (componentName: string): void => {
  const foliplus = window.foliplus || {};
  // The runtime singleton (runtime.min.js) exposes hint + geocode on the
  // global. Pure helpers are statically imported, so check a runtime API.
  if (!foliplus || typeof foliplus.showHint !== "function")
    throw new Error(`[${componentName}] foliplus runtime not found, plugin disabled.`);
};

/**
 * Ensure that `map.foliplus.LayerAPI` is available, creating a lightweight
 * default if no LayerControl has been added. This lets consumers always
 * call `map.foliplus.LayerAPI.xxx` without null checks — the lightweight
 * version provides createLayers/createCanvas directly; the full version
 * (from LayerControl) adds registry, sorting, and panel integration.
 *
 * The lightweight defaults:
 *   createLayers / createCanvas — fully functional (via LayerFactory)
 *   layers / registerLayer / unregisterLayer / bringLayerToFront — no-op
 *   extractPoints / getLayerPanes / getLayersByType — return empty
 *
 * @param map - Leaflet map instance.
 * @returns The LayerAPI instance (always a valid object).
 */
export const ensureLayerAPI = (map: L.Map): LayerAPI => {
  if (!map.foliplus) map.foliplus = { LayerAPI: null as any };
  if (map.foliplus.LayerAPI) return map.foliplus.LayerAPI;

  // Lightweight LayerAPI — no LayerControl, no registry, no panel.
  // createLayers/createCanvas are fully functional; query methods are no-ops.
  const panes = new PaneManager(map);
  const factory = new LayerFactory({
    map,
    panes,
    registerLayer: (opts) => {
      if (opts.layer && !map.hasLayer(opts.layer)) map.addLayer(opts.layer);
      return null;
    },
    unregisterLayer: () => true,
    bringLayerToFront: () => {},
  });

  map.foliplus.LayerAPI = {
    layers: Object.freeze([]) as any,
    registerLayer: () => null,
    unregisterLayer: () => false,
    bringLayerToFront: () => {},
    createLayers: (opts) => factory.createLayers(opts),
    createCanvas: (opts) => factory.createCanvas(opts),
    extractPoints: () => [],
    getLayerPanes: () => [],
    getLayersByType: () => [],
  };
  return map.foliplus.LayerAPI;
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

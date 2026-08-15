// core/layer/api — LayerAPI facade management.
// ensureLayerAPI creates a lightweight stub when no LayerControl exists;
// requireLayerAPI throws when LayerControl is required (Export/Heatmap).
import { LayerFactory } from "./LayerFactory.js";
import { PaneManager } from "./PaneManager.js";

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
 * Used by components that depend on LayerControl (Export, Heatmap).
 *
 * @param componentName - CONF.name, used as hint key and error prefix.
 * @param _ - Translator function (from createTranslator).
 * @param map - Leaflet map instance (per-map LayerAPI namespace).
 * @returns The LayerAPI instance (throws if missing).
 */
export const requireLayerAPI = (
  componentName: string,
  _: (key: string) => string,
  map: L.Map,
): LayerAPI => {
  if (!map.foliplus?.LayerAPI) {
    const msg = _(`${componentName}.no_layercontrol`);
    const foliplus = window.foliplus || {};
    if (foliplus.showHint)
      foliplus.showHint(componentName, msg, 0); // PERSIST
    throw new Error(`[${componentName}] ${msg}`);
  }
  return map.foliplus.LayerAPI;
};

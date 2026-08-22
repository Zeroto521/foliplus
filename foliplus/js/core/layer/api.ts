// core/layer/api — LayerAPI facade management.
// ensureLayerAPI creates a lightweight stub when no LayerControl exists;
// requireLayerAPI throws when LayerControl is required (Export/Heatmap).
import { ensureHint } from "#core/hint.js";
import { LayerFactory } from "./LayerFactory.js";
import { PaneManager } from "./PaneManager.js";
import type { LayerAPI, LayerInfo } from "./type.js";

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
  // Ensure per-map hint system (creates map.foliplus if needed, idempotent).
  ensureHint(map);
  if (map.foliplus!.LayerAPI) return map.foliplus!.LayerAPI;

  // Lightweight LayerAPI — no LayerControl, no registry, no panel.
  // createLayers/createCanvas are fully functional; query methods are no-ops.
  const panes = new PaneManager(map);
  const factory = new LayerFactory({
    map,
    panes,
    registerLayer: opts => {
      if (opts.layer && !map.hasLayer(opts.layer)) map.addLayer(opts.layer);
      return null;
    },
    unregisterLayer: () => true,
    bringLayerToFront: () => {},
    invalidateType: () => {}, // no registry in the lightweight API
  });

  map.foliplus!.LayerAPI = {
    isLayerControl: false,
    layers: Object.freeze([]) as unknown as LayerInfo[],
    registerLayer: () => null,
    unregisterLayer: () => false,
    bringLayerToFront: () => {},
    createLayers: opts => factory.createLayers(opts),
    createCanvas: opts => factory.createCanvas(opts),
    extractPoints: () => [],
    getLayerPanes: () => [],
    getLayersByType: () => [],
  } satisfies LayerAPI;
  return map.foliplus!.LayerAPI;
};

/**
 * True when the LayerAPI is LayerManager (the real LayerControl), false
 * when it is ensureLayerAPI's lightweight stub.
 *
 * We use a capability assertion rather than trusting the isLayerControl
 * self-report flag: LayerManager exposes `layers` as a getter that
 * delegates to its layerRegistry, while the lightweight stub sets `layers`
 * as a plain frozen empty array (a data property with no getter).
 * Object.getOwnPropertyDescriptor distinguishes the two reliably even if
 * isLayerControl were manually tampered with.
 */
const isRealLayerControl = (api: LayerAPI | undefined): boolean => {
  if (!api) return false;
  // LayerManager defines `layers` as a class getter (prototype property),
  // while the lightweight stub sets it as a plain data property (own).
  // Check both the instance and the prototype chain for the getter.
  const own =
    Object.getOwnPropertyDescriptor(api, "layers") ||
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(api), "layers");
  return !!(own && own.get);
};

/**
 * Guard that a real LayerControl (not ensureLayerAPI's lightweight stub)
 * is present.  Shows a persistent hint and throws when the dependency is
 * missing.  Used by components that hard-depend on LayerControl (Export).
 *
 * We can't just test `map.foliplus?.LayerAPI` — other foliplus subsystems
 * (hint/mode/interaction) install a lightweight LayerAPI stub that is
 * always truthy even when LayerControl was never added.  isRealLayerControl
 * asserts the registry-delegating `layers` getter that only LayerManager
 * has, so the guard only accepts a real LayerControl.
 *
 * @param componentName - CONF.name, used as hint key and error prefix.
 * @param _ - Translator function (from createTranslator).
 * @param map - Leaflet map instance (per-map LayerAPI namespace).
 * @returns The LayerAPI instance (throws if not a real LayerControl).
 */
export const requireLayerAPI = (
  componentName: string,
  _: (key: string) => string,
  map: L.Map,
): LayerAPI => {
  const api = map.foliplus?.LayerAPI;
  if (!isRealLayerControl(api)) {
    const msg = _(`${componentName}.no_layercontrol`);
    if (map.foliplus?.showHint) map.foliplus!.showHint(componentName, msg, 0); // PERSIST
    throw new Error(`[${componentName}] ${msg}`);
  }
  // isRealLayerControl returned true, so `api` is non-null (a real
  // LayerManager).  Use the narrowed local to satisfy TS control-flow.
  return api!;
};

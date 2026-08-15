// core — shared layer-management primitives (pure logic, no CONF/DOM).
// LayerControl composes these via LayerManager; other controls consume the
// LayerAPI facade (map.foliplus.LayerAPI) rather than importing core directly.
export {
  FALLBACK_PANE_PREFIX,
  GEOM_TYPE,
  RECURSION,
  RENDERER_KEY,
  Z_INDEX,
} from "./const.js";
export { findLayer, forEachLayer, forEachLeaf, getGeometryType } from "./util.js";
export { LayerRegistry, type RegisterLayerOpts } from "./LayerRegistry.js";
export { PaneManager } from "./PaneManager.js";

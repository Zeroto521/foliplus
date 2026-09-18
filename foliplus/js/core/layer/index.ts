// core — shared layer-management primitives (pure logic, no CONF/DOM).
// LayerControl composes these via LayerManager; other controls consume the
// LayerAPI facade (map.foliplus.LayerAPI) rather than importing core directly.
export {
  CANVAS_PANE_PREFIX,
  FALLBACK_PANE_PREFIX,
  GEOM_TYPE,
  RECURSION,
  RENDERER_KEY,
  Z_INDEX,
} from "./const.js";
export { LayerFactory } from "./LayerFactory.js";
export { LayerRegistry } from "./LayerRegistry.js";
export { PaneManager } from "./PaneManager.js";
// The Leaflet-private reaches components need; everything else in the adapter
// stays internal to core/layer, and Leaflet's public API is called directly.
export { destroyPane, hasAttachedPath, isGroupLike } from "./leafletAdapter.js";
export {
  findLayer,
  forEachLayer,
  forEachLeaf,
  isLayerInPanes,
  setInteractive,
  suspendMapInteractions,
  getGeometryType,
  countFeatureGeometry,
} from "./util.js";
export { ensureLayerAPI, requireLayerAPI } from "./api.js";
export type {
  CreateCanvasAPI,
  CreateCanvasOpts,
  CreateLayersAPI,
  CreateLayersOpts,
  LabelAwareLayer,
  LayerAPI,
  LayerInfo,
  RegisterLayerOpts,
} from "./type.js";

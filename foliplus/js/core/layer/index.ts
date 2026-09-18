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
// The Leaflet-private surface: components reach panes and layers through these
// instead of the fields themselves (see the module header for why).
export {
  createPane,
  destroyPane,
  hasAttachedPath,
  isGroupLike,
  mapPaneOf,
  paneOf,
} from "./leafletAdapter.js";
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

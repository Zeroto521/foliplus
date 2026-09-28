// core — shared layer-management primitives (pure logic, no CONF/DOM).
// LayerControl composes these via LayerManager; other controls consume the
// LayerAPI facade (map.foliplus.LayerAPI) rather than importing core directly.
export {
  CANVAS_PANE_PREFIX,
  COLOR_PANE_PREFIX,
  FALLBACK_PANE_PREFIX,
  GEOM_TYPE,
  GROUP,
  HIDDEN,
  RECURSION,
  Z_INDEX,
} from "./const.js";
export { ANNOTATION_Z_OFFSET, FOCUS_Z, focusLayerZ, topSlotZ, zFor } from "./z.js";
export { LayerFactory } from "./LayerFactory.js";
export { LayerRegistry } from "./LayerRegistry.js";
// The class, not `type.ts`'s interface of the same name: it is what the manager
// constructs, and its type already carries the surface contract (the interface
// is the `implements` target those members are checked against). Exporting both
// from this barrel would need one of them renamed for no gain.
export { LayerSurface } from "./LayerSurface.js";
export { PaneManager } from "./PaneManager.js";
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
export {
  CLUSTER_CAPABILITIES,
  deriveLayerKind,
  isMarkerCluster,
} from "./util.js";
export type {
  CreateCanvasAPI,
  CreateCanvasOpts,
  CreateColorAPI,
  CreateColorOpts,
  CreateLayersAPI,
  CreateLayersOpts,
  LabelAwareLayer,
  LayerAPI,
  LayerCapabilities,
  LayerCarrier,
  LayerInfo,
  LayerKind,
  PaneHandle,
  PaneRole,
  RegisterLayerOpts,
  ZArgs,
} from "./type.js";

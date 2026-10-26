// core — shared layer-management primitives (pure logic, no CONFIG/DOM).
// LayerControl composes these via LayerController; other controls consume the
// LayerAPI facade (map.foliplus.LayerAPI) rather than importing core directly.
export {
  ANNOTATION_PANE_PREFIX,
  CANVAS_PANE_PREFIX,
  CAP_TIER,
  COLOR_PANE_PREFIX,
  DECLARED_PANE_ROLES,
  DIM,
  FALLBACK_PANE_PREFIX,
  GEOM_TYPE,
  HIDDEN,
  KIND,
  NO_FEATURE_TREE_KINDS,
  PANE_OWNER,
  PANE_ROLE,
  RECURSION,
  ROLE,
  Z_INDEX,
} from "./const.js";
export { sectionOf } from "./role.js";
export type { LayerRole, LayerSection } from "./role.js";
export { ANNOTATION_Z_OFFSET, FOCUS_Z, focusLayerZ, topSlotZ, zFor } from "./z.js";
export { LayerFactory } from "./LayerFactory.js";
export { LayerInfoRegistry } from "./LayerInfoRegistry.js";
// The class, not `type.ts`'s interface of the same name: it is what the manager
// constructs, and its type already carries the surface contract (the interface
// is the `implements` target those members are checked against). Exporting both
// from this barrel would need one of them renamed for no gain.
export { LayerSurface } from "./LayerSurface.js";
export { PaneLedger } from "./PaneLedger.js";
export { PaneManager } from "./PaneManager.js";
export { SurfaceIndex } from "./SurfaceIndex.js";
export {
  findLayer,
  isLayerInPanes,
  paintsAtZoom,
  setInteractive,
  suspendMapInteractions,
  getGeometryType,
  countFeatureGeometry,
} from "./util.js";
export {
  isContainerNode,
  someLeaf,
  walkLeaf,
  walkTree,
  findLeaf,
  findNode,
} from "./walkLeaf.js";
// `isArealStyleLeaf` is the fill walker's leaf predicate. The build's registry
// scan folds any `#core/layer/<file>.js` import into this barrel, so a name
// the barrel does not re-export fails the build loudly rather than shimming to
// `undefined` on `window.foliplus.core.layer`. `FILL_OPT_IN` rides along as
// the public spelling of the cross-realm / third-party fill declaration.
export { FILL_OPT_IN, isArealStyleLeaf } from "./capability.js";
export { ensureLayerAPI, requireLayerAPI } from "./api.js";
export { CLUSTER_CAPABILITIES, deriveLayerKind } from "./util.js";
export { LayerRuntimeStore } from "./LayerRuntimeStore.js";
export { LayerOrder } from "./LayerOrder.js";
export {
  buildLayerSnapshot,
  extractMarkerFields,
  snapshotFromPoints,
} from "./snapshot.js";
export {
  buildFilterModel,
  dropFilterForField,
  dropStaleFilter,
  filterKey,
  filterStep,
  filtersEqual,
  matches,
  matchesValues,
  normalizeEnumValues,
  normalizeFilter,
  parsePersistedFilter,
  parsePersistedFilters,
  pickFilterField,
  restoreFilters,
  revalidateStoredFilter,
  select,
  selectIndices,
  serializedFilters,
  storeFilter,
} from "./filter.js";
export { INTENT, isFillRampConfig, LIVE, STYLE_KEYS } from "./intent.js";
export type { AppliedProjection } from "./LayerRuntimeStore.js";
export type {
  FilterDimension,
  FilterEnumDimension,
  FilterEnumOption,
  FilterRangeDimension,
  LayerFilter,
  LayerFilterModel,
} from "./filter.js";
export type { Projection } from "./type.js";
export type {
  AnnotationConfig,
  FillRampConfig,
  IntentKey,
  IntentRow,
  LayerIntent,
  LayerOverride,
  LoadSource,
  PersistedLayerState,
} from "./intent.js";
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
  LayerDimKey,
  LayerInfo,
  LayerMutation,
  LayerSnapshot,
  LayerKind,
  PaneHandle,
  PaneRole,
  PaneSpec,
  PinnableNode,
  RegisterLayerOpts,
  SnapshotPoint,
  ZArgs,
} from "./type.js";

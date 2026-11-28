// core — shared layer-management primitives (pure logic, no CONFIG/DOM).
// LayerControl composes these via LayerController; other controls consume the
// LayerAPI facade (map.foliplus.LayerAPI) rather than importing core directly.
export {
  LABEL_PANE_PREFIX,
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
  CACHE,
  RECURSION,
  ROLE,
  Z_INDEX,
} from "./const.js";
export { readFeatureFillColors } from "./authorFill.js";
export {
  assertInsideOwnedPanes,
  carrierTargetOf,
  contentPanesOf,
  isMigratableLeaf,
  labelPaneNameOf,
  visibleDomOf,
} from "./carrier.js";
export type { CarrierDecl } from "./carrier.js";
export type { LayerRole } from "./role.js";
export {
  LABEL_Z_OFFSET,
  FOCUS_Z,
  focusLayerZ,
  NATIVE_PANE_Z_OFFSET,
  topSlotZ,
  zFor,
} from "./z.js";
export { LayerFactory } from "./LayerFactory.js";
export { LayerInfoRegistry } from "./LayerInfoRegistry.js";
export {
  folderEntries,
  folderKeysOfRole,
  folderOf,
  groupByFolder,
  nextFolderDefaultName,
  rootLayerEntry,
} from "./folderView.js";
export {
  FOLDER_NAME_MAX,
  normalizeFolderName,
  folderDisplayName,
  folderNameLength,
  folderNameTooLong,
} from "./folderName.js";
export type { FolderView, FolderEntry, FolderMember } from "./folderView.js";
// The class, not `type.ts`'s interface of the same name: it is what the manager
// constructs, and its type already carries the surface contract (the interface
// is the `implements` target those members are checked against). Exporting both
// from this barrel would need one of them renamed for no gain.
export { LayerSurface } from "./LayerSurface.js";
export { PaneLedger } from "./PaneLedger.js";
export { PaneManager } from "./PaneManager.js";
export { SurfaceIndex } from "./SurfaceIndex.js";
export { findLayer, isLayerInPanes, paintsAtZoom } from "./capability.js";
export { getGeometryType, countFeatureGeometry } from "./geometry.js";
export { setInteractive } from "./hitTarget.js";
export {
  isGroupLayer,
  isGroupRow,
  countChildLayersOf,
  countVisibleChildLayers,
} from "./traverse.js";
export {
  drawAlpha,
  getLayerAlpha,
  setLayerAlpha,
  withCanvasLayerAlpha,
  withLayerAlpha,
} from "./canvasAlpha.js";
export {
  isGroupNode,
  someLeaf,
  walkLeaf,
  walkTree,
  findLeaf,
  findNode,
  countChildLayers,
} from "./walkLeaf.js";
export { labelProjection, paintProjection, resolveVisibility } from "./visibility.js";
export type {
  VisibilityDrift,
  VisibilityFactors,
  VisibilityQuery,
  VisibilityReason,
} from "./visibility.js";
// `isArealStyleLeaf` is the fill walker's leaf predicate. The build's registry
// scan folds any `#core/layer/<file>.js` import into this barrel, so a name
// the barrel does not re-export fails the build loudly rather than shimming to
// `undefined` on `window.foliplus.core.layer`. `FILL_OPT_IN` rides along as
// the public spelling of the cross-realm / third-party fill declaration.
export {
  FILL_OPT_IN,
  hasFillLeaf,
  hasMarkerLeaf,
  hasRadiusLeaf,
  hasSetStyleLeaf,
  isArealStyleLeaf,
  isMarkerLeaf,
  isPathLeaf,
  probeLayerCarrier,
} from "./capability.js";
export { readLayerPaint, readLeafPaints } from "./paint.js";
export { observePaint, resolvePaintOpacity } from "./paintObservation.js";
export type { PaintChannel, PaintObservation } from "./paintObservation.js";
export type { LayerPaint, LeafPaint, PaintFace } from "./paint.js";
export { ensureLayerAPI, requireLayerAPI } from "./api.js";
export { CLUSTER_CAPABILITIES, deriveLayerKind } from "./capability.js";
export { LayerRuntimeStore } from "./LayerRuntimeStore.js";
export { defaultDoc, folderKeyOf, groupKeyOf, layerKeyOf } from "./layout/default.js";
export type { LayerDeclaration } from "./layout/default.js";
export { mergeOrderDocs } from "./layout/merge.js";
export {
  childrenOfView,
  presentOf,
  projectBlocks,
  projectRows,
  projectFolderViewOf,
  projectView,
  projectZ,
  resolveOrderView,
  ROLE_ORDER,
} from "./layout/project.js";
export type { OrderView, ProjectedBlock, RoleOf } from "./layout/project.js";
export {
  clearOrderDoc,
  loadOrderDoc,
  orderKeyOf,
  saveOrderDoc,
} from "./layout/persist.js";
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
export {
  STYLE_MODE,
  ICON_KIND,
  INTENT,
  isValueConfig,
  isIconIntent,
  LIVE,
  STYLE_KEYS,
} from "./intent.js";
export type { IconKind } from "./intent.js";
export {
  createFilterStore,
  ensureFilterStore,
  filterStoreKey,
  FILTER_SOURCE,
} from "./filterStore.js";
export type { FilterSourceHost, FilterStore } from "./filterStore.js";
export type { AppliedProjection } from "./LayerRuntimeStore.js";
export type {
  FilterDimension,
  FilterEnumDimension,
  FilterEnumOption,
  FilterRangeDimension,
  LayerFilter,
  LayerFilterModel,
} from "./filter.js";
export { buildFilterFeatures, filterLeafSet } from "./filterFeature.js";
export type {
  FilterFeature,
  FilterFieldValue,
  LayerFilterFeatures,
} from "./filterFeature.js";
export type { Projection } from "./type.js";
export type {
  StyleMode,
  LabelConfig,
  ValueConfig,
  IconIntent,
  IntentKey,
  IntentRow,
  LayerIntent,
  LayerOverride,
  LoadSource,
  PersistedLayerState,
} from "./intent.js";
export type {
  AuthorZoomRange,
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
  LayerStyleSnapshot,
  LayerKind,
  PaneHandle,
  PaneRole,
  PaneSpec,
  PinnableNode,
  RegisterLayerOpts,
  SnapshotPoint,
  StyleProvenance,
  ZArgs,
} from "./type.js";

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
  folderLayoutKey,
  FOLDER_NAME_MAX,
  normalizeFolderName,
  folderDisplayName,
  folderNameLength,
  folderNameTooLong,
  emptyFolderLayout,
  ensureFolderLayout,
  createFolderLayoutManager,
  readFolderLayout,
  writeFolderLayout,
  isFolderLayout,
  mergeDeclaredFolders,
  folderOf,
  folderDisplayNameOf,
  folderKeysOfRole,
  nextFolderDefaultName,
  folderEntries,
  groupByFolder,
  roleBlocks,
  roleOrder,
  fullDisplayOrder,
  freezeRoleOrder,
  moveLayerToRootAt,
  rootLayerEntry,
  seedBlockOrder,
  createFolder,
  renameFolder,
  deleteFolder,
  moveFolder,
  moveLayerToFolder,
  moveLayerToRoot,
  dropLayer,
} from "./folderLayout.js";
export type {
  FolderLayout,
  FolderEntry,
  FolderMember,
  FolderLayoutManager,
} from "./folderLayout.js";
export {
  ARRANGEMENT_VERSION,
  ROLES as ARRANGEMENT_ROLES,
  anchorOfNode,
  fromV2,
  hydrate,
  projectRows,
  projectZ,
  projectLayout,
  ensureLayer,
  moveEntry,
  moveBlock,
  addBlock,
  deleteBlock,
  deleteEmptyBlocks,
  freezeBlockOrder,
  dropLeaf,
  renameBlock,
  leafPosition,
} from "./arrangement.js";
export type {
  Arrangement,
  BlockKind,
  BlockMeta,
  FolderNode,
  GroupNode,
  LayerNode,
  MovePlacement,
  OrderNode,
  ResolvedTree,
} from "./arrangement.js";
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
  isGroupLayer,
  isGroupRow,
  countChildLayersOf,
  countVisibleChildLayers,
} from "./util.js";
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
export type { LayerPaint, LeafPaint, PaintFace } from "./paint.js";
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

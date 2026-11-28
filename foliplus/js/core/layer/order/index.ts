// core/layer/order — the persisted layer-order document engine (pure).
//
// The engine knows only node keys and fractional ranks; the adapter
// (core/layer/layout) builds keys from layer/folder declarations and wires
// the resulting document into persist + resolve + normalizeGroups.
export {
  emptyOrderDoc,
  isOrderDoc,
  orderDepth,
  sanitizeOrderDoc,
  ORDER_MAX_DEPTH,
  folderDocKey,
  folderBareOf,
} from "./doc.js";
export type { OrderDoc, OrderKind, OrderNode } from "./doc.js";
export { ALPHABET, rankAfter, rankBetween, rankFirst, rankStart } from "./rank.js";
export { NODE_KEY_PREFIX, ORDER_KIND } from "./kind.js";
export { childrenOf, leafKeysOf, resolveView, subtreeLeaves } from "./resolve.js";
export type {
  BranchRow,
  OrderRow,
  ParentView,
  Present,
  ResolvedView,
} from "./resolve.js";
export {
  createBranch,
  deleteBlock,
  deleteBranch,
  dropNode,
  moveBefore,
  moveBranch,
  moveInto,
  moveToIndex,
  pruneEmptyFolders,
  renameBlock,
  rerankRoots,
  resetOrder,
  restore,
  stepNode,
  suppress,
} from "./command.js";
export { isNonEmptyString } from "./util.js";

// core/layer/order/command — the single write entry to the order document.
//
// Every mutation is a pure `doc -> doc` function: no code splices the registry or
// rewrites a mirror to change order. The engine knows only node keys and ranks; the
// adapter (core/layer/layout) builds keys from layer/folder declarations and wires
// the resulting document into persist + resolve + normalizeGroups.
import { type OrderDoc, type OrderKind, emptyOrderDoc, isOrderDoc } from "./doc.js";
import { ORDER_KIND } from "./kind.js";
import { rankAfter, rankBetween, rankFirst, rankStart } from "./rank.js";
import { childrenOf } from "./resolve.js";
import type { LayerRole } from "#core/layer/index.js";

/** A rank strictly inside a gap, guarded against equal neighbours (the rank
 *  tie-break is declaration index then id, so a new node joins a tied group at
 *  its end rather than forcing a renumber). */
const rankInGap = (prev: string | null, next: string | null): string => {
  if (prev === null) return rankBetween(null, next);
  if (next === null) return rankBetween(prev, null);
  if (prev === next) return next;
  return rankBetween(prev, next);
};

const clone = (doc: OrderDoc): OrderDoc => ({ nodes: { ...doc.nodes } });

/** The node id a layer key refers to (key starts with "layer:"). */
/** Suppress a layer (hidden: true) — the reversible delete marker. */
const suppress = (doc: OrderDoc, key: string): OrderDoc => {
  const node = doc.nodes[key];
  if (node?.kind !== ORDER_KIND.LAYER) return doc;
  const next = clone(doc);
  next.nodes[key] = { ...node, hidden: true };
  return next;
};

/** Restore a suppressed layer (remove the hidden marker). */
const restore = (doc: OrderDoc, key: string): OrderDoc => {
  const node = doc.nodes[key];
  if (node?.kind !== ORDER_KIND.LAYER) return doc;
  const next = clone(doc);
  if (node.hidden) {
    const n = { ...node };
    delete n.hidden;
    next.nodes[key] = n;
  }
  return next;
};

/** Move a layer node to be the immediate previous sibling of `targetKey`. */
const moveBefore = (doc: OrderDoc, key: string, targetKey: string): OrderDoc => {
  const node = doc.nodes[key];
  const target = doc.nodes[targetKey];
  if (node === undefined || target === undefined || node.kind !== ORDER_KIND.LAYER) {
    return doc;
  }
  const parent = target.parent;
  const siblings = childrenOf(doc, parent);
  // targetKey is always in siblings (a node is a child of its own parent by
  // construction), so the index is never negative.
  const idx = siblings.indexOf(targetKey);
  const prev = idx > 0 ? doc.nodes[siblings[idx - 1]].rank : null;
  const rank = rankInGap(prev, target.rank);
  const next = clone(doc);
  next.nodes[key] = { ...node, parent, rank };
  return next;
};

/** Move a layer node into a container (folder/group); index defaults to the end. */
const moveInto = (
  doc: OrderDoc,
  key: string,
  containerKey: string,
  index?: number,
): OrderDoc => {
  const node = doc.nodes[key];
  const container = doc.nodes[containerKey];
  if (node === undefined || container === undefined || node.kind !== ORDER_KIND.LAYER) {
    return doc;
  }
  if (container.kind === ORDER_KIND.LAYER) return doc;
  const siblings = childrenOf(doc, containerKey).filter(s => s !== key);
  const i =
    index === undefined
      ? siblings.length
      : Math.max(0, Math.min(index, siblings.length));
  const prev = i > 0 ? doc.nodes[siblings[i - 1]].rank : null;
  const next = i < siblings.length ? doc.nodes[siblings[i]].rank : null;
  const rank = rankInGap(prev, next);
  const out = clone(doc);
  out.nodes[key] = { ...node, parent: containerKey, rank };
  return out;
};

/** Move any node (layer, folder, group) to an absolute index within a parent
 *  (null = root). A container move carries its whole subtree. */
const moveNodeToIndex = (
  doc: OrderDoc,
  key: string,
  containerKey: string | null,
  index: number,
): OrderDoc => {
  const node = doc.nodes[key];
  if (node === undefined) return doc;
  if (containerKey !== null && doc.nodes[containerKey] === undefined) return doc;
  const siblings = childrenOf(doc, containerKey).filter(s => s !== key);
  const i = Math.max(0, Math.min(index, siblings.length));
  const prev = i > 0 ? doc.nodes[siblings[i - 1]].rank : null;
  const next = i < siblings.length ? doc.nodes[siblings[i]].rank : null;
  const rank = rankInGap(prev, next);
  const out = clone(doc);
  out.nodes[key] = { ...node, parent: containerKey, rank };
  return out;
};

/** Move a layer node to an absolute index within a parent (null = root). */
const moveToIndex = (
  doc: OrderDoc,
  key: string,
  containerKey: string | null,
  index: number,
): OrderDoc => {
  const node = doc.nodes[key];
  if (node?.kind !== ORDER_KIND.LAYER) return doc;
  return moveNodeToIndex(doc, key, containerKey, index);
};

/** Step any node (layer, folder, group) one position within its own parent's
 *  sibling order. A container step carries its whole subtree. `delta` is +1
 *  (toward the end) or -1 (toward the start). Returns the unchanged doc when
 *  the node is unknown or already at the requested boundary. */
const stepNode = (doc: OrderDoc, nodeKey: string, delta: number): OrderDoc => {
  const node = doc.nodes[nodeKey];
  if (node === undefined) return doc;
  const siblings = childrenOf(doc, node.parent);
  const index = siblings.indexOf(nodeKey);
  if (index < 0) return doc;
  const target = index + delta;
  if (target < 0 || target >= siblings.length) return doc;
  return moveNodeToIndex(doc, nodeKey, node.parent, target);
};

/** Create a folder/group branch at the end of the root level (default position). */
const createBranch = (
  doc: OrderDoc,
  kind: OrderKind,
  key: string,
  name: string,
  role?: LayerRole,
): OrderDoc => {
  if (kind !== ORDER_KIND.FOLDER && kind !== ORDER_KIND.GROUP) return doc;
  if (doc.nodes[key] !== undefined) return doc;
  // A folder branch owns a role (its members'); a group's role derives from the
  // container layer, so it is never stored.
  if (kind === ORDER_KIND.FOLDER && role === undefined) return doc;
  if (kind !== ORDER_KIND.FOLDER && role !== undefined) return doc;
  const siblings = childrenOf(doc, null);
  const prev =
    siblings.length > 0 ? doc.nodes[siblings[siblings.length - 1]].rank : null;
  const rank = siblings.length === 0 ? rankFirst() : rankInGap(prev, null);
  const next = clone(doc);
  next.nodes[key] = { kind, parent: null, rank, name, ...(role ? { role } : {}) };
  return next;
};

/** Rename a folder/group branch (key stays stable). PRESERVES members — only the
 *  branch node's name changes. DIFFERS from deleteEmptyBranch: rename keeps the
 *  subtree intact. */
const renameBranch = (doc: OrderDoc, key: string, name: string): OrderDoc => {
  const node = doc.nodes[key];
  if (
    node === undefined ||
    (node.kind !== ORDER_KIND.FOLDER && node.kind !== ORDER_KIND.GROUP)
  ) {
    return doc;
  }
  const next = clone(doc);
  next.nodes[key] = { ...node, name };
  return next;
};

/** Delete an EMPTY folder/group branch: returns the doc unchanged if any member
 *  still exists (callers must empty it first). DIFFERS from deleteBranch, which
 *  PROMOTES every member to root before removing the branch. */
const deleteEmptyBranch = (doc: OrderDoc, key: string): OrderDoc => {
  const node = doc.nodes[key];
  if (
    node === undefined ||
    (node.kind !== ORDER_KIND.FOLDER && node.kind !== ORDER_KIND.GROUP)
  ) {
    return doc;
  }
  const members = childrenOf(doc, key);
  if (members.length > 0) return doc;
  const next = clone(doc);
  delete next.nodes[key];
  return next;
};

/** Reset to the default document (restores every hidden layer; the default is
 *  derived from the declaration order, not registration order). */
const resetOrder = (defaults: OrderDoc): OrderDoc => {
  return isOrderDoc(defaults) ? clone(defaults) : emptyOrderDoc();
};

/** Move a folder/group branch within the root order (before/after `targetKey`).
 *  The branch node keeps its parent (root) — only the rank changes. A key or
 *  target the doc does not list, or a target that is the branch's own member,
 *  is a no-op (a drag that outlived a rename/delete cannot corrupt the order). */
const moveBranch = (
  doc: OrderDoc,
  key: string,
  targetKey: string,
  after: boolean,
): OrderDoc => {
  const node = doc.nodes[key];
  const target = doc.nodes[targetKey];
  if (node === undefined || target === undefined) return doc;
  if (node.kind !== ORDER_KIND.FOLDER && node.kind !== ORDER_KIND.GROUP) return doc;
  if (key === targetKey) return doc;
  const siblings = childrenOf(doc, null).filter(s => s !== key);
  const tIdx = siblings.indexOf(targetKey);
  if (tIdx < 0) return doc;
  const prev = after
    ? tIdx + 1 < siblings.length
      ? doc.nodes[siblings[tIdx + 1]].rank
      : null
    : tIdx > 0
      ? doc.nodes[siblings[tIdx - 1]].rank
      : null;
  const nextR = after
    ? target.rank
    : tIdx + 1 < siblings.length
      ? doc.nodes[siblings[tIdx + 1]].rank
      : null;
  const rank = rankBetween(prev, nextR);
  const out = clone(doc);
  out.nodes[key] = { ...node, rank };
  return out;
};

/** Delete a folder/group branch: promote every member to root (in the branch's
 *  slot) and remove the branch. Members keep their relative order. */
const deleteBranch = (doc: OrderDoc, key: string): OrderDoc => {
  const node = doc.nodes[key];
  if (node === undefined) return doc;
  const siblings = childrenOf(doc, null);
  const fIdx = siblings.indexOf(key);
  const prevRoot = fIdx > 0 ? doc.nodes[siblings[fIdx - 1]].rank : null;
  const nextRoot =
    fIdx >= 0 && fIdx + 1 < siblings.length ? doc.nodes[siblings[fIdx + 1]].rank : null;
  const members = childrenOf(doc, key);
  const out = clone(doc);
  delete out.nodes[key];
  let boundary = prevRoot;
  for (const m of members) {
    const rank = rankBetween(boundary, nextRoot);
    out.nodes[m] = { ...out.nodes[m], parent: null, rank };
    boundary = rank;
  }
  return out;
};

/** Re-rank the root-level branches to match a target z order (a raw registry
 *  reorder that bypassed the doc must still survive the reload). The tree
 *  structure (folders/groups) is preserved; only root ranks move. */
const rerankRoots = (doc: OrderDoc, zOrder: string[]): OrderDoc => {
  const zPos = new Map(zOrder.map((k, i) => [k, i]));
  const roots = childrenOf(doc, null);
  const rootPos = (key: string): number => {
    const direct = zPos.get(key);
    if (direct !== undefined) return direct;
    // A folder/group branch ranks at its first contained layer's z position.
    const leaves = childrenOf(doc, key);
    let best = Number.MAX_SAFE_INTEGER;
    for (const leaf of leaves) {
      const p = zPos.get(leaf);
      if (p !== undefined && p < best) best = p;
    }
    return best === Number.MAX_SAFE_INTEGER ? -1 : best;
  };
  const orderedRoots = [...roots].sort((a, b) => rootPos(a) - rootPos(b));
  const nodes = { ...doc.nodes };
  let cursor: string | null = null;
  for (const key of orderedRoots) {
    const node = nodes[key];
    if (!node) continue;
    cursor = cursor === null ? rankStart() : rankAfter(cursor);
    nodes[key] = { ...node, rank: cursor };
  }
  return { nodes };
};

/** Remove every EMPTY folder key from one role in one operation. Returns the
 *  doc with the empty folder nodes removed (the unchanged doc when nothing is
 *  empty — the caller reports 0 removed). */
const pruneEmptyFolders = (doc: OrderDoc, role: LayerRole): OrderDoc => {
  const docKeys = Object.keys(doc.nodes).filter(
    k =>
      doc.nodes[k].kind === ORDER_KIND.FOLDER &&
      doc.nodes[k].role === role &&
      childrenOf(doc, k).length === 0,
  );
  if (docKeys.length === 0) return doc;
  const out = clone(doc);
  for (const k of docKeys) delete out.nodes[k];
  return out;
};

/** Drop one node from the doc (the persisted order slot). Returns the doc
 *  without the node; the unchanged doc when the key is absent. */
const dropNode = (doc: OrderDoc, key: string): OrderDoc => {
  if (doc.nodes[key] === undefined) return doc;
  const out = clone(doc);
  delete out.nodes[key];
  return out;
};

export {
  suppress,
  restore,
  moveBefore,
  moveInto,
  moveToIndex,
  stepNode,
  createBranch,
  renameBranch,
  deleteEmptyBranch,
  resetOrder,
  moveBranch,
  deleteBranch,
  rerankRoots,
  pruneEmptyFolders,
  dropNode,
};

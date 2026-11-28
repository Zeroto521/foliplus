// core/layer/order/command — the single write entry to the order document.
//
// Every mutation is a pure `doc -> doc` function: no code splices the registry or
// rewrites a mirror to change order. The engine knows only node keys and ranks; the
// adapter (core/layer/layout) builds keys from layer/folder declarations and wires
// the resulting document into persist + resolve + normalizeGroups.
import { type OrderDoc, type OrderKind, emptyOrderDoc, isOrderDoc } from "./doc.js";
import { ORDER_KIND } from "./kind.js";
import { rankBetween, rankFirst } from "./rank.js";
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

/** Rename a folder/group block (key stays stable). */
const renameBlock = (doc: OrderDoc, key: string, name: string): OrderDoc => {
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

/** Delete an empty folder/group block. Blocks with members must be emptied first. */
const deleteBlock = (doc: OrderDoc, key: string): OrderDoc => {
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

export {
  suppress,
  restore,
  moveBefore,
  moveInto,
  moveToIndex,
  stepNode,
  createBranch,
  renameBlock,
  deleteBlock,
  resetOrder,
};

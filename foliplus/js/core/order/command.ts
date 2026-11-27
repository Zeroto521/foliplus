// core/order/command — the single write entry to the order document.
//
// Every mutation is a pure `doc -> doc` function: no code splices the registry or
// rewrites a mirror to change order. The engine knows only node keys and ranks; the
// adapter (core/layer/layout) builds keys from layer/folder declarations and wires
// the resulting document into persist + resolve + normalizeGroups.
import type { OrderDoc, OrderKind } from "./doc.js";
import { emptyOrderDoc, isOrderDoc } from "./doc.js";
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
const layerIdOf = (key: string): string => key.replace(/^layer:/, "");

/** Suppress a layer (hidden: true) — the reversible delete marker. */
export const suppress = (doc: OrderDoc, key: string): OrderDoc => {
  const node = doc.nodes[key];
  if (node === undefined || node.kind !== "layer") return doc;
  const next = clone(doc);
  next.nodes[key] = { ...node, hidden: true };
  return next;
};

/** Restore a suppressed layer (remove the hidden marker). */
export const restore = (doc: OrderDoc, key: string): OrderDoc => {
  const node = doc.nodes[key];
  if (node === undefined || node.kind !== "layer") return doc;
  const next = clone(doc);
  if (node.hidden) {
    const { hidden: _hidden, ...rest } = node;
    next.nodes[key] = { ...rest };
  }
  return next;
};

/** Move a layer node to be the immediate previous sibling of `targetKey`. */
export const moveBefore = (doc: OrderDoc, key: string, targetKey: string): OrderDoc => {
  const node = doc.nodes[key];
  const target = doc.nodes[targetKey];
  if (node === undefined || target === undefined || node.kind !== "layer") return doc;
  const parent = target.parent;
  const siblings = childrenOf(doc, parent);
  const idx = siblings.indexOf(targetKey);
  if (idx < 0) return doc;
  const prev = idx > 0 ? doc.nodes[siblings[idx - 1]].rank : null;
  const rank = rankInGap(prev, target.rank);
  const next = clone(doc);
  next.nodes[key] = { ...node, parent, rank };
  return next;
};

/** Move a layer node into a container (folder/group); index defaults to the end. */
export const moveInto = (
  doc: OrderDoc,
  key: string,
  containerKey: string,
  index?: number,
): OrderDoc => {
  const node = doc.nodes[key];
  const container = doc.nodes[containerKey];
  if (node === undefined || container === undefined || node.kind !== "layer")
    return doc;
  if (container.kind === "layer") return doc;
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

/** Move a layer node to an absolute index within a parent (null = root). */
export const moveToIndex = (
  doc: OrderDoc,
  key: string,
  containerKey: string | null,
  index: number,
): OrderDoc => {
  const node = doc.nodes[key];
  if (node === undefined || node.kind !== "layer") return doc;
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

/** Create a folder/group block at the end of the root level (default position). */
export const createBlock = (
  doc: OrderDoc,
  kind: OrderKind,
  key: string,
  name: string,
  role?: LayerRole,
): OrderDoc => {
  if (kind !== "folder" && kind !== "group") return doc;
  if (doc.nodes[key] !== undefined) return doc;
  // A folder block owns a role (its members'); a group's role derives from the
  // container layer, so it is never stored.
  if (kind === "folder" && role === undefined) return doc;
  if (kind !== "folder" && role !== undefined) return doc;
  const siblings = childrenOf(doc, null);
  const prev =
    siblings.length > 0 ? doc.nodes[siblings[siblings.length - 1]].rank : null;
  const rank = siblings.length === 0 ? rankFirst() : rankInGap(prev, null);
  const next = clone(doc);
  next.nodes[key] = { kind, parent: null, rank, name, ...(role ? { role } : {}) };
  return next;
};

/** Rename a folder/group block (key stays stable). */
export const renameBlock = (doc: OrderDoc, key: string, name: string): OrderDoc => {
  const node = doc.nodes[key];
  if (node === undefined || (node.kind !== "folder" && node.kind !== "group"))
    return doc;
  const next = clone(doc);
  next.nodes[key] = { ...node, name };
  return next;
};

/** Delete an empty folder/group block. Blocks with members must be emptied first. */
export const deleteBlock = (doc: OrderDoc, key: string): OrderDoc => {
  const node = doc.nodes[key];
  if (node === undefined || (node.kind !== "folder" && node.kind !== "group"))
    return doc;
  const members = childrenOf(doc, key);
  if (members.length > 0) return doc;
  const next = clone(doc);
  delete next.nodes[key];
  return next;
};

/** Reset to the default document (restores every hidden layer; the default is
 *  derived from the declaration order, not registration order). */
export const resetOrder = (defaults: OrderDoc): OrderDoc => {
  return isOrderDoc(defaults) ? clone(defaults) : emptyOrderDoc();
};

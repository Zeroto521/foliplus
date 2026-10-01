// core/layer/walkLeaf — the single source of truth for layer-tree recursion.
//
// Every walk in the codebase (PaneManager.pinTree, capability probes, style
// bag walks, focus/annotation bounds collection, suspendMapInteractions, ...)
// used to follow the same pattern: check `eachLayer`, recurse, fall back to
// the layer registry. This file owns that pattern so no module reimplements
// it. The public surface is four small functions:
//
//   walkLeaf(layer, fn)   — visit every leaf, no short-circuit
//   walkTree(layer, fn)     — visit every node (containers + leaves)
//   findLeaf(layer, pred)   — short-circuit, first leaf for which pred
//                             returns a value
//   someLeaf(layer, pred)   — short-circuit existential
//
// Depth guard (`RECURSION.LAYER_DEPTH`) is applied uniformly so a malformed
// or hostile layer graph cannot recurse to the stack. Children come from
// `eachLayer` when present (Leaflet containers); the layer registry is a
// fallback for window globals and ad-hoc wrappers.
import { internalLayers, isGroupLike } from "../leafletAdapter.js";
import * as CONST from "./const.js";

type UnknownLayer = L.Layer | unknown;

type TreeNode = Parameters<typeof isGroupLike>[0];

const DEFAULT_MAX_DEPTH = CONST.RECURSION.LAYER_DEPTH;

const isContainerNode = (node: UnknownLayer): boolean =>
  node != null && typeof (node as { eachLayer?: unknown }).eachLayer === "function";

/** Enumerate a node's children. `eachLayer` wins (Leaflet containers); the
 *  layer registry is a fallback for window globals and ad-hoc wrappers that
 *  don't implement eachLayer. */
const childrenOf = (node: UnknownLayer): L.Layer[] => {
  if (isContainerNode(node)) {
    const out: L.Layer[] = [];
    (node as L.LayerGroup).eachLayer(c => out.push(c));
    return out;
  }
  const reg = internalLayers(node as { _layers?: Record<string, L.Layer> });
  return reg ? Object.values(reg) : [];
};

/** Exhaustive walk over every leaf. A node that declares a child registry
 *  (even when empty) is never visited as a leaf. */
const walkLeaf = (
  layer: UnknownLayer,
  fn: (leaf: L.Layer) => void,
  depth = 0,
  maxDepth = DEFAULT_MAX_DEPTH,
): void => {
  if (!layer || depth > maxDepth) return;
  if (isGroupLike(layer as TreeNode)) {
    for (const kid of childrenOf(layer)) walkLeaf(kid, fn, depth + 1, maxDepth);
    return;
  }
  fn(layer as L.Layer);
};

/** Visit every node (containers + leaves). `pinTree` uses this because its
 *  pane write touches every node in the tree — the container's own pane is
 *  technically ignored by Leaflet for its children, but writing it keeps the
 *  tree introspectable outside the walk. */
const walkTree = (
  layer: UnknownLayer,
  fn: (node: L.Layer) => void,
  depth = 0,
  maxDepth = DEFAULT_MAX_DEPTH,
): void => {
  if (!layer || depth > maxDepth) return;
  fn(layer as L.Layer);
  if (isGroupLike(layer as TreeNode)) {
    for (const kid of childrenOf(layer)) walkTree(kid, fn, depth + 1, maxDepth);
  }
};

/** Short-circuit: return the first leaf for which `pred` produces a value
 *  (i.e. anything other than `undefined`). Used for "first carrier" and
 *  similar find-one queries. */
const findLeaf = <T>(
  layer: UnknownLayer,
  pred: (leaf: L.Layer) => T | undefined,
  depth = 0,
  maxDepth = DEFAULT_MAX_DEPTH,
): T | undefined => {
  if (!layer || depth > maxDepth) return undefined;
  if (isGroupLike(layer as TreeNode)) {
    for (const kid of childrenOf(layer)) {
      const r = findLeaf<T>(kid, pred, depth + 1, maxDepth);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  return pred(layer as L.Layer);
};

/** Short-circuit existential: `true` when any leaf satisfies `pred`. */
const someLeaf = (
  layer: UnknownLayer,
  pred: (leaf: L.Layer) => boolean,
  depth = 0,
  maxDepth = DEFAULT_MAX_DEPTH,
): boolean => {
  if (!layer || depth > maxDepth) return false;
  if (isGroupLike(layer as TreeNode)) {
    for (const kid of childrenOf(layer)) {
      if (someLeaf(kid, pred, depth + 1, maxDepth)) return true;
    }
    return false;
  }
  return pred(layer as L.Layer);
};

export { isContainerNode, someLeaf, walkLeaf, walkTree, findLeaf };

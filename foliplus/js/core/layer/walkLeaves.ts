// core/layer/walkLeaves — the single source of truth for layer-tree recursion.
//
// Every walk in the codebase (PaneManager.pinTree, capability probes, style
// bag walks, focus/annotation bounds collection, suspendMapInteractions, ...)
// used to follow the same pattern: check `eachLayer`, recurse, fall back to
// the layer registry. This file owns that pattern so no module reimplements
// it. The public surface is four small functions:
//
//   walkLeaves(layer, fn)   — visit every leaf, no short-circuit
//   walkTree(layer, fn)     — visit every node (containers + leaves)
//   findLeaf(layer, pred)   — short-circuit, first leaf for which pred
//                             returns a value
//   someLeaf(layer, pred)   — short-circuit existential
//
// Depth guard (`RECURSION.LAYER_DEPTH`) is applied uniformly so a malformed
// or hostile layer graph cannot recurse to the stack. Children come from
// `eachLayer` when present (Leaflet containers); the layer registry is a
// fallback for window globals and ad-hoc wrappers.
import { internalLayers } from "../leafletAdapter.js";
import * as CONST from "./const.js";

type UnknownLayer = L.Layer | unknown;

const DEFAULT_MAX_DEPTH = CONST.RECURSION.LAYER_DEPTH;

const isContainerNode = (node: UnknownLayer): boolean =>
  node != null && typeof (node as { eachLayer?: unknown }).eachLayer === "function";

/** A node is a container when it declares either `eachLayer` (Leaflet) or
 *  `_layers` (a window-global / wrapper registry) — even when empty. An
 *  empty container is still a container, so `walkLeaves` never visits it as
 *  a leaf. */
const hasChildRegistry = (node: UnknownLayer): boolean => {
  if (node == null) return false;
  const n = node as { eachLayer?: unknown; _layers?: unknown };
  return typeof n.eachLayer === "function" || typeof n._layers !== "undefined";
};

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
const walkLeaves = (
  layer: UnknownLayer,
  fn: (leaf: L.Layer) => void,
  depth = 0,
  maxDepth = DEFAULT_MAX_DEPTH,
): void => {
  if (!layer || depth > maxDepth) return;
  if (hasChildRegistry(layer)) {
    for (const kid of childrenOf(layer)) walkLeaves(kid, fn, depth + 1, maxDepth);
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
  if (hasChildRegistry(layer)) {
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
  if (hasChildRegistry(layer)) {
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
  if (hasChildRegistry(layer)) {
    for (const kid of childrenOf(layer))
      if (someLeaf(kid, pred, depth + 1, maxDepth)) return true;
    return false;
  }
  return pred(layer as L.Layer);
};

export { isContainerNode, someLeaf, walkLeaves, walkTree, findLeaf };

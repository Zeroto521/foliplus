// core/layer/walkLeaf — the single source of truth for layer-tree recursion.
//
// Every walk in the codebase (PaneManager.pinTree, capability probes, style
// bag walks, focus/label bounds collection, suspendMapInteractions, ...)
// used to follow the same pattern: check `eachLayer`, recurse, fall back to
// the layer registry. This file owns that pattern so no module reimplements
// it. The public surface is five small functions:
//
//   walkLeaf(layer, fn)   — visit every leaf, no short-circuit
//   walkTree(layer, fn)     — visit every node (containers + leaves)
//   findLeaf(layer, pred)   — short-circuit, first leaf for which pred
//                             returns a value
//   findNode(layer, pred)   — short-circuit, first NODE (container or leaf)
//   someLeaf(layer, pred)   — short-circuit existential
//
// Depth guard (`RECURSION.LAYER_DEPTH`) is applied uniformly so a malformed
// or hostile layer graph cannot recurse to the stack. Children come from
// `eachLayer` when present (Leaflet containers); the layer registry is a
// fallback for window globals and ad-hoc wrappers.
//
// Node-level vs leaf-level matters: the leaf functions skip containers, so a
// value carried on a container's own options (a folium `foliplus={...}`
// declaration) is invisible to them. `findNode` is `findLeaf`'s
// container-level counterpart — the only node-level short-circuit here.
import * as CONST from "./const.js";
import { internalLayers, isGroupLike } from "#core/leafletAdapter.js";

type UnknownLayer = L.Layer | unknown;

type TreeNode = Parameters<typeof isGroupLike>[0];

const DEFAULT_MAX_DEPTH = CONST.RECURSION.LAYER_DEPTH;

/** A hostile node can throw on an `eachLayer` read, and a walk is a query,
 *  not a write: it must never die for that. Catch the read so a throwing node
 *  simply reads as "no child registry" instead of aborting the caller. */
const isGroupNode = (node: UnknownLayer): boolean => {
  try {
    return (
      node != null && typeof (node as { eachLayer?: unknown }).eachLayer === "function"
    );
  } catch {
    return false;
  }
};

const safeGroupLike = (node: TreeNode): boolean => {
  try {
    return isGroupLike(node);
  } catch {
    return false;
  }
};

/** A node's DIRECT children — no recursion, so the read is O(children) and a
 *  container's own children read the same whether they are leaves or nested
 *  containers. `eachLayer` wins (Leaflet containers); the layer registry is a
 *  fallback for window globals and ad-hoc wrappers that don't implement
 *  eachLayer. */
const directChildrenOf = (node: UnknownLayer): L.Layer[] => {
  try {
    if (isGroupNode(node)) {
      const out: L.Layer[] = [];
      (node as L.LayerGroup).eachLayer(c => out.push(c));
      return out;
    }
    const reg = internalLayers(node as { _layers?: Record<string, L.Layer> });
    return reg ? Object.values(reg) : [];
  } catch {
    return [];
  }
};

/** A node's children to a requested depth, flattened depth-first.
 *
 *  `maxDepth` counts levels: **1 (the default) is the direct children** — the
 *  shallow read every existing caller relies on and the row's own unit; 2 adds
 *  the direct children's own children; and so on. A nested group's children are
 *  therefore opt-in, not silently counted twice: the default answers exactly
 *  what it answered before this parameter existed.
 *
 *  Flatten order is depth-first pre-order (each child, then that child's own
 *  descendants), so a caller that renders or counts the result sees the tree in
 *  its natural order. The walk is capped at `RECURSION.LAYER_DEPTH` so a
 *  malformed or cyclic layer graph cannot recurse to the stack; the same
 *  hostile-node guard as the direct read applies (`eachLayer` / registry reads
 *  never throw).
 */
const childrenOf = (node: UnknownLayer, maxDepth = 1): L.Layer[] => {
  const direct = directChildrenOf(node);
  if (!(maxDepth > 1) || direct.length === 0) return direct;
  const limit = Math.min(Math.floor(maxDepth), DEFAULT_MAX_DEPTH);
  const out: L.Layer[] = [];
  const collect = (kids: L.Layer[], level: number): void => {
    for (const kid of kids) {
      out.push(kid);
      if (level < limit) collect(directChildrenOf(kid), level + 1);
    }
  };
  collect(direct, 1);
  return out;
};

/** How many children a node holds, to a requested depth.
 *
 *  The default is DIRECT children on purpose: the row's "how many sub-layers"
 *  figure is the container's own unit, not a deep feature census. A group
 *  holding two groups reads 2, not the leaves buried inside them — that count
 *  belongs to those children. Pass `maxDepth` (see `childrenOf`) when a
 *  consumer needs the nested census instead. O(children at the requested
 *  depth), so a hostile getter costs one caught read and nothing more.
 */
const countChildLayers = (layer: UnknownLayer, maxDepth = 1): number =>
  layer ? childrenOf(layer, maxDepth).length : 0;

/** Exhaustive walk over every leaf. A node that declares a child registry
 *  (even when empty) is never visited as a leaf. */
const walkLeaf = (
  layer: UnknownLayer,
  fn: (leaf: L.Layer) => void,
  depth = 0,
  maxDepth = DEFAULT_MAX_DEPTH,
): void => {
  if (!layer || depth > maxDepth) return;
  if (safeGroupLike(layer as TreeNode)) {
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
  if (safeGroupLike(layer as TreeNode)) {
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
  if (safeGroupLike(layer as TreeNode)) {
    for (const kid of childrenOf(layer)) {
      const r = findLeaf<T>(kid, pred, depth + 1, maxDepth);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  return pred(layer as L.Layer);
};

/** Short-circuit over every node, root first: containers and leaves alike.
 *  `findLeaf` skips containers, so a value carried on a container's own
 *  options is reachable only here. */
const findNode = <T>(
  layer: UnknownLayer,
  pred: (node: L.Layer) => T | undefined,
  depth = 0,
  maxDepth = DEFAULT_MAX_DEPTH,
): T | undefined => {
  if (!layer || depth > maxDepth) return undefined;
  const own = pred(layer as L.Layer);
  if (own !== undefined) return own;
  if (safeGroupLike(layer as TreeNode)) {
    for (const kid of childrenOf(layer)) {
      const r = findNode<T>(kid, pred, depth + 1, maxDepth);
      if (r !== undefined) return r;
    }
  }
  return undefined;
};

/** Short-circuit existential: `true` when any leaf satisfies `pred`. */
const someLeaf = (
  layer: UnknownLayer,
  pred: (leaf: L.Layer) => boolean,
  depth = 0,
  maxDepth = DEFAULT_MAX_DEPTH,
): boolean => {
  if (!layer || depth > maxDepth) return false;
  if (safeGroupLike(layer as TreeNode)) {
    for (const kid of childrenOf(layer)) {
      if (someLeaf(kid, pred, depth + 1, maxDepth)) return true;
    }
    return false;
  }
  return pred(layer as L.Layer);
};

export {
  childrenOf,
  countChildLayers,
  findLeaf,
  findNode,
  isGroupNode,
  someLeaf,
  walkLeaf,
  walkTree,
};

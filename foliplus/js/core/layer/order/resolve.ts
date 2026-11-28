// core/layer/order/resolve — pure kind-generic projection of the order document.
//
// The resolver knows no LayerRole and no LayerInfo: it walks the document tree
// (layers, folders, groups are all "nodes") and produces rows, leaf keys, and
// blocks. The adapter (core/layer/layout/project) maps node keys to LayerInfo and
// partitions rows by role. The z ladder is a DFS leaf flatten of the whole subtree
// — a block does not change z semantics, it is only panel grouping.
import { ORDER_MAX_DEPTH, type OrderDoc, orderDepth } from "./doc.js";
import { ORDER_KIND } from "./kind.js";
import type { OrderKind } from "./kind.js";

/** A container row: a folder or group header with its subtree leaves. */
interface ContainerRow {
  kind: Exclude<OrderKind, typeof ORDER_KIND.LAYER>;
  key: string;
  name: string;
  depth: number;
  /** Subtree leaf keys in DFS order (nested groups included). */
  children: string[];
}

/** One panel row: a container header or a leaf (layer) row. */
interface OrderRow {
  kind: OrderKind;
  key: string;
  /** 1-based nesting depth (root children = 1). */
  depth: number;
  name?: string;
  hidden?: boolean;
}

/** A resolved role view: rows (panel order), leaves (z ladder), containers. */
interface ResolvedView {
  rows: OrderRow[];
  /** Leaf ids in DFS order — the flat z ladder. */
  leaves: string[];
  containers: ContainerRow[];
}

/** The role-independent view of one parent (root when parent is null). */
interface ParentView {
  /** Child node keys in document order (rank, tie declaration index, tie id). */
  children: string[];
}

/** Sibling rank order: rank lexicographic, tie by declaration index then key. */
const byRank = (doc: OrderDoc, a: string, b: string, order: string[]): number => {
  // Declaration index: the caller may pass an explicit declaration order; else
  // the doc node insertion order (defaultDoc builds nodes in declaration order).
  const na = doc.nodes[a];
  const nb = doc.nodes[b];
  if (na.rank !== nb.rank) return na.rank < nb.rank ? -1 : 1;
  const ia = order.length > 0 ? order.indexOf(a) : Object.keys(doc.nodes).indexOf(a);
  const ib = order.length > 0 ? order.indexOf(b) : Object.keys(doc.nodes).indexOf(b);
  if (ia !== ib) return ia < ib ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
};

/** The ordered children of a parent (root children when parent is null). */
const childrenOf = (
  doc: OrderDoc,
  parent: string | null,
  order: string[] = [],
): string[] => {
  const out: string[] = [];
  for (const key of Object.keys(doc.nodes)) {
    if (doc.nodes[key].parent === parent) out.push(key);
  }
  out.sort((a, b) => byRank(doc, a, b, order));
  return out;
};

/** Whether a node key is present in the registry (present set of leaf ids). */
type Present = (key: string) => boolean;

/** All leaf (layer) keys in the subtree rooted at `key` (DFS preorder). */
const subtreeLeaves = (doc: OrderDoc, key: string): string[] => {
  const node = doc.nodes[key];
  if (node === undefined) return [];
  if (node.kind === ORDER_KIND.LAYER) return [key];
  const out: string[] = [];
  for (const child of childrenOf(doc, key)) {
    out.push(...subtreeLeaves(doc, child));
  }
  return out;
};

/** DFS over the whole document: leaf keys in order, present leaves only. */
const leafKeysOf = (doc: OrderDoc, present: Present): string[] => {
  const out: string[] = [];
  const walk = (parent: string | null, depth: number): void => {
    for (const child of childrenOf(doc, parent)) {
      if (orderDepth(doc, child) > ORDER_MAX_DEPTH) continue;
      const node = doc.nodes[child];
      if (node.kind === ORDER_KIND.LAYER) {
        if (present(child)) out.push(child);
      } else {
        walk(child, depth + 1);
      }
    }
  };
  walk(null, 1);
  return out;
};

/** Project the document into rows + leaves + containers for one role partition. */
const resolveView = (doc: OrderDoc, present: Present): ResolvedView => {
  const rows: OrderRow[] = [];
  const leaves: string[] = [];
  const containers: ContainerRow[] = [];
  const walk = (parent: string | null, depth: number): void => {
    for (const child of childrenOf(doc, parent)) {
      if (orderDepth(doc, child) > ORDER_MAX_DEPTH) continue;
      const node = doc.nodes[child];
      if (node.kind === ORDER_KIND.LAYER) {
        if (present(child)) {
          rows.push({ kind: ORDER_KIND.LAYER, key: child, depth, hidden: node.hidden });
          leaves.push(child);
        }
      } else {
        const blockLeaves = subtreeLeaves(doc, child);
        rows.push({
          kind: node.kind as Exclude<OrderKind, typeof ORDER_KIND.LAYER>,
          key: child,
          depth,
          name: node.name,
        });
        containers.push({
          kind: node.kind as Exclude<OrderKind, typeof ORDER_KIND.LAYER>,
          key: child,
          name: node.name ?? "",
          depth,
          children: blockLeaves,
        });
        walk(child, depth + 1);
      }
    }
  };
  walk(null, 1);
  return { rows, leaves, containers };
};

export type { ContainerRow, OrderRow, ResolvedView, ParentView, Present };

export { childrenOf, subtreeLeaves, leafKeysOf, resolveView };

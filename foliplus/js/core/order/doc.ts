// core/order/doc — the persisted layer-order document model.
//
// A document is a sparse tree of nodes (layers, folders, groups) keyed by a stable
// node key. It is the single persisted intent record (localStorage: layer_order);
// default order, user moves, grouping and hiding are all projections of it. There is
// no version field and no migrator: an unknown or incomplete shape fails isOrderDoc
// and the caller falls back to the default document.
import { isNonEmptyString } from "#core/order/util.js";

export type OrderKind = "layer" | "folder" | "group";

/** One node of the order document. `name` is only set on folder/group nodes. */
export interface OrderNode {
  kind: OrderKind;
  /** Parent node key; null means the role root level. */
  parent: string | null;
  /** Fractional sibling rank (lexicographic order within the same parent). */
  rank: string;
  /** Display name (folder/group only; a folder key is stable under rename). */
  name?: string;
  /** User-hidden (suppressed) layer marker; reversible. */
  hidden?: true;
}

/** The persisted layer-order document. */
export interface OrderDoc {
  nodes: Record<string, OrderNode>;
}

/** Maximum nesting depth: root -> block -> sub-block/leaf (design §4.3). */
export const ORDER_MAX_DEPTH = 3;

const KINDS: readonly OrderKind[] = ["layer", "folder", "group"];

/** An empty document (merge with defaults yields the default order). */
export const emptyOrderDoc = (): OrderDoc => ({ nodes: {} });

/** True when `value` is a syntactically valid node. */
const isOrderNode = (value: unknown): value is OrderNode => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.kind !== "string" || !KINDS.includes(v.kind as OrderKind)) return false;
  if (v.parent !== null && typeof v.parent !== "string") return false;
  if (typeof v.rank !== "string" || v.rank.length === 0) return false;
  if (v.name !== undefined && typeof v.name !== "string") return false;
  if (v.hidden !== undefined && v.hidden !== true) return false;
  return true;
};

/** Depth of a node (root children = depth 1). Returns 0 for an unknown key. */
export const orderDepth = (doc: OrderDoc, key: string): number => {
  let depth = 0;
  let cur: string | null = key;
  const seen = new Set<string>();
  while (cur !== null) {
    if (seen.has(cur)) return 0;
    seen.add(cur);
    const node: OrderNode | undefined = doc.nodes[cur];
    if (node === undefined) return 0;
    depth += 1;
    cur = node.parent;
  }
  return depth;
};

/** Strict structural predicate. False on kind/parent/cycle/depth violations; the
 *  caller drops the document wholesale and rebuilds the default. */
export const isOrderDoc = (value: unknown): value is OrderDoc => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.nodes !== "object" || v.nodes === null) return false;
  const nodes = v.nodes as Record<string, unknown>;
  const keys = Object.keys(nodes);
  if (keys.length === 0) return true;
  for (const k of keys) {
    if (!isNonEmptyString(k)) return false;
    if (!isOrderNode(nodes[k])) return false;
  }
  for (const k of keys) {
    const node = nodes[k] as OrderNode;
    if (node.parent !== null && !(node.parent in nodes)) return false;
    if (orderDepth({ nodes: nodes as Record<string, OrderNode> }, k) === 0)
      return false;
  }
  return true;
};

/** Repair a document: drop subtrees deeper than the depth cap (console.warn) and
 *  return it; return null when the shape is structurally invalid (kind/parent/cycle)
 *  and the caller must fall back to the default document. */
export const sanitizeOrderDoc = (value: unknown): OrderDoc | null => {
  if (!isOrderDoc(value)) return null;
  const doc: OrderDoc = { nodes: { ...value.nodes } };
  // Drop nodes whose depth exceeds the cap (subtree drop, design §4.3).
  const drop = new Set<string>();
  for (const k of Object.keys(doc.nodes)) {
    if (orderDepth(doc, k) > ORDER_MAX_DEPTH) drop.add(k);
  }
  if (drop.size > 0) {
    console.warn(
      `[layer-order] dropping ${drop.size} subtree(s) deeper than ${ORDER_MAX_DEPTH}`,
    );
    for (const k of drop) delete doc.nodes[k];
  }
  return doc;
};

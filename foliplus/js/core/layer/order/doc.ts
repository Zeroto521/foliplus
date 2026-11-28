// core/layer/order/doc — the persisted layer-order document model.
//
// A document is a sparse tree of nodes (layers, folders, groups) keyed by a stable
// node key. It is the single persisted intent record (localStorage: layer_order);
// default order, user moves, grouping and hiding are all projections of it. There is
// no version field and no migrator: an unknown or incomplete shape fails isOrderDoc
// and the caller falls back to the default document.
import { ROLE } from "../const.js";
import { NODE_KEY_PREFIX, ORDER_KIND, type OrderKind } from "./kind.js";
import { rankAfter } from "./rank.js";
import { isNonEmptyString } from "./util.js";
import type { LayerRole } from "#core/layer/index.js";

/** One node of the order document. `name` is only set on folder/group nodes. */
interface OrderNode {
  kind: OrderKind;
  /** Parent node key; null means the role root level. */
  parent: string | null;
  /** Fractional sibling rank (lexicographic order within the same parent). */
  rank: string;
  /** Display name (folder/group only; a folder key is stable under rename). */
  name?: string;
  /** User-hidden (suppressed) layer marker; reversible. */
  hidden?: true;
  /** The role a folder block belongs to. Required on folder nodes (an empty
   *  folder must still render in a role segment and do role-aware duplicate
   *  checks); forbidden on layer/group nodes, whose role is the registry's. */
  role?: LayerRole;
}

/** The persisted layer-order document. */
interface OrderDoc {
  nodes: Record<string, OrderNode>;
}

/** Maximum nesting depth: root -> container -> leaf (render contract: a role
 *  contains layers, or one container of layers; the panel cannot render a
 *  third level, so a deeper doc is clamped on load). */
const ORDER_MAX_DEPTH = 2;

const KINDS: readonly OrderKind[] = [
  ORDER_KIND.LAYER,
  ORDER_KIND.FOLDER,
  ORDER_KIND.GROUP,
];

/** An empty document (merge with defaults yields the default order). */
const emptyOrderDoc = (): OrderDoc => ({ nodes: {} });

/** The doc key of a folder block: role-scoped so the same name can exist in
 *  both roles (the old array model was per-role; the doc keeps that by keying
 *  the role into the folder identity). */
const folderDocKey = (role: LayerRole, name: string): string =>
  `${NODE_KEY_PREFIX.FOLDER}${role}:${name}`;

/** The role encoded in a folder doc key, or null when the key is not a folder
 *  block key (a layer key, a bare name, or a malformed folder key). */
const folderRoleOf = (key: string): LayerRole | null => {
  if (!key.startsWith(NODE_KEY_PREFIX.FOLDER)) return null;
  const rest = key.slice(NODE_KEY_PREFIX.FOLDER.length);
  const sep = rest.indexOf(":");
  if (sep < 0) return null;
  const role = rest.slice(0, sep);
  return role === ROLE.OVERLAY || role === ROLE.BASE ? role : null;
};

/** The bare panel-facing name encoded in a folder doc key (\"folder:overlay:roads\"
 *  → \"roads\"). Returns the input unchanged when it is not a folder doc key. */
const folderBareOf = (key: string): string => {
  const role = folderRoleOf(key);
  if (role === null) return key;
  return key.slice(NODE_KEY_PREFIX.FOLDER.length + role.length + 1);
};

/** True when `value` is a syntactically valid node. */
const isOrderNode = (value: unknown): value is OrderNode => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.kind !== "string" || !KINDS.includes(v.kind as OrderKind)) return false;
  if (v.parent !== null && typeof v.parent !== "string") return false;
  if (typeof v.rank !== "string" || v.rank.length === 0) return false;
  if (v.name !== undefined && typeof v.name !== "string") return false;
  if (v.hidden !== undefined && v.hidden !== true) return false;
  const ROLE_VALUES: readonly string[] = [ROLE.OVERLAY, ROLE.BASE];
  if (v.kind === ORDER_KIND.FOLDER) {
    if (typeof v.role !== "string" || !ROLE_VALUES.includes(v.role)) return false;
  } else if (v.role !== undefined) {
    return false;
  }
  return true;
};

/** Depth of a node (root children = depth 1). Returns 0 for an unknown key. */
const orderDepth = (doc: OrderDoc, key: string): number => {
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
const isOrderDoc = (value: unknown): value is OrderDoc => {
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
    if (orderDepth({ nodes: nodes as Record<string, OrderNode> }, k) === 0) {
      return false;
    }
  }
  return true;
};

/** The deepest legal ancestor of `key`: a parent at depth MAX-1 (the leaf
 *  level is depth MAX, so only a depth-(MAX-1) parent may hold children). */
const deepestLegalAncestor = (doc: OrderDoc, key: string): string => {
  let cur: string | null = doc.nodes[key]?.parent ?? null;
  while (cur !== null && orderDepth(doc, cur) > ORDER_MAX_DEPTH - 1) {
    cur = doc.nodes[cur]?.parent ?? null;
  }
  return cur as string;
};

/** The rank after the last child of `parent` (rankFirst when it has none). */
const rankAfterLast = (doc: OrderDoc, parent: string): string => {
  let last: string | null = null;
  for (const cn of Object.values(doc.nodes)) {
    if (cn.parent !== parent) continue;
    if (last === null || cn.rank > last) last = cn.rank;
  }
  return last === null ? "a0" : rankAfter(last);
};

/** Repair a document: clamp any node deeper than the depth cap by promoting its
 *  leaves to the nearest legal container (console.warn) and dropping the
 *  over-deep container itself; return null when the shape is structurally invalid
 *  (kind/parent/cycle) and the caller must fall back to the default document. */
const sanitizeOrderDoc = (value: unknown): OrderDoc | null => {
  if (!isOrderDoc(value)) return null;
  const doc: OrderDoc = { nodes: { ...value.nodes } };
  const overDeep = Object.keys(doc.nodes)
    .filter(k => orderDepth(doc, k) > ORDER_MAX_DEPTH)
    .sort((a, b) => orderDepth(doc, b) - orderDepth(doc, a));
  if (overDeep.length > 0) {
    console.warn(
      `[layer-order] clamped ${overDeep.length} node(s) deeper than ${ORDER_MAX_DEPTH} (leaves promoted to the nearest legal container)`,
    );
    for (const k of overDeep) {
      const node = doc.nodes[k];
      if (node === undefined) continue;
      const legalParent = deepestLegalAncestor(doc, k);
      if (node.kind === ORDER_KIND.LAYER) {
        // A leaf past the cap: reparent to the deepest legal container.
        doc.nodes[k] = {
          ...node,
          parent: legalParent,
          rank: rankAfterLast(doc, legalParent),
        };
      } else {
        // A container past the cap: its leaves were already promoted when they
        // were processed (they are always deeper than the container, so the
        // depth-sorted loop reaches them first); the container is now empty.
        delete doc.nodes[k];
      }
    }
  }
  return doc;
};

export type { OrderKind, OrderNode, OrderDoc };

export {
  ORDER_MAX_DEPTH,
  emptyOrderDoc,
  folderDocKey,
  folderBareOf,
  orderDepth,
  isOrderDoc,
  sanitizeOrderDoc,
};

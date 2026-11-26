// core/layer/arrangement — the ordered-tree model of a role's layer stack.
//
// The single-order refactor: the model, its two pure projections and the
// mutation set. The same order is carried by one tree:
//
//   role → [ block | layer ]
//   block (folder | group) → [ block | layer ]
//
// so a single sequence can produce both the panel's row keys and the z order.
// Stage 1 proved the model is equivalent to today's v2 projections (the
// shadow-parity test); stage 2 wires the tree through the controller and
// removes the v2 migration (`fromV2`) — the persisted shape IS the tree, no
// version field, and an unknown record is dropped and rebuilt as the default.
//
// Boundaries: pure data — no storage, no DOM, no Leaflet. `LayerInfo` is a type
// only, so the module is unit-testable in isolation (same contract as
// folderLayout.ts).
import { ROLE } from "./const.js";
import {
  type FolderLayout,
  normalizeFolderName,
  rootLayerEntry,
} from "./folderLayout.js";
import type { LayerRole } from "./role.js";
import type { LayerInfo } from "./type.js";

/** A block kind. Both are ordered siblings of a role; a folder groups by the
 *  author's/user's folder declaration, a group is a container layer whose
 *  children are its own sub-layers. */
type BlockKind = "folder" | "group";

/** Identity + display metadata for one block. */
interface BlockMeta {
  kind: BlockKind;
  /** The identity key: `normalize(name)` for a folder, the container's layer
   *  id for a group. */
  key: string;
  /** The display spelling (first-seen folder spelling; the container name). */
  name: string;
}

/** A leaf row: exactly one registered layer. */
interface LayerNode {
  kind: "layer";
  id: string;
}

/** A folder block whose children are its members, in panel order. */
interface FolderNode {
  kind: "folder";
  key: string;
  children: OrderNode[];
}

/** A container block (a Leaflet group layer) whose children are its sub-layers. */
interface GroupNode {
  kind: "group";
  key: string;
  children: OrderNode[];
}

/** One node in a role's ordered sequence. */
type OrderNode = LayerNode | FolderNode | GroupNode;

/** The single order source: one record, one write. No version field — the
 *  persisted shape IS the tree; an unknown record is dropped and rebuilt as
 *  the default (see {@link defaultArrangement}). */
interface Arrangement {
  blocks: Record<string, BlockMeta>;
  roles: Record<LayerRole, OrderNode[]>;
}

/** A tree resolved against the live registry: what the projections read. */
interface ResolvedTree {
  blocks: Record<string, BlockMeta>;
  roles: Record<LayerRole, OrderNode[]>;
  /** id → its parent block key, or null for a role-root layer. */
  parentOf: Record<string, string | null>;
  /** Ids the tree still holds but the registry no longer has. They are not
   *  projected: an unregistered layer has no row and no z slot, exactly as the
   *  v2 layout behaves (a member of a dead id simply is not in the registry). */
  orphans: string[];
}

/** The fixed role order the panel and the z projection share: overlays stack
 *  above base layers, and both projections concatenate roles in this order. */
const ROLES: readonly LayerRole[] = [ROLE.OVERLAY, ROLE.BASE];

/** Empty per-role node arrays. */
const emptyRoleNodes = (): Record<LayerRole, OrderNode[]> => ({
  [ROLE.OVERLAY]: [],
  [ROLE.BASE]: [],
});

/** Where a v2 layout puts one layer: at its role root, inside a folder, or
 *  nowhere at all.
 *
 *  `dropped` is the degenerate declaration case, and it is spelled out rather
 *  than folded into `root` because the v2 projection really does drop such a
 *  layer: a non-root layer whose folder normalises to nothing (a
 *  whitespace-only declaration) is neither a root layer (the declaration is
 *  truthy, so `isRootLayer` refuses it) nor a block member (`groupByFolder`
 *  skips a falsy key) — it renders nowhere. Keeping the third case explicit is
 *  what makes the tree equivalent instead of quietly "better". */
type Placement =
  { kind: "root" } | { kind: "folder"; key: string } | { kind: "dropped" };

/** Classify a declared folder spelling: a normalised key, or `dropped` when it
 *  normalises to nothing. */
const placementFrom = (spelling: string): Placement => {
  const key = normalizeFolderName(spelling);
  return key === "" ? { kind: "dropped" } : { kind: "folder", key };
};

/** Resolve one layer's placement: the persisted assignment when the layout has
 *  one, otherwise the author declaration. Mirrors `isRootLayer` + `folderOf`. */
const placementOf = (layout: FolderLayout, info: LayerInfo): Placement => {
  const assigned = layout.members[info.id];
  if (assigned !== undefined) {
    // A materialised root ("") pins the layer at the role root.
    return assigned.folder === "" ? { kind: "root" } : placementFrom(assigned.folder);
  }
  // No declaration at all is a root layer; anything truthy is a folder claim.
  return info.folder ? placementFrom(info.folder) : { kind: "root" };
};

/** Build the default arrangement: every registered layer at its role root, in
 *  registry anchor order, no folders. Used when no persisted tree exists or
 *  when the persisted record is an unknown shape (dropped + rebuilt, not
 *  migrated and not an error). */
/** Build the default arrangement: every registered layer placed by its
 *  author declaration — a declared folder becomes a folder block (children in
 *  registry anchor order, first-seen name), a root declaration or no
 *  declaration becomes a role-root layer. Folder blocks sit at the role tail
 *  (the author's declaration order is not frozen), matching what the v2 seed
 *  materialised before the first user move. Used when no persisted tree
 *  exists or when the persisted record is an unknown shape (dropped +
 *  rebuilt, not migrated and not an error). */
const defaultArrangement = (registryEntries: readonly LayerInfo[]): Arrangement => {
  const roles = emptyRoleNodes();
  const blocks: Record<string, BlockMeta> = {};
  const NO_MEMBERS: FolderLayout["members"] = {};
  for (const info of registryEntries) {
    const placement = placementOf(
      { version: 2, folders: [], order: {}, members: NO_MEMBERS } as FolderLayout,
      info,
    );
    if (placement.kind === "dropped") continue;
    if (placement.kind === "folder") {
      const key = placement.key;
      let folder = roles[info.role].find(
        node => node.kind !== "layer" && node.key === key,
      ) as FolderNode | undefined;
      if (!folder) {
        folder = { kind: "folder", key, children: [] };
        roles[info.role].push(folder);
        blocks[key] ??= { kind: "folder", key, name: info.folder ?? key };
      }
      folder.children.push({ kind: "layer", id: info.id });
      continue;
    }
    roles[info.role].push({ kind: "layer", id: info.id });
  }
  return { blocks, roles };
};

/** Narrow a persisted record to the arrangement shape: a plain object with
 *  `blocks` and `roles` records. Anything else (an unknown shape, a v2
 *  envelope, a non-object) is NOT accepted — the caller drops it and rebuilds
 *  the default. The guard is deliberately shallow (block/nodes are validated
 *  by the projections, which are resilient to a partial record). */
const isArrangementShape = (raw: unknown): raw is Arrangement => {
  if (typeof raw !== "object" || raw === null) return false;
  const record = raw as Record<string, unknown>;
  const blocks = record.blocks as unknown;
  const roles = record.roles as unknown;
  return (
    typeof blocks === "object" &&
    blocks !== null &&
    typeof roles === "object" &&
    roles !== null
  );
};

/** Whether a node already carries `id`. */
const carries = (node: OrderNode, id: string): boolean =>
  node.kind === "layer"
    ? node.id === id
    : node.children.some(child => carries(child, id));

/** The anchor of a node: the smallest registry index among its layers. A node
 *  whose layers are all gone has no anchor (`Infinity`), so it sorts last and
 *  never swallows a late registration. */
const anchorOfNode = (
  node: OrderNode,
  indexById: ReadonlyMap<string, number>,
): number => {
  if (node.kind === "layer") {
    return indexById.get(node.id) ?? Number.POSITIVE_INFINITY;
  }
  let anchor = Number.POSITIVE_INFINITY;
  for (const child of node.children) {
    anchor = Math.min(anchor, anchorOfNode(child, indexById));
  }
  return anchor;
};

/** Record every node's parent block key. */
const indexParents = (
  nodes: readonly OrderNode[],
  parent: string | null,
  parentOf: Record<string, string | null>,
  orphans: string[],
): void => {
  for (const node of nodes) {
    if (node.kind === "layer") {
      parentOf[node.id] = parent;
      continue;
    }
    indexParents(node.children, node.key, parentOf, orphans);
  }
};

/** Resolve a tree against the live registry.
 *
 *  Two gaps have to be closed before projection:
 *
 *  - a layer the registry has but the tree does not (a late registration, a
 *    re-registration after an unregister): inserted as a role-root node at its
 *    anchor, the same "merge by anchor" rule fromV2 used for unlisted entries;
 *  - a layer the tree has but the registry does not: removed from the projected
 *    tree and reported in `orphans`, so nothing renders or prices a dead id
 *    (the id stays in the persisted tree, so a re-registration returns to its
 *    recorded position).
 *
 *  Idempotent: resolving a resolved tree changes nothing.
 *
 *  @param {Arrangement} tree - The persisted tree.
 *  @param {readonly LayerInfo[]} registryEntries - The registry in anchor order.
 *  @returns {ResolvedTree} The tree the projections read.
 */
const hydrate = (
  tree: Arrangement,
  registryEntries: readonly LayerInfo[],
): ResolvedTree => {
  const indexById = new Map(registryEntries.map((info, index) => [info.id, index]));
  const blocks = { ...tree.blocks };
  const orphans: string[] = [];
  const seenOrphan = new Set<string>();
  const roles = emptyRoleNodes();
  for (const role of ROLES) {
    const kept: OrderNode[] = [];
    const keep = (nodes: readonly OrderNode[]): OrderNode[] => {
      const out: OrderNode[] = [];
      for (const node of nodes) {
        if (node.kind === "layer") {
          if (indexById.has(node.id)) out.push(node);
          else if (!seenOrphan.has(node.id)) {
            seenOrphan.add(node.id);
            orphans.push(node.id);
          }
          continue;
        }
        out.push({ ...node, children: keep(node.children) });
      }
      return out;
    };
    kept.push(...keep(tree.roles[role]));
    // Insert the registry's missing layers at their anchor: before the first
    // kept node whose anchor sorts after them.
    registryEntries.forEach((info, index) => {
      if (info.role !== role) return;
      if (kept.some(node => carries(node, info.id))) return;
      let insert = kept.length;
      for (let i = 0; i < kept.length; i += 1) {
        if (anchorOfNode(kept[i], indexById) > index) {
          insert = i;
          break;
        }
      }
      kept.splice(insert, 0, { kind: "layer", id: info.id });
    });
    roles[role] = kept;
  }
  const parentOf: Record<string, string | null> = {};
  for (const role of ROLES) indexParents(roles[role], null, parentOf, orphans);
  return { blocks, roles, parentOf, orphans };
};

/** Project one role's row keys: `role:<r>`, then a block header per block and
 *  its children's rows in order.
 *
 *  This is the sequence a panel renderer walks; a row key is
 *  `role:<r>` | `folder:<r>:<key>` | `group:<r>:<key>` | `layer:<id>`.
 *
 *  @param {ResolvedTree} resolved - The tree to project.
 *  @param {LayerRole} role - The role to project.
 *  @returns {string[]} The role's row keys, header first.
 */
const projectRows = (resolved: ResolvedTree, role: LayerRole): string[] => {
  const rows: string[] = [`role:${role}`];
  const walk = (nodes: readonly OrderNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "layer") {
        rows.push(`layer:${node.id}`);
        continue;
      }
      rows.push(`${node.kind}:${role}:${node.key}`);
      walk(node.children);
    }
  };
  walk(resolved.roles[role]);
  return rows;
};

/** Project the z axis: every leaf's id, overlays first, then base layers.
 *
 *  The registry array should be exactly this sequence; the ordering pass prices
 *  a layer by its index in it (earlier = higher). Roles stay concatenated
 *  (never interleaved) because the z ladder is per role.
 *
 *  @param {ResolvedTree} resolved - The tree to project.
 *  @returns {string[]} The leaf ids in stacking order.
 */
const projectZ = (resolved: ResolvedTree): string[] => {
  const ids: string[] = [];
  const walk = (nodes: readonly OrderNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "layer") ids.push(node.id);
      else walk(node.children);
    }
  };
  for (const role of ROLES) walk(resolved.roles[role]);
  return ids;
};

/** Project one role's display blocks (the panel row sequence): a folder
 *  block with its live members, or a root layer. The ORDER is the tree's
 *  (projectRows); names + members come from the resolved blocks + registry.
 *  This replaces the v2 roleBlocks read for the panel — the tree is the single
 *  order source, so a row can never paint in one place and stack in another. */
const projectBlocks = (
  resolved: ResolvedTree,
  role: LayerRole,
  registryEntries: readonly LayerInfo[],
): Array<
  | { kind: "folder"; key: string; name: string; block: { members: LayerInfo[] } }
  | { kind: "layer"; layer: LayerInfo }
> => {
  const byId = new Map(registryEntries.map(info => [info.id, info]));
  const out: Array<
    | { kind: "folder"; key: string; name: string; block: { members: LayerInfo[] } }
    | { kind: "layer"; layer: LayerInfo }
  > = [];
  for (const node of resolved.roles[role] ?? []) {
    if (node.kind === "layer") {
      const info = byId.get(node.id);
      if (info) out.push({ kind: "layer", layer: info });
      continue;
    }
    const members = node.children
      .filter(child => child.kind === "layer")
      .map(child => byId.get(child.id))
      .filter((info): info is LayerInfo => info !== undefined);
    const name = resolved.blocks[node.key]?.name ?? node.key;
    out.push({ kind: "folder", key: node.key, name, block: { members } });
  }
  return out;
};

/** The role that owns a leaf id, or null when the tree does not hold it. */
const roleOfLeaf = (resolved: ResolvedTree, id: string): LayerRole | null => {
  for (const role of ROLES) {
    if ((resolved.roles[role] ?? []).some(node => carries(node, id))) return role;
  }
  return null;
};

/** Project the resolved tree back into the v2-shaped layout mirror the
 *  controller's folderLayout manager feeds (the derived state: folder
 *  directory, block order, member assignment). This is the inverse of
 *  fromV2, but it is DERIVED — never persisted, never read by the panel or
 *  the registry once they switch to projectRows/projectZ. A group node
 *  mirrors as a folder block (the v2 model has no group kind). */
const projectLayout = (resolved: ResolvedTree): FolderLayout => {
  const folders: { key: string; name: string }[] = [];
  for (const block of Object.values(resolved.blocks)) {
    if (block.kind === "folder") folders.push({ key: block.key, name: block.name });
  }
  const order: Partial<Record<LayerRole, string[]>> = {};
  const members: Record<string, { role: LayerRole; folder: string }> = {};
  for (const role of ROLES) {
    order[role] = (resolved.roles[role] ?? []).map(node =>
      node.kind === "layer" ? rootLayerEntry(node.id) : node.key,
    );
  }
  for (const id of Object.keys(resolved.parentOf)) {
    const parent = resolved.parentOf[id];
    const role = roleOfLeaf(resolved, id);
    if (!role) continue;
    members[id] = { role, folder: parent ?? "" };
  }
  return { version: 2, folders, order, members };
};

/** The container + index of a leaf id in a role's tree, or null when absent.
 *  A root leaf has `container: "root"`; a folder member names its folder key.
 */
const leafPosition = (
  nodes: readonly OrderNode[],
  id: string,
): { container: "root" | { key: string }; index: number } | null => {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.kind === "layer") {
      if (node.id === id) return { container: "root", index: i };
      continue;
    }
    const at = node.children.findIndex(c => c.kind === "layer" && c.id === id);
    if (at !== -1) return { container: { key: node.key }, index: at };
  }
  return null;
};

/** Remove the first node carrying `id` from its container; returns the new
 *  container and whether anything moved. The node may be a root layer or a
 *  folder member; a folder that loses its last member keeps its (empty) block.
 */
const detachLeaf = (nodes: OrderNode[], id: string): [OrderNode[], boolean] => {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.kind === "layer") {
      if (node.id === id) {
        const out = [...nodes];
        out.splice(i, 1);
        return [out, true];
      }
      continue;
    }
    const [children, moved] = detachLeaf(node.children, id);
    if (moved) {
      const out = [...nodes];
      out[i] = { ...node, children };
      return [out, true];
    }
  }
  return [nodes, false];
};

/** Insert a layer node into a container at `index` (clamped); append when
 *  `index` is negative or past the end. */
const insertLeaf = (nodes: OrderNode[], id: string, index: number): OrderNode[] => {
  const out = [...nodes];
  const at = index < 0 || index > out.length ? out.length : index;
  out.splice(at, 0, { kind: "layer", id });
  return out;
};

/** The role-root index of a top-level entry (a block key or `layer:<id>`),
 *  or -1 when the entry is not top-level. */
const topLevelIndex = (nodes: readonly OrderNode[], entry: string): number =>
  nodes.findIndex(node =>
    node.kind === "layer" ? rootLayerEntry(node.id) === entry : node.key === entry,
  );

/** A placement target for a layer move. */
type MovePlacement =
  | { kind: "root"; index?: number; beforeEntry?: string | null }
  | { kind: "folder"; key: string; index: number };

/** Move a layer to a placement in its role. Pure: returns a new tree, or the
 *  same tree when the move is a no-op (the layer already sits where the
 *  placement puts it, or the layer is not in the tree).
 *
 *  - `root` placement: the layer becomes a role-root node at `index` (0..len),
 *    or before `beforeEntry` (a block key / `layer:<id>`), or appended when
 *    `beforeEntry` is null or names nothing.
 *  - `folder` placement: the layer becomes a member of folder `key` at `index`
 *    (within the folder), or appended.
 *
 *  A folder that loses its last member keeps its (empty) block, so the folder
 *  row survives until the user deletes it — the v2 behaviour. The block
 *  directory is untouched.
 */
const moveEntry = (
  tree: Arrangement,
  role: LayerRole,
  id: string,
  placement: MovePlacement,
): Arrangement => {
  const nodes = tree.roles[role] ?? [];
  const [detached, moved] = detachLeaf(nodes, id);
  if (!moved) return tree;
  const roles = { ...tree.roles, [role]: detached };
  if (placement.kind === "root") {
    let index = placement.index ?? detached.length;
    if (placement.beforeEntry !== undefined) {
      const before = placement.beforeEntry;
      if (before === null) index = detached.length;
      else {
        const at = topLevelIndex(detached, before);
        index = at === -1 ? detached.length : at;
      }
    }
    const next = insertLeaf(detached, id, index);
    if (sameNodes(next, detached)) return tree;
    return { ...tree, roles: { ...roles, [role]: next } };
  }
  // Folder placement: find the folder node, insert inside it.
  let placed: OrderNode[] | null = null;
  const withFolder = detached.map(node => {
    if (node.kind === "layer" || node.key !== placement.key) return node;
    placed = insertLeaf(node.children, id, placement.index);
    return { ...node, children: placed };
  });
  if (placed === null) {
    // The folder block does not exist: create it (v2 materialises a folder on
    // the first move into it — createFolder semantics).
    const folderNode: OrderNode = {
      kind: "folder",
      key: placement.key,
      children: [{ kind: "layer", id }],
    };
    const next = [...detached, folderNode];
    const meta: BlockMeta = { kind: "folder", key: placement.key, name: placement.key };
    const blocks = { ...tree.blocks, [placement.key]: meta };
    return { ...tree, roles: { ...roles, [role]: next }, blocks };
  }
  return { ...tree, roles: { ...roles, [role]: withFolder } };
};

/** Add a layer node to a role's tree if the id is not already carried.
 *  A declared folder (non-null) receives the leaf at its tail, materialising
 *  the folder block when absent; otherwise the leaf lands at the role tail.
 *  Pure: returns the same tree when the id is already carried. */
const addLeaf = (
  tree: Arrangement,
  role: LayerRole,
  id: string,
  folder: { key: string; name: string } | null,
  position: "top" | "bottom" = "top",
): Arrangement => {
  const nodes = tree.roles[role] ?? [];
  if (nodes.some(node => carries(node, id))) return tree;
  const leaf: OrderNode = { kind: "layer", id };
  if (folder === null) {
    // A fresh root layer goes on top of its role block (the registration
    // default) unless the caller asks for the bottom; a ranked layer is
    // repositioned to its saved slot afterwards.
    const root = position === "bottom" ? [...nodes, leaf] : [leaf, ...nodes];
    return { ...tree, roles: { ...tree.roles, [role]: root } };
  }
  let found = false;
  const next = nodes.map(node => {
    if (node.kind === "layer" || node.key !== folder.key) return node;
    found = true;
    // A fresh member joins its folder the way the registration default puts a
    // root layer on top: the v2 registry prepended the new layer, and the
    // folder's member order followed the registry, so a new member lands at
    // the top of its folder unless the caller asks for the bottom.
    const children =
      position === "bottom" ? [...node.children, leaf] : [leaf, ...node.children];
    return { ...node, children };
  });
  if (found) return { ...tree, roles: { ...tree.roles, [role]: next } };
  const folderNode: OrderNode = { kind: "folder", key: folder.key, children: [leaf] };
  const meta: BlockMeta = { kind: "folder", key: folder.key, name: folder.name };
  return {
    ...tree,
    roles: { ...tree.roles, [role]: [...nodes, folderNode] },
    blocks: { ...tree.blocks, [folder.key]: meta },
  };
};

/** Reorder a role's ROOT LAYER nodes to the saved-order rank (the legacy
 *  LayerControl order record). Folder/group blocks keep their relative
 *  positions; unranked root layers keep their live order at the block tail.
 *  Pure. `saved` is the role-agnostic id list — each role reads its own ids. */
const applySavedOrder = (
  tree: Arrangement,
  role: LayerRole,
  saved: readonly string[],
): Arrangement => {
  const nodes = tree.roles[role] ?? [];
  if (nodes.length === 0) return tree;
  const rank = new Map(saved.map((id, i) => [id, i]));
  const byRank = (a: OrderNode, b: OrderNode): number => {
    if (a.kind !== "layer" || b.kind !== "layer") return 0;
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra === undefined) return rb === undefined ? 0 : 1;
    if (rb === undefined) return -1;
    return ra - rb;
  };
  const layers = nodes.filter((n): n is LayerNode => n.kind === "layer").sort(byRank);
  let i = 0;
  const next = nodes.map(node => (node.kind === "layer" ? layers[i++] : node));
  return { ...tree, roles: { ...tree.roles, [role]: next } };
};

/** Move a ROOT layer to its saved-order slot (the legacy order record):
 *  before the first registered layer that ranks after it in `saved`, or to
 *  the role tail among root layers when no such neighbour is present yet.
 *  Only root layers are moved (a member inside a folder keeps its folder).
 *  Pure. */
const placeLeafAtSaved = (
  tree: Arrangement,
  role: LayerRole,
  id: string,
  saved: readonly string[],
): Arrangement => {
  const nodes = tree.roles[role] ?? [];
  const at = nodes.findIndex(n => n.kind === "layer" && n.id === id);
  if (at === -1) return tree;
  const target = saved.indexOf(id);
  if (target === -1) return tree;
  let insert = -1;
  for (let i = target + 1; i < saved.length; i += 1) {
    const nid = saved[i];
    const idx = nodes.findIndex(n => n.kind === "layer" && n.id === nid);
    if (idx !== -1) {
      insert = idx;
      break;
    }
  }
  // No registered neighbour after it: the leaf is the rightmost of the role's
  // root layers (nothing below the saved slot exists yet).
  if (insert === -1) insert = nodes.length;
  if (insert === at || insert === at + 1) return tree;
  const next = [...nodes];
  const [leaf] = next.splice(at, 1);
  next.splice(insert > at ? insert - 1 : insert, 0, leaf);
  return { ...tree, roles: { ...tree.roles, [role]: next } };
};

/** Remove a layer node from a role's tree (the deleteLayer splice). A folder
 *  that loses its last member keeps its (empty) block — the delete removes the
 *  leaf, not the folder. Pure: returns the same tree when the id is absent. */
const dropLeaf = (tree: Arrangement, role: LayerRole, id: string): Arrangement => {
  const nodes = tree.roles[role] ?? [];
  const [next, moved] = detachLeaf(nodes, id);
  if (!moved) return tree;
  return { ...tree, roles: { ...tree.roles, [role]: next } };
};

/** Compare two node sequences by identity (shallow: children not compared). */
const sameNodes = (a: readonly OrderNode[], b: readonly OrderNode[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

/** Move a top-level block (a folder or a root layer) before/after another
 *  top-level entry. Pure: returns the same tree on a no-op or when either
 *  entry is not top-level. `after` selects the insertion side.
 */
const moveBlock = (
  tree: Arrangement,
  role: LayerRole,
  key: string,
  targetKey: string,
  after: boolean,
): Arrangement => {
  const nodes = [...(tree.roles[role] ?? [])];
  const from = nodes.findIndex(node =>
    node.kind === "layer" ? rootLayerEntry(node.id) === key : node.key === key,
  );
  if (from === -1) return tree;
  const to = nodes.findIndex(node =>
    node.kind === "layer"
      ? rootLayerEntry(node.id) === targetKey
      : node.key === targetKey,
  );
  if (to === -1 || to === from) return tree;
  const [block] = nodes.splice(from, 1);
  let insert = to;
  if (from < to) insert = to - 1;
  if (after) insert += 1;
  nodes.splice(insert, 0, block);
  return { ...tree, roles: { ...tree.roles, [role]: nodes } };
};

/** Insert a new top-level block into a role, before `beforeEntry` (a block
 *  key / `layer:<id>`) or at the role tail when null / not found. The block
 *  is a folder or a group; its directory entry is NOT written here (the
 *  caller owns the directory). Pure: returns the same tree when the block
 *  already exists in the role. */
const addBlock = (
  tree: Arrangement,
  role: LayerRole,
  block: { kind: BlockKind; key: string; name: string },
  beforeEntry: string | null,
): Arrangement => {
  const nodes = tree.roles[role] ?? [];
  if (nodes.some(node => node.kind !== "layer" && node.key === block.key)) return tree;
  let index = nodes.length;
  if (beforeEntry !== null) {
    const at = topLevelIndex(nodes, beforeEntry);
    if (at !== -1) index = at;
  }
  const node: OrderNode = { kind: block.kind, key: block.key, children: [] };
  const next = [...nodes];
  next.splice(index, 0, node);
  const meta: BlockMeta = { kind: block.kind, key: block.key, name: block.name };
  const blocks = { ...tree.blocks, [block.key]: meta };
  return { ...tree, roles: { ...tree.roles, [role]: next }, blocks };
};

/** Delete a top-level block (folder/group) from a role. Its member layers are
 *  PROMOTED to role root (inserted at the block's former position), never
 *  retired — the v2 deleteFolder contract. The directory entry is removed.
 *  Pure: returns the same tree when the block is absent. */
const deleteBlock = (tree: Arrangement, role: LayerRole, key: string): Arrangement => {
  const nodes = tree.roles[role] ?? [];
  const at = nodes.findIndex(node => node.kind !== "layer" && node.key === key);
  if (at === -1) return tree;
  const block = nodes[at];
  const promoted = (block.kind === "layer" ? [] : block.children).filter(
    (c): c is LayerNode => c.kind === "layer",
  );
  const next = [...nodes];
  next.splice(at, 1);
  next.splice(at, 0, ...promoted);
  const blocks = { ...tree.blocks };
  delete blocks[key];
  return { ...tree, roles: { ...tree.roles, [role]: next }, blocks };
};

/** Remove every EMPTY folder/group block from a role. Returns the new tree and
 *  how many blocks were removed. Pure. */
const deleteEmptyBlocks = (
  tree: Arrangement,
  role: LayerRole,
): { tree: Arrangement; count: number } => {
  const nodes = tree.roles[role] ?? [];
  const emptyKeys = nodes
    .filter((node): node is FolderNode | GroupNode => node.kind !== "layer")
    .filter(node => node.children.length === 0)
    .map(node => node.key);
  if (emptyKeys.length === 0) return { tree, count: 0 };
  const next = nodes.filter(
    node => node.kind === "layer" || node.children.length !== 0,
  );
  const blocks = { ...tree.blocks };
  for (const key of emptyKeys) delete blocks[key];
  return {
    tree: { ...tree, roles: { ...tree.roles, [role]: next }, blocks },
    count: emptyKeys.length,
  };
};

/** Rename a block's display name (the directory entry; the stable key is
 *  unchanged). Pure: returns the same tree when the block is absent. */
const renameBlock = (
  tree: Arrangement,
  role: LayerRole,
  key: string,
  name: string,
): Arrangement => {
  const nodes = tree.roles[role] ?? [];
  if (!nodes.some(node => node.kind !== "layer" && node.key === key)) return tree;
  const meta = tree.blocks[key];
  if (!meta) return tree;
  return {
    ...tree,
    blocks: { ...tree.blocks, [key]: { ...meta, name } },
  };
};

export {
  ROLES,
  addBlock,
  addLeaf,
  anchorOfNode,
  applySavedOrder,
  defaultArrangement,
  deleteBlock,
  deleteEmptyBlocks,
  dropLeaf,
  hydrate,
  isArrangementShape,
  leafPosition,
  moveBlock,
  moveEntry,
  placeLeafAtSaved,
  projectBlocks,
  projectLayout,
  projectRows,
  projectZ,
  renameBlock,
  roleOfLeaf,
};
export type {
  Arrangement,
  BlockKind,
  BlockMeta,
  FolderNode,
  GroupNode,
  LayerNode,
  MovePlacement,
  OrderNode,
  ResolvedTree,
};

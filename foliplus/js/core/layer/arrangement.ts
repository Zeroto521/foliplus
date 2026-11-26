// core/layer/arrangement — the ordered-tree model of a role's layer stack.
//
// Stage 1 of the single-order refactor: the model and its two pure
// projections, with NO production caller yet. Today the same order is carried
// by three disjoint pieces of state — `layout.order[role]` (block order),
// `layout.members` (assignment) and the registry array (z axis + inside-folder
// order) — and the projections that read them (roleBlocks for the panel,
// the registry index for z) can disagree, because a pure registry move never
// writes the layout. This module expresses the same order as ONE tree:
//
//   role → [ block | layer ]
//   block (folder | group) → [ block | layer ]
//
// so a single sequence can produce both the panel's row keys and the z order.
// Stage 1 only proves the model is equivalent to today's projections (the
// shadow-parity test); the controller switch-over follows in later stages.
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

/** Shape version of the persisted arrangement document. v2 layouts are read
 *  through {@link fromV2}; a v3 record is this interface, written by the
 *  stage-2 controller path (not yet present). */
const ARRANGEMENT_VERSION = 3;

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

/** The single order source: one record, one write. Replaces the v2 triple
 *  (`folders` + `order` + `members`) — an assignment is a POSITION here. */
interface Arrangement {
  version: typeof ARRANGEMENT_VERSION;
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

/** The block-order prefix that marks a root-layer entry (`layer:<id>`). Taken
 *  from `rootLayerEntry` so the literal lives in one place. */
const ROOT_LAYER_PREFIX = rootLayerEntry("");

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

/** Append a layer node for every entry, preserving the given order. */
const layerNodes = (members: readonly LayerInfo[]): OrderNode[] =>
  members.map(info => ({ kind: "layer" as const, id: info.id }));

/** Convert a v2 layout into the tree model.
 *
 *  This re-derives the order from the v2 record rather than calling
 *  `roleBlocks`: an implementation that delegated to the projection it is meant
 *  to replace would make the parity test tautological. The rules are the v2
 *  ones, reproduced literally:
 *
 *  1. listed block-order entries first, in list order — a folder key becomes a
 *     folder node (an empty folder still owns a row), a `layer:<id>` entry
 *     becomes a root layer node only when that layer is currently a root layer
 *     (a stale entry for a layer since moved into a folder is ignored);
 *  2. then every unlisted folder block and unlisted root layer, merged by
 *     anchor ascending (anchor = the layer's index in the registry, folder
 *     anchor = its first member's index), so a root layer registered between
 *     two folders keeps its place between them.
 *
 *  A non-root layer whose effective key normalises to `""` (a whitespace-only
 *  declaration) is dropped: the v2 projection drops it too (it is neither a
 *  root layer nor a block member), so parity is preserved and the degenerate
 *  case stays visible in the parity test instead of silently changing shape.
 *
 *  @param {FolderLayout} layout - The v2 layout document.
 *  @param {readonly LayerInfo[]} registryEntries - The registry in anchor order.
 *  @returns {Arrangement} The equivalent tree.
 */
const fromV2 = (
  layout: FolderLayout,
  registryEntries: readonly LayerInfo[],
): Arrangement => {
  const blocks: Record<string, BlockMeta> = {};
  for (const folder of layout.folders) {
    blocks[folder.key] = {
      kind: "folder",
      key: folder.key,
      name: folder.name,
    };
  }
  const ensureBlock = (key: string): void => {
    if (blocks[key]) return;
    // No directory entry (an author-declared folder the user never renamed, or
    // a folder that only lives in `members`): the key is the display spelling.
    blocks[key] = { kind: "folder", key, name: key };
  };
  const roles = emptyRoleNodes();
  for (const role of ROLES) {
    // Bucket per folder key, keeping the FIRST member's registry index as the
    // block anchor (the position an unlisted block sorts by).
    const buckets = new Map<string, { at: number; members: LayerInfo[] }>();
    const roots: { at: number; info: LayerInfo }[] = [];
    registryEntries.forEach((info, index) => {
      if (info.role !== role) return;
      const placement = placementOf(layout, info);
      if (placement.kind === "root") {
        roots.push({ at: index, info });
        return;
      }
      if (placement.kind === "dropped") return;
      const key = placement.key;
      const bucket = buckets.get(key);
      if (bucket) bucket.members.push(info);
      else buckets.set(key, { at: index, members: [info] });
      ensureBlock(key);
    });
    const listed = layout.order[role] ?? [];
    const listedKeys = new Set(listed);
    const nodes = roles[role];
    const rootEntryById = new Map(
      roots.map(({ info }) => [rootLayerEntry(info.id), info]),
    );
    for (const entry of listed) {
      // A "layer:" entry names a ROOT layer by id — never a folder key, even
      // when the named layer has since moved into a folder (a stale entry then
      // projects nothing). The prefix comes from rootLayerEntry, so a folder
      // may not quietly claim the namespace.
      if (entry.startsWith(ROOT_LAYER_PREFIX)) {
        const info = rootEntryById.get(entry);
        if (info) nodes.push({ kind: "layer", id: info.id });
        continue;
      }
      // A folder key, including one with no members yet: an empty folder block
      // is a row the user created and can rename or fill.
      ensureBlock(entry);
      nodes.push({
        kind: "folder",
        key: entry,
        children: layerNodes(buckets.get(entry)?.members ?? []),
      });
    }
    const slots: { at: number; node: OrderNode }[] = [];
    for (const [key, bucket] of buckets) {
      if (listedKeys.has(key)) continue;
      slots.push({
        at: bucket.at,
        node: { kind: "folder", key, children: layerNodes(bucket.members) },
      });
    }
    for (const { at, info } of roots) {
      if (listedKeys.has(rootLayerEntry(info.id))) continue;
      slots.push({ at, node: { kind: "layer", id: info.id } });
    }
    slots.sort((a, b) => a.at - b.at);
    for (const slot of slots) nodes.push(slot.node);
  }
  return { version: ARRANGEMENT_VERSION, blocks, roles };
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
 *    anchor, the same "merge by anchor" rule fromV2 uses for unlisted entries;
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

export {
  ARRANGEMENT_VERSION,
  ROLES,
  anchorOfNode,
  fromV2,
  hydrate,
  projectRows,
  projectZ,
};
export type {
  Arrangement,
  BlockKind,
  BlockMeta,
  FolderNode,
  GroupNode,
  LayerNode,
  OrderNode,
  ResolvedTree,
};

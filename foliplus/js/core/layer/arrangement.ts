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

/** The solid-color basemap id (the special base layer). Single source is the
 *  control constant `SOLID_BASEMAP_ID`; the mirror needs it to keep the
 *  basemap out of `order.base` (v2 kept it implicit at the bottom). Core may
 *  not import `#control/*`, so the value is mirrored here with the authority
 *  named. */
const SOLID_BASEMAP_ID = "foliplus_color_map";
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
  /** The EXPLICIT block-order entries per role (a folder key or a
   *  `layer:<id>` root entry), exactly the v2 `layout.order[role]`. An
   *  author-declared folder the user never froze is NOT here — it lives only
   *  in `roles`/member assignment, exactly as v2 kept it in `members`. The
   *  mirror (`projectLayout`) emits `order[role]` from THIS list, not from the
   *  full tree, so the read-only v2 view stays faithful. */
  listed: Partial<Record<LayerRole, string[]>>;
}

/** A tree resolved against the live registry: what the projections read. */
interface ResolvedTree {
  blocks: Record<string, BlockMeta>;
  roles: Record<LayerRole, OrderNode[]>;
  /** The tree's explicit block-order entries (see Arrangement.listed). */
  listed: Partial<Record<LayerRole, string[]>>;
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
  savedOrder?: readonly string[],
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
  const listedOut: Arrangement["listed"] = {};
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
    let listed = layout.order[role] ?? [];
    // A v1-flat saved order (`order` as a single id list, the legacy shape the
    // v2 layout migrated from) carries no per-role block sequence, so a fresh
    // migration would build the tree in anchor order and lose the user's
    // arrangement. When the v2 layout has no per-role order but the flat saved
    // order ranks ids in this role, seed the block order from it (roots only).
    if (listed.length === 0 && savedOrder?.length) {
      const inRole = savedOrder.filter(id =>
        registryEntries.some(info => info.id === id && info.role === role),
      );
      listed = inRole.map(rootLayerEntry);
    }
    listedOut[role] = [...listed];
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
  return { version: ARRANGEMENT_VERSION, blocks, roles, listed: listedOut };
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
  return { blocks, roles, listed: tree.listed, parentOf, orphans };
};

/** Ensure a registered layer is present in the PERSISTED tree without pruning
 *  tree-only nodes.
 *
 *  `hydrate` resolves a tree for PROJECTION: a layer the registry lost is
 *  dropped from the projected roles (an orphan) so nothing renders or prices a
 *  dead id. That resolved shape must never be written back to the persisted
 *  model — a re-registration has to return to its recorded parent block and
 *  rank, which the persisted tree still holds. This helper therefore adds ONLY
 *  `id` when the persisted tree does not already carry it (a genuinely new
 *  registration, placed at its anchor), and leaves every other node — orphans
 *  included — untouched.
 *
 *  @param {Arrangement} tree - The persisted tree.
 *  @param {LayerRole} role - The role the layer belongs to.
 *  @param {string} id - The layer id to ensure.
 *  @param {readonly LayerInfo[]} registryEntries - The registry in anchor order.
 *  @returns {Arrangement} The tree with the layer ensured (same ref if present).
 */
const ensureLayer = (
  tree: Arrangement,
  role: LayerRole,
  id: string,
  registryEntries: readonly LayerInfo[],
): Arrangement => {
  const nodes = tree.roles[role] ?? [];
  if (nodes.some(node => carries(node, id))) return tree;
  const indexById = new Map(registryEntries.map((info, index) => [info.id, index]));
  const index = indexById.get(id);
  // The registry index is the anchor; an unregistered id sorts last (Infinity).
  let insert = nodes.length;
  for (let i = 0; i < nodes.length; i += 1) {
    if (anchorOfNode(nodes[i], indexById) > (index ?? Number.POSITIVE_INFINITY)) {
      insert = i;
      break;
    }
  }
  const next = [...nodes];
  next.splice(insert, 0, { kind: "layer", id });
  return { ...tree, roles: { ...tree.roles, [role]: next } };
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

/** Project the tree into the v2 layout mirror: the shape the panel's
 *  read-only projections (roleBlocks / groupByFolder / fullDisplayOrder) still
 *  consume. The tree is the source; this is the ONLY place the mirror is
 *  written, so nothing can diverge from the tree by construction.
 *
 *  An assignment is a position here: a root layer has no members entry (a
 *  materialised root pin is "folder: ''"), a folder member is recorded under
 *  its parent key, and the block order is the role's top-level sequence. A
 *  group node mirrors as a folder block (the v2 model has no group kind).
 *
 *  @param {ResolvedTree} resolved - The resolved tree.
 *  @returns {FolderLayout} The v2-shaped mirror, never persisted as v2.
 */
const projectLayout = (resolved: ResolvedTree): FolderLayout => {
  const folders: { key: string; name: string }[] = [];
  for (const block of Object.values(resolved.blocks)) {
    if (block.kind === "folder") folders.push({ key: block.key, name: block.name });
  }
  const order: Partial<Record<LayerRole, string[]>> = {};
  const members: Record<string, { role: LayerRole; folder: string }> = {};
  // The v2 mirror contract: `order[role]` is the EXPLICIT block order (a
  // folder key or a `layer:<id>` root entry), exactly what v2 persisted in
  // `layout.order[role]`. It is NOT the full tree — an author-declared folder
  // the user never froze lives only in `members`, and the solid basemap is
  // implicit at the base bottom, never an order entry. Both are v2 quirks the
  // mirror must replicate; see `folderLayout.ts` `roleBlocks`.
  for (const role of ROLES) {
    const listed = resolved.listed[role] ?? [];
    order[role] =
      role === ROLE.BASE
        ? listed.filter(entry => entry !== rootLayerEntry(SOLID_BASEMAP_ID))
        : listed;
  }
  for (const id of Object.keys(resolved.parentOf)) {
    const parent = resolved.parentOf[id];
    // undefined = an orphan leaf (dropped from the projection) -> no entry.
    if (parent === undefined) continue;
    const role = roleOfLeaf(resolved, id);
    if (!role) continue;
    // Every live leaf gets an explicit assignment. A root leaf is pinned as
    // folder:"" (the materialised root), so folderOf/isRootLayer read the
    // pin and never fall back to a stale author declaration left on the
    // LayerInfo after the user moved the layer out of its folder.
    members[id] = { role, folder: parent === null ? "" : parent };
  }
  return { version: 2, folders, order, members };
};

/** The role that owns a leaf id, or null when the tree does not hold it. */
const roleOfLeaf = (resolved: ResolvedTree, id: string): LayerRole | null => {
  for (const role of ROLES) {
    if ((resolved.roles[role] ?? []).some(node => carries(node, id))) return role;
  }
  return null;
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
  nodes.findIndex(node => (node.kind === "layer" ? rootLayerEntry(node.id) === entry : node.key === entry));

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
    // A root layer becomes an EXPLICIT block-order entry (`layer:<id>`) only
    // when it is placed at an explicit between-block position (moveLayerToRootAt
    // with a `beforeEntry`, a drag between blocks). An anchor-relative reorder
    // (moveLayerUp / moveLayerDown) keeps it UNLISTED — v2 merges unlisted root
    // layers by anchor, so listing every reorder would corrupt the row order.
    if (placement.beforeEntry === undefined) {
      return { ...tree, roles: { ...roles, [role]: next } };
    }
    const entry = rootLayerEntry(id);
    const listed = [...(tree.listed[role] ?? [])];
    const at = listed.findIndex(e => e === entry);
    if (at !== -1) listed.splice(at, 1);
    let linsert = listed.length;
    for (let i = 0; i < listed.length; i += 1) {
      if (topLevelIndex(next, listed[i]) > topLevelIndex(next, entry) || topLevelIndex(next, listed[i]) === -1) {
        linsert = i;
        break;
      }
    }
    listed.splice(linsert, 0, entry);
    return { ...tree, roles: { ...roles, [role]: next }, listed: { ...tree.listed, [role]: listed } };
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
  const listedIn = (tree.listed[role] ?? []).filter(e => e !== rootLayerEntry(id));
  return {
    ...tree,
    roles: { ...roles, [role]: withFolder },
    listed: { ...tree.listed, [role]: listedIn },
  };
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
    node.kind === "layer" ? rootLayerEntry(node.id) === targetKey : node.key === targetKey,
  );
  if (to === -1 || to === from) return tree;
  const [block] = nodes.splice(from, 1);
  let insert = to;
  if (from < to) insert = to - 1;
  if (after) insert += 1;
  nodes.splice(insert, 0, block);
  // Keep the explicit list in step: reorder `listed[role]` the same way the
  // tree nodes moved (the block-order mirror must follow the single source).
  const listed = [...(tree.listed[role] ?? [])];
  const lfrom = listed.findIndex(e => e === key || e === rootLayerEntry(key));
  const lto = listed.findIndex(e => e === targetKey || e === rootLayerEntry(targetKey));
  if (lfrom !== -1) {
    const [entry] = listed.splice(lfrom, 1);
    let linsert = lto === -1 ? listed.length : lto;
    if (lto !== -1 && lfrom < lto) linsert = lto - 1;
    if (after && lto !== -1) linsert += 1;
    listed.splice(linsert, 0, entry);
  }
  return {
    ...tree,
    roles: { ...tree.roles, [role]: nodes },
    listed: { ...tree.listed, [role]: listed },
  };
};

/** Materialise the role's CURRENT block order into the explicit list — the
 *  v2 reorder contract: a move between author-declared (unlisted) folders must
 *  freeze the block order first, because `moveFolder` refuses a move between
 *  keys it cannot find in `order[role]`. Pure. */
const freezeBlockOrder = (tree: Arrangement, role: LayerRole): Arrangement => {
  const entries = (tree.roles[role] ?? []).map(node =>
    node.kind === "layer" ? rootLayerEntry(node.id) : node.key,
  );
  const prev = tree.listed[role] ?? [];
  if (entries.length === prev.length && entries.every((e, i) => e === prev[i])) return tree;
  return { ...tree, listed: { ...tree.listed, [role]: entries } };
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
  explicit = true,
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
  const listed = tree.listed[role] ?? [];
  const nextListed =
    explicit && !listed.includes(block.key) ? [...listed, block.key] : listed;
  return {
    ...tree,
    roles: { ...tree.roles, [role]: next },
    blocks,
    listed: { ...tree.listed, [role]: nextListed },
  };
};

/** Delete a top-level block (folder/group) from a role. Its member layers are
 *  PROMOTED to role root (inserted at the block's former position), never
 *  retired — the v2 deleteFolder contract. The directory entry is removed.
 *  Pure: returns the same tree when the block is absent. */
const deleteBlock = (
  tree: Arrangement,
  role: LayerRole,
  key: string,
): Arrangement => {
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
  const listed = (tree.listed[role] ?? []).filter(e => e !== key);
  return {
    ...tree,
    roles: { ...tree.roles, [role]: next },
    blocks,
    listed: { ...tree.listed, [role]: listed },
  };
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
  const listed = (tree.listed[role] ?? []).filter(e => !emptyKeys.includes(e));
  return {
    tree: {
      ...tree,
      roles: { ...tree.roles, [role]: next },
      blocks,
      listed: { ...tree.listed, [role]: listed },
    },
    count: emptyKeys.length,
  };
};

/** Remove one leaf (a registered layer) from a role's tree, wherever it is —
 *  at role root or inside any folder/group block. Pure: returns the same tree
 *  when the id is absent. Used when the user forgets a layer's persisted order
 *  (the tree slot must go too, or a re-registration would return to a position
 *  the user explicitly abandoned). */
const dropLeaf = (tree: Arrangement, role: LayerRole, id: string): Arrangement => {
  const drop = (nodes: readonly OrderNode[]): OrderNode[] => {
    const out: OrderNode[] = [];
    for (const node of nodes) {
      if (node.kind === "layer") {
        if (node.id !== id) out.push(node);
        continue;
      }
      out.push({ ...node, children: drop(node.children) });
    }
    return out;
  };
  const roles = { ...tree.roles };
  const next = drop(roles[role] ?? []);
  if (next === roles[role]) return tree;
  roles[role] = next;
  return { ...tree, roles };
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
  // The v2 rename contract stores the DISPLAY name (folderDisplayName), not
  // the raw input — edge whitespace is dropped, so "  Streets  " is "Streets".
  return {
    ...tree,
    blocks: { ...tree.blocks, [key]: { ...meta, name: name.trim() } },
  };
};

export {
  ARRANGEMENT_VERSION,
  ROLES,
  anchorOfNode,
  fromV2,
  hydrate,
  projectRows,
  projectZ,
  projectLayout,
  moveEntry,
  moveBlock,
  addBlock,
  deleteBlock,
  deleteEmptyBlocks,
  freezeBlockOrder,
  dropLeaf,
  ensureLayer,
  renameBlock,
  leafPosition,
};
export type {
  Arrangement,
  BlockKind,
  MovePlacement,
  BlockMeta,
  FolderNode,
  GroupNode,
  LayerNode,
  OrderNode,
  ResolvedTree,
};

// core/layer/layout/project — adapt the generic resolution to the panel/registry.
//
// The engine (core/order/resolve) knows only node keys; here the leaf key
// "layer:<id>" is resolved to a LayerInfo and rows/blocks are partitioned by role.
// `z` is the DFS leaf flatten of a role (block does not change z semantics, §6).
import type { LayerRole } from "../role.js";
import type { FolderLayout } from "../folderLayout.js";
import type { LayerInfo } from "../type.js";
import { layerKeyOf } from "./default.js";
import type { OrderDoc } from "#core/order/doc.js";
import { folderBareOf } from "#core/order/doc.js";
import {

  type BlockRow,
  type OrderRow,
  type ParentView,
  type Present,
  type ResolvedView,
  childrenOf,
  resolveView,
} from "#core/order/resolve.js";

/** The panel-facing folder key: the doc key without the \"folder:\" prefix. A
 *  folder's stable identity is the doc key; the panel and drag anchors use the
 *  normalized folder name (the old array-model convention), so a rename never
 *  re-keys the row. */
const panelFolderKey = (key: string): string => folderBareOf(key);

const layerIdOf = (key: string): string | null =>
  key.startsWith("layer:") ? key.slice("layer:".length) : null;

/** The role that owns a layer (its LayerInfo.role); unknown ids are not present. */
export type RoleOf = (id: string) => LayerRole | null;

/** One projected block (folder/group) with its live members, or a root layer row.
 *
 *  `members` is DERIVED from the engine BlockRow.children leaf order (present-
 *  filtered, then looked up to LayerInfo) — never a separate registry sort, so
 *  rows and z stay the same source (design §6 single-source). */
export type ProjectedBlock =
  | {
      kind: "folder" | "group";
      key: string;
      name: string;
      depth: number;
      members: LayerInfo[];
    }
  | { kind: "layer"; layer: LayerInfo };

/** Re-export the engine projection types so the adapter contract is one import. */
export type { BlockRow, OrderRow, ParentView, ResolvedView };

/** The roles in the fixed panel/z order: overlay first, then base. */
export const ROLE_ORDER: readonly LayerRole[] = ["overlay", "base"];

/** Build the present predicate: a layer id is present when its LayerInfo exists. */
export const presentOf = (registry: readonly LayerInfo[]): Present => {
  const ids = new Set(registry.map(info => info.id));
  return (key: string) => {
    const id = layerIdOf(key);
    return id !== null && ids.has(id);
  };
};

/** The typed rows for one role (panel order), in DFS order. The role header
 *  is a UI concern rendered separately; a block row appears in a role when any
 *  of its subtree leaves belongs to that role. */
export const projectRows = (
  doc: OrderDoc,
  present: Present,
  roleOf: RoleOf,
  role: LayerRole,
): OrderRow[] => {
  const v = resolveView(doc, present);
  const rows: OrderRow[] = [];
  const leafRole = new Map<string, LayerRole>();
  for (const r of v.rows) {
    const id = layerIdOf(r.key);
    if (id !== null) {
      const roleOfLeaf = roleOf(id);
      if (roleOfLeaf !== null) leafRole.set(r.key, roleOfLeaf);
    }
  }
  for (const r of v.rows) {
    if (r.kind === "layer") {
      if (leafRole.get(r.key) === role) rows.push(r);
      continue;
    }
    const block = v.blocks.find(b => b.key === r.key);
    const any = block?.children.some(c => leafRole.get(c) === role) ?? false;
    if (any) rows.push(r);
  }
  return rows;
};

/** The z ladder for one role: leaf ids in DFS order (overlays before base). */
export const projectZ = (
  doc: OrderDoc,
  present: Present,
  roleOf: RoleOf,
  role: LayerRole,
): string[] => {
  const v = resolveView(doc, present);
  return v.leaves
    .filter(key => {
      const id = layerIdOf(key);
      return id !== null && roleOf(id) === role;
    })
    .map(key => layerIdOf(key) as string);
};

/** The display blocks for one role (panel row sequence) with live members. */
export const projectBlocks = (
  doc: OrderDoc,
  present: Present,
  registry: readonly LayerInfo[],
  role: LayerRole,
): ProjectedBlock[] => {
  const byId = new Map(registry.map(info => [info.id, info]));
  const roleOf: RoleOf = id => byId.get(id)?.role ?? null;
  const v = resolveView(doc, present);
  const out: ProjectedBlock[] = [];
  for (const r of v.rows) {
    if (r.kind === "layer") {
      const id = layerIdOf(r.key);
      if (id !== null && roleOf(id) === role) {
        const info = byId.get(id);
        if (info) out.push({ kind: "layer", layer: info });
      }
      continue;
    }
    const block = v.blocks.find(b => b.key === r.key);
    if (!block) continue;
    const members = block.children
      .map(c => byId.get(layerIdOf(c) as string))
      .filter((i): i is LayerInfo => i !== undefined && i.role === role);
    if (members.length === 0) continue;
    out.push({
      kind: block.kind,
      key: panelFolderKey(block.key),
      name: block.name,
      depth: block.depth,
      members,
    });
  }
  return out;
};

/** Convenience: the engine view for one role (rows + leaves + blocks raw). */
export const projectView = (doc: OrderDoc, present: Present): ResolvedView =>
  resolveView(doc, present);

/** The single controller-facing projection: one resolve, three derived views.
 *
 *  `rows` is typed per role (OrderRow[]); `blocks` carries BlockRow.kind/depth
 *  with live LayerInfo `members`; `z` is the flat role ladder (overlays before
 *  base) that feeds registry.normalizeGroups. All three come from ONE resolveView
 *  call, so rows and z can never disagree (design §6 single-source). */
export interface OrderView {
  rows: Record<LayerRole, OrderRow[]>;
  blocks: Record<LayerRole, ProjectedBlock[]>;
  z: string[];
}

export const resolveOrderView = (
  doc: OrderDoc,
  present: Present,
  registry: readonly LayerInfo[],
): OrderView => {
  const byId = new Map(registry.map(info => [info.id, info]));
  const roleOf: RoleOf = id => byId.get(id)?.role ?? null;
  const v = resolveView(doc, present);
  const rows: Record<LayerRole, OrderRow[]> = { overlay: [], base: [] };
  const blocks: Record<LayerRole, ProjectedBlock[]> = { overlay: [], base: [] };
  const z: string[] = [];
  const leafRole = new Map<string, LayerRole>();
  for (const r of v.rows) {
    const id = layerIdOf(r.key);
    if (id !== null) {
      const role = roleOf(id);
      if (role !== null) leafRole.set(r.key, role);
    }
  }
  for (const r of v.rows) {
    if (r.kind === "layer") {
      const role = leafRole.get(r.key);
      if (role == null) continue;
      // A member layer lives inside its folder block (the folder row below
      // carries it in `members`); only a root layer is a block of its own.
      // Without the guard the same layer is both a folder member and a
      // separate root block, so a drop after the folder resolves to the
      // member row instead of the tail.
      const parent = doc.nodes[r.key]?.parent;
      if (parent !== null && parent !== undefined) continue;
      rows[role].push(r);
      const info = byId.get(layerIdOf(r.key) as string);
      if (info) blocks[role].push({ kind: "layer", layer: info });
      continue;
    }
    const block = v.blocks.find(b => b.key === r.key);
    if (!block) continue;
    const members = block.children
      .map(c => byId.get(layerIdOf(c) as string))
      .filter((i): i is LayerInfo => i !== undefined);
    const byRole = new Map<LayerRole, LayerInfo[]>();
    for (const m of members) {
      let list = byRole.get(m.role);
      if (!list) { list = []; byRole.set(m.role, list); }
      list.push(m);
    }
    for (const role of ROLE_ORDER) {
      const m = byRole.get(role);
      if (!m || m.length === 0) continue;
      rows[role].push(r);
      blocks[role].push({
        kind: block.kind,
        key: panelFolderKey(block.key),
        name: block.name,
        depth: block.depth,
        members: m,
      });
    }
    // An empty folder keeps its creation role and still renders in that role's
    // segment (the clean-up row is the only handle on it). Group blocks always
    // have a member (the container layer), so this path is folder-only.
    if (members.length === 0) {
      const folderRole = doc.nodes[r.key]?.role;
      if (folderRole === undefined) continue;
      rows[folderRole].push(r);
      blocks[folderRole].push({
        kind: block.kind,
        key: panelFolderKey(block.key),
        name: block.name,
        depth: block.depth,
        members: [],
      });
    }
  }
  for (const role of ROLE_ORDER) {
    for (const leaf of v.leaves) {
      const id = layerIdOf(leaf);
      if (id !== null && roleOf(id) === role) z.push(id);
    }
  }
  return { rows, blocks, z };
};

/** The ordered child keys of one parent (root when null) — engine childrenOf. */
export const childrenOfView = (
  doc: OrderDoc,
  parent: string | null,
  order: string[] = [],
): ParentView => ({ children: childrenOf(doc, parent, order) });

/** The folder-block key of a node (folder/group) or the role-root marker "" for a
 *  root layer, derived from the doc — the folderOf/display lookup the controller
 *  still reads through the folderLayout mirror. */
const folderOfDoc = (doc: OrderDoc, key: string): string => {
  const node = doc.nodes[key];
  if (node === undefined) return "";
  return node.parent ?? "";
};

/** Derive the folderLayout mirror (folders + block order + member assignment)
 *  from the doc. The doc is the single order source; this mirror is derived
 *  (setDerived) and never persisted. Groups are excluded — the folder domain
 *  (folderOf / display / rename) operates on folders only. */
export const projectLayoutOf = (
  doc: OrderDoc,
  present: Present,
  registry: readonly LayerInfo[],
): FolderLayout => {
  const v = resolveView(doc, present);
  // The mirror is the panel-facing view of the doc: folder keys are the bare
  // normalized name (the old array-model convention), never the doc's
  // \"folder:\"-namespaced identity. The controller prefixes on the way in.
  const bare = (key: string): string => folderBareOf(key);
  const folders: { key: string; name: string }[] = [];
  for (const b of v.blocks) {
    if (b.kind === "folder") folders.push({ key: bare(b.key), name: b.name });
  }
  const order: Partial<Record<LayerRole, string[]>> = {};
  const members: Record<string, { role: LayerRole; folder: string }> = {};
  const byId = new Map(registry.map(info => [info.id, info]));
  for (const id of byId.keys()) {
    const key = layerKeyOf(id);
    const info = byId.get(id);
    if (!info) continue;
    const node = doc.nodes[key];
    members[id] = { role: info.role, folder: bare(node?.parent ?? "") };
  }
  // A block row belongs to the role(s) of its live members; an empty folder
  // carries no role (a folder's role is its members'). Layer rows join the
  // role of their layer. Only rows in the single root walk are emitted, in
  // the row order — a role's block sequence is the projection of the same
  // document the panel reads.
  const blockRoles = new Map<string, LayerRole[]>();
  for (const b of v.blocks) {
    const roles = new Set<LayerRole>();
    for (const child of b.children) {
      const id = layerIdOf(child);
      if (id !== null && byId.get(id)) roles.add(byId.get(id)!.role);
    }
    // An empty folder still owns its creation role (it renders in that role's
    // segment and is the only handle on the clean-up row).
    if (roles.size === 0 && b.kind === "folder") {
      const r = doc.nodes[b.key]?.role;
      if (r !== undefined) roles.add(r);
    }
    if (roles.size > 0) blockRoles.set(b.key, [...roles]);
  }
  for (const role of ROLE_ORDER) {
    order[role] = [];
    for (const r of v.rows) {
      if (r.kind === "layer") {
        const id = r.key.slice("layer:".length);
        const parent = doc.nodes[r.key]?.parent;
        const isMember = parent !== null && parent !== undefined;
        if (!isMember && byId.get(id)?.role === role) order[role].push(r.key);
      } else {
        const roles = blockRoles.get(r.key);
        if (roles?.includes(role)) order[role].push(bare(r.key));
      }
    }
  }
  return { version: 2, folders, order, members };
};

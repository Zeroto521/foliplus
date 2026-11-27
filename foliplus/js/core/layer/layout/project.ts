// core/layer/layout/project — adapt the generic resolution to the panel/registry.
//
// The engine (core/order/resolve) knows only node keys; here the leaf key "layer:<id>"
// is resolved to a LayerInfo and rows/blocks are partitioned by role. `z` is the DFS
// leaf flatten of a role (block does not change z semantics, design §6).
import type { LayerRole } from "../role.js";
import type { LayerInfo } from "../type.js";
import { layerKeyOf } from "./default.js";
import type { OrderDoc } from "#core/order/doc.js";
import {
  type BlockRow,
  type OrderRow,
  type ParentView,
  type Present,
  type ResolvedView,
  childrenOf,
  resolveView,
} from "#core/order/resolve.js";

const layerIdOf = (key: string): string | null =>
  key.startsWith("layer:") ? key.slice("layer:".length) : null;

/** The role that owns a layer (its LayerInfo.role); unknown ids are not present. */
export type RoleOf = (id: string) => LayerRole | null;

/** One projected block (folder/group) with its live members, or a root layer row. */
export type ProjectedBlock =
  | {
      kind: "folder" | "group";
      key: string;
      name: string;
      depth: number;
      children: LayerInfo[];
    }
  | { kind: "layer"; layer: LayerInfo };

/** Re-export the engine projection types so the adapter contract is one import. */
export type { BlockRow, OrderRow, ParentView, ResolvedView };

/** Build the present predicate: a layer id is present when its LayerInfo exists. */
export const presentOf = (registry: readonly LayerInfo[]): Present => {
  const ids = new Set(registry.map(info => info.id));
  return (key: string) => {
    const id = layerIdOf(key);
    return id !== null && ids.has(id);
  };
};

/** The row keys for one role (panel order), role header first. */
export const projectRows = (
  doc: OrderDoc,
  present: Present,
  roleOf: RoleOf,
  role: LayerRole,
): string[] => {
  const rows: string[] = [`role:${role}`];
  const v = resolveView(doc, present);
  // The generic rows are role-agnostic; filter by the leaf role. A block row is
  // included when any of its subtree leaves belongs to this role.
  const leafRole = new Map<string, LayerRole>();
  const collect = (key: string): void => {
    const id = layerIdOf(key);
    if (id !== null) {
      const r = roleOf(id);
      if (r !== null) leafRole.set(key, r);
    }
  };
  for (const r of v.rows) collect(r.key);
  for (const r of v.rows) {
    if (r.kind === "layer") {
      if (leafRole.get(r.key) === role) rows.push(`layer:${layerIdOf(r.key)}`);
    } else {
      // Block row: keep it when any member belongs to this role.
      const block = v.blocks.find(b => b.key === r.key);
      const any = block?.children.some(c => leafRole.get(c) === role) ?? false;
      if (any) rows.push(`${r.key}`);
    }
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
      key: block.key,
      name: block.name,
      depth: block.depth,
      children: members,
    });
  }
  return out;
};

/** Convenience: the engine view for one role (rows + leaves + blocks raw). */
export const projectView = (doc: OrderDoc, present: Present): ResolvedView =>
  resolveView(doc, present);

/** The ordered child keys of one parent (root when null) — engine childrenOf. */
export const childrenOfView = (
  doc: OrderDoc,
  parent: string | null,
  order: string[] = [],
): ParentView => ({ children: childrenOf(doc, parent, order) });

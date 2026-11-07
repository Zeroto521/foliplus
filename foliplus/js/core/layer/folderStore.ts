// core/layer/folderStore — 一级 Folder 领域：稳定 ID + canonical 成员 store.
//
// 这是 Folder 成员关系（哪些 Layer 在哪个 Folder）的唯一写点和读源。DOM 永远
// 不是事实源：注册边的作者声明（LayerInfo.folder）与这里的用户 override 在
// reconcile() 合并成 placements（override > 作者声明 > null）。
//
// 展示顺序 / 折叠属于 folderOrder.ts；本模块只拥有身份（FolderId）与成员关系
// （foldersById + placementsByLayerId）。mutation（建/删/移/重命名，M1）与
// 持久化（M2）不在这里；本文件是 D1/D2 —— 纯函数 + canonical store + 只读面，
// 不落盘、不改 UI、不碰 registry。
//
// DM 规则（写进测试的不变量）：
//   - 一个 Layer 最多一个 folderId；Folder 不嵌套、只属于一个 Section；成员
//     role 必须匹配 Section（sectionOf(layer.role) === folder.section）。
//   - authorFolderId(role, name) 确定性：同 (role, name) 恒同 id；name 先经
//     normalizeFolderName（NFC + 空白折叠 + casefold），与 folderOrder 同源。
//   - Override 优先级：用户 override > Python 作者声明 > null；reset 只删 override。
//   - Fold 不改 visibility/z-order/folderId/rank → fold 状态不进这里。
//   - 删除 Folder = 成员提升 Section 根级（M1）；跨 Section 走 changeLayerRole()（M1）。
import { normalizeFolderName } from "./folderOrder.js";
import { type LayerRole, type LayerSection, sectionOf } from "./role.js";
import type { LayerInfo } from "./type.js";

/** Schema version folded into author-folder ids. Bump when the identity
 *  derivation changes (vocabulary rename or a new normalisation rule) —
 *  never reuse a version for a different derivation. */
const FOLDER_SCHEMA_VERSION = 1;

/** Deterministic 64-bit FNV-1a hash → 16-lowercase-hex. A pure function of its
 *  input: no Math.random, no Date, no locale table — so an author-folder id is
 *  stable across reloads and machines. FNV-1a (not a crypto hash) because the
 *  input is project-authored and the space is small (folder names); the 64-bit
 *  width keeps collisions negligible for that space. */
const hash64 = (input: string): string => {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i++) {
    h = (h ^ BigInt(input.charCodeAt(i))) & mask;
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, "0");
};

/** A folder's stable identity. `author-folder:*` derives from the author's
 *  declaration (deterministic, stable); `user-folder:*` is assigned for a
 *  user-created folder (uuid, M1). Never a display name or a bare string. */
type FolderId = `author-folder:${string}` | `user-folder:${string}`;

/** Stable id for an author-declared folder. `name` is the author's display
 *  spelling (LayerInfo.folder); it is normalised here — NFC + whitespace fold
 *  + casefold, the single identity rule shared with folderOrder — so
 *  `Roads` / `roads` / `  roads ` collapse to one folder. The id embeds the
 *  schema version and the role, so a role move or a version bump yields a
 *  different id (never silently merges two folders). */
const authorFolderId = (role: LayerRole, name: string): FolderId => {
  const key = normalizeFolderName(name);
  const digest = hash64(
    `folder\u0000v${FOLDER_SCHEMA_VERSION}\u0000${role}\u0000${key}`,
  );
  return `author-folder:${digest}`;
};

/** A folder node in the canonical store. `name` is the normalised grouping
 *  key; `displayName` is the first-seen author spelling (trim only). */
interface FolderNode {
  id: FolderId;
  section: LayerSection;
  name: string;
  displayName: string;
  origin: "author" | "user";
  /** Null = derive the rank from the registry's first-seen order (never
   *  persisted until the user reorders; M1 assigns a rank on reorder). */
  rank: number | null;
}

/** The resolved membership of one layer. `folderId === null` ⇒ Section root. */
interface LayerPlacement {
  layerId: string;
  folderId: FolderId | null;
}

/** Typed row identity for the layer list — section / folder / layer. Never a
 *  display name or a bare string; a folder row is a FolderId, not the author's
 *  folder spelling. (The UI-projection `CursorRef` rename to RowRef is B2's
 *  job — this is the domain RowRef, distinct from the list cursor.) */
type RowRef =
  | { kind: "section"; section: LayerSection }
  | { kind: "folder"; folderId: FolderId }
  | { kind: "layer"; layerId: string };

/** The canonical folder membership store — one per LayerControl manager. The
 *  module is re-evaluated per render (IIFE), but the store is held by the
 *  controller, so a second control on the page gets its own instance.
 *  Read-only surface: `resolvePlacement` / `folderOf` / `foldersOf` /
 *  `hasOverride`. Mutation surface (M1): `setOverride` / `resetOverride` /
 *  `reconcile`. */
class FolderStore {
  /** Author-declared and user-created folders, keyed by id. Author folders are
   *  rebuilt by `reconcile`; user folders persist until deleted. */
  #folders = new Map<FolderId, FolderNode>();
  /** User overrides: layerId → folderId | null. An entry (even null) means
   *  "the user moved this layer here"; `reset` deletes the entry so the
   *  author declaration shows through again. */
  #overrides = new Map<string, FolderId | null>();
  /** Resolved placements after the last `reconcile` (override > author > null). */
  #placements = new Map<string, LayerPlacement>();

  /** Rebuild author-declared folders and re-resolve every placement from the
   *  registry snapshot. Author declarations are the input; user overrides ride
   *  on top. Pure derivation — no writes to the registry, no DOM, no storage.
   *  A folder with no live member is dropped here (an author folder exists
   *  only while ≥1 layer declares it); empty-folder freeze is folderOrder's
   *  concern (freezeSectionOrder). */
  reconcile(entries: readonly LayerInfo[]): void {
    const folders = new Map<FolderId, FolderNode>();
    // Preserve user-created folders across reconciles (they are not derived
    // from the registry; a reconcile must not drop them).
    for (const node of this.#folders.values()) {
      if (node.origin === "user") folders.set(node.id, node);
    }
    const placements = new Map<string, LayerPlacement>();
    for (const entry of entries) {
      const section = sectionOf(entry.role);
      let folderId: FolderId | null = null;
      if (entry.folder) {
        const id = authorFolderId(entry.role, entry.folder);
        let node = folders.get(id);
        if (!node) {
          node = {
            id,
            section,
            name: normalizeFolderName(entry.folder),
            displayName: entry.folder.trim(),
            origin: "author",
            rank: null,
          };
          folders.set(id, node);
        }
        folderId = id;
      }
      // Store the AUTHOR-derived placement here; the override is applied
      // live in resolvePlacement (it is the only resolution point, so a
      // setOverride/resetOverride after reconcile is always reflected).
      placements.set(entry.id, { layerId: entry.id, folderId });
    }
    this.#folders = folders;
    this.#placements = placements;
  }

  /** Resolve one layer's folder membership: user override > author > null.
   *  The override is read live (not from the reconcile snapshot), so a move
   *  applied after the last reconcile is always reflected here. */
  resolvePlacement(layerId: string): LayerPlacement {
    const override = this.#overrides.get(layerId);
    if (override !== undefined) return { layerId, folderId: override };
    return this.#placements.get(layerId) ?? { layerId, folderId: null };
  }

  /** The resolved folder id of a layer (null = Section root). */
  folderOf(layerId: string): FolderId | null {
    return this.resolvePlacement(layerId).folderId;
  }

  /** The read-only list of folders in one section, in first-seen order. */
  foldersOf(section: LayerSection): FolderNode[] {
    return [...this.#folders.values()].filter(f => f.section === section);
  }

  /** Whether the user has explicitly moved this layer (an override exists,
   *  even a null one meaning "to Section root"). */
  hasOverride(layerId: string): boolean {
    return this.#overrides.has(layerId);
  }

  /** Record a user move: layerId → folderId (null = Section root). */
  setOverride(layerId: string, folderId: FolderId | null): void {
    this.#overrides.set(layerId, folderId);
  }

  /** Drop a user move so the author declaration (or null) shows through. */
  resetOverride(layerId: string): void {
    this.#overrides.delete(layerId);
  }
}

export { FOLDER_SCHEMA_VERSION, authorFolderId, FolderStore, hash64 };
export type { FolderId, FolderNode, LayerPlacement, RowRef };

// core/layer/folderLayout — the folder layout + ordering domain.
//
// The ONE module that owns how a section's registry entries become the
// two-segment display order the panel renders, and the persisted layout
// document that records folder identity, block order and member assignment
// in a single snapshot (same source, same write — one storage key, one
// record, so order and members can never be observed half-written).
//
// The design is frozen at .foliplus/design/folder-layout-document.md (rev 2):
//   - identity key = (section, normalize(name)); normalize = NFC → whitespace
//     fold → trim → casefold (locale-independent).
//   - displayName = first-seen original (trim only) — never used for
//     merge / sort / store.
//   - block anchor = min(member global registry index); within a section
//     Folder blocks come first, then root Layer blocks.
//   - layout.order[section] (ordered normalize(name)[]) is highest priority;
//     listed folders in list order, unlisted by anchor, list-only names
//     ignored.
//   - layout.members[layerId] is the single source of a layer's folder
//     assignment ONCE a layout exists. layerInfo.folder (the author's CONF
//     declaration) seeds a member ONLY when no persisted assignment exists
//     for that layer; it never overrides a persisted members entry. A
//     materialised root (folder: "") pins the layer at root even when the
//     author declared a folder.
//   - empty-folder freeze materialises the section's whole block order before
//     the last member is removed; deleteFolder promotes every member to root
//     and removes the directory / order entries.
//
// This module is DOM-free and dependency-light (LayerInfo is a type only), so
// it is unit-testable in isolation — the invariant tests drive it directly.
import type { LayerRole } from "./role.js";
import type { LayerInfo } from "./type.js";
import { ensureMapFoliplus } from "#core/mapApi.js";
import { type Debounced, debounce } from "#platform/debounce.js";
import { loadRecord, saveRecord } from "#platform/storage.js";

/** The folder dimension: a folder is scoped to one section (role). Base and
 *  overlay folders with the same name are two different folders. */
type FolderSection = LayerRole;

/** One folder identity entry: stable key + the display name a rename rewrites
 *  (rename never touches the key — see renameFolder). */
interface FolderEntry {
  /** The identity key = normalize(name) (NFC → ws fold → trim → casefold). */
  key: string;
  /** The display spelling (trim only); the first-seen spelling wins. */
  name: string;
}

/** One member assignment. `folder` is the identity KEY (not the display
 *  spelling); an empty string is the materialised ROOT pin — a user action
 *  that returns a layer to root even when the author declared a folder. */
interface FolderMember {
  section: FolderSection;
  folder: string;
}

/** The persisted folder layout document. One storage record holds folder
 *  identity, block order and member assignment together, so a user action
 *  writes them as one snapshot (same source, same write). */
interface FolderLayout {
  version: 2;
  /** Folder identity directory: stable keys + display names. */
  folders: FolderEntry[];
  /** Per-section ordered folder key array = block order (the order is the
   *  truth: a drag re-writes this array). */
  order: Partial<Record<FolderSection, string[]>>;
  /** layerId → assignment. The stable LayerInfo.id is the key; a layer's
   *  assignment is seeded from the author declaration only when this record
   *  has no entry for it, and a persisted entry always wins. */
  members: Record<string, FolderMember>;
}

/** One folder block: every member sharing (section, normalize(name)). */
interface FolderBlock {
  /** The identity key = normalize(displayName). Never used for display. */
  key: string;
  /** The current display spelling (directory name, or first-seen). */
  displayName: string;
  /** Block anchor = min(member GLOBAL registry index). */
  anchor: number;
  /** Members in registry (anchor) order. */
  members: LayerInfo[];
}

/** The single storage key every map's folder layout lives under. One key,
 *  indexed by folder key / layer id inside the record — never a per-folder or
 *  per-layer key assembled at the call site (mirrors the filter-store key). */
const LAYOUT_DOC_KEY = "foliplus_layer_layout";

/** An empty layout: no folders, no block order, no assignments. */
const emptyFolderLayout = (): FolderLayout => ({
  version: 2,
  folders: [],
  order: {},
  members: {},
});

/** Identity/merge/sort key for a folder name.
 *
 *  NFC → fold internal whitespace runs to one space → trim → casefold. The
 *  casefold is the JS layer #905 deliberately left to this card: Python emits
 *  the author's display spelling (NFC + trim + whitespace fold only), and the
 *  JS side folds case so `Roads` / `roads` / `  roads ` are one folder.
 *
 *  Locale-independent by construction: `toLowerCase()` uses the Unicode
 *  Default Case Conversion, not a locale table, and no `localeCompare` is
 *  used anywhere in the ordering (invariant 2). */
const normalizeFolderName = (name: string): string =>
  name.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

/** The display spelling for a folder: trim only, no NFC / casefold. The
 *  first-seen raw spelling wins and is never normalised for display. */
const folderDisplayName = (name: string): string => name.trim();

/** Shape guard for a persisted layout record. A corrupt or unknown-version
 *  payload reads back as empty (see readFolderLayout) — the record is never
 *  trusted as a persistence channel it does not actually match. */
const isFolderLayout = (raw: unknown): raw is FolderLayout => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  if (o.version !== 2) return false;
  if (!Array.isArray(o.folders)) return false;
  if (!o.order || typeof o.order !== "object" || Array.isArray(o.order)) return false;
  if (!o.members || typeof o.members !== "object" || Array.isArray(o.members)) {
    return false;
  }
  for (const f of o.folders) {
    if (!f || typeof f !== "object") return false;
    const e = f as Record<string, unknown>;
    if (typeof e.key !== "string" || typeof e.name !== "string") return false;
  }
  for (const [sec, keys] of Object.entries(o.order)) {
    if (sec !== "overlay" && sec !== "base") return false;
    if (!Array.isArray(keys) || !keys.every(k => typeof k === "string")) return false;
  }
  for (const [_id, a] of Object.entries(o.members)) {
    if (!a || typeof a !== "object") return false;
    const m = a as Record<string, unknown>;
    if (typeof m.section !== "string" || typeof m.folder !== "string") return false;
    if (m.section !== "overlay" && m.section !== "base") return false;
  }
  return true;
};

/** Tolerant read of the persisted layout. A corrupt or unknown-version
 *  payload (an array, a string, a record missing any section, a future
 *  version) reads back as an empty layout — it is not a persistence channel
 *  and must never be trusted as one. Read has NO side effect: a bad record is
 *  left as-is, never repaired on read (mirrors the filter-store read path). */
const readFolderLayout = (): FolderLayout => {
  const loaded = loadRecord<unknown>(LAYOUT_DOC_KEY);
  return isFolderLayout(loaded) ? loaded : emptyFolderLayout();
};

/** Write the layout record, always stamping version 2. */
const writeFolderLayout = (layout: FolderLayout): void => {
  saveRecord(LAYOUT_DOC_KEY, { ...layout, version: 2 });
};

/** Resolve a layer's effective folder assignment from the layout. A persisted
 *  members entry is the single source of truth (an empty string = materialised
 *  root); only when NO members entry exists does the author's declaration
 *  seed the assignment. */
const folderOf = (layout: FolderLayout, layer: LayerInfo): string | null => {
  const assigned = layout.members[layer.id];
  if (assigned !== undefined) return assigned.folder === "" ? null : assigned.folder;
  return layer.folder ?? null;
};

/** Group one section's folder members into blocks, keyed by normalize(name).
 *  `registryEntries` is the WHOLE registry in anchor order; the block anchor
 *  is the member's GLOBAL index in it (not a per-section index), matching
 *  invariant 3's `rail@1 / Roads@3 / Roads@7` shape.
 *
 *  The member assignment is read from `members[layerId]` when present — the
 *  single source of truth once a layout exists — and falls back to the
 *  author's `layerInfo.folder` declaration ONLY when the layout has no entry
 *  for that layer (the seed rule). A persisted assignment never loses to an
 *  author declaration. */
const groupByFolder = (
  registryEntries: readonly LayerInfo[],
  section: FolderSection,
  layout: FolderLayout,
): Map<string, FolderBlock> => {
  const map = new Map<string, FolderBlock>();
  registryEntries.forEach((entry, globalIndex) => {
    if (entry.role !== section) return;
    const folder = folderOf(layout, entry);
    if (!folder) return;
    const key = normalizeFolderName(folder);
    let block = map.get(key);
    if (!block) {
      // The directory entry's name is the current display spelling (a rename
      // updates it while keeping the key); a not-yet-directory member uses its
      // own spelling.
      const named = layout.folders.find(f => f.key === key);
      block = {
        key,
        displayName: named ? named.name : folderDisplayName(folder),
        anchor: globalIndex,
        members: [],
      };
      map.set(key, block);
    }
    block.members.push(entry);
    if (globalIndex < block.anchor) block.anchor = globalIndex;
  });
  return map;
};

/** True when a layer is a ROOT layer of its section: no persisted assignment,
 *  or a materialised root pin (folder: ""). The author declaration only
 *  counts when no members entry exists at all. */
const isRootLayer = (layout: FolderLayout, entry: LayerInfo): boolean => {
  const assigned = layout.members[entry.id];
  if (assigned !== undefined) return assigned.folder === "";
  return !entry.folder;
};

/** The two-segment display order for one section:
 *  (1) listed folders in layout.order[section] list order, (2) unlisted
 *  folders by anchor ascending appended after them, (3) root layers (no
 *  folder) in anchor order at the end. `registryEntries` is the WHOLE
 *  registry in anchor (registration) order so the global array index is the
 *  anchor axis. Pure: never mutates its inputs. */
const sectionOrder = (
  section: FolderSection,
  registryEntries: readonly LayerInfo[],
  layout: FolderLayout,
): LayerInfo[] => {
  const folders = groupByFolder(registryEntries, section, layout);
  const listed = layout.order[section] ?? [];
  const listedKeys = new Set(listed);
  const blocks: FolderBlock[] = [];
  for (const key of listed) {
    const block = folders.get(key);
    if (block) blocks.push(block);
  }
  const rest = [...folders.values()]
    .filter(block => !listedKeys.has(block.key))
    .sort((a, b) => a.anchor - b.anchor);
  blocks.push(...rest);
  const rootLayers = registryEntries.filter(
    entry => entry.role === section && isRootLayer(layout, entry),
  );
  return [...blocks.flatMap(block => block.members), ...rootLayers];
};

/** The full panel display order: overlay section then base section, each in
 *  its own two-segment order. `registryEntries` is the WHOLE registry in
 *  anchor order. */
const fullDisplayOrder = (
  registryEntries: readonly LayerInfo[],
  layout: FolderLayout,
): LayerInfo[] => [
  ...sectionOrder("overlay", registryEntries, layout),
  ...sectionOrder("base", registryEntries, layout),
];

/** Materialise one section's WHOLE folder-key order before a folder is about
 *  to lose its last member. Listed keys stay in list order; unlisted keys are
 *  appended by anchor (min member global index); the frozen key is guaranteed
 *  present. The emptied folder's block then survives at its frozen position
 *  (the clean button can still reach it). Pure: returns a new layout. */
const freezeSectionOrder = (
  layout: FolderLayout,
  section: FolderSection,
  registryEntries: readonly LayerInfo[],
  key: string,
): FolderLayout => {
  const listed = layout.order[section] ?? [];
  const folders = groupByFolder(registryEntries, section, layout);
  const unlisted = [...folders.keys()]
    .filter(k => !listed.includes(k))
    .sort((a, b) => folders.get(a)!.anchor - folders.get(b)!.anchor);
  const frozen = [...listed, ...unlisted];
  if (!frozen.includes(key)) frozen.push(key);
  return { ...layout, order: { ...layout.order, [section]: frozen } };
};

/** Seed a layout from the current registry: folder directory from the author
 *  declarations (first-seen spelling wins, keyed by normalize), members from
 *  each registered layer's declared folder. Used when no layout exists yet —
 *  the first user action materialises the author's declared grouping as the
 *  persisted layout. */
const seedFolderLayout = (registryEntries: readonly LayerInfo[]): FolderLayout => {
  const layout = emptyFolderLayout();
  const byKey = new Map<string, FolderEntry>();
  for (const entry of registryEntries) {
    const folder = entry.folder;
    if (!folder) continue;
    const key = normalizeFolderName(folder);
    if (!byKey.has(key)) {
      const name = folderDisplayName(folder);
      byKey.set(key, { key, name });
      layout.folders.push({ key, name });
    }
    layout.members[entry.id] = { section: entry.role, folder: key };
  }
  return layout;
};

/** Create a folder: append the new key to the section's block order and add
 *  it to the identity directory. Same-section duplicates (directory, order or
 *  live member) are refused. Pure: returns the same layout on a no-op. */
const createFolder = (
  layout: FolderLayout,
  section: FolderSection,
  name: string,
): FolderLayout => {
  const key = normalizeFolderName(name);
  if (key === "") return layout;
  const order = layout.order[section] ?? [];
  if (order.includes(key)) return layout; // same-section duplicate refused
  // A different section may already hold this key: base and overlay folders
  // with the same name are two different folders (section-scoped identity).
  const existing = layout.folders.find(f => f.key === key);
  const folderEntry = existing ?? { key, name: folderDisplayName(name) };
  return {
    ...layout,
    folders: existing ? layout.folders : [...layout.folders, folderEntry],
    order: { ...layout.order, [section]: [...order, key] },
  };
};

/** Rename a folder's DISPLAY NAME without touching its identity key or any
 *  member assignment. The directory entry's name is rewritten (and created
 *  when the folder was live-only); the block-order key and every member
 *  assignment keep their key, so the block stays put and the rename is pure
 *  display. Pure: returns the same layout on a no-op / blank new name. */
const renameFolder = (
  layout: FolderLayout,
  section: FolderSection,
  oldName: string,
  newName: string,
): FolderLayout => {
  const oldKey = normalizeFolderName(oldName);
  const newKey = normalizeFolderName(newName);
  if (newKey === "") return layout;
  if (oldKey === newKey) return layout; // normalisation-only rename: no-op
  if (layout.folders.some(f => f.key === newKey)) return layout;
  const hasOld =
    layout.folders.some(f => f.key === oldKey) ||
    (layout.order[section] ?? []).includes(oldKey);
  if (!hasOld) return layout;
  const folders = layout.folders.some(f => f.key === oldKey)
    ? layout.folders.map(f =>
        f.key === oldKey ? { ...f, name: folderDisplayName(newName) } : f,
      )
    : [...layout.folders, { key: oldKey, name: folderDisplayName(newName) }];
  return { ...layout, folders };
};

/** Delete a folder: remove its directory entry and block-order key, and pin
 *  every assigned member to ROOT (folder: "" — the layer stays registered and
 *  visible, only its folder association drops; the pin wins over the author
 *  declaration, so a deleted folder is not re-created by the seed fallback). */
const deleteFolder = (
  layout: FolderLayout,
  section: FolderSection,
  name: string,
): FolderLayout => {
  const key = normalizeFolderName(name);
  const order = layout.order[section] ?? [];
  const members = { ...layout.members };
  for (const [id, a] of Object.entries(members)) {
    if (a.section === section && a.folder === key) {
      members[id] = { section, folder: "" };
    }
  }
  return {
    ...layout,
    folders: layout.folders.filter(f => f.key !== key),
    order: { ...layout.order, [section]: order.filter(k => k !== key) },
    members,
  };
};

/** Assign a layer to a folder. When the target folder has no block order key
 *  yet, it is materialised (appended to the section's block tail) so the
 *  moved layer lands in a visible block. */
const moveLayerToFolder = (
  layout: FolderLayout,
  layerId: string,
  section: FolderSection,
  folderKey: string,
): FolderLayout => {
  const key = normalizeFolderName(folderKey);
  if (key === "") return layout;
  const order = layout.order[section] ?? [];
  const nextOrder = order.includes(key) ? order : [...order, key];
  return {
    ...layout,
    order: { ...layout.order, [section]: nextOrder },
    members: { ...layout.members, [layerId]: { section, folder: key } },
  };
};

/** Return a layer to ROOT: its assignment is pinned (folder: "") so the layer
 *  stays at root even when the author declared a folder — the user's action
 *  overrides the declaration. */
const moveLayerToRoot = (
  layout: FolderLayout,
  layerId: string,
  section: FolderSection,
): FolderLayout => {
  const existing = layout.members[layerId];
  if (existing && existing.folder === "") return layout;
  return {
    ...layout,
    members: { ...layout.members, [layerId]: { section, folder: "" } },
  };
};

/** Drop one layer's assignment entirely (the deleteLayer path): the layer is
 *  gone, so its member entry goes with it, but an emptied folder's order key
 *  SURVIVES (the automatic freeze), so the block stays put for the clean
 *  button. */
const dropLayer = (layout: FolderLayout, layerId: string): FolderLayout => {
  if (!(layerId in layout.members)) return layout;
  const members = { ...layout.members };
  delete members[layerId];
  return { ...layout, members };
};

/** Restore the author's declared layout: clear the block order and every
 *  member assignment, keeping the folder name directory (a reset would drop
 *  the user's display spellings). */
const restoreAuthorLayout = (layout: FolderLayout): FolderLayout => ({
  ...layout,
  order: {},
  members: {},
});

/** A per-map folder-layout manager: the in-memory layout plus the one
 *  debounced writer. One instance per map (see ensureFolderLayout). */
interface FolderLayoutManager {
  /** The live layout (read/write through the manager's own methods). */
  layout: FolderLayout;
  /** Replace the live layout AND schedule a debounced write. */
  set(layout: FolderLayout): void;
  /** Flush any pending write immediately (teardown). */
  flush(): void;
  /** Drop the in-memory copy and re-read from storage (a fresh control). */
  reload(): FolderLayout;
  /** Re-seed from the current registry (no persisted layout yet). */
  seed(registryEntries: readonly LayerInfo[]): void;
  /** True when the layout has no folder keys, no members and no directory. */
  isEmpty(): boolean;
}

/** Build one folder-layout manager. The live layout starts from the persisted
 *  record (tolerant read: a corrupt or unknown version reads as empty); a
 *  write goes through the one debounced timer (100 ms, mirrors the layer-state
 *  save debounce) so a batch of user actions coalesces into one storage write
 *  of the final state. */
const createFolderLayoutManager = (): FolderLayoutManager => {
  let current: FolderLayout = readFolderLayout();
  let timer: Debounced | null = null;
  const write = (): void => {
    writeFolderLayout(current);
  };
  return {
    get layout() {
      return current;
    },
    set(layout: FolderLayout): void {
      current = layout;
      timer ??= debounce(write, 100);
      timer();
    },
    flush(): void {
      timer?.flush();
      timer = null;
    },
    reload(): FolderLayout {
      current = readFolderLayout();
      return current;
    },
    seed(registryEntries: readonly LayerInfo[]): void {
      // Merge the author's declared grouping into the current layout: only
      // layers WITHOUT an assignment yet get one (a user pin — root or a
      // different folder — wins), and only new folder keys get a directory
      // entry. The block order is untouched (declarations do not force an
      // order; freeze/create materialises it). This is safe to call every
      // init, even when a persisted layout already exists.
      const byKey = new Map<string, FolderEntry>();
      for (const f of current.folders) byKey.set(f.key, f);
      const members = { ...current.members };
      let folders = current.folders;
      let changed = false;
      for (const entry of registryEntries) {
        const folder = entry.folder;
        if (!folder) continue;
        const key = normalizeFolderName(folder);
        if (members[entry.id]) continue; // user pin or existing assignment wins
        if (!byKey.has(key)) {
          byKey.set(key, { key, name: folderDisplayName(folder) });
          folders = [...folders, { key, name: folderDisplayName(folder) }];
        }
        members[entry.id] = { section: entry.role, folder: key };
        changed = true;
      }
      if (changed) current = { ...current, folders, members };
    },
    isEmpty(): boolean {
      return (
        Object.values(current.order).every(a => a.length === 0) &&
        Object.keys(current.members).length === 0 &&
        current.folders.length === 0
      );
    },
  };
};

/** Per-map singleton: one folder-layout manager per map, cached on the per-map
 *  namespace (mirrors ensureFilterStore). Every LayerControl on a map shares
 *  this instance, so the layout is single-sourced across controls. */
const ensureFolderLayout = (map: L.Map): FolderLayoutManager => {
  const api = ensureMapFoliplus(map);
  api.folderLayout ??= createFolderLayoutManager();
  return api.folderLayout;
};

export {
  LAYOUT_DOC_KEY,
  normalizeFolderName,
  folderDisplayName,
  emptyFolderLayout,
  ensureFolderLayout,
  createFolderLayoutManager,
  readFolderLayout,
  writeFolderLayout,
  isFolderLayout,
  seedFolderLayout,
  folderOf,
  groupByFolder,
  sectionOrder,
  fullDisplayOrder,
  freezeSectionOrder,
  createFolder,
  renameFolder,
  deleteFolder,
  moveLayerToFolder,
  moveLayerToRoot,
  dropLayer,
  restoreAuthorLayout,
};
export type {
  FolderLayout,
  FolderEntry,
  FolderSection,
  FolderMember,
  FolderLayoutManager,
};

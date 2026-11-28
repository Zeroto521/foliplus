// core/layer/folderLayout — the folder layout + ordering domain.
//
// The ONE module that owns how a role's registry entries become the
// two-segment display order the panel renders, and the persisted layout
// document that records folder identity, block order and member assignment
// in a single snapshot (same source, same write — one storage key, one
// record, so order and members can never be observed half-written).
//
// The design invariants this module implements:
//   - identity key = (role, normalize(name)); normalize = NFC → whitespace
//     fold → trim → casefold (locale-independent).
//   - displayName = first-seen original (trim only) — never used for
//     merge / sort / store.
//   - block anchor = min(member global registry index); within a role
//     Folder blocks come first, then root Layer blocks.
//   - layout.order[role] (ordered normalize(name)[]) is highest priority;
//     listed folders in list order, unlisted by anchor, list-only names
//     ignored.
//   - layout.members[layerId] is the single source of a layer's folder
//     assignment ONCE a layout exists. layerInfo.folder (the author's CONF
//     declaration) seeds a member ONLY when no persisted assignment exists
//     for that layer; it never overrides a persisted members entry. A
//     materialised root (folder: "") pins the layer at root even when the
//     author declared a folder.
//   - empty-folder freeze materialises the role's whole block order before
//     the last member is removed; deleteFolder promotes every member to root
//     and removes the directory / order entries.
//
// This module is DOM-free and dependency-light (LayerInfo is a type only), so
// it is unit-testable in isolation — the invariant tests drive it directly.
import type { LayerRole } from "./role.js";
import type { LayerInfo } from "./type.js";
import { ensureMapFoliplus } from "#core/mapApi.js";
import { type Debounced, debounce } from "#platform/debounce.js";
import {
  type MapLike,
  STORAGE_SUFFIX,
  loadVersionedObject,
  saveVersionedObject,
  scopedStorageKey,
} from "#platform/storage.js";

/** The folder dimension: a folder is scoped to one role (role). Base and
 *  overlay folders with the same name are two different folders. */

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
  role: LayerRole;
  folder: string;
}

/** Shape version of the persisted layout document (the record is invalidated,
 *  never migrated, when the version is not this one). */
const FOLDER_LAYOUT_VERSION = 2;

/** The persisted folder layout document. One storage record holds folder
 *  identity, block order and member assignment together, so a user action
 *  writes them as one snapshot (same source, same write). */
interface FolderLayout {
  version: 2;
  /** Folder identity directory: stable keys + display names. */
  folders: FolderEntry[];
  /** Per-role ordered folder key array = block order (the order is the
   *  truth: a drag re-writes this array). */
  order: Partial<Record<LayerRole, string[]>>;
  /** layerId → assignment. The stable LayerInfo.id is the key; a layer's
   *  assignment is seeded from the author declaration only when this record
   *  has no entry for it, and a persisted entry always wins. */
  members: Record<string, FolderMember>;
}

/** One folder block: every member sharing (role, normalize(name)). */
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

/** The per-map storage key for a map's folder layout, scoped to its map
 *  container (multi-map pages keep layouts separate; a renamed declaration
 *  then re-seeds instead of pinning an old assignment). The record is one key
 *  indexed by folder key / layer id inside it — never a per-folder or per-layer
 *  key assembled at the call site (mirrors the filter-store key).
 *  Single-sourced from scopedStorageKey so the key shape cannot drift. */
const folderLayoutKey = (map: MapLike): string =>
  scopedStorageKey(map, STORAGE_SUFFIX.LAYER_LAYOUT);

/** The longest folder name a declaration may carry, in Unicode code points.
 *  Mirrors FOLDER_NAME_MAX in Python's foliplus/_declaration/key.py: a folder
 *  name is a short label read on a list row, not a data field, and the cap
 *  must match across stacks so Python and JS cannot disagree about which
 *  names reach the panel. */
const FOLDER_NAME_MAX = 64;

/** An empty layout: no folders, no block order, no assignments. */
const emptyFolderLayout = (): FolderLayout => ({
  version: 2,
  folders: [],
  order: {},
  members: {},
});

/** Identity/merge/sort key for a folder name.
 *
 *  NFC → fold internal whitespace runs to one space → trim → lowercase. The
 *  lowercasing is the JS layer #905 deliberately left to this card: Python
 *  emits the author's display spelling (NFC + trim + whitespace fold only), and
 *  the JS side folds case so `Roads` / `roads` / `  roads ` are one folder.
 *
 *  Locale-independent by construction: `toLowerCase()` uses the Unicode
 *  Default Case Conversion, not a locale table, and no `localeCompare` is
 *  used anywhere in the ordering (invariant 2). */
const normalizeFolderName = (name: string): string =>
  name.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

/** The display spelling for a folder: trim only, no NFC / casefold. The
 *  first-seen raw spelling wins and is never normalised for display. */
const folderDisplayName = (name: string): string => name.trim();

/** Prefix that marks a ROOT-LAYER entry in a role's block order.
 *
 *  A block order entry is either a folder key or `layer:<id>`. Root layers
 *  used to be appended after every folder block, so a layer could never sit
 *  between two folders; carrying the layer in the order is what makes that
 *  position expressible. The prefix keeps the two namespaces apart — a folder
 *  may legally be named like a layer id. */
const ROOT_LAYER_PREFIX = "layer:";

const rootLayerEntry = (layerId: string): string => ROOT_LAYER_PREFIX + layerId;

const isRootLayerEntry = (entry: string): boolean =>
  entry.startsWith(ROOT_LAYER_PREFIX);

/** The folder keys of a block order, with the root-layer entries removed. */
const folderEntries = (order: readonly string[]): string[] =>
  order.filter(entry => !isRootLayerEntry(entry));

/** The length a folder name is judged by, in Unicode code points.
 *
 *  Measured on the normalised name - the same NFC / whitespace-fold / trim
 *  the panel shows, so padding cannot disguise a long name, and counted in
 *  code points rather than UTF-8 bytes, so a name heavy in non-BMP
 *  characters is judged by what the author reads. Mirrors the Python
 *  reader, which measures the identical normalisation.
 */
const folderNameLength = (name: string): number =>
  [...name.normalize("NFC").replace(/\s+/g, " ").trim()].length;

/** Whether a folder name exceeds {@link FOLDER_NAME_MAX}.
 *
 *  The single decision point for the cap, so one invariant cannot be
 *  guarded at one entry and not another: the author's declaration (Python
 *  and the JS reader) and the panel's own create / rename paths all ask
 *  this. */
const folderNameTooLong = (name: string): boolean =>
  folderNameLength(name) > FOLDER_NAME_MAX;

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
  for (const a of Object.values(o.members)) {
    if (!a || typeof a !== "object") return false;
    const m = a as Record<string, unknown>;
    if (typeof m.role !== "string" || typeof m.folder !== "string") return false;
    if (m.role !== "overlay" && m.role !== "base") return false;
  }
  return true;
};

/** Tolerant read of the persisted layout. A corrupt or unknown-version
 *  payload (an array, a string, a future version) reads back as an empty
 *  layout — and an empty `order` (`{}`, no role keys) is the legal empty
 *  state, not a corrupt one. It is not a persistence channel and must never
 *  be trusted as one. Read has NO side effect: a bad record is left as-is,
 *  never repaired on read (mirrors the filter-store read path). */
const readFolderLayout = (map: MapLike): FolderLayout => {
  // The record has lived in two shapes: the flat v2 document (pre-envelope)
  // and the versioned envelope that wraps it today. `migrate` accepts only the
  // flat shape it can validate, so both read back the same layout.
  const loaded = loadVersionedObject<FolderLayout>(folderLayoutKey(map), {
    version: FOLDER_LAYOUT_VERSION,
    migrate: raw => (isFolderLayout(raw) ? raw : null),
  });
  return loaded ?? emptyFolderLayout();
};

/** Write the layout record, always stamping version 2. */
const writeFolderLayout = (layout: FolderLayout, map: MapLike): void => {
  saveVersionedObject(folderLayoutKey(map), {
    version: FOLDER_LAYOUT_VERSION,
    data: { ...layout, version: FOLDER_LAYOUT_VERSION },
  });
};

/** Resolve a layer's effective folder assignment from the layout. A persisted
 *  members entry is the single source of truth (an empty string = materialised
 *  root); only when NO members entry exists does the author's declaration
 *  seed the assignment. */
const folderOf = (layout: FolderLayout, layer: LayerInfo): string | null => {
  const assigned = layout.members[layer.id];
  const folder = assigned !== undefined ? assigned.folder : (layer.folder ?? "");
  // The folder's IDENTITY is its normalised key: order, folders and every
  // block map are keyed by it, so a raw author spelling ("Roads") must never
  // leak out of here — a caller comparing it to a key would silently miss the
  // layer.
  return folder === "" ? null : normalizeFolderName(folder);
};

/** The display spelling for a folder key: the directory entry's name, or the
 *  key itself when the folder has no directory entry yet. One reader for both
 *  a member-bearing block and an empty folder that only owns an order key. */
const folderDisplayNameOf = (layout: FolderLayout, key: string): string =>
  layout.folders.find(f => f.key === key)?.name ?? key;

/** Every folder key one role holds: its block order plus its live member
 *  assignments, unioned. An empty folder (created but not yet holding a layer)
 *  is in the order; an author-declared folder the user has not touched is only
 *  in `members`. Reading one of the two would miss the other. */
const folderKeysOfRole = (layout: FolderLayout, role: LayerRole): string[] => {
  const keys = new Set<string>(folderEntries(layout.order[role] ?? []));
  for (const m of Object.values(layout.members)) {
    if (m.role === role && m.folder) keys.add(m.folder);
  }
  return [...keys];
};

/** The default name for a new folder: `base`, or the smallest free ordinal
 *  suffix so a second create never collides with the first. */
const nextFolderDefaultName = (
  layout: FolderLayout,
  role: LayerRole,
  base: string,
): string => {
  const taken = new Set(folderKeysOfRole(layout, role));
  if (!taken.has(normalizeFolderName(base))) return base;
  // Bounded by construction: `taken.size + 1` distinct candidates cannot all
  // be taken, so the loop provably terminates instead of relying on "it will
  // run out eventually". The stem is shortened to leave room for the suffix —
  // a base near FOLDER_NAME_MAX would otherwise produce an over-long candidate
  // that createFolder rejects as `too-long`, and "new folder" would look like
  // it did nothing.
  for (let n = 2; n <= taken.size + 2; n += 1) {
    const suffix = ` ${n}`;
    const room = FOLDER_NAME_MAX - [...suffix].length;
    const stem = [...base].slice(0, room).join("").trimEnd();
    const candidate = `${stem}${suffix}`;
    if (!taken.has(normalizeFolderName(candidate))) return candidate;
  }
  // unreachable: the range holds `taken.size + 1` distinct candidates while
  // `taken` holds `taken.size` keys, so one candidate is always free.
  /* v8 ignore next */
  return base;
};

/** Group one role's folder members into blocks, keyed by normalize(name).
 *  `registryEntries` is the WHOLE registry in anchor order; the block anchor
 *  is the member's GLOBAL index in it (not a per-role index), matching
 *  invariant 3's `rail@1 / Roads@3 / Roads@7` shape.
 *
 *  The member assignment is read from `members[layerId]` when present — the
 *  single source of truth once a layout exists — and falls back to the
 *  author's `layerInfo.folder` declaration ONLY when the layout has no entry
 *  for that layer (the seed rule). A persisted assignment never loses to an
 *  author declaration. */
const groupByFolder = (
  registryEntries: readonly LayerInfo[],
  role: LayerRole,
  layout: FolderLayout,
): Map<string, FolderBlock> => {
  const map = new Map<string, FolderBlock>();
  registryEntries.forEach((entry, globalIndex) => {
    if (entry.role !== role) return;
    // folderOf already returns the normalised key — normalising again would
    // only re-run NFC + whitespace + lowercase on a value that is already in
    // that form.
    const key = folderOf(layout, entry);
    if (!key) return;
    let block = map.get(key);
    if (!block) {
      // The directory entry's name is the current display spelling (a rename
      // updates it while keeping the key); a not-yet-directory member uses its
      // own spelling.
      const named = layout.folders.find(f => f.key === key);
      block = {
        key,
        displayName: named ? named.name : key,
        anchor: globalIndex,
        members: [],
      };
      map.set(key, block);
    }
    block.members.push(entry);
  });
  return map;
};

/** True when a layer is a ROOT layer of its role: no persisted assignment,
 *  or a materialised root pin (folder: ""). The author declaration only
 *  counts when no members entry exists at all. */
const isRootLayer = (layout: FolderLayout, entry: LayerInfo): boolean => {
  const assigned = layout.members[entry.id];
  if (assigned !== undefined) return assigned.folder === "";
  return !entry.folder;
};

/** The block display order for one role:
 *  (1) listed blocks in layout.order[role] list order, then (2+3) the
 *  unlisted folder blocks and unlisted root layers merged by registry
 *  anchor ascending — a single sorted pass, so a root layer registered
 *  between two author-declared folders sits between their blocks instead
 *  of after every folder. `registryEntries` is the WHOLE registry in anchor
 *  (registration) order so the global array index is the anchor axis.
 *  Pure: never mutates its inputs. */
/** One role's ordered blocks: folder blocks (empty ones included) and root
 *  layers, in the order the panel paints them.
 *
 *  This is the single source for BOTH the panel's row sequence and the stacking
 *  order. They used to be two implementations — the panel honoured the
 *  `layer:<id>` entries of the block order, `roleOrder` did not and appended
 *  every root layer after all blocks — so a root layer dragged between two
 *  folders showed in the right place and stacked in the wrong one (it painted
 *  under the folder below it). */
type RoleBlock =
  | { kind: "folder"; key: string; displayName: string; members: LayerInfo[] }
  | { kind: "layer"; info: LayerInfo };

const roleBlocks = (
  role: LayerRole,
  registryEntries: readonly LayerInfo[],
  layout: FolderLayout,
): RoleBlock[] => {
  const folders = groupByFolder(registryEntries, role, layout);
  const listed = layout.order[role] ?? [];
  const listedKeys = new Set(listed);
  // Root layers carry their own registry index (the anchor axis) so the merge
  // pass needs no lookup map - 'at' IS the registry index, exactly what the
  // indexById map used to resolve, and no unreachable fallback can hide.
  const rootLayers: { at: number; info: LayerInfo }[] = [];
  registryEntries.forEach((entry, idx) => {
    if (entry.role === role && isRootLayer(layout, entry)) {
      rootLayers.push({ at: idx, info: entry });
    }
  });
  const rootById = new Map(rootLayers.map(({ info }) => [info.id, info]));
  const out: RoleBlock[] = [];
  // 1. The listed block order. An entry is a folder key or `layer:<id>`, so a
  //    root layer can sit between two folder blocks instead of only after all
  //    of them.
  for (const entry of listed) {
    if (isRootLayerEntry(entry)) {
      const info = rootById.get(entry.slice(ROOT_LAYER_PREFIX.length));
      if (info) out.push({ kind: "layer", info });
      continue;
    }
    const block = folders.get(entry);
    // An empty folder (created but not yet holding a layer) has no members, so
    // groupByFolder cannot see it. It still owns a row: the user names it right
    // after creating it, and the row is the only handle for renaming/deleting
    // it until a layer moves in.
    out.push({
      kind: "folder",
      key: entry,
      displayName: block?.displayName ?? folderDisplayNameOf(layout, entry),
      members: block?.members ?? [],
    });
  }
  // 2+3. Unlisted folders and root layers, merged by anchor. The anchor is the
  //    registry index (groupByFolder stores it as block.anchor; root layers
  //    carry it directly). A single sorted pass avoids the two-segment split
  //    where every unlisted folder always preceded every unlisted root layer
  //    regardless of registration order — the root cause of the
  //    author-declared-folder-order bug.
  type Slot = { at: number; block: RoleBlock };
  const slots: Slot[] = [];
  for (const block of [...folders.values()]) {
    if (listedKeys.has(block.key)) continue;
    slots.push({
      at: block.anchor,
      block: {
        kind: "folder",
        key: block.key,
        displayName: block.displayName,
        members: block.members,
      },
    });
  }
  for (const { at, info } of rootLayers) {
    if (listedKeys.has(rootLayerEntry(info.id))) continue;
    slots.push({ at, block: { kind: "layer", info } });
  }
  slots.sort((a, b) => a.at - b.at);
  for (const slot of slots) out.push(slot.block);
  return out;
};

/** One role's layer order (the stacking order): the block sequence flattened. */
const roleOrder = (
  role: LayerRole,
  registryEntries: readonly LayerInfo[],
  layout: FolderLayout,
): LayerInfo[] =>
  roleBlocks(role, registryEntries, layout).flatMap(block =>
    block.kind === "folder" ? block.members : [block.info],
  );

/** The full panel display order: overlay role then base role, each in
 *  its own two-segment order. `registryEntries` is the WHOLE registry in
 *  anchor order. */
const fullDisplayOrder = (
  registryEntries: readonly LayerInfo[],
  layout: FolderLayout,
): LayerInfo[] => [
  ...roleOrder("overlay", registryEntries, layout),
  ...roleOrder("base", registryEntries, layout),
];

/** The role's block order with every folder it holds listed, in anchor order.
 *  Author-declared folders live in `members`, not in `order`, so a role whose
 *  folders are all author-declared has an empty order; this is the one place
 *  that turns "what the role holds" into "the order its blocks appear in". */
const freezeRoleOrder = (
  layout: FolderLayout,
  role: LayerRole,
  registryEntries: readonly LayerInfo[],
  key: string,
): FolderLayout => {
  // The block order is single-sourced from roleBlocks (the merge-by-anchor
  // result) — the SAME sequence seedBlockOrder returns. Root-layer entries stay
  // interleaved with folder blocks at their anchor positions instead of being
  // pushed to the tail, and the frozen key is guaranteed present (an emptied
  // folder's block must survive at its position for the clean button to reach).
  const frozen = seedBlockOrder(layout, role, registryEntries);
  if (!frozen.includes(key)) frozen.push(key);
  return { ...layout, order: { ...layout.order, [role]: frozen } };
};

/** Merge the author's declared grouping into a layout: folder directory from
 *  the declarations (first-seen spelling wins, keyed by normalize), members
 *  from each registered layer's declared folder.
 *
 *  Only layers WITHOUT an assignment get one — a user pin (root or a different
 *  folder) wins — and only new folder keys get a directory entry. The block
 *  order is untouched: declarations do not force an order, freeze/create
 *  materialises it.
 *
 *  Pure: returns the same layout when nothing changed, so the manager can skip
 *  the write. This is the ONE seeding rule; the manager's `seed()` is a thin
 *  wrapper over it, so a test that drives this function drives production. */
const mergeDeclaredFolders = (
  layout: FolderLayout,
  registryEntries: readonly LayerInfo[],
): FolderLayout => {
  const byKey = new Map<string, FolderEntry>();
  for (const f of layout.folders) byKey.set(f.key, f);
  const members = { ...layout.members };
  let folders = layout.folders;
  let changed = false;
  for (const entry of registryEntries) {
    const folder = entry.folder;
    if (!folder) continue;
    const key = normalizeFolderName(folder);
    if (members[entry.id]) continue; // user pin or existing assignment wins
    if (!byKey.has(key)) {
      const name = folderDisplayName(folder);
      byKey.set(key, { key, name });
      folders = [...folders, { key, name }];
    }
    members[entry.id] = { role: entry.role, folder: key };
    changed = true;
  }
  return changed ? { ...layout, folders, members } : layout;
};

/** Create a folder: append the new key to the role's block order and add
 *  it to the identity directory. Same-role duplicates (directory, order or
 *  live member) are refused. Pure: returns the same layout on a no-op.
 *
 *  Pass `registryEntries` to seed the block order from roleBlocks (the
 *  merge-by-anchor result): root layers keep their anchor slots instead of
 *  being pushed to the tail after every folder. */
const createFolder = (
  layout: FolderLayout,
  role: LayerRole,
  name: string,
  registryEntries?: readonly LayerInfo[],
): FolderLayout => {
  const key = normalizeFolderName(name);
  if (key === "") return layout;
  // Single-source the existing block order from roleBlocks (the merge-by-anchor
  // result), exactly as freezeRoleOrder does: root layers keep their anchor
  // slots instead of being pushed to the tail after every folder.
  const order = seedBlockOrder(layout, role, registryEntries ?? []);
  if (order.includes(key)) return layout; // same-role duplicate refused
  // A different role may already hold this key: base and overlay folders
  // with the same name are two different folders (role-scoped identity).
  const existing = layout.folders.find(f => f.key === key);
  const folderEntry = existing ?? { key, name: folderDisplayName(name) };
  return {
    ...layout,
    folders: existing ? layout.folders : [...layout.folders, folderEntry],
    order: { ...layout.order, [role]: [...order, key] },
  };
};

/** Rename a folder's DISPLAY NAME without touching its identity key or any
 *  member assignment. The directory entry's name is rewritten (and created
 *  when the folder was live-only); the block-order key and every member
 *  assignment keep their key, so the block stays put and the rename is pure
 *  display. Pure: returns the same layout on a no-op / blank new name. */
const renameFolder = (
  layout: FolderLayout,
  role: LayerRole,
  key: string,
  newName: string,
): FolderLayout => {
  // The key is the folder's identity — fold state, block order and every member
  // assignment reference it — so a rename moves the DISPLAY name only. Taking
  // the old display name here instead would break the identity the moment the
  // two diverge: normalizeFolderName(displayName) is no longer the key, and the
  // next rename / delete / drag-into would all miss the folder.
  const newKey = normalizeFolderName(newName);
  if (newKey === "") return layout;
  // A folder exists when the directory, the block order OR a live member
  // assignment names it: an author-declared folder that the user has not
  // touched yet lives only in `members`, and the controller's existence check
  // already counts that. Reading only the first two would answer "renamed"
  // while returning the layout unchanged.
  const hasOld =
    layout.folders.some(f => f.key === key) ||
    (layout.order[role] ?? []).includes(key) ||
    Object.values(layout.members).some(m => m.role === role && m.folder === key);
  if (!hasOld) return layout;
  // A rename to a name another folder already owns is refused; renaming to the
  // folder's own normalised name is a display-only change and stays allowed.
  if (newKey !== key && layout.folders.some(f => f.key === newKey)) return layout;
  const folders = layout.folders.some(f => f.key === key)
    ? layout.folders.map(f =>
        f.key === key ? { ...f, name: folderDisplayName(newName) } : f,
      )
    : [...layout.folders, { key, name: folderDisplayName(newName) }];
  return { ...layout, folders };
};

/** Delete a folder: remove its directory entry and block-order key, and pin
 *  every assigned member to ROOT (folder: "" — the layer stays registered and
 *  visible, only its folder association drops; the pin wins over the author
 *  declaration, so a deleted folder is not re-created by the seed fallback). */
const deleteFolder = (
  layout: FolderLayout,
  role: LayerRole,
  key: string,
): FolderLayout => {
  // The key, not the display name: a renamed folder's display name no longer
  // normalises to its key, so a name-keyed delete would silently miss it.
  const order = layout.order[role] ?? [];
  const members = { ...layout.members };
  for (const [id, a] of Object.entries(members)) {
    if (a.role === role && a.folder === key) {
      members[id] = { role, folder: "" };
    }
  }
  return {
    ...layout,
    folders: layout.folders.filter(f => f.key !== key),
    order: { ...layout.order, [role]: order.filter(k => k !== key) },
    members,
  };
};

/** Move one folder block to a new position in its role's block order. The
 *  target is another folder key of the same role; `after` places the moved
 *  block after the target, otherwise before it. A key or target the role does
 *  not list is a no-op (returns the same layout), so a drag that outlived a
 *  rename or a delete cannot corrupt the order. Pure: returns a new layout. */
const moveFolder = (
  layout: FolderLayout,
  role: LayerRole,
  key: string,
  targetKey: string,
  after: boolean,
): FolderLayout => {
  if (key === targetKey) return layout;
  const listed = layout.order[role] ?? [];
  if (!listed.includes(key) || !listed.includes(targetKey)) return layout;
  const rest = listed.filter(k => k !== key);
  const at = rest.indexOf(targetKey);
  rest.splice(after ? at + 1 : at, 0, key);
  return { ...layout, order: { ...layout.order, [role]: rest } };
};

/** Assign a layer to a folder. When the target folder has no block order key
 *  yet, it is materialised (appended to the role's block tail) so the
 *  moved layer lands in a visible block. */
const moveLayerToFolder = (
  layout: FolderLayout,
  layerId: string,
  role: LayerRole,
  folderKey: string,
): FolderLayout => {
  const key = normalizeFolderName(folderKey);
  if (key === "") return layout;
  const order = layout.order[role] ?? [];
  const nextOrder = order.includes(key) ? order : [...order, key];
  return {
    ...layout,
    // The layer is no longer a root block: its order entry goes with the
    // assignment, or the same layer would render twice.
    order: {
      ...layout.order,
      [role]: nextOrder.filter(entry => entry !== rootLayerEntry(layerId)),
    },
    members: { ...layout.members, [layerId]: { role, folder: key } },
  };
};

/** The role's block order with every folder listed in anchor order, keeping
 *  the existing root-layer entries. A move needs this first: an author-declared
 *  folder lives only in `members`, so an empty order cannot address it by key
 *  and the move would fall back to appending — which renders the folder (or the
 *  moved layer) at the head of the role instead of where the user dropped it. */
const seedBlockOrder = (
  layout: FolderLayout,
  role: LayerRole,
  registryEntries: readonly LayerInfo[],
): string[] =>
  roleBlocks(role, registryEntries, layout).map(block =>
    block.kind === "folder" ? block.key : rootLayerEntry(block.info.id),
  );

/** Move a layer to its role's root, positioned before `beforeEntry` in the
 *  block order (null appends at the tail). `beforeEntry` is a block-order
 *  entry — a folder key or `layer:<id>` — so a layer can be dropped between
 *  two folder blocks, not only after all of them. */
const moveLayerToRootAt = (
  layout: FolderLayout,
  layerId: string,
  role: LayerRole,
  beforeEntry: string | null,
): FolderLayout => {
  const entry = rootLayerEntry(layerId);
  const order = (layout.order[role] ?? []).filter(k => k !== entry);
  const at = beforeEntry === null ? -1 : order.indexOf(beforeEntry);
  if (at === -1) order.push(entry);
  else order.splice(at, 0, entry);
  return {
    ...layout,
    order: { ...layout.order, [role]: order },
    members: { ...layout.members, [layerId]: { role, folder: "" } },
  };
};

/** Return a layer to ROOT: its assignment is pinned (folder: "") so the layer
 *  stays at root even when the author declared a folder — the user's action
 *  overrides the declaration. */
const moveLayerToRoot = (
  layout: FolderLayout,
  layerId: string,
  role: LayerRole,
): FolderLayout => {
  const existing = layout.members[layerId];
  if (existing?.folder === "") return layout;
  return {
    ...layout,
    members: { ...layout.members, [layerId]: { role, folder: "" } },
  };
};

/** Drop one layer's assignment entirely (the deleteLayer path): the layer is
 *  gone, so its member entry goes with it, but an emptied folder's order key
 *  SURVIVES (the automatic freeze), so the block stays put for the clean
 *  button. */
const dropLayer = (layout: FolderLayout, layerId: string): FolderLayout => {
  const entry = rootLayerEntry(layerId);
  const hasRootEntry = Object.values(layout.order).some(order => order.includes(entry));
  if (!(layerId in layout.members) && !hasRootEntry) return layout;
  const members = { ...layout.members };
  delete members[layerId];
  const order: FolderLayout["order"] = {};
  for (const [role, entries] of Object.entries(layout.order)) {
    order[role as LayerRole] = entries.filter(k => k !== entry);
  }
  return { ...layout, members, order };
};

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
const createFolderLayoutManager = (map: MapLike): FolderLayoutManager => {
  let current: FolderLayout = readFolderLayout(map);
  let timer: Debounced | null = null;
  const write = (): void => {
    writeFolderLayout(current, map);
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
      current = readFolderLayout(map);
      return current;
    },
    seed(registryEntries: readonly LayerInfo[]): void {
      // Safe to call every init, even when a persisted layout already exists:
      // the merge rule lives in `mergeDeclaredFolders` and returns the same
      // layout when nothing changed, so an unchanged seed schedules no write.
      const next = mergeDeclaredFolders(current, registryEntries);
      if (next !== current) current = next;
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
  api.folderLayout ??= createFolderLayoutManager(map);
  return api.folderLayout;
};

export {
  folderLayoutKey,
  FOLDER_NAME_MAX,
  normalizeFolderName,
  folderDisplayName,
  folderNameLength,
  folderNameTooLong,
  emptyFolderLayout,
  ensureFolderLayout,
  createFolderLayoutManager,
  readFolderLayout,
  writeFolderLayout,
  isFolderLayout,
  mergeDeclaredFolders,
  folderOf,
  folderDisplayNameOf,
  folderKeysOfRole,
  nextFolderDefaultName,
  folderEntries,
  groupByFolder,
  roleBlocks,
  roleOrder,
  fullDisplayOrder,
  freezeRoleOrder,
  createFolder,
  moveLayerToRootAt,
  rootLayerEntry,
  seedBlockOrder,
  renameFolder,
  deleteFolder,
  moveFolder,
  moveLayerToFolder,
  moveLayerToRoot,
  dropLayer,
};
export type { FolderLayout, FolderEntry, FolderMember, FolderLayoutManager };

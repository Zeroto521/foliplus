// core/layer/folderView — the read-only folder layout view derived from the order doc.
//
// The order document (core/layer/order) is the single order source; this module is the
// READ-side projection the panel consumes (projectFolderViewOf derives a FolderView
// from the doc, and the controller holds it as the derived mirror). It owns:
//   - the FolderView / FolderEntry / FolderMember view shapes,
//   - the pure read helpers over a layout (folderOf / folderKeysOfRole /
//     nextFolderDefaultName / folderEntries / groupByFolder / rootLayerEntry).
//
// There is NO persistence here: the order doc is persisted (layout/persist),
// the layout mirror is never written, and a folder's create / rename / delete /
// move now goes through the core/layer/order commands + applyDoc.
//
// The identity key = (role, normalize(name)); normalize = NFC → whitespace fold
// → trim → casefold (locale-independent). displayName = first-seen original
// (trim only) — never used for merge / sort / store.
import { FOLDER_NAME_MAX, normalizeFolderName } from "./folderName.js";
import type { LayerRole } from "./role.js";
import type { LayerInfo } from "./type.js";

/** One folder identity entry: stable key + the display name a rename rewrites
 *  (rename never touches the key — see the order command). */
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

/** The derived folder layout view. The controller builds it from the order doc
 *  (projectFolderViewOf) and never persists it; folder identity, block order and
 *  member assignment are projections of the doc's node tree. */
interface FolderView {
  /** Folder identity directory: stable keys + display names. */
  folders: FolderEntry[];
  /** Per-role ordered folder key array = block order (the order is the truth:
   *  a drag re-writes the doc, and this mirror re-projects it). */
  order: Partial<Record<LayerRole, string[]>>;
  /** layerId → assignment (derived from the doc's node parent). */
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

/** Resolve a layer's effective folder assignment from the layout. A derived
 *  members entry is the single source of truth (an empty string = materialised
 *  root); only when NO members entry exists does the author's declaration seed
 *  the assignment. */
const folderOf = (layout: FolderView, layer: LayerInfo): string | null => {
  const assigned = layout.members[layer.id];
  const folder = assigned !== undefined ? assigned.folder : (layer.folder ?? "");
  // The folder's IDENTITY is its normalised key: order, folders and every
  // block map are keyed by it, so a raw author spelling ("Roads") must never
  // leak out of here — a caller comparing it to a key would silently miss the
  // layer.
  return folder === "" ? null : normalizeFolderName(folder);
};

/** Every folder key one role holds: its block order plus its live member
 *  assignments, unioned. An empty folder (created but not yet holding a layer)
 *  is in the order; an author-declared folder the user has not touched is only
 *  in `members`. Reading one of the two would miss the other. */
const folderKeysOfRole = (layout: FolderView, role: LayerRole): string[] => {
  const keys = new Set<string>(folderEntries(layout.order[role] ?? []));
  for (const m of Object.values(layout.members)) {
    if (m.role === role && m.folder) keys.add(m.folder);
  }
  return [...keys];
};

/** The default name for a new folder: `base`, or the smallest free ordinal
 *  suffix so a second create never collides with the first. */
const nextFolderDefaultName = (
  layout: FolderView,
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
  layout: FolderView,
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

export {
  folderEntries,
  folderKeysOfRole,
  folderOf,
  groupByFolder,
  nextFolderDefaultName,
  rootLayerEntry,
};
export type { FolderView, FolderEntry, FolderMember };

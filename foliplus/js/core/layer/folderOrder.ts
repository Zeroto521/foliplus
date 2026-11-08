// core — folderOrder: the collection-level folder ordering domain.
//
// The one pure place that turns a section's registry entries (in registration /
// anchor order) into the two-segment display order the panel renders:
//   [ listed folders (folderOrder) in list order, unlisted folders by anchor,
//     root layers (no folder) in anchor order ].
//
// The design is frozen at .foliplus/design/folder-order.md (rev 2):
//   - identity key = (section, normalize(name)); normalize = NFC → whitespace
//     fold → trim → casefold (locale-independent).
//   - displayName = first-seen original (trim only) — never used for
//     merge / sort / store.
//   - block anchor = min(member global registry index); within a section
//     Folder blocks come first, then root Layer blocks.
//   - folderOrder (per section, ordered normalize(name)[]) is highest
//     priority; listed folders in list order, unlisted by anchor, list-only
//     names ignored.
//   - empty-folder freeze materialises the section's whole block order before
//     the last member is removed; deleteFolder removes a name from the list.
//
// This module is DOM-free and dependency-light (LayerInfo is a type only), so
// it is unit-testable in isolation — the invariant tests drive it directly.
import type { LayerRole } from "./role.js";
import type { LayerInfo } from "./type.js";

/** The folder dimension: a folder is scoped to one section (role). Base and
 *  overlay folders with the same name are two different folders. */
type FolderSection = LayerRole;

/** The persisted folder-order record. One ordered array of normalised folder
 *  names per section; the array is the full block order once a section has
 *  been frozen, a partial (listed-first) order otherwise. */
type FolderOrder = {
  version: 1;
  sections: Partial<Record<FolderSection, string[]>>;
};

/** One folder block: every member sharing (section, normalize(name)). */
interface FolderBlock {
  /** The identity key = normalize(displayName). Never used for display. */
  key: string;
  /** The first-seen original folder spelling (trim only). */
  displayName: string;
  /** Block anchor = min(member GLOBAL registry index). */
  anchor: number;
  /** Members in registry (anchor) order. */
  members: LayerInfo[];
}

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

/** Group one section's folder members into blocks, keyed by normalize(name).
 *  `registryEntries` is the WHOLE registry in anchor order; the block anchor
 *  is the member's GLOBAL index in it (not a per-section index), matching
 *  invariant 3's `rail@1 / Roads@3 / Roads@7` shape. */
const groupByFolder = (
  registryEntries: readonly LayerInfo[],
  section: FolderSection,
): Map<string, FolderBlock> => {
  const map = new Map<string, FolderBlock>();
  registryEntries.forEach((entry, globalIndex) => {
    if (entry.role !== section) return;
    if (!entry.folder) return;
    const key = normalizeFolderName(entry.folder);
    let block = map.get(key);
    if (!block) {
      block = {
        key,
        displayName: folderDisplayName(entry.folder),
        anchor: globalIndex,
        members: [],
      };
      map.set(key, block);
    }
    block.members.push(entry);
    /* v8 ignore next -- forward pass keeps globalIndex >= block.anchor; defensive */
    if (globalIndex < block.anchor) block.anchor = globalIndex;
  });
  return map;
};

/** The two-segment display order for one section:
 *  (1) listed folders in folderOrder list order, (2) unlisted folders by
 *  anchor ascending appended after them, (3) root layers (no folder) in
 *  anchor order at the end. `registryEntries` is the WHOLE registry in
 *  anchor (registration) order so the global array index is the anchor axis.
 *  Pure: never mutates its inputs. */
const sectionOrder = (
  section: FolderSection,
  registryEntries: readonly LayerInfo[],
  folderOrder: FolderOrder,
): LayerInfo[] => {
  const folders = groupByFolder(registryEntries, section);
  const listed = folderOrder.sections[section] ?? [];
  const listedKeys = new Set(listed);
  const blocks: FolderBlock[] = [];
  // (1) listed folders in list order
  for (const key of listed) {
    const block = folders.get(key);
    if (block) blocks.push(block);
  }
  // (2) unlisted folders by anchor asc, appended after the listed blocks
  const rest = [...folders.values()]
    .filter(block => !listedKeys.has(block.key))
    .sort((a, b) => a.anchor - b.anchor);
  blocks.push(...rest);
  // (3) root layers of the section at the end, in anchor order
  const rootLayers = registryEntries.filter(
    entry => entry.role === section && !entry.folder,
  );
  return [...blocks.flatMap(block => block.members), ...rootLayers];
};

/** The full panel display order: overlay section then base section, each in
 *  its own two-segment order. `registryEntries` is the WHOLE registry in
 *  anchor order. */
const fullDisplayOrder = (
  registryEntries: readonly LayerInfo[],
  folderOrder: FolderOrder,
): LayerInfo[] => [
  ...sectionOrder("overlay", registryEntries, folderOrder),
  ...sectionOrder("base", registryEntries, folderOrder),
];

/** Materialise a section's whole block order into `folderOrder` — the
 *  empty-folder freeze. Must be called with the PRE-removal registry snapshot
 *  (the folder still has its last member) so its block is part of the order;
 *  the section then runs on the explicit list and a later new folder lands at
 *  the block tail (invariant 9). `emptyKey` is the normalize(name) of the
 *  folder being emptied, appended if the snapshot missed it. */
const freezeSectionOrder = (
  section: FolderSection,
  registryEntries: readonly LayerInfo[],
  folderOrder: FolderOrder,
  emptyKey: string,
): FolderOrder => {
  const current = sectionOrder(section, registryEntries, folderOrder);
  const keys = current
    .filter(entry => entry.folder)
    .map(entry => normalizeFolderName(entry.folder as string));
  if (!keys.includes(emptyKey)) keys.push(emptyKey);
  return {
    ...folderOrder,
    sections: { ...folderOrder.sections, [section]: keys },
  };
};

/** Remove a folder name from `folderOrder` — the write-side cleanup that
 *  stops an emptied folder's stale key from accumulating forever (the read
 *  side already ignores names with no live folder). */
const deleteFolderFromOrder = (
  section: FolderSection,
  name: string,
  folderOrder: FolderOrder,
): FolderOrder => {
  const key = normalizeFolderName(name);
  const listed = folderOrder.sections[section] ?? [];
  return {
    ...folderOrder,
    sections: {
      ...folderOrder.sections,
      [section]: listed.filter(k => k !== key),
    },
  };
};

export {
  normalizeFolderName,
  sectionOrder,
  fullDisplayOrder,
  freezeSectionOrder,
  deleteFolderFromOrder,
};
export type { FolderOrder, FolderSection };

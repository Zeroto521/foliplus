// core/layer/layoutDoc — the v2 folder layout document (one storage key).
//
// The v1 `FolderOrder` held only the block order (`{version:1,sections}`), with
// member ownership living in `LayerInfo.folder` (the author's CONF declaration).
// That meant a user move / rename only mutated in-memory `member.folder` and
// reverted to the author state on reload (risk R3). The layout document upgrades
// the persisted object to one record that holds the folder identity/name
// catalog, the per-section block order, and the per-layer member ownership
// together — one storage key, one snapshot, one source of truth.
//
// This module is the storage/ownership side: the tolerant read (reads must
// never write — a corrupt payload reads back as an empty layout, never gets
// repaired), the single per-map singleton (mirrors ensureFilterStore), and the
// v1 -> v2 migration. The pure display-order functions live in folderOrder.ts.
//
// No DOM, no Leaflet. Storage goes through #platform/storage.js.
import {
  type FolderOrder,
  type FolderSection,
  type LayoutDocument,
  emptyLayoutDoc,
  normalizeFolderName,
} from "./folderOrder.js";
import type { LayerInfo } from "./type.js";
import { ensureMapFoliplus } from "#core/mapApi.js";
import { loadRecord, saveRecord } from "#platform/storage.js";

/** The single storage key the layout document lives under. One key, indexed by
 *  layer id inside the record — never a per-folder or per-layer key assembled
 *  at the call site (the filterStore single-key precedent). */
const LAYOUT_DOC_KEY = "foliplus_layer_layout";

/** Tolerant read of the persisted layout document. A corrupt or non-record
 *  payload (an array, a string, a record missing folders/order/members) reads
 *  back as an EMPTY layout — it is not a persistence channel and must never be
 *  trusted as one. Unknown future versions read back empty too (we do not
 *  guess a shape we have never seen). Reads never write: no repair, no
 *  re-stamp, no side effect. */
const readLayoutDoc = (): LayoutDocument => {
  const loaded = loadRecord<unknown>(LAYOUT_DOC_KEY);
  if (!isLayoutDoc(loaded)) return emptyLayoutDoc();
  return loaded;
};

/** Shape guard for the v2 document. `version === 2` is the only accepted
 *  shape; anything else (including a future version) is not a v2 layout. */
const isLayoutDoc = (value: unknown): value is LayoutDocument => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 2) return false;
  if (!Array.isArray(v.folders)) return false;
  if (
    !v.folders.every(f => {
      const folderEntry = f as Record<string, unknown>;
      return (
        typeof folderEntry.key === "string" && typeof folderEntry.name === "string"
      );
    })
  ) {
    return false;
  }
  if (!v.order || typeof v.order !== "object") return false;
  const order = v.order as Record<string, unknown>;
  for (const [sec, keys] of Object.entries(order)) {
    if (sec !== "overlay" && sec !== "base") {
      return false;
    }
    if (!Array.isArray(keys) || !keys.every(k => typeof k === "string")) return false;
  }
  if (!v.members || typeof v.members !== "object") return false;
  const members = v.members as Record<string, unknown>;
  for (const [, m] of Object.entries(members)) {
    const mo = m as Record<string, unknown>;
    if (!mo || typeof mo !== "object") return false;
    const sec = mo.section;
    if (sec !== "overlay" && sec !== "base") return false;
    if (typeof mo.folder !== "string") {
      return false;
    }
  }
  return true;
};

/** Write the layout document, stamping `version: 2`. */
const writeLayoutDoc = (layout: LayoutDocument): void => {
  saveRecord(LAYOUT_DOC_KEY, { ...layout, version: 2 });
};

/** Migrate a v1 `FolderOrder` (plus the live registry) into a v2 layout
 *  document. Pure: never writes storage, never mutates inputs.
 *
 *  The v1 record's `sections` only lists folders that were frozen or created;
 *  a section that was never frozen has an EMPTY `sections` entry while its
 *  layers still sit in author-declared folders. So both the folders catalog
 *  AND the members map are derived from the registry's `layerInfo.folder`
 *  (the author declaration), UNION the v1 sections keys (which may name a
 *  frozen empty folder with no live member). The `order` array is the v1
 *  `sections` array VERBATIM (a frozen empty key must survive, risk R1).
 *
 *  This makes migration behavior-equivalent: the v2 display order produced
 *  from the migrated document equals the v1 display order block-for-block,
 *  including the never-frozen case where v1 `sections` was empty. */
const migrateV1toV2 = (
  v1: FolderOrder,
  registryEntries: readonly LayerInfo[],
): LayoutDocument => {
  const layout = emptyLayoutDoc();
  // Pass 1: author-declared folders from the registry (first-seen spelling wins).
  for (const entry of registryEntries) {
    if (!entry.folder) continue;
    const key = normalizeFolderName(entry.folder);
    const section = entry.role as FolderSection;
    layout.folders.push({ key, name: entry.folder.trim() });
    layout.members[entry.id] = { section, folder: key };
  }
  // Pass 2: v1 sections keys (frozen/created folders, may have no live member).
  for (const section of ["overlay", "base"] as const) {
    const listed = v1.sections[section] ?? [];
    if (listed.length > 0) layout.order[section] = [...listed];
    for (const key of listed) {
      if (!layout.folders.some(f => f.key === key)) {
        layout.folders.push({ key, name: key });
      }
    }
  }
  // Deduplicate the folders catalog (same key may appear via both passes).
  const seen = new Set<string>();
  layout.folders = layout.folders.filter(f => {
    if (seen.has(f.key)) return false;
    seen.add(f.key);
    return true;
  });
  return layout;
};

/** The per-map layout-document singleton (mirrors ensureFilterStore): one
 *  document per map, cached on the per-map namespace so every control shares
 *  the same ownership truth. */
const ensureLayoutDoc = (map: L.Map): LayoutDocument => {
  const api = ensureMapFoliplus(map);
  api.layoutDoc ??= readLayoutDoc();
  return api.layoutDoc;
};

export {
  LAYOUT_DOC_KEY,
  ensureLayoutDoc,
  readLayoutDoc,
  writeLayoutDoc,
  migrateV1toV2,
};
export type { LayoutDocument };

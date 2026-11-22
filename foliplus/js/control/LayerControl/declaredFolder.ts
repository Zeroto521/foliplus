// control/LayerControl/declaredFolder — author-declared default fold state + the
// effective fold resolution the panel renders with.
//
// The author writes LayerControl(folders={"overlay": [{"name": "业务数据",
// "folded": True}], ...}) in Python; this module derives the author's default
// folded-folder key set from that CONF payload, and resolves the effective
// fold state a folder row renders with. The derivation is pure (DOM-free,
// storage-free) so it is unit-testable in isolation.
//
// The priority chain is frozen at .foliplus/design/folder-final-design.md §2.2:
//   built-in (expanded) < author default (this module) < user override
// (the persisted foldedRoles set). A user's manual FOLD always wins and
// then stops the author default from affecting that folder; Reset clears
// the user override and falls back to the author default.
//
// The user override is a tri-state map (absent | true | false), the same shape
// the role fold uses: an explicit EXPAND over an author default fold has to be
// distinguishable from "never touched", or an author-folded folder can never
// be opened by hand.
import { normalizeFolderName } from "#core/layer/index.js";
import type { FolderDefaults } from "#foliplus/config-schema.js";

/** The key separator between the role and the normalized folder name. The
 *  folder's identity is its role plus its normalized name (a rename is a new
 *  folder, matching the layout model), so the persisted fold state keys on
 *  that identity. This is the ONE place the separator lives: the toggle
 *  primitive and this derivation must agree, or a toggle writes a key the
 *  renderer never reads. */
const FOLDER_FOLD_KEY_SEP = "::";

/** Build the persisted folder-fold key: `role::normalizedFolderName`. */
const folderFoldKey = (role: string, name: string): string =>
  role + FOLDER_FOLD_KEY_SEP + normalizeFolderName(name);

/** Derive the author's default folded-folder key set from the CONF payload.
 *
 *  `folders` is the Python LayerControl(folders=...) config (already
 *  normalised on the Python side). A section key outside overlay/base is
 *  impossible (the Python normaliser drops it), but the type is the contract
 *  and this derivation is tolerant: an unknown section is skipped, an entry
 *  without `folded: true` is expanded (the built-in default), and a
 *  missing name is skipped. The returned set uses the same
 *  `role::normalizedFolderName` keys the toggle primitive writes, so the
 *  author default and the user override compare on one vocabulary.
 *
 *  @param {FolderDefaults | null | undefined} folders - The CONF.folders
 *    payload, or null when the author declared none.
 *  @returns {Set<string>} The author-folded key set (empty when none).
 */
const authorFoldedKeys = (folders: FolderDefaults | null | undefined): Set<string> => {
  const keys = new Set<string>();
  if (!folders) return keys;
  // Only the two declared sections are folder roles; the Python normaliser
  // drops anything else, and this derivation mirrors that (a stray key in a
  // hand-built CONF must not become a fold state).
  for (const role of ["overlay", "base"] as const) {
    const entries = folders[role];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry.name !== "string" || entry.folded !== true) continue;
      keys.add(folderFoldKey(role, entry.name));
    }
  }
  return keys;
};

/** Resolve the effective fold state a folder row renders with.
 *
 *  Priority: user opinion (either direction) > author default > expanded.
 *  The user opinion is the persisted `foldedFolders` map, written by the
 *  panel's own toggle and by expand-all/collapse-all; the author default is
 *  {@link authorFoldedKeys}. A user's explicit EXPAND therefore wins over an
 *  author default fold — without that, an author-folded folder could never be
 *  opened by hand.
 *
 *  @param {ReadonlySet<string>} authorKeys - The author default folded keys.
 *  @param {Readonly<Record<string, boolean>>} userOpinion - The user override.
 *  @param {string} role - A LayerRole ("base" | "overlay").
 *  @param {string} name - The folder display name.
 *  @returns {boolean} True when the folder renders folded.
 */
const effectiveFolderFolded = (
  authorKeys: ReadonlySet<string>,
  userOpinion: Readonly<Record<string, boolean>>,
  role: string,
  name: string,
): boolean => {
  const key = folderFoldKey(role, name);
  return userOpinion[key] ?? authorKeys.has(key);
};

export { folderFoldKey, authorFoldedKeys, effectiveFolderFolded };

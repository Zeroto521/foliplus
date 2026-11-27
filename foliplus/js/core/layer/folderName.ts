// core/layer/folderName — the single source for folder-name validation (cap, normalisation, display).
//
// The cap and the normalisation are shared by every entry a folder name can
// reach the panel through: the author's declaration (Python + the JS reader)
// and the panel's own create / rename paths. One invariant, one decision point.
//
// Pure functions, no DOM / CONFIG / persistence dependency. The name vocabulary
// lives here so the folder-layout manager (folderLayout) can own arrangement
// without also owning the name rules.

/** The longest folder name a declaration may carry, in Unicode code points.
 *  Mirrors FOLDER_NAME_MAX in Python's foliplus/_declaration/key.py: a folder
 *  name is a short label read on a list row, not a data field, and the cap
 *  must match across stacks so Python and JS cannot disagree about which
 *  names reach the panel. */
export const FOLDER_NAME_MAX = 64;

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
export const normalizeFolderName = (name: string): string =>
  name.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

/** The display spelling for a folder: trim only, no NFC / casefold. The
 *  first-seen raw spelling wins and is never normalised for display. */
export const folderDisplayName = (name: string): string => name.trim();

/** The length a folder name is judged by, in Unicode code points.
 *
 *  Measured on the normalised name - the same NFC / whitespace-fold / trim
 *  the panel shows, so padding cannot disguise a long name, and counted in
 *  code points rather than UTF-8 bytes, so a name heavy in non-BMP
 *  characters is judged by what the author reads. Mirrors the Python
 *  reader, which measures the identical normalisation. */
export const folderNameLength = (name: string): number =>
  [...name.normalize("NFC").replace(/\s+/g, " ").trim()].length;

/** Whether a folder name exceeds {@link FOLDER_NAME_MAX}.
 *
 *  The single decision point for the cap, so one invariant cannot be
 *  guarded at one entry and not another: the author's declaration (Python
 *  and the JS reader) and the panel's own create / rename paths all ask
 *  this. */
export const folderNameTooLong = (name: string): boolean =>
  folderNameLength(name) > FOLDER_NAME_MAX;

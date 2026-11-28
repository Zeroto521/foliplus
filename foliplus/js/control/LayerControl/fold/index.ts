// control/LayerControl/fold — barrel: the author-declared fold defaults.
//
// Fold dispatch is not declaration parsing: these two modules derive the
// author's default folded folder / role state from CONF and resolve the
// effective fold a row renders with (user override > author default > built-in
// expanded). Callers import from this barrel so the folder and role halves stay
// one channel and a later split does not leak into call sites.

export { authorFoldedKeys, effectiveFolderFolded, folderFoldKey } from "./folder.js";
export { authorDefaultRoleFolds, effectiveRoleFolded } from "./role.js";

// control/LayerControl/declaredRole — author-declared default fold state per
// role + the effective fold resolution the panel renders with.
//
// The author writes LayerControl(roles={"overlay": {"folded": True}, ...}) in
// Python; this module derives the author's default folded role map from that
// CONF payload, and resolves the effective fold state a role header renders
// with. The derivation is pure (DOM-free, storage-free) so it is unit-testable
// in isolation.
//
// The priority chain is the role analog of the folder design:
//   built-in (expanded) < author default (this module) < user override
// (the persisted foldedRoles Record). A user's manual FOLD or EXPAND always
// wins and then stops the author default from affecting that role; Reset
// clears the user override and falls back to the author default.
//
// Unlike the folder case (Set-based foldedRoles = folded keys only), the role
// override is a tri-state Record<role, boolean>: absent | true | false. The
// false (explicit expand) entry is what lets a user expand an author-folded
// role and keep it expanded across a reload — the Set model could not record
// that, which is the whole reason for the v7 shape change.
import type { RoleDefaults } from "#foliplus/config-schema.js";

/** Derive the author's default folded role map from the CONF payload.
 *
 *  `roles` is the Python LayerControl(roles=...) config (already normalised
 *  on the Python side). A section key outside overlay/base is impossible (the
 *  Python normaliser drops it), but the type is the contract and this
 *  derivation is tolerant: an unknown section is skipped, a section without a
 *  boolean `folded` is skipped (the built-in default applies). The returned
 *  map uses the same role keys the toggle primitive writes, so the author
 *  default and the user override compare on one vocabulary.
 *
 *  @param {RoleDefaults | null | undefined} roles - The CONF.roles payload,
 *    or null when the author declared none.
 *  @returns {Record<string, boolean>} The author default folded role map
 *    (empty when none — every role expands).
 */
const authorDefaultRoleFolds = (
  roles: RoleDefaults | null | undefined,
): Record<string, boolean> => {
  const out: Record<string, boolean> = {};
  if (!roles) return out;
  // Only the two declared sections are roles; the Python normaliser drops
  // anything else, and this derivation mirrors that (a stray key in a
  // hand-built CONF must not become a fold state).
  for (const role of ["overlay", "base"] as const) {
    const entry = roles[role];
    if (!entry || typeof entry.folded !== "boolean") continue;
    out[role] = entry.folded;
  }
  return out;
};

/** Resolve the effective fold state a role header renders with.
 *
 *  Priority: user override (opinion) > author default > expanded. The user
 *  override is the persisted foldedRoles Record (absent | true | false),
 *  written by the panel's own toggle; the author default is
 *  {@link authorDefaultRoleFolds}.
 *
 *  @param {Readonly<Record<string, boolean>>} userOpinion - The user override.
 *  @param {Readonly<Record<string, boolean>>} authorDefault - The author
 *    default folded role map.
 *  @param {string} role - A LayerRole ("base" | "overlay").
 *  @returns {boolean} True when the role renders folded.
 */
const effectiveRoleFolded = (
  userOpinion: Readonly<Record<string, boolean>>,
  authorDefault: Readonly<Record<string, boolean>>,
  role: string,
): boolean => userOpinion[role] ?? authorDefault[role] ?? false;

export { authorDefaultRoleFolds, effectiveRoleFolded };

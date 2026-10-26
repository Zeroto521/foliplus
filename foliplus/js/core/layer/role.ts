// core/layer/role — the layer-role vocabulary and its UI section projection.
//
// A layer's ROLE is domain data: it picks the z ladder the layer paints on,
// decides whether the layer counts as a basemap, and never changes for an id's
// lifetime (the registry refuses an in-place role change). A SECTION is the UI
// grouping derived from that role. Today the two coincide, but the folder work
// gives a section its own identity — fold state, ordering and folders belong to
// one section — so the projection gets a name and a table now instead of being
// re-derived from the role string at each UI site.
//
// `LayerInfo.role` is the single source of truth: no UI site derives a role
// from a DOM attribute or a display string.
import { ROLE } from "./const.js";

/** A layer's role — derived from `ROLE` (const.ts) so the runtime vocabulary
 *  and the type are one definition. */
type LayerRole = (typeof ROLE)[keyof typeof ROLE];

/** The UI section a role projects into. Two fixed sections: `overlay` (data
 *  layers) and `base` (basemaps). Stated as its own union, not as an alias of
 *  `LayerRole`, so a future role that shares a section with another one has a
 *  type to land in. */
type LayerSection = "overlay" | "base";

/** Role → section, as a table rather than a ternary: every role must be given
 *  a section here, so adding one cannot fall through a branch that silently
 *  treats the new role as overlay. */
const SECTION_OF_ROLE: Record<LayerRole, LayerSection> = {
  [ROLE.OVERLAY]: "overlay",
  [ROLE.BASE]: "base",
};

/** The UI section a layer role belongs to. */
const sectionOf = (role: LayerRole): LayerSection => SECTION_OF_ROLE[role];

export { sectionOf };
export type { LayerRole, LayerSection };

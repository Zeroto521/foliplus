// core/layer/role — the layer-role vocabulary.
//
// A layer's ROLE is domain data: it picks the z ladder the layer paints on,
// which group (base/overlay) its row belongs to in the LayerControl panel, and
// the defaults the panel shows for it. It is a single word on purpose: the UI
// projection IS the role, so there is no separate section middle-layer.
//
// The role vocabulary lives here so the panel never hand-rolls a role string
// (a hardcoded "overlay" in a control would drift from the table below).
import { ROLE } from "./const.js";

/** A layer's role — derived from `ROLE` (const.ts) so the runtime vocabulary
 *  stays a single source (a literal union here would drift from the table). */
type LayerRole = (typeof ROLE)[keyof typeof ROLE];

export type { LayerRole };

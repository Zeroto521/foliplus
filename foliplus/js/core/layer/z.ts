// core/layer/z — the layer z ladder, in one place.
//
// Vocabulary: this file is the "layer z" family (plus the focus band at its
// top). The three-family z policy table (layer / control / export) lives in
// css/common/token.css → Z-index — read that first when asking which family
// a number belongs to.
//
// Four sites used to each derive a z by hand: the ordering pass priced a
// layer's slot from its registry index, a surface added its pane's draw
// offset, PaneManager gave a freshly created pane a provisional one, and
// LayerControl's focus lift derived its own ladder from component constants.
// They agreed with each other only by coincidence — a step change in one
// desynchronised the rest silently. Every z the layer stack writes now comes
// out of `zFor`.
//
// One ladder stays out on purpose: the popup/tooltip/marker relationship the
// ordering pass writes onto Leaflet's own panes (`topZ + 1 / topZ / topZ - 1`
// in `LayerController.enforceOrder`). The base for those three lines comes out of
// the ladder (`topSlotZ`); what stays out is the fixed relationship between
// them — they describe the relative order of Leaflet's *native* panes, not a
// foliplus layer's slot. Folding it in would mean adding `PaneRole` values
// (marker/tooltip/popup) that no layer ever declares, polluting the frozen
// role contract, and the per-role renderer defaults do not apply to a native
// pane at all. So leave those three lines where they are: a fixed
// relationship, not a ladder.
//
// Division of labor: core owns the z space — every value the layer stack
// writes, including the focus spotlight ceiling. LayerControl owns *when* to
// use it (the focus state machine), not what the numbers are. That is why
// `FOCUS_Z` lives here rather than in the component dir: a second home would
// recreate the "two places must stay in sync" problem this file exists to end.
//
// Pure: no DOM, no CONFIG, no Leaflet.
import { PANE_ROLE, ROLE, Z_INDEX } from "./const.js";
import type { ZArgs } from "./type.js";

/** A layer's label pane rides one step above its own panes: the labels cover
 *  that layer's geometry, and the next layer up still covers the labels — the
 *  stack the panel shows. */
const LABEL_Z_OFFSET = 1;

/** A layer's marker-shadow pane rides one step BELOW its own panes: a shadow
 *  must paint under its icon no matter what inline z the icon carries.
 *  Leaflet writes `pos.y + zIndexOffset` onto marker icons (latitude
 *  stacking), which goes negative near the viewport top or under a negative
 *  offset — and CSS paints a negative-z positioned element BELOW a z:auto
 *  sibling, so DOM order alone cannot keep the shadow down. The pane
 *  boundary is the one ordering that survives: the icons' inline z competes
 *  inside the base pane's stacking context, never against the shadow pane. */
const SHADOW_Z_OFFSET = -1;

/** The z the focus spotlight writes. Layer panes start at `Z_INDEX.BASE` and
 *  step by `Z_INDEX.STEP`, so both values sit clear above any layer stack: the
 *  overlay pane holds the dim mask and the selection rectangle, and a focused
 *  layer is lifted to just below it so the hidden layers stacked above it
 *  cannot cover it. */
const FOCUS_Z = {
  overlay: 9000,
  gap: 10,
} as const;

/** The base z a focused layer is lifted to: below the overlay, above every
 *  layer pane. */
const focusLayerZ = (): number => FOCUS_Z.overlay - FOCUS_Z.gap;

/**
 * The z one pane of the layer stack paints at.
 *
 * `index` and `count` price the layer's slot: a layer at index `i` of `count`
 * layers sits `count - i` steps above the base, so the last one sits one step
 * above it. Without a `count` the slot is priced at the base itself — the shape
 * a freshly created pane is given before the ordering pass has claimed a slot.
 * `role` and `order` place the pane inside that slot; `base` prices an absolute
 * lift instead of a slot.
 */
const zFor = ({
  index = 0,
  count = index,
  role = ROLE.OVERLAY,
  paneRole = PANE_ROLE.BASE,
  order = 0,
  base,
}: ZArgs): number => {
  const slot =
    base ??
    (role === ROLE.BASE ? Z_INDEX.TILE_BASE : Z_INDEX.BASE) +
      (count - index) * Z_INDEX.STEP;
  if (paneRole === PANE_ROLE.LABEL) return slot + LABEL_Z_OFFSET;
  if (paneRole === PANE_ROLE.SHADOW) return slot + SHADOW_Z_OFFSET;
  return slot + order;
};

/** The z one step above the topmost layer's slot — the base for the three
 *  native-pane offsets (popup / tooltip / marker) in `LayerController.enforceOrder`. */
const topSlotZ = (count: number): number => zFor({ index: -1, count });

export { LABEL_Z_OFFSET, FOCUS_Z, focusLayerZ, topSlotZ, zFor };

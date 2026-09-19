// core/layer/z — the layer z ladder, in one place.
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
// in `LayerManager.enforceOrder`). Those three lines describe the relative
// order of Leaflet's *native* panes, not a foliplus layer's slot, and `topZ`
// itself already comes out of `zFor` — so only a constant relationship is
// left. Folding it in would mean adding `PaneRole` values (marker/tooltip/
// popup) that no layer ever declares, polluting the frozen role contract, and
// the per-role renderer defaults do not apply to a native pane at all. So
// leave those three lines where they are: a fixed relationship, not a ladder.
//
// Pure: no DOM, no CONF, no Leaflet.
import { Z_INDEX } from "./const.js";
import type { PaneRole } from "./type.js";

/** A layer's label pane rides one step above its own panes: the labels cover
 *  that layer's geometry, and the next layer up still covers the labels — the
 *  stack the panel shows. */
const ANNOTATION_Z_OFFSET = 1;

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

/** Everything `zFor` can be told about the pane it prices. */
interface ZArgs {
  /** The layer's position in the ordered registry: index 0 is the topmost. */
  index?: number;
  /** How many layers the registry holds — the step multiplier. */
  count?: number;
  /** Tile layers start on the tile base, not the overlay base. */
  tile?: boolean;
  /** The pane's role in its layer's draw stack. Only `annotation` prices a
   *  relation of its own (one step above its layer); the rest use `order`. */
  role?: PaneRole;
  /** The pane's draw offset within its layer (`PaneSpec.order`). */
  order?: number;
  /** An absolute base z instead of a slot — the focus lift. */
  base?: number;
}

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
  tile = false,
  role = "base",
  order = 0,
  base,
}: ZArgs): number => {
  const slot =
    base ?? (tile ? Z_INDEX.TILE_BASE : Z_INDEX.BASE) + (count - index) * Z_INDEX.STEP;
  return role === "annotation" ? slot + ANNOTATION_Z_OFFSET : slot + order;
};

export { ANNOTATION_Z_OFFSET, FOCUS_Z, focusLayerZ, zFor, type ZArgs };

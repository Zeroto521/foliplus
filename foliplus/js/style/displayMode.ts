import { STYLE_MODE, type StyleMode } from "#core/layer/index.js";

// style/displayMode — channel-agnostic display-mode resolution.
//
// One resolver answers "which mode does this paint dimension show" for both
// fill and border, from a channel-agnostic spec. The spec deliberately
// carries NO opacity/weight intent: those sub-dimensions ride every mode
// (#953 for fill opacity, the mirrored rule for border weight) and must
// never sink the mode. Type-level guarantee: the resolver cannot read what
// the spec does not carry.

/** The channel-agnostic inputs to display-mode resolution.
 *
 *  `stored` is the user's explicit mode choice (INTENT.FILL_MODE /
 *  INTENT.BORDER_STYLE_MODE). `declaredValue` is #789 — the author's
 *  declared value fill, a real instruction that outranks the detected
 *  presentation state. `colorIntent` is FILL_COLOR / BORDER_COLOR presence;
 *  `valueIntent` is FILL_VALUE presence. `carriesValue` is whether the
 *  channel can paint by value (fill: always; border: LINE geometry only).
 *  `supportsInherit` is whether the channel offers INHERIT (border: yes;
 *  fill: no).
 *
 *  Deliberately ABSENT: opacity intent, weight intent. Those sub-dimensions
 *  ride every mode and must never sink it (#953 / border-weight mirror).
 */
interface DisplayModeSpec {
  stored: StyleMode | undefined;
  declaredValue: boolean;
  colorIntent: boolean;
  valueIntent: boolean;
  carriesValue: boolean;
  supportsInherit: boolean;
}

export type { DisplayModeSpec };
export { resolveDisplayMode };
/** Resolve the display mode for one paint dimension.
 *
 *  Precedence (highest first):
 *    1. an explicit stored mode the user chose;
 *       - VALUE stored on a channel that cannot carry value → ORIGINAL
 *         (the honest readout: the layer cannot classify, so a stored
 *         VALUE is a state the layer cannot paint);
 *       - INHERIT stored on a channel that does not support it → SOLID
 *         (defensive: fill cannot INHERIT, so a stray stored INHERIT
 *         reads as SOLID rather than throwing);
 *    2. the author's declared value fill (#789) → VALUE (fill only;
 *         border never sets declaredValue);
 *    3. neither color nor value intent → ORIGINAL (the map paints the
 *         author's own colours; claiming SOLID would lie about "the user
 *         picked a colour");
 *    4. value intent → VALUE (pre-fillMode record shape: the config's
 *         presence alone means "paint by value");
 *    5. fallback → SOLID.
 */
const resolveDisplayMode = (spec: DisplayModeSpec): StyleMode => {
  if (spec.stored !== undefined) {
    if (spec.stored === STYLE_MODE.VALUE && !spec.carriesValue) {
      return STYLE_MODE.ORIGINAL;
    }
    if (spec.stored === STYLE_MODE.FOLLOW_FILL && !spec.supportsInherit) {
      return STYLE_MODE.SOLID;
    }
    return spec.stored;
  }
  if (spec.declaredValue) return STYLE_MODE.VALUE;
  if (!spec.colorIntent && !spec.valueIntent) return STYLE_MODE.ORIGINAL;
  if (spec.valueIntent) return STYLE_MODE.VALUE;
  return STYLE_MODE.SOLID;
};

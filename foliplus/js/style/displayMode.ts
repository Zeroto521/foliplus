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
  /** The author's declared default mode (border: follow_fill from
   *  foliplus.border). Read-time default only — a stored mode intent always
   *  wins; absent, the declaration replaces the derived fallback. */
  declaredMode?: StyleMode;
  declaredValue: boolean;
  colorIntent: boolean;
  valueIntent: boolean;
  carriesValue: boolean;
  supportsInherit: boolean;
}

/** The display mode and its detail-render mode.
 *
 *  `display` is the mode the row shows (the mode select's value).
 *  `detail` is the mode the detail slot renders. For most combinations
 *  they agree; the one deliberate collapse is border ORIGINAL → SOLID
 *  detail (original and solid both render solid controls; the builder
 *  reads display again to disable the colorInput in ORIGINAL).
 */
type DisplayAndDetail = {
  display: StyleMode;
  detail: StyleMode;
};

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
 *    2. the author's declared mode default (border: follow_fill) → the
 *         declared mode when the channel supports it (FOLLOW_FILL needs
 *         supportsInherit); steps aside when unsupported;
 *    3. the author's declared value fill (#789) → VALUE (fill only;
 *         border never sets declaredValue);
 *    4. neither color nor value intent → ORIGINAL (the map paints the
 *         author's own colours; claiming SOLID would lie about "the user
 *         picked a colour");
 *    5. value intent → VALUE (pre-fillMode record shape: the config's
 *         presence alone means "paint by value");
 *    6. fallback → SOLID.
 */
const resolveDisplay = (spec: DisplayModeSpec): StyleMode => {
  if (spec.stored !== undefined) {
    if (spec.stored === STYLE_MODE.VALUE && !spec.carriesValue) {
      return STYLE_MODE.ORIGINAL;
    }
    if (spec.stored === STYLE_MODE.FOLLOW_FILL && !spec.supportsInherit) {
      return STYLE_MODE.SOLID;
    }
    return spec.stored;
  }
  // The author's declared mode default sits below a stored intent but above
  // the derived fallback (the same rank declaredValue holds). An unsupported
  // declared mode (FOLLOW_FILL on a channel that cannot INHERIT) steps aside
  // rather than forcing a mode the channel cannot paint.
  if (spec.declaredMode !== undefined) {
    if (spec.declaredMode === STYLE_MODE.FOLLOW_FILL && !spec.supportsInherit) {
      // fall through to the derived chain
    } else {
      return spec.declaredMode;
    }
  }
  if (spec.declaredValue) return STYLE_MODE.VALUE;
  if (!spec.colorIntent && !spec.valueIntent) return STYLE_MODE.ORIGINAL;
  if (spec.valueIntent) return STYLE_MODE.VALUE;
  return STYLE_MODE.SOLID;
};

/** Resolve the display mode for one paint dimension (convenience access to
 *  `resolveDisplayAndDetail(spec).display` — the S3 signature is unchanged). */
const resolveDisplayMode = (spec: DisplayModeSpec): StyleMode => resolveDisplay(spec);

/** Resolve both the display mode and the detail-render mode for one paint
 *  dimension.
 *
 *  `detail` equals `display` except for the one deliberate border collapse:
 *  ORIGINAL → SOLID (original and solid both render solid controls; the
 *  border builder reads display again to disable the colour input while the
 *  layer is still on the author's own paint). The collapse is border-only
 *  opt-in — fill never folds its ORIGINAL detail, so the default keeps the
 *  detail identical to the display. */
const resolveDisplayAndDetail = (
  spec: DisplayModeSpec,
  opts: { collapseOriginalDetail: boolean } = { collapseOriginalDetail: false },
): DisplayAndDetail => {
  const display = resolveDisplay(spec);
  const detail =
    opts.collapseOriginalDetail && display === STYLE_MODE.ORIGINAL
      ? STYLE_MODE.SOLID
      : display;
  return { display, detail };
};

export type { DisplayModeSpec };
export { resolveDisplayAndDetail, resolveDisplayMode };

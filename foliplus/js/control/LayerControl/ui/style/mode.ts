// Shared three-state mode vocabulary + control-visibility matrix.
//
// The style rows (fill, border, and the future size/scheme rows) all offer the
// same three presentation arms — the author's original colors, one flat user
// color, or a value classification — and every arm shows a different subset of
// controls. This module is the single place that:
//
//   1. spells the mode order and the shared locale keys, so the two rows cannot
//      drift ("follow fill" / "auto" experiments ended here);
//   2. decides which controls a (mode, authorKind) pair shows, so the row and
//      the paint path agree on what the user can actually see and do;
//   3. maps a mode to where the color comes from, so apply paths and the row
//      read the same source instead of each branching on its own rule.
//
// Geometry-agnostic: a dimension declares only which slots it owns (size for a
// point/line width, color+scheme+detail for a value face), and this module
// decides visibility. Line/size/future cmap faces reuse it without change.
import { FILL_MODE, type FillMode } from "#core/layer/intent.js";
import type { ModeRowOption } from "./row.js";

/** The three presentation arms, in the order the mode select shows them. */
const STYLE_MODE_ORDER: readonly FillMode[] = [
  FILL_MODE.ORIGINAL,
  FILL_MODE.SOLID,
  FILL_MODE.VALUE,
] as const;

/** The shared locale key for each arm — one vocabulary for every dimension. */
const STYLE_MODE_LABEL_KEY: Record<FillMode, string> = {
  [FILL_MODE.ORIGINAL]: "style_mode_original",
  [FILL_MODE.SOLID]: "style_mode_single",
  [FILL_MODE.VALUE]: "style_mode_by_value",
};

/** Where the author's own presentation comes from: a single declared color, or
 *  a multi-color cmap / per-feature palette. This is geometry-independent — the
 *  author's style color set decides, so a line cmap and a face cmap read alike. */
type AuthorKind = "single" | "cmap";

/** Where the paint color for the active arm comes from. The row and the apply
 *  path share this one answer: original paints the author's colors, single the
 *  user's stored color, value the classification palette. */
type ColorSource = "author" | "user" | "palette";

/** The controls a row may show. Each dimension owns a subset; the visibility
 *  matrix decides which of the owned slots actually render for the active arm. */
type ModeControlSlots = {
  /** Point radius / line-face width — always shown when the dimension owns it. */
  size: boolean;
  /** A color swatch/picker (editable in single, read-only swatch in original
   *  single-author, absent in value / original cmap). */
  color: boolean;
  /** The classification scheme (editable in value, read-only preview in
   *  original cmap). */
  scheme: boolean;
  /** The value detail rows (field / method / classes) — value only. */
  detail: boolean;
};

/** The visibility matrix. `size` is always visible when the dimension owns it;
 *  the color and scheme slots are the mode × author-kind cross product:
 *
 *    original + single author  → read-only color swatch, no scheme, no detail;
 *    original + cmap           → no color swatch, read-only scheme preview;
 *    single                    → editable color, no scheme, no detail;
 *    value                     → no color, editable scheme, detail shown.
 *
 *  The Lead's final matrix (m05241) is exactly this — a dimension that does not
 *  own a slot (fill has no size, a point has no width) gates it off via the
 *  `hasSize` / `hasColor` flags in {@link resolveModeState}. */
const controlsFor = (mode: FillMode, authorKind: AuthorKind): ModeControlSlots => {
  if (mode === FILL_MODE.VALUE) {
    return { size: true, color: false, scheme: true, detail: true };
  }
  if (mode === FILL_MODE.SOLID) {
    return { size: true, color: true, scheme: false, detail: false };
  }
  // original
  if (authorKind === "cmap") {
    return { size: true, color: false, scheme: true, detail: false };
  }
  return { size: true, color: true, scheme: false, detail: false };
};

/** The paint source for an arm — the single rule both the row and the apply
 *  path read, so the panel can never claim one source while the map paints
 *  another. */
const colorSourceFor = (mode: FillMode): ColorSource => {
  if (mode === FILL_MODE.ORIGINAL) return "author";
  if (mode === FILL_MODE.VALUE) return "palette";
  return "user";
};

/** The shared mode-row option list: one option per arm in {@link STYLE_MODE_ORDER},
 *  labeled from the shared `style_mode_*` keys, filtered to the arms the caller
 *  can offer (`include`, e.g. a layer with no numeric field drops the value arm).
 *  The only place mode option text is built — fill and border both call here. */
const modeOptions = (
  t: (key: string) => string,
  include: readonly FillMode[] = STYLE_MODE_ORDER,
): ModeRowOption[] =>
  include.map(mode => ({ value: mode, label: t(STYLE_MODE_LABEL_KEY[mode]) }));

/** A dimension's state, resolved once and shared by the row and the paint path.
 *
 *  `mode` is the active arm (stored intent, or the pre-record shape the
 *  resolver infers), `authorKind` the author's own presentation source, and the
 *  `has*` flags declare which slots the dimension owns. The derived `slots`
 *  is the intersection of ownership and the {@link controlsFor} matrix, and
 *  `colorSource` tells the apply path where to take the color from. */
const resolveModeState = (input: {
  mode: FillMode;
  authorKind: AuthorKind;
  hasSize?: boolean;
  hasColor?: boolean;
  hasScheme?: boolean;
  hasDetail?: boolean;
}): {
  mode: FillMode;
  authorKind: AuthorKind;
  colorSource: ColorSource;
  slots: ModeControlSlots;
} => {
  const matrix = controlsFor(input.mode, input.authorKind);
  return {
    mode: input.mode,
    authorKind: input.authorKind,
    colorSource: colorSourceFor(input.mode),
    slots: {
      size: matrix.size && input.hasSize === true,
      color: matrix.color && input.hasColor === true,
      scheme: matrix.scheme && input.hasScheme === true,
      detail: matrix.detail && input.hasDetail === true,
    },
  };
};

export { STYLE_MODE_ORDER, colorSourceFor, controlsFor, modeOptions, resolveModeState };
export type { AuthorKind, ColorSource, ModeControlSlots };

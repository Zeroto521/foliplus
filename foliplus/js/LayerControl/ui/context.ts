// Shared pure helpers for LayerControl UI modules.
// CONF / map are no longer read here — each module reads them off the
// `LayerUI` state it receives (ui.conf / ui.T / ui.m.map).
import { type LayerInfo } from "#core/layer/index.js";
import { updateItemLabel } from "#common/dom.js";
import * as CONST from "../const.js";

/** Does the browser consider this focus keyboard-visible?
 *
 *  Queried once in the focusin delegate — never as a CSS trigger. jsdom does
 *  not implement `:focus-visible` and throws on the selector; treat that as
 *  "not keyboard" so unit tests do not light the recipe on every focus(). */
const isKeyboardVisibleFocus = (el: Element): boolean => {
  try {
    return el.matches(":focus-visible");
  } catch {
    return false;
  }
};

/** Owning cursor-recipe row for a focus target (checkbox / more / fold → row). */
const owningRow = (el: EventTarget | null): HTMLElement | null => {
  if (!el || typeof (el as Element).closest !== "function") return null;
  return (el as Element).closest(CONST.SEL.ROW) as HTMLElement | null;
};

/** Is the event target inside a floating row panel (style / attributes)?
 *
 *  Those panels are *children* of the layer row, so container-level click and
 *  dblclick handlers must ignore them: their chrome (toggle slider spans,
 *  labels, selects) is not an `input`/`button`, and stealing the press would
 *  both steal DOM focus from panel controls and — on a quick double flip of
 *  the label switch — fall through to focusLayer. */
const isInFloatingPanel = (el: EventTarget | null): boolean => {
  if (!el || typeof (el as Element).closest !== "function") return false;
  return Boolean(
    (el as Element).closest(
      `.${CONST.CLASSES.STYLE_PANEL}, .${CONST.CLASSES.ATTRS_PANEL}`,
    ),
  );
};

/**
 * Push one persisted rename out to whatever projections of it exist.
 *
 * Shared by the whole-panel sweep and the targeted single-layer call so the
 * "skip unchanged" rule lives in exactly one place.
 */
const applyNameProjection = (
  layerInfo: LayerInfo | null,
  item: HTMLElement | null,
  name: string,
): void => {
  if (!layerInfo && !item) return;
  if (layerInfo && layerInfo.name !== name) layerInfo.name = name;
  updateItemLabel(item, name);
};

/** Above this length a value overflows the value column at the attrs panel's
 *  fixed label width (`--form-label-width`) and is rendered below its label
 *  on the full panel width. */
const ATTRS_ROW_WRAP_CHARS = 32;

export {
  ATTRS_ROW_WRAP_CHARS,
  applyNameProjection,
  isKeyboardVisibleFocus,
  isInFloatingPanel,
  owningRow,
};

// Shared free helpers for LayerControl UI modules.
// CONF / map are IIFE free variables from the template wrapper.
import { type LayerInfo, forEachLeaf, getGeometryType } from "#core/layer/index.js";
import { updateItemLabel } from "#common/dom.js";
import { createScopedTranslator } from "#common/locale.js";
import * as CONST from "../const.js";

const T = createScopedTranslator(CONF);
const mapContainer = map.getContainer();

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

/** Above this length a value overflows the value column at the panel's fixed
 *  10px type and is rendered below its label on the full panel width. */
const ATTRS_ROW_WRAP_CHARS = 32;

export {
  ATTRS_ROW_WRAP_CHARS,
  applyNameProjection,
  isKeyboardVisibleFocus,
  mapContainer,
  owningRow,
  T,
};

// re-export for modules that only need geometry helpers via shared
export { forEachLeaf, getGeometryType };

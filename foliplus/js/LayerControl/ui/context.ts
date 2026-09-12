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

/** Format an update timestamp for the attributes panel.
 *  Accepts an epoch-ms number or any value `new Date()` can parse. Invalid
 *  input returns "" so the caller omits the row instead of showing a
 *  "Invalid Date" literal. Renders in the browser's local timezone. */
const formatTimestamp = (value: string | number): string => {
  const date = new Date(typeof value === "number" ? value : Date.parse(value));
  if (Number.isNaN(date.getTime())) return "";
  // "zh" is not a full BCP-47 tag — ICU wants zh-CN / zh-Hant etc. for
  // medium date + short time; fall back to the raw code otherwise.
  const locale = CONF.locale_code === "zh" ? "zh-CN" : (CONF.locale_code ?? "en");
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return date.toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
};

export {
  ATTRS_ROW_WRAP_CHARS,
  applyNameProjection,
  formatTimestamp,
  isKeyboardVisibleFocus,
  mapContainer,
  owningRow,
  T,
};

// re-export for modules that only need geometry helpers via shared
export { forEachLeaf, getGeometryType };

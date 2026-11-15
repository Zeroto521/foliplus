// Reset-footer state — when the style panel's Reset can do anything.
//
// Reset restores the author's declared style. It is worth enabling only when
// the layer currently carries a user-owned style: an intent override, a label
// config, or (for a delegated layer) a component style that differs from the
// Python CONFIG snapshot it started from. One predicate answers all three so
// the footer's initial paint and every live refresh agree, and so the button
// can never advertise a reset that would be a no-op.
//
// The filter panel's Clear follows the same contract (disabled exactly when
// there is nothing to clear); this module is its style-panel twin.
import type { LayerUI } from "../surface.js";
import { layerHasStyleDelegation } from "./delegated.js";
import type { LayerInfo, LayerOverride } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";

/** The intent dimensions the style panel can restore. `visible` is excluded:
 *  it is a list-row toggle, not part of this panel — resetting it here would
 *  restore more than the surface owns. */
const STYLE_RESET_OVERRIDES: readonly LayerOverride[] = [
  "fillColor",
  "fillOpacity",
  "fillValue",
  "fillStyleMode",
  "borderColor",
  "borderWeight",
  "borderValue",
  "borderStyleMode",
  "opacity",
  "zoomRange",
  "size",
  "icon",
  "iconColor",
  "iconColorOpacity",
  "markerColor",
  "markerColorOpacity",
];

/** Structural equality for the two style records: the delegated providers
 *  publish scalars today (`labelShow`, `labelSize`, …), but the intent-shaped
 *  values (`zoomRange`, value configs) may ride the same comparison later, so
 *  the helper is not scalar-only. */
const sameStyleValue = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => sameStyleValue(value, b[index]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const leftKeys = Object.keys(left);
    if (leftKeys.length !== Object.keys(right).length) return false;
    return leftKeys.every(key => sameStyleValue(left[key], right[key]));
  }
  return false;
};

/** Whether the user set any style-panel dimension on this layer. */
const hasStyleIntent = (ui: LayerUI, layerId: string): boolean =>
  STYLE_RESET_OVERRIDES.some(override => ui.intentStore.isUserSet(layerId, override));

/** Whether a delegated layer's component style has moved off the snapshot its
 *  Reset would restore. A missing provider or snapshot cannot answer, so it is
 *  treated as "nothing to restore" — the same no-op Reset would be. */
const delegatedStyleMoved = (layerInfo: LayerInfo): boolean => {
  const provider = layerInfo.styleProvider;
  const defaults = layerInfo.styleDefaultsProvider;
  if (!provider || !defaults) return false;
  const current = provider() ?? {};
  const base = defaults() ?? {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(current)])) {
    if (!sameStyleValue(current[key], base[key])) return true;
  }
  return false;
};

/** The one "is this layer's style the declared default?" predicate.
 *
 *  Order matters: intent provenance is the cheapest and most direct signal
 *  (every style write records it), the delegated comparison follows because
 *  third-party canvas layers carry their style on the component rather than in
 *  the intent store, and the label config is the final rider (its owner keeps
 *  a separate map and has no provenance axis). */
const layerStyleIsPristine = (ui: LayerUI, layerId: string): boolean => {
  if (hasStyleIntent(ui, layerId)) return false;
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return true;
  if (layerHasStyleDelegation(ui, layerId)) return !delegatedStyleMoved(layerInfo);
  return !ui.c.label.hasConfig(layerId);
};

/** Paint the footer's Reset from the live state: disabled exactly when the
 *  layer is still on its declared style. `aria-disabled` mirrors the native
 *  attribute for the row's screen-reader announcement, and the tooltip explains
 *  the disabled state instead of leaving a mute button. */
const syncResetButton = (ui: LayerUI, layerId: string, panel: ParentNode): void => {
  const button = panel.querySelector<HTMLButtonElement>(
    `.${CONST.CLASSES.STYLE_RESET_BTN}`,
  );
  if (!button) return;
  const pristine = layerStyleIsPristine(ui, layerId);
  button.disabled = pristine;
  button.setAttribute("aria-disabled", pristine ? "true" : "false");
  button.title = pristine ? ui.T("style_reset_disabled") : ui.T("style_reset_tooltip");
};

export { syncResetButton };

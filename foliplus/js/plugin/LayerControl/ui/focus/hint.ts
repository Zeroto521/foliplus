// Focus-layer disabled-state metadata: the reason codes, their locale keys,
// and the shared hint shown when a keyboard / double-click / overflow path
// tries to focus a row the surface cannot focus.
import { HINT_DURATION } from "#core/hint.js";
import { ROLE } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerUI } from "../surface.js";

/** Why a row's focus action is off. Carried as the menu item's title and as
 *  the hint text when a keyboard/double-click path tries to focus a row the
 *  surface cannot focus. `undefined` means focus is available. */
type FocusDisabledReason = "hidden" | "base" | "no_bounds" | undefined;

/** A reason focus is off — every value but "focus is available". */
type FocusDisabled = Exclude<FocusDisabledReason, undefined>;

const FOCUS_DISABLED_LOCALE: Record<FocusDisabled, string> = {
  hidden: "focus_layer_hidden",
  base: "focus_layer_base",
  no_bounds: "focus_layer_no_bounds",
};

/** The locale key explaining `reason`. Both the ⋮ menu item's title and the
 *  hint shown on the keyboard / double-click paths read it, so the two can
 *  never drift apart. */
const focusDisabledLocaleKey = (reason: FocusDisabled): string =>
  FOCUS_DISABLED_LOCALE[reason];

/** Why the ⋮ menu / keyboard / double-click path should not focus `item`.
 *
 *  An unchecked row comes first: it is hidden, so there is nothing to focus
 *  and nothing to style. That check sits ahead of the basemap branches so a
 *  basemap row obeys the same "checked first" rule as every data row — the
 *  branches below only say "no useful extent", which is true whether or not
 *  the row is on, so consulting them first would let an off basemap keep an
 *  enabled Style entry.
 *
 *  Basemaps (no useful extent) and surfaces whose `capabilities.bounds` is
 *  false (no honest carrier to focus on — a MarkerCluster group, a canvas
 *  without a `getBounds` provider, a third-party layer that never advertised
 *  a bounds) are off for focus only. */
const focusDisabledReason = (ui: LayerUI, item: HTMLElement): FocusDisabledReason => {
  const box = item.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
  if (box !== null && !box.checked) return "hidden";
  if (item.dataset.layerType === ROLE.BASE) return "base";
  const layerId = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (layerInfo && ui.c.surfaceFor(layerInfo).capabilities.bounds === false) {
    return "no_bounds";
  }
  return undefined;
};

/** Show the hint that matches a `focusDisabledReason` value. */
const showFocusDisabledHint = (ui: LayerUI, reason: FocusDisabled): void => {
  ui.c.map.foliplus!.showHint(
    ui.config.name,
    ui.T(focusDisabledLocaleKey(reason)),
    HINT_DURATION.SHORT,
  );
};

export { focusDisabledLocaleKey, focusDisabledReason, showFocusDisabledHint };

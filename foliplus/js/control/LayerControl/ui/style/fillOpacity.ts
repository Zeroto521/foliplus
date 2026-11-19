// Fill opacity input + commit — the one construction point shared by the
// SOLID row, the VALUE (color-by-value) row and the original-colours readout.
//
// Split out of fill.ts so fillValue.ts (the value detail) and originalDetail.ts
// (the original readout) can build the same 0-100 number input and commit the
// same intent without importing fill.ts — fill.ts imports both of those
// modules, so importing back would close a cycle (import-x/no-cycle maxDepth 10).
import { INTENT, getIntent } from "../intent.js";
import type { LayerUI } from "../surface.js";
import { getDimension } from "./registry.js";
import { DIM } from "#core/layer/index.js";
import { withUnit } from "#platform/format.js";
import { numberInput } from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";

/** A visible `fillOpacity` used to *display* the row's opacity input when
 *  neither a stored override nor an authored value exists. 0.2 matches
 *  Leaflet's own default, so a row for a layer that never declared a fill
 *  opacity shows what the layer is actually painting. Display only — no
 *  write path reads this to change a layer's opacity. */
const VISIBLE_FILL_OPACITY = 0.2;

/** Commit the fill opacity (0-100 %) to the layer. Converts to 0-1 for
 *  storage and setStyle. Called from `bindLiveNumber` on the opacity input.
 *  Writes only the `opacity` patch on DIM.FILL — never FILL_MODE — so an
 *  opacity-only override keeps the #953 invariant (the mode stays ORIGINAL). */
const commitFillOpacity = (ui: LayerUI, layerId: string, pct: number): void => {
  const opacity = Math.max(0, Math.min(1, pct / 100));
  if (getIntent(ui, layerId, INTENT.FILL_OPACITY) === opacity) return;
  getDimension(DIM.FILL)!.write!(ui, layerId, { opacity });
};

/** Build the 0-100 fill-opacity number input for one mode detail row.
 *  One construction point: the SOLID row, the by-value row and the
 *  original-colours row all mount the same 0-100 number input, so the width,
 *  step and aria contract can never drift between modes. The value is the
 *  stored override, else the authored base, else the 0.2 Leaflet default the
 *  solid row already displays. */
const buildFillOpacityInput = (
  ui: LayerUI,
  layerId: string,
  base: { fillOpacity?: number | null } = {},
): HTMLElement => {
  const storedOpacity = getIntent(ui, layerId, INTENT.FILL_OPACITY);
  const opacityPct =
    Math.round((storedOpacity ?? base.fillOpacity ?? VISIBLE_FILL_OPACITY) * 1000) / 10;
  return numberInput({
    value: opacityPct,
    min: 0,
    max: 100,
    step: 1,
    className: CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER,
    ariaLabel: withUnit(ui.T("style_fill_opacity"), ui._("foliplus.unit_pct")),
    unitSuffix: ui._("foliplus.unit_pct"),
  });
};
export { VISIBLE_FILL_OPACITY, buildFillOpacityInput, commitFillOpacity };

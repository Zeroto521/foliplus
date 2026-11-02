// Opacity row: the shared slider primitive + the layer's opacity commit path.
//
// The row is one <div> handed to Slider. The primitive owns the rail, thumb,
// fill, end dots and the drag bubble (portaled to <body> so the panel cannot
// clip it); this module owns what an opacity change *means*.
//
// Also registered in the style-panel dimension registry (./registry.ts)
// as the first per-layer dimension. The descriptor owns intent+persist
// (write / reset / valueSource); commitOpacityPct stays a thin delegate that
// also syncs the panel rail (UI chrome outside the descriptor).
import { CAP_TIER, DIM, ROLE } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import { Slider, sliderOf } from "#foliplus/LayerControl/slider.js";
import { dom } from "#common/dom.js";
import {
  NO_DELTA,
  type ProjectionDelta,
  applyProjection,
  notifyDelta,
} from "../apply.js";
import { INTENT } from "../intent.js";
import { syncNoBasemap } from "../listPanel/visibility.js";
import { currentOpacity } from "../projection.js";
import type { LayerUI } from "../surface.js";
import {
  getDimension,
  registerDimension,
  resetIntentKeys,
  writeIntentKeys,
} from "./registry.js";

/** Whether the layer's surface can honestly carry an opacity write. Layers with
 *  opacity: "none" (e.g. MarkerCluster, whose cluster icons live in a shared
 *  pane we do not own) get no opacity row — a slider that writes nothing but
 *  persists the value would fail silently. */
const layerCanOpacity = (ui: LayerUI, layerId: string): boolean => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return false;
  return ui.c.surfaceFor(layerInfo).capabilities.opacity !== CAP_TIER.NONE;
};

/** UI percentage (0-100) for a stored opacity (0-1). */
const opacityToPct = (opacity: number | undefined): number =>
  Math.round(Math.max(0, Math.min(1, opacity ?? 1)) * 100);

/** Clamp a raw percentage into [0, 100]. A non-numeric entry — an emptied
 *  number field on commit — falls back to fully opaque, the same
 *  invalid-commits-to-default rule the shared number field uses. */
const clampPct = (raw: number, fallback = 100): number =>
  Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : fallback;

/** Apply a UI percentage to the layer, persist it, and sync the thumb.
 *  Thin delegate over the opacity descriptor's write: the panel rail sync
 *  stays here because the slider host is a UI argument that does not belong
 *  on the descriptor contract. */
const commitOpacityPct = (
  ui: LayerUI,
  layerId: string,
  host: HTMLElement,
  rawPct: number,
): void => {
  const pct = clampPct(rawPct);
  const opacity = pct / 100;
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return;
  // Only touch the layer when the value actually moved: a drag revisits steps
  // (and the commit re-sends the live value), and for a plain layer each pass
  // is a sweep over every feature.
  if (layerInfo.opacity !== opacity) {
    getDimension(DIM.OPACITY)!.write!(ui, layerId, opacity);
  }
  // A clamped value has to reach the thumb even when the layer did not move:
  // an out-of-range write must not leave the control showing the old number.
  sliderOf(host)?.setValue(pct, { silent: true });
};

/** Build the opacity form row: the shared slider, nothing else.
 *
 *  There is no number field: the value is already on screen three ways (the
 *  fill's length, the drag bubble, the end numbers) and the field cost the rail
 *  two thirds of its width. The slider keeps the value reachable: the thumb
 *  carries the accessible name and value, arrow / Home / End drive it, and the
 *  bubble appears for keyboard input the same as for a drag. */
const buildOpacityRow = (ui: LayerUI, layerId: string): HTMLElement => {
  const pct = opacityToPct(currentOpacity(ui, ui.c.layerRegistry.get(layerId)));
  const host = dom.el("div", {
    class: `${CONST.CLASSES.STYLE_OPACITY_TRACK} ${CONST.CLASSES.STYLE_OPACITY_SLIDER}`,
  });
  new Slider(host, {
    min: 0,
    max: 100,
    step: 1,
    value: pct,
    label: ui.T("style_opacity"),
    marks: [
      { at: 0, tone: "limit" },
      { at: 100, tone: "limit" },
    ],
    values: { min: "0", max: "100" },
    input: value => commitOpacityPct(ui, layerId, host, Number(value)),
  });
  return dom.el(
    "div",
    { class: CONST.CLASSES.FORM_ROW },
    dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, ui.T("style_opacity")),
    dom.el("div", { class: CONST.CLASSES.FORM_CONTROL }, host),
  );
};

/** Reset one layer's opacity to fully opaque and drop its persisted entry.
 *  Thin delegate over the opacity descriptor's reset; `publish` keeps the
 *  notify here, where the hatch is already settled. Pass `false` from the
 *  panel's whole-operation Reset — that entry owns the single notify, and it
 *  goes out only after the panel itself is closed. */
const resetLayerOpacity = (
  ui: LayerUI,
  layerId: string,
  publish = true,
): ProjectionDelta | void => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return;
  const delta = getDimension(DIM.OPACITY)!.reset!(ui, layerId) ?? NO_DELTA;
  if (publish) notifyDelta(ui, layerInfo, delta);
  return delta;
};

/** Register opacity as a per-layer dimension. The descriptor owns the
 *  intent+persist slots; commitOpacityPct / resetLayerOpacity stay as thin
 *  delegates (panel rail sync remains in the commit helper).
 *
 *  **opacity === 1 clears the override** — fully opaque is the declared
 *  default, so there is no user choice to persist. That rule lives in
 *  write so every writer agrees.
 *
 *  Gate invariant: existence then capabilities.opacity !== "none". */
const OPACITY_DIMENSION = registerDimension<number>({
  key: DIM.OPACITY,
  gate: layerCanOpacity,
  value: (ui, layerId) => currentOpacity(ui, ui.c.layerRegistry.get(layerId)),
  row: buildOpacityRow,
  /** Intent+persist + projection. opacity === 1 clears (no override);
   *  any other number marks via LayerIntentStore.set. A non-number patch is a
   *  no-op (descriptor callers always pass a finite 0-1 value). */
  write: (ui, layerId, patch) => {
    const opacity = typeof patch === "number" ? patch : undefined;
    if (opacity === undefined) return;
    if (opacity === 1) {
      // Fully opaque is the declared default — clear, same as resetIntentKeys.
      resetIntentKeys(ui, layerId, [INTENT.OPACITY]);
    } else {
      void writeIntentKeys(ui, layerId, [[INTENT.OPACITY, opacity]]);
    }
    const moved = applyProjection(ui, layerId, "debounce");
    const layerInfo = ui.c.layerRegistry.get(layerId);
    if (layerInfo?.role === ROLE.BASE) syncNoBasemap(ui);
    // Announce last, after the hatch: on a layer's first projection the pass
    // can still converge a stale map membership, and that flip is a real
    // change worth notifying.
    notifyDelta(ui, layerInfo, moved);
  },
  /** Cohesive reset: clear the override, save, re-project, hatch sync. Returns
   *  the delta without announcing — the complete reset entry
   *  (`resetLayerOpacity`) owns the notify so the hatch is settled first. */
  reset: (ui, layerId) => {
    resetIntentKeys(ui, layerId, [INTENT.OPACITY]);
    const moved = applyProjection(ui, layerId, "debounce");
    const layerInfo = ui.c.layerRegistry.get(layerId);
    if (layerInfo?.role === ROLE.BASE) syncNoBasemap(ui);
    return moved;
  },
  valueSource: (ui, layerId) => {
    if (!layerCanOpacity(ui, layerId)) return "none";
    return ui.intentStore.isUserSet(layerId, INTENT.OPACITY) ? "user" : "author";
  },
  /** No registry replay: the hub's projection block above already re-applies
   *  a stored opacity to newly-finalized geometry, and its delta is the
   *  notify's payload — it cannot ride the frame loop. */
  contentChange: { kind: "none" },
});

export { OPACITY_DIMENSION, clampPct, resetLayerOpacity };

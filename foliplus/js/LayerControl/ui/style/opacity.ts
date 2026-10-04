// Opacity row: single-thumb rail + fill + end dots + live commit pipeline.
// Moved verbatim from ui/style.ts; the frame helpers it
// reaches into live in ./frame.ts. `buildOpacityRow` and the sync /
// commit functions are used both by the delegated drawer (delegated.ts)
// and the annotation panel (index.ts) �?the row is LayerControl-owned,
// not annotation-owned.
//
// Also registered in the style-panel dimension registry (./registry.ts)
// as the first per-layer dimension. The descriptor owns intent+persist
// (`write` / `reset` / `valueSource`); `commitOpacityPct` stays a thin
// delegate that also syncs the panel rail (UI chrome outside the descriptor).
import { CAP_TIER, DIM, GROUP } from "#core/layer/index.js";
import { dom } from "#common/dom.js";
import * as CONST from "../../const.js";
import { applyProjection } from "../apply.js";
import type { LayerUI } from "../index.js";
import { INTENT, getIntent } from "../intent.js";
import type { OverlayPanel } from "../overlayPanel.js";
import { syncNoBasemap } from "../visibility.js";
import { railPos, round5 } from "./frame.js";
import {
  getDimension,
  registerDimension,
  resetIntentKeys,
  writeIntentKeys,
} from "./registry.js";

/** Whether the layer's surface can honestly carry an opacity write. Layers with
 *  `opacity: "none"` (e.g. MarkerCluster, whose cluster icons live in a shared
 *  pane we do not own) get no opacity row �?a slider that writes nothing but
 *  persists the value would fail silently. */
const layerCanOpacity = (ui: LayerUI, layerId: string): boolean => {
  const li = ui.m.layerRegistry.get(layerId);
  if (!li) return false;
  return ui.m.surfaceFor(li).capabilities.opacity !== CAP_TIER.NONE;
};

/** UI percentage (0-100) for a stored opacity (0-1). */
const opacityToPct = (opacity: number | undefined): number =>
  Math.round(Math.max(0, Math.min(1, opacity ?? 1)) * 100);

/** Clamp a raw percentage into [0, 100]. A non-numeric entry �?an emptied
 *  number field on commit �?falls back to fully opaque, the same
 *  invalid-commits-to-default rule the shared number field uses. */
const clampPct = (raw: number, fallback = 100): number =>
  Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : fallback;

/** Fill width for the single-thumb opacity rail: the rail's own percentage,
 *  which is where the handle's center sits. */
const opacityFillWidth = (pct: number): string => `${round5(pct)}%`;

/** Ring color of the opacity row's two end dots. The covered span is always
 *  [0, pct], so the 0 end is red by construction �?the layer is painted from
 *  there whatever the value �?and 100 is red only when the layer is fully
 *  opaque. Same readout the zoom range's limits give, where a limit is covered
 *  once the range reaches it. */
const syncOpacityDots = (track: HTMLElement, pct: number): void => {
  const marks: [string, boolean][] = [
    ["-min", true],
    ["-max", pct >= 100],
  ];
  for (const [suffix, covered] of marks) {
    track
      .querySelector(`.${CONST.CLASSES.STYLE_OPACITY_DOT}${suffix}`)
      ?.classList.toggle(CONST.CLASSES.SLIDER_DOT_COVERED, covered);
  }
};

/** Write one resolved percentage into the slider and its number field.
 *
 *  The slider always takes the value �?its thumb has to follow whoever moved
 *  the other control. The number field is left alone while the user is typing
 *  in it, or the caret would jump to the end on every keystroke; `force` is the
 *  commit pass, which rewrites it to the resolved value the same way the shared
 *  number field does on blur. */
const syncOpacityInputs = (panel: HTMLElement, pct: number): void => {
  const range = panel.querySelector(
    `.${CONST.CLASSES.STYLE_OPACITY_RANGE}`,
  ) as HTMLInputElement;
  const fill = panel.querySelector(
    `.${CONST.CLASSES.STYLE_OPACITY_FILL}`,
  ) as HTMLElement | null;
  range.value = String(pct);
  // The fill starts where the thumb's center sits at 0% and ends on it at the
  // current value �?the handle's own travel range, so the two never disagree at
  // the ends (a rail-relative width leaves a sliver of accent past the handle).
  if (fill) fill.style.width = opacityFillWidth(pct);
  syncOpacityDots(panel, pct);
};

/** Apply a UI percentage to the layer, persist it, and sync the rail.
 *  Thin delegate over the opacity descriptor's `write`: the panel rail
 *  sync stays here because the panel root is a UI argument that does not
 *  belong on the descriptor contract. */
const commitOpacityPct = (
  ui: LayerUI,
  layerId: string,
  panel: HTMLElement,
  rawPct: number,
  commit = false,
): void => {
  const pct = clampPct(rawPct);
  const opacity = pct / 100;
  const li = ui.m.layerRegistry.get(layerId);
  if (!li) return;
  // Only touch the layer when the value actually moved: a drag revisits steps
  // (and the commit re-sends the live value), and for a plain layer each pass
  // is a sweep over every feature.
  if (li.opacity === opacity) return;
  getDimension(DIM.OPACITY)!.write!(ui, layerId, opacity);
  syncOpacityInputs(panel, pct);
};

/** Build the opacity form row: the shared slider component, nothing else.
 *
 *  There is no number field: the value is already on screen three ways (the
 *  fill's length, the drag bubble, the end numbers) and the field cost the rail
 *  two thirds of its width �?it is the reason the zoom range's rail is longer
 *  than this one. The range input keeps the value reachable: it carries the
 *  accessible name and value, arrow / Home / End drive it, and the bubble
 *  appears for keyboard input the same as for a drag. */
const buildOpacityRow = (ui: LayerUI, layerId: string): HTMLElement => {
  const li = ui.m.layerRegistry.get(layerId);
  const pct = opacityToPct(getIntent(ui, layerId, INTENT.OPACITY) ?? li?.opacity);
  const fill = dom.el("div", {
    class: `${CONST.CLASSES.SLIDER_FILL} ${CONST.CLASSES.STYLE_OPACITY_FILL}`,
    style: `width:${opacityFillWidth(pct)}`,
  });
  const dot = (suffix: string): HTMLElement =>
    dom.el("span", {
      class:
        `${CONST.CLASSES.SLIDER_DOT} ${CONST.CLASSES.SLIDER_DOT}${suffix}` +
        ` ${CONST.CLASSES.STYLE_OPACITY_DOT} ${CONST.CLASSES.STYLE_OPACITY_DOT}${suffix}`,
    });
  const range = dom.el("input", {
    type: "range",
    class: `${CONST.CLASSES.SLIDER_HANDLE} ${CONST.CLASSES.STYLE_OPACITY_RANGE}`,
    min: "0",
    max: "100",
    step: "1",
    value: String(pct),
    "aria-label": ui.T("style_opacity"),
  });
  const rail = dom.el(
    "div",
    { class: `${CONST.CLASSES.SLIDER_RAIL} ${CONST.CLASSES.STYLE_OPACITY_RAIL}` },
    fill,
    dot("-min"),
    dot("-max"),
    range,
  );
  // The scale's ends, so the row matches the zoom range's: fixed numbers under
  // the fixed dots. The value itself stays in the number field beside them.
  const values = dom.el(
    "div",
    { class: `${CONST.CLASSES.SLIDER_VALUES} ${CONST.CLASSES.STYLE_OPACITY_VALUES}` },
    dom.el("span", {}, "0"),
    dom.el("span", {}, "100"),
  );
  const track = dom.el(
    "div",
    { class: `${CONST.CLASSES.SLIDER} ${CONST.CLASSES.STYLE_OPACITY_TRACK}` },
    rail,
    values,
  );
  syncOpacityDots(track, pct);
  return dom.el(
    "div",
    { class: CONST.CLASSES.FORM_ROW },
    dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, ui.T("style_opacity")),
    dom.el("div", { class: CONST.CLASSES.FORM_CONTROL }, track),
  );
};

/** Reset one layer's opacity to fully opaque and drop its persisted entry.
 *  Thin delegate over the opacity descriptor's `reset`. */
const resetLayerOpacity = (ui: LayerUI, layerId: string): void => {
  const li = ui.m.layerRegistry.get(layerId);
  if (!li) return;
  getDimension(DIM.OPACITY)!.reset!(ui, layerId);
};

/** Register opacity as a per-layer dimension. The descriptor owns the
 *  intent+persist slots; `commitOpacityPct` / `resetLayerOpacity` stay as
 *  thin delegates (panel rail sync remains in the commit helper).
 *
 *  **opacity === 1 clears the override** �?fully opaque is the declared
 *  default, so there is no user choice to persist. That rule lives in
 *  `write` so every writer agrees.
 *
 *  Gate invariant: existence then `capabilities.opacity !== "none"`. */
const OPACITY_DIMENSION = registerDimension<number>({
  key: DIM.OPACITY,
  gate: layerCanOpacity,
  value: (ui, layerId) => {
    const li = ui.m.layerRegistry.get(layerId);
    return getIntent(ui, layerId, INTENT.OPACITY) ?? li?.opacity;
  },
  row: buildOpacityRow,
  /** Intent+persist + projection. `opacity === 1` clears (no override);
   *  any other number marks via LayerIntentStore.set. A non-number patch is a
   *  no-op (descriptor callers always pass a finite 0-1 value). */
  write: (ui, layerId, patch) => {
    const opacity = typeof patch === "number" ? patch : undefined;
    if (opacity === undefined) return;
    if (opacity === 1) {
      // Fully opaque is the declared default �?clear, same as resetIntentKeys.
      resetIntentKeys(ui, layerId, [INTENT.OPACITY]);
    } else {
      void writeIntentKeys(ui, layerId, [[INTENT.OPACITY, opacity]]);
    }
    applyProjection(ui, layerId, "debounce");
    const li = ui.m.layerRegistry.get(layerId);
    if (li?.group === GROUP.BASE) syncNoBasemap(ui);
  },
  /** Cohesive reset: clear the override, save, re-project, hatch sync. */
  reset: (ui, layerId) => {
    resetIntentKeys(ui, layerId, [INTENT.OPACITY]);
    applyProjection(ui, layerId, "debounce");
    const li = ui.m.layerRegistry.get(layerId);
    if (li?.group === GROUP.BASE) syncNoBasemap(ui);
  },
  valueSource: (ui, layerId) => {
    if (!layerCanOpacity(ui, layerId)) return "none";
    return ui.intentStore.isUserSet(layerId, INTENT.OPACITY) ? "user" : "author";
  },
});

export {
  OPACITY_DIMENSION,
  buildOpacityRow,
  clampPct,
  commitOpacityPct,
  layerCanOpacity,
  resetLayerOpacity,
  syncOpacityDots,
  syncOpacityInputs,
};

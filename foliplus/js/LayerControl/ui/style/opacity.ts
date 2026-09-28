// Opacity row: single-thumb rail + fill + end dots + live commit pipeline.
// Moved verbatim from ui/style.ts; the frame helpers it
// reaches into live in ./frame.ts. `buildOpacityRow` and the sync /
// commit functions are used both by the delegated drawer (delegated.ts)
// and the annotation panel (index.ts) — the row is LayerControl-owned,
// not annotation-owned.
//
// Also registered in the style-panel dimension registry (./registry.ts)
// as the first per-layer dimension: `gate` + `value` + `row` for
// discovery. The write path (state + projection + DOM sync) stays as
// `commitOpacityPct` for now — see ./registry.ts for the reason.
import { dom } from "#common/dom.js";
import * as CONST from "../../const.js";
import { applyProjection } from "../apply.js";
import type { LayerUI } from "../index.js";
import { markOverride, saveState, unmarkOverride } from "../state.js";
import { syncNoBasemap } from "../visibility.js";
import { railPos, round5 } from "./frame.js";
import { registerDimension } from "./registry.js";

/** Whether the layer's surface can honestly carry an opacity write. Layers with
 *  `opacity: "none"` (e.g. MarkerCluster, whose cluster icons live in a shared
 *  pane we do not own) get no opacity row — a slider that writes nothing but
 *  persists the value would fail silently. */
const layerCanOpacity = (ui: LayerUI, layerId: string): boolean => {
  const li = ui.m.layerRegistry.get(layerId);
  if (!li) return false;
  return ui.m.surfaceFor(li).capabilities.opacity !== "none";
};

/** UI percentage (0-100) for a stored opacity (0-1). */
const opacityToPct = (opacity: number | undefined): number =>
  Math.round(Math.max(0, Math.min(1, opacity ?? 1)) * 100);

/** Clamp a raw percentage into [0, 100]. A non-numeric entry — an emptied
 *  number field on commit — falls back to fully opaque, the same
 *  invalid-commits-to-default rule the shared number field uses. */
const clampPct = (raw: number, fallback = 100): number =>
  Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : fallback;

/** Fill width for the single-thumb opacity rail: the rail's own percentage,
 *  which is where the handle's center sits. */
const opacityFillWidth = (pct: number): string => `${round5(pct)}%`;

/** Ring color of the opacity row's two end dots. The covered span is always
 *  [0, pct], so the 0 end is red by construction — the layer is painted from
 *  there whatever the value — and 100 is red only when the layer is fully
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
 *  The slider always takes the value — its thumb has to follow whoever moved
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
  // current value — the handle's own travel range, so the two never disagree at
  // the ends (a rail-relative width leaves a sliver of accent past the handle).
  if (fill) fill.style.width = opacityFillWidth(pct);
  syncOpacityDots(panel, pct);
};

/** Apply a UI percentage to the layer, persist it, and sync the rail. */
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
  if (opacity === 1) {
    // Fully opaque is the declared default, so there is no override to keep.
    delete ui.opacityMap[layerId];
    unmarkOverride(ui, layerId, "opacity");
  } else {
    ui.opacityMap[layerId] = opacity;
    markOverride(ui, layerId, "opacity");
  }
  saveState(ui);
  applyProjection(ui, layerId);
  // Base-layer opacity can move the visible-basemap count across the zero
  // boundary (0 hides, >0 shows), so the no-basemap hatch and the group
  // label must follow — `syncNoBasemap` gates on `li.opacity ?? 1 > 0`.
  // Overlay opacity is unrelated to basemap visibility, so skip it: the
  // call would be a wasted O(n) scan on the drag hot path.
  if (li.group === "base") syncNoBasemap(ui);
  syncOpacityInputs(panel, pct);
};

/** Build the opacity form row: the shared slider component, nothing else.
 *
 *  There is no number field: the value is already on screen three ways (the
 *  fill's length, the drag bubble, the end numbers) and the field cost the rail
 *  two thirds of its width — it is the reason the zoom range's rail is longer
 *  than this one. The range input keeps the value reachable: it carries the
 *  accessible name and value, arrow / Home / End drive it, and the bubble
 *  appears for keyboard input the same as for a drag. */
const buildOpacityRow = (ui: LayerUI, layerId: string): HTMLElement => {
  const li = ui.m.layerRegistry.get(layerId);
  const pct = opacityToPct(ui.opacityMap[layerId] ?? li?.opacity);
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

/** Reset one layer's opacity to fully opaque and drop its persisted entry. */
const resetLayerOpacity = (ui: LayerUI, layerId: string): void => {
  const li = ui.m.layerRegistry.get(layerId);
  if (!li) return;
  delete ui.opacityMap[layerId];
  unmarkOverride(ui, layerId, "opacity");
  saveState(ui);
  applyProjection(ui, layerId);
  // Resetting a base layer from 0 back to 1 un-hides it — flip the hatch.
  if (li.group === "base") syncNoBasemap(ui);
};

/** Register opacity as the first per-layer dimension in the style-panel
 *  registry. The descriptor wires up the existing helpers — nothing moves,
 *  nothing duplicates. The write path is intentionally not part of the
 *  descriptor yet: `commitOpacityPct` needs the panel root to sync the
 *  slider, which is a UI argument that does not belong on the descriptor.
 *
 *  Gate invariant (§43.9, first-class from day one): `gate` is two layers —
 *  layer existence (`!li` returns `false` as a precondition guard) and
 *  then the pure capability check `capabilities.opacity !== "none"`. No
 *  carrier probes, no `isColorBasemap` special-cases, no canvas exclusion.
 *  Canvas-only layers (heatmap, measure, …) already declare `"none"` for
 *  opacity because they don't own a leaf to walk, so the gate rejects them
 *  naturally. Any extra check here would drift from the invariant and the
 *  moment a new dimension lands with a different shape, the panel's own
 *  honest-degradation rule stops being a rule. */
const OPACITY_DIMENSION = registerDimension<number>({
  key: "opacity",
  gate: layerCanOpacity,
  value: (ui, layerId) => {
    const li = ui.m.layerRegistry.get(layerId);
    return ui.opacityMap[layerId] ?? li?.opacity;
  },
  row: buildOpacityRow,
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

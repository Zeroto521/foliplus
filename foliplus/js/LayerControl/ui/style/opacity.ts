// Opacity row: single-thumb rail + fill + end dots + live commit pipeline.
// Moved verbatim from ui/style.ts (34.1 §34.2.1); the frame helpers it
// reaches into live in ./frame.ts. `buildOpacityRow` and the sync /
// commit functions are used both by the delegated drawer (delegated.ts)
// and the annotation panel (index.ts) — the row is LayerControl-owned,
// not annotation-owned.
import { dom } from "#common/dom.js";
import * as CONST from "../../const.js";
import { applyProjection } from "../apply.js";
import type { LayerUI } from "../index.js";
import { markOverride, saveState, unmarkOverride } from "../state.js";
import { railPos, round5 } from "./frame.js";

/** Whether the layer's surface can honestly carry an opacity write. Layers with
 *  `opacity: "none"` (e.g. MarkerCluster, whose cluster icons live in a shared
 *  pane we do not own) get no opacity row — a slider that writes nothing but
 *  persists the value would violate §6.2 "不得静默失效". */
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
 *  which is where the handle's centre sits. */
const opacityFillWidth = (pct: number): string => `${round5(pct)}%`;

/** Ring colour of the opacity row's two end dots. The covered span is always
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
  // The fill starts where the thumb's centre sits at 0% and ends on it at the
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
  if (!ui.m.layerRegistry.has(layerId)) return;
  delete ui.opacityMap[layerId];
  unmarkOverride(ui, layerId, "opacity");
  saveState(ui);
  applyProjection(ui, layerId);
};

export {
  buildOpacityRow,
  clampPct,
  commitOpacityPct,
  layerCanOpacity,
  resetLayerOpacity,
  syncOpacityDots,
  syncOpacityInputs,
};

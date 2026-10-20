// Opacity row: wa-slider single-thumb + end dots overlay + live commit pipeline.
// Moved verbatim from ui/style.ts; the frame helpers it
// reaches into live in ./frame.ts. `buildOpacityRow` and the sync /
// commit functions are used both by the delegated drawer (delegated.ts)
// and the annotation panel (index.ts) — the row is LayerControl-owned,
// not annotation-owned.
//
// Also registered in the style-panel dimension registry (./registry.ts)
// as the first per-layer dimension. The descriptor owns intent+persist
// (`write` / `reset` / `valueSource`); `commitOpacityPct` stays a thin
// delegate that also syncs the panel rail (UI chrome outside the descriptor).
//
// The <wa-slider> replaces the old dual-<input type=range> + custom rail/fill/
// handle DOM. The component dispatches native `input`/`change` events
// (bubbles + composed) and owns the thumb, rail, fill and drag tooltip
// internally (via its shadow parts). Foliplus adds only the end-dot readout
// and the fixed end numbers, as overlay elements outside the slider's shadow
// boundary — the same pattern the zoom-range row uses for its current-marker.
import { CAP_TIER, DIM, GROUP } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import { dom } from "#common/dom.js";
import { applyProjection } from "../apply.js";
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
 *  `opacity: "none"` (e.g. MarkerCluster, whose cluster icons live in a shared
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
  const slider = panel.querySelector(
    `.${CONST.CLASSES.STYLE_OPACITY_SLIDER}`,
  ) as WaSliderElement | null;
  if (slider) {
    slider.value = pct;
  }
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
): void => {
  const pct = clampPct(rawPct);
  const opacity = pct / 100;
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return;
  // Only touch the layer when the value actually moved: a drag revisits steps
  // (and the commit re-sends the live value), and for a plain layer each pass
  // is a sweep over every feature.
  if (layerInfo.opacity === opacity) return;
  getDimension(DIM.OPACITY)!.write!(ui, layerId, opacity);
  syncOpacityInputs(panel, pct);
};

/** Build the opacity form row: a <wa-slider> single-thumb with end-dot
 *  and end-number overlays.
 *
 *  There is no number field: the value is already on screen three ways (the
 *  fill's length, the drag bubble, the end numbers) and the field cost the rail
 *  two thirds of its width — it is the reason the zoom range's rail is longer
 *  than this one. The wa-slider keeps the value reachable: it carries the
 *  accessible name and value, arrow / Home / End drive it, and the bubble
 *  appears for keyboard input the same as for a drag.
 *
 *  The end dots and numbers are foliplus-owned marks outside the slider's
 *  shadow boundary. They sit in one box with the rail, so a percentage on
 *  that box is a position on the rail; the library's own reference slot
 *  cannot do that — its flex layout cannot centre a label on the rail's end. */
const buildOpacityRow = (ui: LayerUI, layerId: string): HTMLElement => {
  const pct = opacityToPct(currentOpacity(ui, ui.c.layerRegistry.get(layerId)));

  const slider = dom.el("wa-slider", {
    min: "0",
    max: "100",
    step: "1",
    value: String(pct),
    "with-tooltip": "",
    "aria-label": ui.T("style_opacity"),
    class: CONST.CLASSES.STYLE_OPACITY_SLIDER,
  }) as WaSliderElement;

  // Scale numbers: foliplus-owned, in the same half-thumb inset box as the
  // rail, so each label's centre lands on the rail's end. The library's
  // reference slot lays its spans out with flex space-between, which
  // right-aligns "100" instead of centring it on the end it belongs to.
  const values = dom.el(
    "div",
    { class: CONST.CLASSES.SLIDER_VALUES },
    dom.el("span", {}, "0"),
    dom.el("span", {}, "100"),
  );

  // End dots: white core + ring, accent when the covered span reaches that end.
  // Foliplus-owned marks on the shared rail box, positioned by the row's CSS.
  const dot = (suffix: string): HTMLElement =>
    dom.el("span", {
      class:
        `${CONST.CLASSES.SLIDER_DOT} ${CONST.CLASSES.SLIDER_DOT}${suffix}` +
        ` ${CONST.CLASSES.STYLE_OPACITY_DOT} ${CONST.CLASSES.STYLE_OPACITY_DOT}${suffix}`,
    });

  const track = dom.el(
    "div",
    { class: `${CONST.CLASSES.SLIDER} ${CONST.CLASSES.STYLE_OPACITY_TRACK}` },
    slider,
    dom.el("div", { class: CONST.CLASSES.SLIDER_MARKS }, dot("-min"), dot("-max")),
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
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return;
  getDimension(DIM.OPACITY)!.reset!(ui, layerId);
};

/** Register opacity as a per-layer dimension. The descriptor owns the
 *  intent+persist slots; `commitOpacityPct` / `resetLayerOpacity` stay as
 *  thin delegates (panel rail sync remains in the commit helper).
 *
 *  **opacity === 1 clears the override** — fully opaque is the declared
 *  default, so there is no user choice to persist. That rule lives in
 *  `write` so every writer agrees.
 *
 *  Gate invariant: existence then `capabilities.opacity !== "none"`. */
const OPACITY_DIMENSION = registerDimension<number>({
  key: DIM.OPACITY,
  gate: layerCanOpacity,
  value: (ui, layerId) => currentOpacity(ui, ui.c.layerRegistry.get(layerId)),
  row: buildOpacityRow,
  /** Intent+persist + projection. `opacity === 1` clears (no override);
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
    applyProjection(ui, layerId, "debounce");
    const layerInfo = ui.c.layerRegistry.get(layerId);
    if (layerInfo?.group === GROUP.BASE) syncNoBasemap(ui);
  },
  /** Cohesive reset: clear the override, save, re-project, hatch sync. */
  reset: (ui, layerId) => {
    resetIntentKeys(ui, layerId, [INTENT.OPACITY]);
    applyProjection(ui, layerId, "debounce");
    const layerInfo = ui.c.layerRegistry.get(layerId);
    if (layerInfo?.group === GROUP.BASE) syncNoBasemap(ui);
  },
  valueSource: (ui, layerId) => {
    if (!layerCanOpacity(ui, layerId)) return "none";
    return ui.intentStore.isUserSet(layerId, INTENT.OPACITY) ? "user" : "author";
  },
});

export { OPACITY_DIMENSION, clampPct, commitOpacityPct, resetLayerOpacity };

// Zoom-range row: wa-slider range + current-zoom marker + value labels +
// live / commit passes. Moved verbatim from ui/style.ts.
// Used by both the delegated drawer and the annotation panel — the row is
// LayerControl-owned, gated by surface capability.
//
// <wa-slider range> replaced the dual <input type=range> to close
// the double-thumb deadlock where overlapping thumbs could not be separated.
// The current-zoom indicator is a foliplus-owned overlay div, not the
// wa-slider's reference slot — it represents map state relative to the slider,
// not a slider value. The slider's own tick labels live in the reference slot.
//
// Events: wa-slider dispatches native `input` / `change` events
// (bubbles:true, composed:true) — the panel-level delegation in
// style/index.ts is the single handler for both flavours, same as opacity.
// No listener is bound here; buildZoomRangeRow only renders the row.
import { CAP_TIER, DIM } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import { dom } from "#common/dom.js";
import { applyProjection, authorZoomBoundsForLayer } from "../apply.js";
import { INTENT, getIntent } from "../intent.js";
import type { LayerUI } from "../surface.js";
import { railPos } from "./frame.js";
import {
  getDimension,
  registerDimension,
  resetIntentKeys,
  writeIntentKeys,
} from "./registry.js";

/** Whether the layer's surface can honestly carry a zoom-range write.
 *  Pure capability check: `capabilities.zoomRange !== "none"`.
 *
 *  The zoomRange capability is derived at the surface (see
 *  `detectCapabilities` in core/layer/LayerSurface.ts). MarkerCluster
 *  and ImageOverlay declare `"none"` — a row that persists a value
 *  the write cannot apply is a lie that survives reload. The color
 *  basemap declares `"pane"` (the executor's `visible` op is the
 *  carrier, same as every other surface). No `isColorBasemap`
 *  special-case, no `group` exemption: capability alone decides. */
const canShowZoomRange = (ui: LayerUI, layerId: string): boolean => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return false;
  return ui.c.surfaceFor(layerInfo).capabilities.zoomRange !== CAP_TIER.NONE;
};

/** Percentage of a zoom value within [mapMin, mapMax]. */
const zoomToPct = (zoom: number, mapMin: number, mapMax: number): number => {
  const range = mapMax - mapMin;
  if (range <= 0) return 0;
  return ((zoom - mapMin) / range) * 100;
};

/** Two value labels closer than this (in percentage points of the rail) would
 *  overlap once they sit under their own marks, so the lower-priority one is
 *  dropped: min wins over max, and both win over the current level, which is
 *  only a readout. */
const LABEL_MIN_GAP_PCT = 12;

/** Write the current-zoom marker and the reference-slot limit labels.
 *
 *  The limits belong to the marks that cannot move (the map's two zoom
 *  bounds, shown as wa-slider reference-slot ticks). The current level is a
 *  foliplus-owned overlay under its own marker — the slider's own tooltip
 *  covers the draggable values, so the persistent readout is the marker.
 */
const syncValues = (
  row: HTMLElement,
  min: number,
  max: number,
  current: number,
  mapMin: number,
  mapMax: number,
): void => {
  const refMin = row.querySelector(
    `.${CONST.CLASSES.STYLE_ZOOM_RANGE_LIMIT_MIN}`,
  ) as HTMLElement | null;
  const refMax = row.querySelector(
    `.${CONST.CLASSES.STYLE_ZOOM_RANGE_LIMIT_MAX}`,
  ) as HTMLElement | null;
  if (refMin) refMin.textContent = String(mapMin);
  if (refMax) refMax.textContent = String(mapMax);

  // End dots: covered when the selected range reaches that map limit.
  const dotMin = row.querySelector(`.${CONST.CLASSES.SLIDER_DOT_MIN}`);
  const dotMax = row.querySelector(`.${CONST.CLASSES.SLIDER_DOT_MAX}`);
  dotMin?.classList.toggle(
    CONST.CLASSES.SLIDER_DOT_COVERED,
    min <= mapMin,
  );
  dotMax?.classList.toggle(
    CONST.CLASSES.SLIDER_DOT_COVERED,
    max >= mapMax,
  );

  const marker = row.querySelector(
    `.${CONST.CLASSES.STYLE_ZOOM_RANGE_CURRENT_MARKER}`,
  ) as HTMLElement | null;
  if (marker) {
    const currentPct = zoomToPct(current, mapMin, mapMax);
    marker.style.left = railPos(currentPct);
    const label = marker.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_CURRENT_VALUE}`,
    );
    if (label) label.textContent = String(current);
    // The current level can sit on top of a limit at the ends of the map's
    // range, where the limit's own number already says it.
    const clear =
      Math.abs(currentPct) >= LABEL_MIN_GAP_PCT &&
      Math.abs(currentPct - 100) >= LABEL_MIN_GAP_PCT;
    marker.classList.toggle(CONST.CLASSES.SLIDER_LABEL_HIDDEN, !clear);
  }
};

/** Update the zoom-range row's visual state: slider values, marker, labels,
 *  and the out-of-range dimming. Does not write to the map or persistence —
 *  that is the commit pass's job. Pass the live thumb values so the row can
 *  update before the change is committed. */
const syncZoomRangeRow = (
  ui: LayerUI,
  layerId: string,
  row: HTMLElement,
  liveRange?: [number, number],
): void => {
  const [mapMin, mapMax] = authorZoomBoundsForLayer(ui, layerId);
  const range = liveRange ?? getIntent(ui, layerId, INTENT.ZOOM_RANGE);
  const min = range ? Math.max(range[0], mapMin) : mapMin;
  const max = range ? Math.min(range[1], mapMax) : mapMax;
  const current = ui.c.map.getZoom();

  const slider = row.querySelector("wa-slider") as WaSliderElement | null;
  if (slider) {
    // minValue/maxValue do not reflect to attributes (verified against the
    // component source), so write the properties; the attributes are only
    // the upgrade-time initial values set by buildZoomRangeRow.
    slider.minValue = min;
    slider.maxValue = max;
  }

  syncValues(row, min, max, current, mapMin, mapMax);

  const outOfRange = current < min || current > max;
  row.classList.toggle(CONST.CLASSES.STYLE_ZOOM_RANGE_OUT_OF_RANGE, outOfRange);
  row.title = outOfRange
    ? ui.T("style_zoom_range_out_of_range").replace("{zoom}", String(current))
    : ui.T("style_zoom_range_current").replace("{zoom}", String(current));
};

/** Build the zoom-range form row: a <wa-slider range> with a current-zoom
 *  marker overlay and reference-slot tick labels.
 *
 *  The wa-slider handles both thumbs natively (range mode), which closes the
 *  dual-<input type=range> deadlock where overlapping thumbs could not be
 *  separated. The current-zoom marker is a foliplus-owned overlay div,
 *  positioned at the map's current zoom level — it represents
 *  map state relative to the slider, not a slider value.
 *
 *  Initial values come from the layer's zoomRange intent (the persisted
 *  choice), clamped to the map's current [min, max]. When no range is stored,
 *  the full map range is used — the "author-undeclared" default.
 *
 *  Values are written as attributes (observed, applied on upgrade): the ESM
 *  lands in <body>, so the element is not upgraded at creation time. Only
 *  the valueFormatter property is deferred to customElements.whenDefined.
 */
const buildZoomRangeRow = (ui: LayerUI, layerId: string): HTMLElement => {
  const [mapMin, mapMax] = authorZoomBoundsForLayer(ui, layerId);
  const stored = getIntent(ui, layerId, INTENT.ZOOM_RANGE);
  const min = stored ? Math.max(stored[0], mapMin) : mapMin;
  const max = stored ? Math.min(stored[1], mapMax) : mapMax;
  const current = ui.c.map.getZoom();

  const slider = dom.el("wa-slider", {
    range: "",
    min: String(mapMin),
    max: String(mapMax),
    step: "1",
    "min-value": String(min),
    "max-value": String(max),
    "with-tooltip": "",
    class: CONST.CLASSES.STYLE_ZOOM_RANGE_SLIDER,
  }) as WaSliderElement;

  // Reference slot: tick labels at the map's zoom limits. These are
  // wa-slider-owned elements rendered inside the slider's shadow boundary;
  // their position is computed by the slider from the min/max range.
  const refMin = dom.el(
    "span",
    { slot: "reference", class: CONST.CLASSES.STYLE_ZOOM_RANGE_LIMIT_MIN },
    String(mapMin),
  );
  const refMax = dom.el(
    "span",
    { slot: "reference", class: CONST.CLASSES.STYLE_ZOOM_RANGE_LIMIT_MAX },
    String(mapMax),
  );
  slider.appendChild(refMin);
  slider.appendChild(refMax);

  // Async upgrade: set valueFormatter after the custom element upgrades.
  // ESM lands in body, so the element is not yet upgraded at creation time.
  void customElements.whenDefined("wa-slider").then(() => {
    slider.valueFormatter = (v: number) => String(Math.round(v));
  });

  // End dots: same visual language as the opacity row — a white core with a
  // gray ring at the map's two zoom limits. Foliplus-owned overlays outside
  // the slider's shadow boundary, positioned by the shared CSS.
  const dot = (suffix: string): HTMLElement =>
    dom.el("span", {
      class: `${CONST.CLASSES.SLIDER_DOT} ${CONST.CLASSES.SLIDER_DOT}${suffix}`,
    });

  // Current-zoom marker: a 10px dot (reuses the shared .foliplus-slider-dot
  // visual) positioned at the map's current zoom level. Shows "where am I"
  // relative to the range. Accent border distinguishes it from the gray
  // end dots.
  const marker = dom.el(
    "div",
    {
      class: `${CONST.CLASSES.SLIDER_DOT} ${CONST.CLASSES.STYLE_ZOOM_RANGE_CURRENT_MARKER}`,
    },
    dom.el(
      "span",
      { class: CONST.CLASSES.STYLE_ZOOM_RANGE_CURRENT_VALUE },
      String(current),
    ),
  );

  const control = dom.el(
    "div",
    { class: `${CONST.CLASSES.SLIDER} ${CONST.CLASSES.STYLE_ZOOM_RANGE_CONTROL}` },
    slider,
    dot("-min"),
    dot("-max"),
    marker,
  );

  const row = dom.el(
    "div",
    {
      class: `${CONST.CLASSES.FORM_ROW} ${CONST.CLASSES.STYLE_ZOOM_RANGE_ROW}`,
    },
    dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, ui.T("style_zoom_range")),
    dom.el("div", { class: CONST.CLASSES.FORM_CONTROL }, control),
  );
  syncValues(row, min, max, current, mapMin, mapMax);
  syncZoomRangeRow(ui, layerId, row);

  return row;
};

/** Live pass: update the map and visual state without persisting. Called
 *  on every `input` event so the layer responds in real-time as the user
 *  drags a thumb — the slider is a live preview, not a deferred commit.
 *  Value-only write (`setValue`) — provenance marks on the commit pass. */
const applyZoomRangeLive = (
  ui: LayerUI,
  layerId: string,
  row: HTMLElement,
  min: number,
  max: number,
): void => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return;
  ui.intentStore.setValue(layerId, INTENT.ZOOM_RANGE, [min, max]);
  syncZoomRangeRow(ui, layerId, row, [min, max]);
  applyProjection(ui, layerId);
};

/** Commit pass: persist the zoom range to localStorage. The value and the
 *  map state are already updated by {@link applyZoomRangeLive}; this records
 *  the override through the descriptor `write` (cohesive set + save). */
const commitZoomRange = (ui: LayerUI, layerId: string): void => {
  getDimension(DIM.ZOOM_RANGE)!.write!(ui, layerId, {});
};

/** Reset one layer's zoom range to the full map range and drop its override.
 *  Thin delegate over the zoom-range descriptor's `reset` plus row chrome. */
const resetLayerZoomRange = (ui: LayerUI, layerId: string): void => {
  if (!ui.c.layerRegistry.has(layerId)) return;
  getDimension(DIM.ZOOM_RANGE)!.reset!(ui, layerId);
  // Refresh the row's visual state (fill, values, out-of-range).
  const panel = ui.uiContainer.querySelector(
    `.${CONST.CLASSES.STYLE_PANEL}`,
  ) as HTMLElement | null;
  const row = panel?.querySelector(
    `.${CONST.CLASSES.STYLE_ZOOM_RANGE_ROW}`,
  ) as HTMLElement | null;
  if (row) syncZoomRangeRow(ui, layerId, row);
};

/** Register zoom range as a per-layer dimension. The descriptor owns the
 *  intent+persist slots. Live preview stays value-only until commit. */
const ZOOM_RANGE_DIMENSION = registerDimension<{ min: number; max: number }>({
  key: DIM.ZOOM_RANGE,
  gate: canShowZoomRange,
  value: (ui, layerId) => {
    const layerInfo = ui.c.layerRegistry.get(layerId);
    if (!layerInfo) return undefined;
    const [mapMin, mapMax] = authorZoomBoundsForLayer(ui, layerId);
    const stored = getIntent(ui, layerId, INTENT.ZOOM_RANGE);
    return {
      min: stored ? Math.max(stored[0], mapMin) : mapMin,
      max: stored ? Math.min(stored[1], mapMax) : mapMax,
    };
  },
  row: buildZoomRangeRow,
  /** Intent+persist + projection. Empty patch commits an already-written
   *  live preview (mark current intent); `{min,max}` writes then marks. */
  write: (ui, layerId, patch) => {
    const min = patch?.min;
    const max = patch?.max;
    if (min !== undefined && max !== undefined) {
      void writeIntentKeys(ui, layerId, [[INTENT.ZOOM_RANGE, [min, max]]]);
    } else {
      const stored = ui.intentStore.get(layerId, INTENT.ZOOM_RANGE);
      if (!stored) return;
      void writeIntentKeys(ui, layerId, [[INTENT.ZOOM_RANGE, stored]]);
    }
    applyProjection(ui, layerId);
  },
  /** Cohesive reset: clear the override, save, re-project. */
  reset: (ui, layerId) => {
    resetIntentKeys(ui, layerId, [INTENT.ZOOM_RANGE]);
    applyProjection(ui, layerId);
  },
  valueSource: (ui, layerId) => {
    if (!canShowZoomRange(ui, layerId)) return "none";
    return ui.intentStore.isUserSet(layerId, INTENT.ZOOM_RANGE) ? "user" : "author";
  },
});

export {
  applyZoomRangeLive,
  commitZoomRange,
  resetLayerZoomRange,
  syncZoomRangeRow,
  ZOOM_RANGE_DIMENSION,
};

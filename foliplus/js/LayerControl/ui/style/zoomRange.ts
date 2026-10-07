// Zoom-range row: dual-thumb rail + current-zoom marker + value labels +
// live / commit passes. Moved verbatim from ui/style.ts.
// Used by both the delegated drawer and the annotation panel — the row is
// LayerControl-owned, gated by surface capability.
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
 *  the write cannot apply is a lie that survives reload. The colour
 *  basemap declares `"pane"` (the executor's `visible` op is the
 *  carrier, same as every other surface). No `isColorBasemap`
 *  special-case, no `group` exemption: capability alone decides. */
const canShowZoomRange = (ui: LayerUI, layerId: string): boolean => {
  const li = ui.c.layerRegistry.get(layerId);
  if (!li) return false;
  return ui.c.surfaceFor(li).capabilities.zoomRange !== CAP_TIER.NONE;
};

/** Clamp a zoom value into the map's current [min, max] range. */
const clampZoom = (value: number, mapMin: number, mapMax: number): number =>
  Math.max(mapMin, Math.min(mapMax, Math.round(value)));

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

/** Write the values row and the three readout dots.
 *
 *  The numbers belong to the marks that cannot move: the map's two zoom limits
 *  (fixed text at the row's edges) and the current level (placed under its own
 *  dot). The draggable range carries no number of its own — it reports through
 *  the bubble while held, and through the rail's geometry the rest of the time.
 *
 *  `--foliplus-slider-dot-size` dots read coverage through their ring: accent where the
 *  layer renders (inside the range), gray where it does not. The current dot
 *  rides the row's existing out-of-range class for the same readout. */
const syncValues = (
  row: HTMLElement,
  min: number,
  max: number,
  current: number,
  mapMin: number,
  mapMax: number,
): void => {
  const spans = [
    ...row.querySelectorAll(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_VAL} span`),
  ] as HTMLElement[];
  if (spans.length >= 3) {
    const [minEl, currentEl, maxEl] = spans;
    // The ends' positions come from the stylesheet (`:first-child` /
    // `:last-child`), so only the text is ours.
    minEl.textContent = String(mapMin);
    maxEl.textContent = String(mapMax);
    const currentPct = zoomToPct(current, mapMin, mapMax);
    currentEl.textContent = String(current);
    currentEl.style.left = railPos(currentPct);
    // The current level can sit on top of a limit at the ends of the map's
    // range, where the limit's own number already says it.
    const clear =
      Math.abs(currentPct) >= LABEL_MIN_GAP_PCT &&
      Math.abs(currentPct - 100) >= LABEL_MIN_GAP_PCT;
    currentEl.classList.toggle(CONST.CLASSES.SLIDER_LABEL_HIDDEN, !clear);
  }

  const dots: [string, number, boolean][] = [
    ["-min", mapMin, min <= mapMin],
    ["-max", mapMax, max >= mapMax],
    ["-current", current, current >= min && current <= max],
  ];
  for (const [suffix, value, covered] of dots) {
    const dot = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_DOT}${suffix}`,
    ) as HTMLElement | null;
    if (!dot) continue;
    if (suffix === "-current") {
      dot.style.left = railPos(zoomToPct(value, mapMin, mapMax));
    }
    dot.classList.toggle(CONST.CLASSES.SLIDER_DOT_COVERED, covered);
  }
};

/** Update the zoom-range row's visual state: fill position, value labels,
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

  const fill = row.querySelector(
    `.${CONST.CLASSES.STYLE_ZOOM_RANGE_FILL}`,
  ) as HTMLElement | null;
  if (fill) {
    fill.style.left = railPos(zoomToPct(min, mapMin, mapMax));
    fill.style.right = `calc(100% - ${railPos(zoomToPct(max, mapMin, mapMax))})`;
  }

  syncValues(row, min, max, current, mapMin, mapMax);

  // Out-of-range: dim the row when the current zoom falls outside [min, max].
  const outOfRange = current < min || current > max;
  row.classList.toggle(CONST.CLASSES.STYLE_ZOOM_RANGE_OUT_OF_RANGE, outOfRange);
  row.title = outOfRange
    ? ui.T("style_zoom_range_out_of_range").replace("{zoom}", String(current))
    : ui.T("style_zoom_range_current").replace("{zoom}", String(current));

  // The handles' tooltips carry the range the rail draws but the row no longer
  // prints.
  for (const [tail, value] of [
    [CONST.CLASSES.STYLE_ZOOM_RANGE_MIN, min],
    [CONST.CLASSES.STYLE_ZOOM_RANGE_MAX, max],
  ] as const) {
    const input = row.querySelector(`.${tail}`) as HTMLInputElement | null;
    if (input) input.title = `${ui.T("style_zoom_range")} ${value}`;
  }
};

/** Build the zoom-range form row: a dual-thumb slider on a track with a
 *  current-zoom marker and value labels.
 *
 *  The two <input type=range> elements overlay each other; only their thumbs
 *  are interactive (pointer-events: none on the inputs, auto on the thumbs).
 *  The track shows the selected range as an accent fill, and a vertical line
 *  marks the map's current zoom level.
 *
 *  Initial values come from the layer's zoomRange intent (the persisted
 *  choice),
 *  clamped to the map's current [min, max]. When no range is stored, the
 *  full map range is used — the "author-undeclared" default. */
const buildZoomRangeRow = (ui: LayerUI, layerId: string): HTMLElement => {
  const [mapMin, mapMax] = authorZoomBoundsForLayer(ui, layerId);
  const stored = getIntent(ui, layerId, INTENT.ZOOM_RANGE);
  const min = stored ? Math.max(stored[0], mapMin) : mapMin;
  const max = stored ? Math.min(stored[1], mapMax) : mapMax;
  const current = ui.c.map.getZoom();

  const fill = dom.el("div", {
    class: `${CONST.CLASSES.SLIDER_FILL} ${CONST.CLASSES.STYLE_ZOOM_RANGE_FILL}`,
    style: `left:${railPos(zoomToPct(min, mapMin, mapMax))};right:calc(100% - ${railPos(
      zoomToPct(max, mapMin, mapMax),
    )})`,
  });

  // The readout dots: the map's two limits are pinned by CSS, the current level
  // is placed by syncValues.
  const dot = (suffix: string): HTMLElement =>
    dom.el("span", {
      class:
        `${CONST.CLASSES.SLIDER_DOT} ${CONST.CLASSES.SLIDER_DOT}${suffix}` +
        ` ${CONST.CLASSES.STYLE_ZOOM_RANGE_DOT} ${CONST.CLASSES.STYLE_ZOOM_RANGE_DOT}${suffix}`,
    });

  const minInput = dom.el("input", {
    type: "range",
    class: `${CONST.CLASSES.SLIDER_HANDLE} ${CONST.CLASSES.STYLE_ZOOM_RANGE_MIN}`,
    min: String(mapMin),
    max: String(mapMax),
    step: "1",
    value: String(min),
    "aria-label": ui.T("style_zoom_range_min"),
  });
  const maxInput = dom.el("input", {
    type: "range",
    class: `${CONST.CLASSES.SLIDER_HANDLE} ${CONST.CLASSES.STYLE_ZOOM_RANGE_MAX}`,
    min: String(mapMin),
    max: String(mapMax),
    step: "1",
    value: String(max),
    "aria-label": ui.T("style_zoom_range_max"),
  });

  // DOM order is the paint order for these positioned siblings; the two
  // textures on the rail itself come from CSS.
  const track = dom.el(
    "div",
    { class: `${CONST.CLASSES.SLIDER_RAIL} ${CONST.CLASSES.STYLE_ZOOM_RANGE_TRACK}` },
    fill,
    dot("-min"),
    dot("-max"),
    dot("-current"),
    minInput,
    maxInput,
  );

  const values = dom.el(
    "div",
    { class: `${CONST.CLASSES.SLIDER_VALUES} ${CONST.CLASSES.STYLE_ZOOM_RANGE_VAL}` },
    dom.el("span", {}, String(mapMin)),
    dom.el(
      "span",
      { class: CONST.CLASSES.STYLE_ZOOM_RANGE_CURRENT_VALUE },
      String(current),
    ),
    dom.el("span", {}, String(mapMax)),
  );

  const control = dom.el(
    "div",
    { class: `${CONST.CLASSES.SLIDER} ${CONST.CLASSES.STYLE_ZOOM_RANGE_CONTROL}` },
    track,
    values,
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
  const li = ui.c.layerRegistry.get(layerId);
  if (!li) return;
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
    const li = ui.c.layerRegistry.get(layerId);
    if (!li) return undefined;
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
  buildZoomRangeRow,
  canShowZoomRange,
  clampZoom,
  commitZoomRange,
  resetLayerZoomRange,
  syncZoomRangeRow,
  syncValues,
  ZOOM_RANGE_DIMENSION,
  zoomToPct,
};

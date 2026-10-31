// Zoom-range row: the shared dual-thumb slider + the current-zoom readout.
//
// The primitive owns both thumbs, the fill, the limit dots and the drag
// bubble (portaled to <body>, so the panel cannot clip it). This row adds the
// map's "where am I" readout and the out-of-range dimming, and turns thumb
// movement into live projection + a persisted intent.
//
// Used by both the delegated drawer and the label panel — the row is
// LayerControl-owned, gated by surface capability.
import { CAP_TIER, DIM } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import { Slider, sliderOf } from "#foliplus/LayerControl/slider.js";
import { dom } from "#common/dom.js";
import {
  NO_DELTA,
  type ProjectionDelta,
  applyProjection,
  authorZoomBoundsForLayer,
  notifyDelta,
} from "../apply.js";
import { INTENT, getIntent } from "../intent.js";
import type { LayerUI } from "../surface.js";
import {
  getDimension,
  registerDimension,
  resetIntentKeys,
  writeIntentKeys,
} from "./registry.js";

/** Whether the layer's surface can honestly carry a zoom-range write.
 *  Pure capability check: capabilities.zoomRange !== "none".
 *
 *  The zoomRange capability is derived at the surface (see
 *  detectCapabilities in core/layer/LayerSurface.ts). MarkerCluster
 *  and ImageOverlay declare "none" — a row that persists a value
 *  the write cannot apply is a lie that survives reload. The color
 *  basemap declares "pane" (the executor's visible op is the
 *  carrier, same as every other surface). No isColorBasemap
 *  special-case, no group exemption: capability alone decides. */
const canShowZoomRange = (ui: LayerUI, layerId: string): boolean => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return false;
  return ui.c.surfaceFor(layerInfo).capabilities.zoomRange !== CAP_TIER.NONE;
};

/** The current level's label is hidden when it would sit closer than this
 *  (percentage points) to either end, where the limit's own number already
 *  says it. */
const LABEL_MIN_GAP_PCT = 12;

/** The slider inside a zoom-range row. */
const sliderOfRow = (row: HTMLElement): Slider | undefined =>
  sliderOf(
    row.querySelector<HTMLElement>(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_CONTROL}`),
  );

/** Update the zoom-range row's visual state: thumb positions, limit dots,
 *  the current-zoom readout, and the out-of-range dimming. Does not write to
 *  the map or persistence — that is the commit pass's job. Pass the live
 *  thumb values so the row can update before the change is committed.
 *
 *  The drag bubble shows the value being moved; the numbers under the rail
 *  belong to the marks that cannot move (the map's two limits) and to the
 *  current level, which is a readout, not a control. */
const syncZoomRangeRow = (
  ui: LayerUI,
  layerId: string,
  row: HTMLElement,
  liveRange?: [number, number],
): void => {
  const [mapMin, mapMax] = authorZoomBoundsForLayer(ui, layerId);
  const range = liveRange ?? getIntent(ui, layerId, INTENT.ZOOM_RANGE);
  const [min, max] = clampEndpoints(range, mapMin, mapMax);
  const current = ui.c.map.getZoom();

  const slider = sliderOfRow(row);
  if (slider) {
    slider.setValue([min, max], { silent: true });
    slider.setMarks([
      { at: mapMin, tone: "limit" },
      { at: mapMax, tone: "limit" },
      { at: current, tone: "current" },
    ]);
    slider.setCurrent({
      at: current,
      text: String(current),
      hideGapPct: LABEL_MIN_GAP_PCT,
    });
  }

  // Out-of-range: dim the row when the current zoom falls outside [min, max].
  const outOfRange = current < min || current > max;
  row.classList.toggle(CONST.CLASSES.STYLE_ZOOM_RANGE_OUT_OF_RANGE, outOfRange);
  row.title = outOfRange
    ? ui.T("style_zoom_range_out_of_range").replace("{zoom}", String(current))
    : ui.T("style_zoom_range_current").replace("{zoom}", String(current));
};

/** Resolve a stored [lo, hi] into the map's available band, always ordered.
 *  The stored choice wins (never locks the user), so it is only clamped into
 *  the map's rail. If the stored band lies entirely outside the map the two
 *  ends collapse onto the nearer map end — a degenerate point — so the model
 *  and the slider agree (both ordered, both inside [mapMin, mapMax]); the
 *  layer's actual visibility still comes from the projection, which hides it
 *  when no zoom can land inside the stored range. */
const clampEndpoints = (
  stored: [number, number] | undefined,
  mapMin: number,
  mapMax: number,
): [number, number] => {
  if (!stored) return [mapMin, mapMax];
  const lo = Math.min(stored[0], stored[1]);
  const hi = Math.max(stored[0], stored[1]);
  const min = Math.max(lo, mapMin);
  const max = Math.min(hi, mapMax);
  if (min <= max) return [min, max];
  // Band entirely below the map: pin to the floor. Entirely above: pin to the
  // ceiling. (A band that straddles the whole map clamps to the full rail and
  // stays ordered, so it never reaches this branch.)
  return hi <= mapMin ? [mapMin, mapMin] : [mapMax, mapMax];
};

/** Build the zoom-range form row: a dual-thumb slider with the map's current
 *  zoom as a readout mark.
 *
 *  Initial values come from the layer's zoomRange intent (the persisted
 *  choice), clamped to the map's current [min, max]. When no range is stored,
 *  the full map range is used — the "author-undeclared" default. */
const buildZoomRangeRow = (ui: LayerUI, layerId: string): HTMLElement => {
  const [mapMin, mapMax] = authorZoomBoundsForLayer(ui, layerId);
  const stored = getIntent(ui, layerId, INTENT.ZOOM_RANGE);
  const [min, max] = clampEndpoints(stored, mapMin, mapMax);
  const current = ui.c.map.getZoom();

  // The primitive adds .foliplus-slider itself; the row only names its hook.
  const host = dom.el("div", {
    class: CONST.CLASSES.STYLE_ZOOM_RANGE_CONTROL,
  });
  const row = dom.el(
    "div",
    {
      class: `${CONST.CLASSES.FORM_ROW} ${CONST.CLASSES.STYLE_ZOOM_RANGE_ROW}`,
    },
    dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, ui.T("style_zoom_range")),
    dom.el("div", { class: CONST.CLASSES.FORM_CONTROL }, host),
  );

  new Slider(host, {
    min: mapMin,
    max: mapMax,
    step: 1,
    value: [min, max],
    label: ui.T("style_zoom_range"),
    labels: [ui.T("style_zoom_range_min"), ui.T("style_zoom_range_max")],
    values: { min: String(mapMin), max: String(mapMax) },
    marks: [
      { at: mapMin, tone: "limit" },
      { at: mapMax, tone: "limit" },
      { at: current, tone: "current" },
    ],
    current: {
      at: current,
      text: String(current),
      hideGapPct: LABEL_MIN_GAP_PCT,
    },
    input: value => {
      const [lo, hi] = value as [number, number];
      applyZoomRangeLive(ui, layerId, row, lo, hi);
    },
    change: () => commitZoomRange(ui, layerId),
  });

  syncZoomRangeRow(ui, layerId, row);
  return row;
};

/** Live pass: update the map and visual state without persisting. Called on
 *  every input while a thumb moves, so the layer responds in real time — the
 *  slider is a live preview, not a deferred commit. Value-only write
 *  (setValue) — provenance marks on the commit pass. */
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
  // Announce last: the row chrome above is already settled, so a subscriber
  // that re-enters sees the dragged value, not a mid-drag row.
  notifyDelta(ui, layerInfo, applyProjection(ui, layerId));
};

/** Commit pass: persist the zoom range to localStorage. The value and the
 *  map state are already updated by applyZoomRangeLive; this records the
 *  override through the descriptor write (cohesive set + save). */
const commitZoomRange = (ui: LayerUI, layerId: string): void => {
  getDimension(DIM.ZOOM_RANGE)!.write!(ui, layerId, {});
};

/** Reset one layer's zoom range to the full map range and drop its override.
 *  Owns the full operation boundary: intent + projection land inside the
 *  descriptor, the row chrome (fill, values, out-of-range state) is refreshed
 *  here, and only then does the notify go out — a subscriber that re-enters
 *  reads the settled row, not a stale "out of range" face. Pass
 *  `publish = false` from the panel's whole-operation Reset, which owns the
 *  single notify after the panel is closed. */
const resetLayerZoomRange = (
  ui: LayerUI,
  layerId: string,
  publish = true,
): ProjectionDelta | void => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return;
  const delta = getDimension(DIM.ZOOM_RANGE)!.reset!(ui, layerId) ?? NO_DELTA;
  // Refresh the row's visual state (fill, values, out-of-range) before the
  // notify below. A reset can still land after a competing teardown took the
  // panel — a scheduled reset, or a panel whose control was destroyed — so the
  // lookup tolerates a missing container instead of dereferencing null.
  const panel = ui.uiContainer?.querySelector(
    `.${CONST.CLASSES.STYLE_PANEL}`,
  ) as HTMLElement | null;
  const row = panel?.querySelector(
    `.${CONST.CLASSES.STYLE_ZOOM_RANGE_ROW}`,
  ) as HTMLElement | null;
  if (row) syncZoomRangeRow(ui, layerId, row);
  if (publish) notifyDelta(ui, layerInfo, delta);
  return delta;
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
    const [min, max] = clampEndpoints(stored, mapMin, mapMax);
    return { min, max };
  },
  row: buildZoomRangeRow,
  /** Intent+persist + projection. Empty patch commits an already-written
   *  live preview (mark current intent); {min,max} writes then marks. */
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
    const layerInfo = ui.c.layerRegistry.get(layerId);
    if (!layerInfo) return;
    // The commit pass owns its own notify: the intent write above is the only
    // side effect, so the delta goes out on the projection it just ran.
    notifyDelta(ui, layerInfo, applyProjection(ui, layerId));
  },
  /** Cohesive reset: clear the override, save, re-project. Returns the delta
   *  without announcing — the complete reset entry (`resetLayerZoomRange`)
   *  owns the notify so it can refresh row chrome first. */
  reset: (ui, layerId) => {
    resetIntentKeys(ui, layerId, [INTENT.ZOOM_RANGE]);
    const layerInfo = ui.c.layerRegistry.get(layerId);
    if (!layerInfo) return;
    return applyProjection(ui, layerId);
  },
  valueSource: (ui, layerId) => {
    if (!canShowZoomRange(ui, layerId)) return "none";
    return ui.intentStore.isUserSet(layerId, INTENT.ZOOM_RANGE) ? "user" : "author";
  },
  /** No content-change replay: zoom range is a visibility gate over zoom
   *  level, not a per-leaf write — the zoom-end projection sweep owns it. */
  contentChange: { kind: "none" },
});

export {
  applyZoomRangeLive,
  commitZoomRange,
  resetLayerZoomRange,
  syncZoomRangeRow,
  ZOOM_RANGE_DIMENSION,
};

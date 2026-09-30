// Value-based fill rendering — the "By value" mode of the fill dimension.
//
// Walks a layer's style leaves, reads `feature.properties[field]` per leaf,
// classifies the values with `computeBreaks`, maps each class to a colour
// from the scheme via `getColorScale`, and writes the per-leaf `fillColor`
// through styleBag FACE.FILL (the same landing as solid-mode fill).
//
// One frame = one `applyFillToLayer` call = two internal walks (collect
// values, then apply colours). The styleBag scheduler
// (`scheduleStyleDimApply`) coalesces the whole apply to at most one per
// frame, so a colour-scheme drag does not trigger a walk per input step.
//
// Highlight pin: each leaf gets a `pinStyleOnHighlight` getter that reads
// the live fillRamp intent and the cached breaks. If the config changed
// since the cache was built, the getter returns null (the author's fill
// face stays in force) — the next scheduler tick rebuilds the cache.
import { computeBreaks } from "#core/classify.js";
import { DIM } from "#core/layer/index.js";
import { getColorScale } from "#core/palette.js";
import type { FillRampConfig } from "../../type.js";
import type { LayerUI } from "../index.js";
import { INTENT, getIntent } from "../intent.js";
import { pinStyleOnHighlight } from "./pin.js";
import {
  FACE,
  type StyleCarrier,
  type StyleSetter,
  commitStyleDim,
  styleDimPayload,
  walkStyleLeaves,
} from "./styleBag.js";

/** A leaf that may carry a `feature` envelope (GeoJSON data). */
type FeatureLeaf = StyleSetter & {
  feature?: { properties?: Record<string, unknown> };
};

/** Read a leaf's `feature.properties[key]` value, if any. */
const leafPropertyValue = (leaf: StyleSetter, key: string): unknown =>
  (leaf as FeatureLeaf).feature?.properties?.[key];

/** Whether a property value can drive a numeric classification. */
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Bisect a value into a class index over sorted, non-decreasing breaks.
 *  Returns the last class for values beyond the final break (the same
 *  convention `valueToClassIdx` in HeatmapControl/data.ts uses). */
const valueToClassIdx = (val: number, breaks: number[]): number => {
  if (breaks.length < 2) return 0;
  for (let i = 1; i < breaks.length; i++) {
    if (val <= breaks[i]) return i - 1;
  }
  return breaks.length - 2;
};

/** Apply a value-based fill to one layer. Two-pass walk:
 *
 *  1. Collect every leaf's `feature.properties[field]` value (finite
 *     numbers only — NaN / Infinity / non-numeric are skipped).
 *  2. Compute breaks, build the colour scale, and write each leaf's
 *     `fillColor` via `commitStyleDim` (which also lights `fill: true`).
 *
 *  A layer with no finite values is a no-op. Leaves whose value is
 *  non-finite keep the author's fill face (the previous commit, or the
 *  author's bag on first touch).
 *
 *  Highlight pin: each written leaf gets a `pinStyleOnHighlight` getter
 *  that reads the live fillRamp intent and uses the cached breaks to
 *  re-derive the leaf's colour on mouseout. If the ramp config changed
 *  since the cache was built (field / method / classes / scheme differ),
 *  the getter returns null so folium's `resetStyle` is not overridden
 *  with a stale colour — the next scheduler tick rebuilds the cache. */
const applyRampToLayer = (ui: LayerUI, layerId: string, ramp: FillRampConfig): void => {
  const li = ui.m.layerRegistry.get(layerId);
  const layer = li?.layer as StyleCarrier | null;
  if (!layer) return;

  // ── Pass 1: collect values ──
  const values: number[] = [];
  const leafValues = new Map<StyleSetter, number>();
  walkStyleLeaves(layer, leaf => {
    const val = leafPropertyValue(leaf, ramp.field);
    if (isFiniteNumber(val)) {
      values.push(val);
      leafValues.set(leaf, val);
    }
  });

  if (values.length === 0) return;

  // ── Compute breaks + colour scale ──
  const nClasses = Math.min(ramp.classes, values.length);
  const breaks = computeBreaks(values, nClasses, ramp.method);
  const classColors = getColorScale(ramp.scheme, breaks.length - 1);

  // ── Pass 2: apply per-leaf + pin ──
  walkStyleLeaves(layer, leaf => {
    const val = leafValues.get(leaf);
    if (val === undefined) return;
    const classIdx = valueToClassIdx(val, breaks);
    const fillColor =
      classColors[classIdx] ?? classColors[classColors.length - 1] ?? "#999";
    commitStyleDim(leaf, { fillColor }, FACE.FILL);

    pinStyleOnHighlight(leaf, DIM.FILL, () => {
      const currentRamp = getIntent(ui, layerId, INTENT.FILL_RAMP);
      if (!currentRamp) return null;
      // Config changed since the cache was built — return null so the
      // author's face stays in force until the next scheduler tick.
      if (
        currentRamp.field !== ramp.field ||
        currentRamp.method !== ramp.method ||
        currentRamp.classes !== ramp.classes ||
        currentRamp.scheme !== ramp.scheme
      ) {
        return null;
      }
      const curVal = leafPropertyValue(leaf, ramp.field);
      if (!isFiniteNumber(curVal)) return null;
      const curIdx = valueToClassIdx(curVal, breaks);
      const curColor =
        classColors[curIdx] ?? classColors[classColors.length - 1] ?? "#999";
      return styleDimPayload({ fillColor: curColor }, FACE.FILL);
    });
  });
};

export { applyRampToLayer };

// Value-based fill rendering — the "By value" mode of the fill dimension.
//
// Walks a layer's style leaves, reads `feature.properties[field]` per leaf,
// classifies the values with `computeBreaks`, maps each class to a colour
// from the scheme via `getColorScale`, and writes the per-leaf `fillColor`
// through styleBag FACE.FILL (the same landing as solid-mode fill).
//
// Two-pass walk design with a collect-pass cache:
//
//   Pass 1 (collect): walks leaves, reads `feature.properties[field]`.
//     Cached by (layerId, field) — method/classes/scheme don't change
//     the source values, so re-applying the same field skips Pass 1
//     entirely. Cache is a single slot: a different layerId drops the
//     previous entry. Invalidation on field switch is automatic.
//
//   Pass 2 (apply): walks leaves again, writes per-leaf fillColor via
//     styleBag. Always runs — even a scheme drag writes new colours
//     to every leaf.
//
// Net: steady-state (dragging scheme / classes / method on the same
// layer+field) = 1 walk per frame (Pass 2 only). Field switch or
// first apply = 2 walks (Pass 1 + Pass 2), then steady-state resumes.
//
// The styleBag scheduler (`scheduleStyleDimApply`) coalesces the whole
// apply to at most one per frame, so a colour-scheme drag does not
// trigger a walk per input step.
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

/** Result of the collect pass — what applyRampToLayer needs from Pass 1. */
type CollectedValues = {
  layer: StyleCarrier;
  layerId: string;
  field: string;
  values: number[];
  leafValues: Map<StyleSetter, number>;
};

/** Single-slot cache for the collect pass. Keyed by (layer, layerId, field):
 *  method / classes / scheme don't change the source values, so a
 *  re-apply with the same layer+field reuses the cached array. A
 *  different layer reference, layerId, or field drops the entry and
 *  rebuilds.
 *
 *  Lifetime: module-level, survives across apply calls. The cache is
 *  tied to the LayerControl instance's lifetime indirectly — the
 *  `layer` reference in the key ensures a stale cache entry (from a
 *  previous layer with the same ID) is never reused.
 *
 *  Multi-instance on one page: the single slot means two controls on
 *  the same page would thrash each other. Acceptable for v1 — each
 *  control's apply calls are per-frame and per-layer, so thrashing
 *  only costs one extra collect walk per frame. */
let cachedCollected: CollectedValues | null = null;

/** Return the collected values for (layer, layerId, field) — cached if
 *  the previous collect was for the same layer+layerId+field, else rebuild. */
const collectOrCachedValues = (
  layer: StyleCarrier,
  layerId: string,
  field: string,
): CollectedValues => {
  if (
    cachedCollected &&
    cachedCollected.layer === layer &&
    cachedCollected.layerId === layerId &&
    cachedCollected.field === field
  ) {
    return cachedCollected;
  }
  const values: number[] = [];
  const leafValues = new Map<StyleSetter, number>();
  walkStyleLeaves(layer, leaf => {
    const val = leafPropertyValue(leaf, field);
    if (isFiniteNumber(val)) {
      values.push(val);
      leafValues.set(leaf, val);
    }
  });
  cachedCollected = { layer, layerId, field, values, leafValues };
  return cachedCollected;
};

/** Apply a value-based fill to one layer.
 *
 *  Collect pass is cached by (layerId, field): a re-apply with the
 *  same layer+field reuses the cached values and only runs Pass 2
 *  (the per-leaf apply). Field switch or first apply = 2 walks.
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

  // ── Collect (cached if same layer+field) ──
  const collected = collectOrCachedValues(layer, layerId, ramp.field);
  if (collected.values.length === 0) return;
  const values = collected.values;
  const leafValues = collected.leafValues;

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

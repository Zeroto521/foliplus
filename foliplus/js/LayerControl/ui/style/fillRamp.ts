// Value-based fill rendering — the "按值着色 / Color by value" arm of the
// fill dimension.
//
// Walks a layer's style leaves, reads `feature.properties[field]` per leaf,
// builds the ramp once with `buildRamp` (breaks + colours + the value →
// class bisection, shared with the heatmap and the upcoming by-value icon
// and size dimensions), and writes the per-leaf `fillColor` through
// styleBag FACE.FILL — the same landing as the solid arm.
//
// Two-pass walk per apply (collect → apply). The styleBag scheduler
// (`scheduleStyleDimApply`) coalesces the whole apply to at most one per
// frame, so a scheme drag does not trigger a walk per input step.
//
// The user's solid-mode `fillOpacity` rides along on every ramp leaf: a ramp
// replaces only the colour, so dropping the opacity here would make a mode
// switch back to solid silently lose it. The same live value is replayed by
// the highlight pin.
//
// Highlight pin: each written leaf gets a `pinStyleOnHighlight` getter that
// reads the live fillRamp intent and the cached breaks. If the config
// changed since the cache was built (field / method / classes / scheme
// differ), the getter returns null so the author's fill face stays in force
// — the next scheduler tick rebuilds the cache.
import { DIM } from "#core/layer/index.js";
import type { FillRampConfig } from "#core/layer/intent.js";
import { buildRamp, colorFor } from "#core/ramp.js";
import { INTENT, getIntent } from "../intent.js";
import type { LayerUI } from "../surface.js";
import { pinStyleOnHighlight } from "./pin.js";
import {
  FACE,
  type StyleCarrier,
  type StyleSetter,
  commitStyleDim,
  restoreStyleDim,
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

/** Invalidate a leaf's previous ramp pin.
 *
 *  A leaf this ramp cannot classify must not keep replaying the colour the
 *  previous ramp committed: folium's mouseout would re-apply it on every
 *  leave. Returning null leaves the author's face in force, and the next
 *  apply re-registers the key with a live getter, so the null is not a
 *  permanent block. */
const clearRampPin = (leaf: StyleSetter): void => {
  pinStyleOnHighlight(leaf, DIM.FILL, () => null);
};

/** Whether two ramp configs differ in a way that invalidates a cached
 *  breaks/scale pair. Every field counts: `field` because the collected
 *  values come from it, so a field change is a full rebuild, not a repaint;
 *  `kind` because another typing would build its breaks differently, so a
 *  same-named config for a different kind must not repaint off a numeric
 *  cache. An explicit "numeric" is read as the same typing as absence — the
 *  persistence reader strips it, so the two spellings are one config. */
const sameRampConfig = (a: FillRampConfig, b: FillRampConfig): boolean =>
  (a.kind ?? "numeric") === (b.kind ?? "numeric") &&
  a.field === b.field &&
  a.method === b.method &&
  a.classes === b.classes &&
  a.scheme === b.scheme;

/** The active fill arm. An absent mode defers to whether a ramp config
 *  exists — the pre-fillMode record shape, where a config alone meant "paint
 *  by value". Every reader of the fill state goes through this so apply, the
 *  dimension's value, the replay guard and the highlight pins all agree on
 *  what the map should show; reading the stored mode with a solid fallback on
 *  its own reports solid while the map is painted by value. */
const resolveFillMode = (
  ui: LayerUI,
  layerId: string,
  ramp: FillRampConfig | undefined,
): "solid" | "ramp" =>
  getIntent(ui, layerId, INTENT.FILL_MODE) ?? (ramp !== undefined ? "ramp" : "solid");

/** Apply a value-based fill to one layer.
 *
 *  Two-pass walk: collect `feature.properties[field]` values, then apply
 *  per-leaf fillColor via styleBag. A layer with no finite values is a
 *  no-op. Leaves whose value is non-finite keep the author's fill face
 *  (the previous commit, or the author's bag on first touch).
 *
 *  Highlight pin: each written leaf gets a `pinStyleOnHighlight` getter
 *  that reads the live fillRamp intent and uses the cached breaks to
 *  re-derive the leaf's colour on mouseout. If the ramp config changed
 *  since the cache was built, the getter returns null so folium's
 *  `resetStyle` is not overridden with a stale colour — the next
 *  scheduler tick rebuilds the cache. */
const applyRampToLayer = (ui: LayerUI, layerId: string, ramp: FillRampConfig): void => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  // Snapshot-then-resolve: the registry's own `layer` reference is fast and
  // stable once populated, so it wins; the controller's `findLayer`
  // re-resolves against the live map for a folium layer whose registry
  // reference is still null — the same late-binding defense as
  // applyFillToLayer, without which a just-attached control would paint
  // nothing.
  const layer = (layerInfo?.layer ?? ui.c.findLayer(layerId)) as StyleCarrier | null;
  if (!layer) return;

  // Live reader: the pin replays whatever the user has since chosen, not the
  // value frozen at build time.
  const readOpacity = (): number | undefined =>
    getIntent(ui, layerId, INTENT.FILL_OPACITY);

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

  // ── Build the ramp once, before the write pass ──
  // chroma throws on a scheme name it cannot parse instead of returning the
  // fallback grey, and that throw would otherwise escape the replay walk that
  // runs while the control attaches: one bad record in storage would leave
  // the whole panel unmounted. A layer whose ramp cannot be built gets the
  // author's fill face back — the same answer an all-invalid field gives.
  let scale: ReturnType<typeof buildRamp> | null = null;
  if (values.length > 0) {
    try {
      scale = buildRamp(values, ramp);
    } catch {
      scale = null;
    }
  }
  if (!scale || scale.colors.length === 0) {
    // Nothing to classify — clean up rather than leave the map as it was:
    // every leaf goes back to the author's fill face and its old pin is
    // dropped, so a previously painted ramp cannot resurface on mouseout.
    walkStyleLeaves(layer, leaf => {
      restoreStyleDim(leaf, FACE.FILL);
      clearRampPin(leaf);
    });
    return;
  }

  // ── Pass 2: apply per-leaf + pin ──
  walkStyleLeaves(layer, leaf => {
    const val = leafValues.get(leaf);
    if (val === undefined) {
      // No value to classify, so this leaf is outside the ramp's reach and
      // goes back to the author's fill face. Leaving the previous commit here
      // would keep a colour the current config cannot justify, and the stale
      // pin would stay inert until folium's next mouseout fixed it by luck.
      restoreStyleDim(leaf, FACE.FILL);
      clearRampPin(leaf);
      return;
    }
    // fillOpacity is undefined when the user never set one; styleDimPayload
    // drops it, so the author's declared opacity stays in force.
    commitStyleDim(
      leaf,
      { fillColor: colorFor(scale, val), fillOpacity: readOpacity() },
      FACE.FILL,
    );

    pinStyleOnHighlight(leaf, DIM.FILL, () => {
      const currentRamp = getIntent(ui, layerId, INTENT.FILL_RAMP);
      if (!currentRamp) return null;
      // The arm changed since the cache was built: the solid commit owns the
      // leaf now, and this getter must not replay a colour the active mode
      // does not own (a mode switch back to solid that leaves the ramp config
      // stored would otherwise re-apply the ramp on every mouseout).
      if (resolveFillMode(ui, layerId, currentRamp) !== "ramp") return null;
      // Config changed since the cache was built — return null so the
      // author's face stays in force until the next scheduler tick.
      if (!sameRampConfig(currentRamp, ramp)) return null;
      const curVal = leafPropertyValue(leaf, ramp.field);
      if (!isFiniteNumber(curVal)) return null;
      // fill:true rides the replay too — folium's resetStyle would otherwise
      // re-apply the author's fill:false on mouseout and hide the fill.
      // fillOpacity replays alongside it so the hover restore does not drop
      // the user's transparency.
      return styleDimPayload(
        { fillColor: colorFor(scale, curVal), fillOpacity: readOpacity() },
        FACE.FILL,
      );
    });
  });
};

export { applyRampToLayer, resolveFillMode };

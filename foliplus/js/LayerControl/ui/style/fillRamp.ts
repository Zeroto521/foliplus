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
// The user's solid-mode `fillOpacity` rides along on every fill leaf,
// including ones the ramp cannot classify: a ramp replaces only the colour,
// so dropping the opacity here would make a mode switch back to solid silently
// lose it, and a valueless leaf would keep the author's opacity next to the
// user's on a classifiable neighbour of the same layer. `fillOpacity` is
// shared across the two arms, so it is a layer-level value. The same live
// value is replayed by the highlight pin.
//
// Highlight pin: each written leaf gets a `pinStyleOnHighlight` getter that
// reads the live fillRamp intent and the cached breaks. If the config
// changed since the cache was built (field / method / classes / scheme
// differ), the getter returns null so the author's fill face stays in force
// — the next scheduler tick rebuilds the cache.
import { ClassifierDependencyError } from "#core/classify.js";
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
  commitStyleDimMerged,
  styleDimOverAuthor,
  styleDimPayload,
  walkFillLeaves,
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

/** Drive values per leaf: collected by pass 1, read by pass 2. One shared
 *  map cleared per apply rather than a fresh allocation per tick - a drag
 *  issues one apply per frame, so the entries are reused instead of handed
 *  to GC N at a time, N x frames. */
const rampLeafValues = new Map<StyleSetter, number>();

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
 *  Two-pass walk: collect `feature.properties[field]` values, then write
 *  per-leaf fillColor via styleBag. Every fill leaf is written on every apply:
 *  one the ramp can classify gets the ramp's colour, one it cannot gets the
 *  author's own colour and `fill` flag back, and both get the user's opacity.
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
  rampLeafValues.clear();
  walkFillLeaves(layer, leaf => {
    const val = leafPropertyValue(leaf, ramp.field);
    if (isFiniteNumber(val)) {
      values.push(val);
      rampLeafValues.set(leaf, val);
    }
  });

  // ── Build the ramp once, before the write pass ──
  // chroma throws on a scheme name it cannot parse instead of returning the
  // fallback grey, and that throw would otherwise escape the replay walk that
  // runs while the control attaches: one bad record in storage would leave
  // the whole panel unmounted. A layer whose ramp cannot be built gets the
  // author's fill face back — the same answer an all-invalid field gives.
  //
  // Two failures land here, and only one is one the user can fix by changing
  // the record. A scheme chroma cannot parse degrades to the author's face;
  // a missing simple-statistics global means the chosen method cannot run at
  // all, for the whole page, and it must be reported rather than only
  // degraded — otherwise the map silently keeps its author colour while the
  // panel still says "quantile".
  let built: ReturnType<typeof buildRamp> | null = null;
  try {
    built = buildRamp(values, ramp);
  } catch (err) {
    if (err instanceof ClassifierDependencyError) {
      console.warn("[foliplus] value-based fill: " + err.message);
    }
  }

  // `buildRamp` returns no colours when the sample cannot be split at all —
  // an empty ramp, or breaks with no span — which is the honest "nothing to
  // classify" answer. Read once, so the write pass and the pins share one
  // answer instead of each re-testing it.
  const scale: ReturnType<typeof buildRamp> | null =
    built !== null && built.colors.length > 0 ? built : null;

  // ── Pass 2: write per-leaf + pin ──
  walkFillLeaves(layer, leaf => {
    const opacity = readOpacity();
    const write: Record<string, unknown> = {};
    if (opacity !== undefined) write.fillOpacity = opacity;
    const val = rampLeafValues.get(leaf);
    if (scale !== null && isFiniteNumber(val)) {
      // The ramp owns this leaf's colour, so `fill` is lit and the author's
      // colour is replaced. The payload stays minimal: a named colour replaces
      // whatever the previous arm left in that slot, and the opacity is named
      // only when the user chose one, so the author's stays in force.
      write.fillColor = colorFor(scale, val);
      commitStyleDim(leaf, write, FACE.FILL);
    } else {
      // Outside the ramp's reach: the author's colour and `fill` flag —
      // `fill: false` on a hollow layer — ride the merge untouched, but the
      // user's opacity still does. Restoring the whole face would leave the
      // author's opacity next to the user's on a classifiable neighbour of
      // the same layer.
      commitStyleDimMerged(leaf, write, FACE.FILL, false);
    }

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
      const op = readOpacity();
      const curVal = leafPropertyValue(leaf, ramp.field);
      if (scale !== null && isFiniteNumber(curVal)) {
        // fill:true rides the replay too — folium's resetStyle would otherwise
        // re-apply the author's fill:false on mouseout and hide the fill.
        // fillOpacity replays alongside it so the hover restore does not drop
        // the user's transparency.
        return styleDimPayload(
          { fillColor: colorFor(scale, curVal), fillOpacity: op },
          FACE.FILL,
        );
      }
      // Out of the ramp's reach: folium's restore already gave the author's
      // colour and `fill` flag back, so the only thing worth re-applying on
      // top of it is the user's opacity. With none chosen there is nothing
      // to add, and null lets the restore stand instead of rewriting it.
      if (op === undefined) return null;
      return styleDimOverAuthor(leaf, { fillOpacity: op }, FACE.FILL, false);
    });
  });
};

export { applyRampToLayer, resolveFillMode };

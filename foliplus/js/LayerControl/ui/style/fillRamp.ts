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
import { DIM } from "#core/layer/index.js";
import type { FillMode, FillRampConfig } from "#core/layer/intent.js";
import { buildRamp, colorFor } from "#core/ramp.js";
import { createLogger } from "#common/log.js";
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

const log = createLogger("foliplus");

/** A leaf that may carry a `feature` envelope (GeoJSON data). */
type FeatureLeaf = StyleSetter & {
  feature?: { properties?: Record<string, unknown> };
};

/** Read a leaf's `feature.properties[key]` value, if any.
 *
 *  The three reads walk into a third-party object, so each hop is its own
 *  boundary: a leaf whose `feature`, whose `properties`, or the field itself
 *  is a throwing getter simply has no value. Letting it propagate aborts the
 *  whole layer's collection - no healthy sibling gets coloured - and re-throws
 *  later out of a Leaflet mouseout handler that is replaying the highlight.
 *
 *  Only the read is inside the boundary. `buildRamp`, `colorFor` and
 *  `setStyle` stay outside it: a classifier or write failure is a different
 *  class of problem and must not be swallowed here. */
const leafPropertyValue = (leaf: StyleSetter, key: string): unknown => {
  try {
    const feature = (leaf as FeatureLeaf).feature;
    const properties = feature?.properties;
    return properties?.[key];
  } catch {
    return undefined;
  }
};

/** Whether a property value can drive a numeric classification. */
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** One collected leaf: the node plus its finite drive value, if any. */
type CollectedLeaf = { leaf: StyleSetter; value: number | undefined };

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

/** The stored fill arm. An absent mode defers to whether a ramp config
 *  exists — the pre-fillMode record shape, where a config alone meant "paint
 *  by value". Every reader of the fill state goes through this (or the
 *  panel's own resolver in `fill.ts`, which adds the author's original-colors
 *  arm) so apply, the dimension's value, the replay guard and the highlight
 *  pins all agree on what the map should show; reading the stored mode with a
 *  solid fallback on its own reports solid while the map is painted by value.
 *  `FillMode` is returned whole rather than narrowed to the two arms: a
 *  stored "original" must reach the caller as itself, not as the fallback. */
const resolveFillMode = (
  ui: LayerUI,
  layerId: string,
  ramp: FillRampConfig | undefined,
): FillMode =>
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
const applyRampToLayer = (
  ui: LayerUI,
  layerId: string,
  ramp: FillRampConfig,
  /** Resolve a stored config's field against the layer's current fields.
   *  The caller resolves the config it paints with, so the highlight pin must
   *  resolve the live record the same way before comparing: a stored field the
   *  data no longer offers would otherwise compare unequal to the resolved one
   *  and the mouseout replay would drop the ramp colour. Identity by default —
   *  a caller with no field list has nothing to resolve. */
  resolveStored: (stored: FillRampConfig) => FillRampConfig = stored => stored,
): void => {
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
  // The collection is local to this call on purpose. A module-level scratch
  // would be shared with a re-entrant apply - a setStyle that triggers
  // another layer's ramp would clear this walk's entries mid-pass and the
  // surviving leaves would be repainted with the author's colour - and it
  // would keep every leaf of the last painted layer alive between applies.
  const values: number[] = [];
  const collected: CollectedLeaf[] = [];
  walkFillLeaves(layer, leaf => {
    const read = leafPropertyValue(leaf, ramp.field);
    const value = isFiniteNumber(read) ? read : undefined;
    if (value !== undefined) values.push(value);
    collected.push({ leaf, value });
  });

  // ── Build the ramp once, before the write pass ──
  // A build failure must not escape the replay walk that runs while the
  // control attaches: one bad record in storage would leave the whole panel
  // unmounted. A layer whose ramp cannot be built gets the author's fill face
  // back — the same answer an all-invalid field gives.
  //
  // Every build failure lands here and every one is reported - a classifier
  // dependency that failed to load (blocked CDN, or an environment without
  // the global: the script itself is a declared LayerControl asset), a
  // method or palette name this client does not implement (only reachable by
  // bypassing the record validator), and anything unexpected. Reporting
  // matters because the alternative is the map silently keeping its author
  // colour while the panel still claims the chosen method.
  let built: ReturnType<typeof buildRamp> | null = null;
  try {
    built = buildRamp(values, ramp);
  } catch (err) {
    log.warn("value-based fill:", err);
  }

  // `buildRamp` returns no colours when the sample cannot be split at all —
  // an empty ramp, or breaks with no span — which is the honest "nothing to
  // classify" answer. Read once, so the write pass and the pins share one
  // answer instead of each re-testing it.
  const scale: ReturnType<typeof buildRamp> | null =
    built !== null && built.colors.length > 0 ? built : null;

  // ── Pass 2: write per-leaf + pin ──
  // Iterating the collection instead of re-walking the tree: the two passes
  // then share one leaf order and no shared state.
  for (const { leaf, value } of collected) {
    const opacity = readOpacity();
    const write: Record<string, unknown> = {};
    if (opacity !== undefined) write.fillOpacity = opacity;
    if (scale !== null && value !== undefined) {
      // The ramp owns this leaf's colour, so `fill` is lit and the author's
      // colour is replaced. The payload stays minimal: a named colour replaces
      // whatever the previous arm left in that slot, and the opacity is named
      // only when the user chose one, so the author's stays in force.
      write.fillColor = colorFor(scale, value);
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
      const stored = getIntent(ui, layerId, INTENT.FILL_RAMP);
      if (!stored) return null;
      // Resolve the live record exactly as the paint did, or a stale field
      // name compares unequal to the resolved config and the replay drops the
      // ramp colour on the first mouseout.
      const currentRamp = resolveStored(stored);
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
  }
};

export { applyRampToLayer, resolveFillMode };

// Value-based stroke rendering — the "Color by value / Stroke by value" arm of
// the border dimension.
//
// Walks a layer's style leaves, reads `feature.properties[field]` per leaf,
// builds the ramp once with `buildRamp` (breaks + colors + the value →
// class bisection, shared with the value-based fill and the heatmap), and
// writes the per-leaf `color` through styleBag FACE.STROKE — the same
// landing as the solid border arm.
//
// Two-pass walk per apply (collect → apply). The styleBag scheduler
// (`scheduleStyleDimApply`) coalesces the whole apply to at most one per
// frame, so a scheme drag does not trigger a walk per input step.
//
// Unlike the fill arm there is no opacity to carry: the stroke face owns
// `color` / `weight` / `stroke`. This arm replaces only the color — the
// width stays the fixed border width and the `stroke` visibility bit is
// lit by `commitStyleDim` (an author who declared `stroke: false` must not
// swallow the user's value-stroke write, the styleBag write contract).
//
// The walk is `walkStyleLeaves`, NOT `walkFillLeaves`: the stroke predicate
// is `setStyle` presence, which admits line leaves (Polyline owns a
// setter but is not areal). So one value-stroke dimension covers both the
// line stroke (Gap 2) and the area stroke (Gap 3) without a geometry
// filter — the design's recommended single dimension.
//
// Highlight pin: each written leaf gets a `pinStyleOnHighlight` getter that
// reads the live stroke config and the cached breaks. If the config
// changed since the cache was built (field / method / classes / scheme
// differ), the getter returns null so the author's stroke face stays in
// force — the next scheduler tick rebuilds the cache.
//
// This module is intentionally decoupled from the intent store: the caller
// (the border dimension's write path) owns where the stroke config and the
// active-arm mode live, and supplies the live readers. The engine paints
// exactly what it is asked to — a stored `borderValue` / `borderMode`
// pair is a later slice (it needs new LayerOverride keys, which touch
// persistence.ts, which #932 is actively editing).
import { DIM } from "#core/layer/index.js";
import { type FillMode, type FillValueConfig } from "#core/layer/intent.js";
import {
  buildCategoryRamp,
  buildRamp,
  categoryLabel,
  colorFor,
  isFiniteNumber,
  leafPropertyValue,
} from "#core/ramp.js";
import { createLogger } from "#common/log.js";
import type { LayerUI } from "../surface.js";
import { pinStyleOnHighlight } from "./pin.js";
import {
  FACE,
  type StyleCarrier,
  type StyleSetter,
  commitStyleDim,
  commitStyleDimMerged,
  styleDimPayload,
  walkStyleLeaves,
} from "./styleBag.js";

const log = createLogger("foliplus");

/** One collected leaf: the node plus its finite drive value, if any. */
type CollectedLeaf = {
  leaf: StyleSetter;
  /** The numeric drive value, when the arm is numeric. */
  value: number | undefined;
  /** The categorical drive label, when the arm is category. */
  category: string | undefined;
};

/** Whether two value configs differ in a way that invalidates a cached
 *  breaks/scale pair. Every field counts: `field` because the collected
 *  values come from it, so a field change is a full rebuild, not a repaint;
 *  `kind` because another typing would build its breaks differently, so a
 *  same-named config for a different kind must not repaint off a numeric
 *  cache. An explicit "numeric" is read as the same typing as absence — the
 *  persistence reader strips it, so the two spellings are one config.
 *  Shared with the fill arm: the two faces classify one field the same way. */
const sameValueConfig = (a: FillValueConfig, b: FillValueConfig): boolean =>
  (a.kind ?? "numeric") === (b.kind ?? "numeric") &&
  a.field === b.field &&
  a.method === b.method &&
  a.classes === b.classes &&
  a.scheme === b.scheme;

/** The stroke arm in force. An absent mode defers to whether a value config
 *  exists — the pre-mode record shape, where a config alone meant "paint
 *  by value". `FillMode` is reused as the stroke-mode vocabulary: the two
 *  faces own the same literals (solid / value), and the border arm has no
 *  "original" today. Exported so the dimension's `value` readout and the
 *  replay guard agree with the apply path on what the map should show. */
const resolveStrokeMode = (
  mode: FillMode | undefined,
  ramp: FillValueConfig | undefined,
): FillMode => mode ?? (ramp !== undefined ? ("value" as const) : ("solid" as const));

/** Apply a value-based stroke to one layer.
 *
 *  Two-pass walk: collect `feature.properties[field]` values, then write
 *  per-leaf `color` via styleBag. Every style leaf is written on every
 *  apply: one the value ramp can classify gets the ramp's color, one it
 *  cannot gets the author's own color and `stroke` flag back.
 *
 *  Highlight pin: each written leaf gets a `pinStyleOnHighlight` getter
 *  that reads the live stroke config (via `liveRamp`) and the live active
 *  arm (via `liveMode`) and uses the cached breaks to re-derive the leaf's
 *  color on mouseout. If the value config changed since the cache was
 *  built, the getter returns null so folium's `resetStyle` is not
 *  overridden with a stale color — the next scheduler tick rebuilds it.
 */
const applyValueStroke = (
  ui: LayerUI,
  layerId: string,
  ramp: FillValueConfig,
  /** Resolve a stored config's field against the layer's current fields.
   *  The caller resolves the config it paints with, so the highlight pin must
   *  resolve the live record the same way before comparing: a stored field the
   *  data no longer offers would otherwise compare unequal to the resolved one
   *  and the mouseout replay would drop the value color. Identity by default —
   *  a caller with no field list has nothing to resolve. */
  resolveStored: (stored: FillValueConfig) => FillValueConfig = stored => stored,
  /** The config the highlight pin replays on mouseout: the live user intent,
   *  or the author's declared value stroke when the user has not chosen one.
   *  Without it a declared value stroke would be dropped by folium's
   *  `resetStyle` on the first hover, leaving the author's flat face under a
   *  by-value panel. */
  liveRamp: () => FillValueConfig | undefined,
  /** The live active arm the pin reads on mouseout — the caller owns the
   *  stored mode, so the pin asks for it rather than importing an intent key
   *  that does not exist yet. A mode that is not "value" returns null so a
   *  solid-mode leaf is never re-painted by a stale value pin. */
  liveMode: () => FillMode | undefined,
  /** The border width to carry through the value arm. Default `undefined`
   *  keeps the existing color-only behavior (the author's width stays in
   *  force); the border dimension passes its live width so a user-set
   *  border width survives the value-stroke write and the highlight pin. */
  weight?: number,
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

  // ── Pass 1: collect values ──
  // The collection is local to this call on purpose. A module-level scratch
  // would be shared with a re-entrant apply — a setStyle that triggers
  // another layer's value stroke would clear this walk's entries mid-pass and
  // the surviving leaves would be repainted with the author's color — and it
  // would keep every leaf of the last painted layer alive between applies.
  const values: number[] = [];
  const categories: string[] = [];
  const collected: CollectedLeaf[] = [];
  const category = ramp.kind === "category";
  const seenCategories = new Set<string>();
  // walkStyleLeaves (NOT walkFillLeaves): the stroke predicate is setStyle
  // presence, which admits line leaves too. The design's single value-stroke
  // dimension covers both the line stroke and the area stroke with one walk.
  walkStyleLeaves(layer, leaf => {
    const read = leafPropertyValue(leaf, ramp.field);
    if (category) {
      const text = categoryLabel(read);
      // buildCategoryRamp maps DISTINCT labels to colors in first-seen
      // order, so a repeated label must not re-index the palette: only the
      // first sighting seeds the domain, later ones reuse the same color.
      if (text !== undefined && !seenCategories.has(text)) {
        seenCategories.add(text);
        categories.push(text);
      }
      collected.push({ leaf, value: undefined, category: text });
    } else {
      const value = isFiniteNumber(read) ? read : undefined;
      if (value !== undefined) values.push(value);
      collected.push({ leaf, value, category: undefined });
    }
  });

  // ── Build the ramp once, before the write pass ──
  // A build failure must not escape the replay walk that runs while the
  // control attaches: one bad record in storage would leave the whole panel
  // unmounted. A layer whose ramp cannot be built gets the author's stroke
  // face back — the same answer an all-invalid field gives.
  //
  // Every build failure lands here and every one is reported — a classifier
  // dependency that failed to load (blocked CDN, or an environment without
  // the global: the script itself is a declared LayerControl asset), a
  // method or palette name this client does not implement (only reachable by
  // bypassing the record validator), and anything unexpected. Reporting
  // matters because the alternative is the map silently keeping its author
  // color while the panel still claims the chosen method.
  let built: ReturnType<typeof buildRamp> | null = null;
  let categoryScale: ReturnType<typeof buildCategoryRamp> | null = null;
  try {
    if (category) {
      categoryScale = buildCategoryRamp(categories, ramp.scheme);
    } else {
      built = buildRamp(values, ramp);
    }
  } catch (err) {
    log.warn("value-based stroke:", err);
  }

  // `buildRamp` / `buildCategoryRamp` return no colors when the sample
  // cannot be split at all — an empty ramp, or breaks with no span — which
  // is the honest "nothing to classify" answer. Read once, so the write
  // pass and the pins share one answer instead of each re-testing it.
  const scale: ReturnType<typeof buildRamp> | null =
    built !== null && built.colors.length > 0 ? built : null;
  const catScale: ReturnType<typeof buildCategoryRamp> | null =
    categoryScale !== null && categoryScale.colors.size > 0 ? categoryScale : null;

  // ── Pass 2: write per-leaf + pin ──
  // Iterating the collection instead of re-walking the tree: the two passes
  // then share one leaf order and no shared state.
  for (const { leaf, value, category: leafCategory } of collected) {
    const write: Record<string, unknown> = {};
    const paint = category
      ? catScale !== null && leafCategory !== undefined
        ? (catScale.colors.get(leafCategory) ?? catScale.other)
        : undefined
      : scale !== null && value !== undefined
        ? colorFor(scale, value)
        : undefined;
    if (paint !== undefined) {
      // The value ramp owns this leaf's color, so `stroke` is lit and the
      // author's color is replaced. The payload stays minimal: a named color
      // replaces whatever the previous arm left in that slot. The width and
      // the `stroke` flag ride `commitStyleDim`'s own payload (it always
      // lights the face bit), so an author's `stroke: false` does not
      // swallow the write — the styleBag write contract.
      write.color = paint;
      if (weight !== undefined) write.weight = weight;
      commitStyleDim(leaf, write, FACE.STROKE);
    } else {
      // Outside the value ramp's reach: the author's color, width and
      // `stroke` flag ride the merge untouched.
      commitStyleDimMerged(leaf, write, FACE.STROKE, false);
    }

    pinStyleOnHighlight(leaf, DIM.BORDER, () => {
      const stored = liveRamp();
      if (!stored) return null;
      // Resolve the live record exactly as the paint did, so a field that
      // moved in the data is re-pointed the same way before comparing.
      const currentRamp = resolveStored(stored);
      // The arm changed since the cache was built: the solid commit owns the
      // leaf now, and this getter must not replay a color the active mode
      // does not own (a mode switch back to solid that leaves the value config
      // stored would otherwise re-apply the value stroke on every mouseout).
      if (resolveStrokeMode(liveMode(), currentRamp) !== "value") {
        return null;
      }
      // Config changed since the cache was built — return null so the
      // author's face stays in force until the next scheduler tick.
      if (!sameValueConfig(currentRamp, ramp)) return null;
      const curVal = leafPropertyValue(leaf, ramp.field);
      if (category && catScale !== null) {
        const label = categoryLabel(curVal);
        if (label !== undefined) {
          const color = catScale.colors.get(label) ?? catScale.other;
          return styleDimPayload(
            weight !== undefined ? { color, weight } : { color },
            FACE.STROKE,
          );
        }
      }
      if (!category && scale !== null && isFiniteNumber(curVal)) {
        // stroke:true rides the replay too — folium's resetStyle would
        // otherwise re-apply the author's stroke:false on mouseout and hide
        // the stroke.
        return styleDimPayload(
          weight !== undefined
            ? { color: colorFor(scale, curVal), weight }
            : { color: colorFor(scale, curVal) },
          FACE.STROKE,
        );
      }
      // Out of the value ramp's reach: folium's restore already gave the
      // author's color and `stroke` flag back, so there is nothing worth
      // re-applying on top of it.
      return null;
    });
  }
};

export { applyValueStroke, resolveStrokeMode };

// ui/style/valuePaint.ts — the face-independent by-value style mode shared by every LayerControl style dimension that paints a leaf by a feature value.
/**
 * The by-value style mode — the face-independent skeleton shared by every
 * LayerControl style dimension that paints a leaf by a feature value.
 *
 * This is the LayerControl style subsystem's shared mechanism, NOT a
 * fill-specific implementation. The face-specific surface — which style slot
 * the ramp color lands in (`colorKey`), which leaf walker reaches the carrier
 * leaves (`walkLeaves`), the user's scalar flatScalar for this face (`flatScalar`, or
 * null for a face without one), the highlight dimension (`dim`), the write
 * face (`face`), and the two face-level live readers (`isValueActive`,
 * `readValueConfig`) — is injected as a `ValueFaceDecl`. The mode body
 * contains no FILL/STROKE literal and no face branch: a new dimension
 * declares its own `ValueFaceDecl` and calls `paintByValue`.
 * Sibling faces (borderValue / size / icon) reuse it directly.
 *
 * If a NON-LayerControl component ever needs to paint by value, that is a
 * separate "promote this mechanism to a shared layer" refactor card — do not
 * hard-code a cross-component path here.
 *
 * Walk shape: two-pass per apply (collect → apply). The styleBag scheduler
 * (`scheduleStyleDimApply`) coalesces the whole apply to at most one per
 * frame, so a scheme drag does not trigger a walk per input step.
 *
 * The user's flat-mode scalar flatScalar (e.g. solid-mode `fillOpacity`, or the
 * stroke's `weight`) rides along on every leaf of this face, including ones
 * the value ramp cannot classify: the ramp replaces only the color, so
 * dropping the flatScalar here would make a mode switch back to the flat mode
 * silently lose it, and a valueless leaf would keep the author's flatScalar next
 * to the user's on a classifiable neighbour of the same layer. When a face
 * has no user flatScalar (`flatScalar` is null) nothing rides along.
 *
 * Highlight pin: each written leaf gets a `pinStyleOnHighlight` getter that
 * reads the live value config and the cached breaks. If the config changed
 * since the cache was built (field / method / classes / scheme differ), the
 * getter returns null so the author's face stays in force — the next
 * scheduler tick rebuilds the cache.
 */
import type { LayerUI } from "../surface.js";
import { pinStyleOnHighlight } from "./pin.js";
import {
  type StyleCarrier,
  type StyleFace,
  type StyleSetter,
  commitStyleDim,
  commitStyleDimMerged,
  styleDimOverAuthor,
  styleDimPayload,
} from "./styleBag.js";
import type { ValueConfig } from "#core/layer/index.js";
import { HINT_DURATION } from "#core/overlay/index.js";
import {
  VALUE_KIND,
  buildCategoryRamp,
  buildRamp,
  categoryLabel,
  colorFor,
  isCategoryKind,
  isFiniteNumber,
  leafPropertyValue,
  withDependencyFallback,
} from "#core/value/index.js";
import { createLogger } from "#platform/log.js";

const log = createLogger("foliplus");

/** One collected leaf: the node plus its finite drive value, if any. */
type CollectedLeaf = {
  leaf: StyleSetter;
  /** The numeric drive value, when the mode is numeric. */
  value: number | undefined;
  /** The categorical drive label, when the mode is category. */
  category: string | undefined;
};

/** Whether two value configs differ in a way that invalidates a cached
 *  breaks/scale pair. Every field counts: `field` because the collected
 *  values come from it, so a field change is a full rebuild, not a repaint;
 *  `kind` because another typing would build its breaks differently, so a
 *  same-named config for a different kind must not repaint off a numeric
 *  cache. An explicit "numeric" is read as the same typing as absence — the
 *  persistence reader strips it, so the two spellings are one config. */
const sameValueConfig = (a: ValueConfig, b: ValueConfig): boolean =>
  (a.kind ?? VALUE_KIND.NUMERIC) === (b.kind ?? VALUE_KIND.NUMERIC) &&
  a.field === b.field &&
  a.method === b.method &&
  a.classes === b.classes &&
  a.scheme === b.scheme;

/** The leaf walker: visits exactly the carrier leaves for the mode's face. */
type ValueLeafWalker = (node: StyleCarrier, fn: (leaf: StyleSetter) => void) => void;

/** The face's live scalar: the one style property this face owns that
 *  is not replaced by the ramp but must ride every leaf (the fill's
 *  `fillOpacity`, the stroke's `weight`) — the style slot it writes to plus
 *  the live reader. Paired rather than a bare slot so the mode never branches
 *  on "does this face have a flatScalar" — a face without one passes `null` and
 *  the mode simply skips it. */
type FlatScalar = {
  /** The style slot the flatScalar lands in (e.g. `fillOpacity`, `weight`). */
  key: string;
  /** The live reader for this face's flatScalar intent. */
  read: (ui: LayerUI, layerId: string) => number | undefined;
};

/** The face-specific surface of the by-value mode. One declaration per style
 *  dimension (fill / stroke / size / icon); the mode body consumes only these
 *  and carries no face literal or branch. */
type ValueFaceDecl = {
  /** The dimension the highlight pin registers on (DIM.FILL, DIM.STROKE...). */
  dim: string;
  /** The write face (FACE.FILL, FACE.STROKE). */
  face: StyleFace;
  /** The style slot the ramp color lands in (`fillColor`, `color`...). */
  colorKey: string;
  /** The user's scalar flatScalar for this face, or null when the face has none. */
  flatScalar: FlatScalar | null;
  /** The leaf walker reaching only the carrier leaves for this face. */
  walkLeaves: ValueLeafWalker;
  /** Whether the value mode is active for a layer (the face's mode check). */
  isValueActive: (ui: LayerUI, layerId: string, value: ValueConfig) => boolean;
  /** The live value config for this face (the pin's default live reader). */
  readValueConfig: (ui: LayerUI, layerId: string) => ValueConfig | undefined;
  /** The diagnostic label for a ramp build failure (the face's prose). */
  logLabel: string;
};

// Module-level WeakMap keyed by the map instance: the classify-degradation
// hint is shown at most once per layer per page. Every apply re-runs the
// value walk, so without dedup a page missing simple-statistics would re-pop
// the hint on every re-render of a jenks/quantile layer. Keying by the map
// (not a module-level Set keyed by layerId) keeps controls and tests isolated:
// a fresh map starts with no degraded layers, and a second control on the
// same map still shares the per-layer dedup.
const degradedHintedLayers = new WeakMap<object, Set<string>>();

/** Forget one layer's degradation decision when the layer leaves the page.
 *
 *  The Set is bounded by the map key, but the ids inside it are not: a layer
 *  removed mid-session would otherwise keep its id here for the life of the
 *  page. That is worse than the retained bytes — the id a page reuses for a
 *  fresh layer reads as "already hinted", so the new layer degrades silently
 *  on a page that has since loaded the dependency. The id-keyed drops in the
 *  teardown subscription run it; the map key releases the Set with the map. */
const forgetDegradedHint = (map: object, layerId: string): void => {
  degradedHintedLayers.get(map)?.delete(layerId);
};

/** Apply a value-based style to one layer through the shared mode.
 *
 *  Two-pass walk: collect `feature.properties[field]` values, then write
 *  per-leaf color via styleBag. Every carrier leaf is written on every apply:
 *  one the value ramp can classify gets the ramp's color, one it cannot gets the
 *  author's own color and visibility bit back, and both get the user's flatScalar.
 *
 *  Highlight pin: each written leaf gets a `pinStyleOnHighlight` getter that
 *  reads the live value intent and uses the cached breaks to re-derive the
 *  leaf's color on mouseout. If the value config changed since the cache was
 *  built, the getter returns null so the author's face stays in force — the
 *  next scheduler tick rebuilds the cache.
 *
 *  The face-specific surface is the `decl`; the two optional readers default
 *  to the decl's own readers so a caller can drive the mode with a decl alone. */
const paintByValue = (
  ui: LayerUI,
  layerId: string,
  value: ValueConfig,
  decl: ValueFaceDecl,
  /** Resolve a stored config's field against the layer's current fields. The
   *  caller resolves the config it paints with, so the highlight pin must
   *  resolve the live record the same way before comparing. Identity by
   *  default — a caller with no field list has nothing to resolve. */
  resolveStored: (stored: ValueConfig) => ValueConfig = stored => stored,
  /** The config the highlight pin replays on mouseout: the live user intent,
   *  or the author's declared value fill when the user has not chosen one. */
  liveValue: () => ValueConfig | undefined = () => decl.readValueConfig(ui, layerId),
): void => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  // Snapshot-then-resolve: the registry's own `layer` reference is fast and
  // stable once populated, so it wins; the controller's `findLayer`
  // re-resolves against the live map for a folium layer whose registry
  // reference is still null — the same late-binding defense as the original
  // mode, without which a just-attached control would paint nothing.
  const layer = (layerInfo?.layer ?? ui.c.findLayer(layerId)) as StyleCarrier | null;
  if (!layer) return;

  // Live reader: the pin replays whatever the user has since chosen, not the
  // value frozen at build time.
  const readflatScalar = (): number | undefined =>
    decl.flatScalar !== null ? decl.flatScalar.read(ui, layerId) : undefined;

  // ── Pass 1: collect values ──
  // The collection is local to this call on purpose. A module-level scratch
  // would be shared with a re-entrant apply - a setStyle that triggers
  // another layer's value fill would clear this walk's entries mid-pass and the
  // surviving leaves would be repainted with the author's color - and it
  // would keep every leaf of the last painted layer alive between applies.
  const values: number[] = [];
  const categories: string[] = [];
  const collected: CollectedLeaf[] = [];
  const category = isCategoryKind(value.kind);
  const seenCategories = new Set<string>();
  decl.walkLeaves(layer, leaf => {
    const read = leafPropertyValue(leaf, value.field);
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
      const leafValue = isFiniteNumber(read) ? read : undefined;
      if (leafValue !== undefined) values.push(leafValue);
      collected.push({ leaf, value: leafValue, category: undefined });
    }
  });

  // ── Build the ramp once, before the write pass ──
  // A build failure must not escape the replay walk that runs while the
  // control attaches: one bad record in storage would leave the whole panel
  // unmounted. A layer whose ramp cannot be built gets the author's face
  // back — the same answer an all-invalid field gives.
  let built: ReturnType<typeof buildRamp> | null = null;
  let categoryScale: ReturnType<typeof buildCategoryRamp> | null = null;
  try {
    if (category) {
      categoryScale = buildCategoryRamp(categories, value.scheme);
    } else {
      // A jenks/quantile method reads the simple-statistics CDN global. When
      // that dependency is missing the classifier throws ClassifierDependencyError;
      // degrade to the equal method (which needs none) and say so to the user,
      // instead of silently leaving the layer uncolored. The same strategy the
      // HeatmapControl value path uses, via the shared withDependencyFallback.
      built = withDependencyFallback(
        value.method,
        m => buildRamp(values, { ...value, method: m }),
        err => {
          log.warn(decl.logLabel, err);
          // Dedup by layer: the degradation is reported once per layer per
          // page, so a re-render of the same layer must not re-pop the hint.
          const hinted = degradedHintedLayers.get(ui.c.map) ?? new Set<string>();
          if (!hinted.has(layerId)) {
            hinted.add(layerId);
            degradedHintedLayers.set(ui.c.map, hinted);
            ui.c.map.foliplus!.showHint(
              ui.config.name,
              ui.T("style_value_classify_degraded"),
              HINT_DURATION.LONG,
            );
          }
        },
      );
    }
  } catch (err) {
    log.warn(decl.logLabel, err);
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
  for (const { leaf, value: leafValue, category: leafCategory } of collected) {
    const flatScalar = readflatScalar();
    const write: Record<string, unknown> = {};
    if (flatScalar !== undefined && decl.flatScalar !== null) {
      write[decl.flatScalar.key] = flatScalar;
    }
    const paint = category
      ? catScale !== null && leafCategory !== undefined
        ? catScale.colors.get(leafCategory)
        : undefined
      : scale !== null && leafValue !== undefined
        ? colorFor(scale, leafValue)
        : undefined;
    if (paint !== undefined) {
      // The value ramp owns this leaf's color, so the face's visibility bit
      // is lit and the author's color is replaced. The payload stays minimal:
      // a named color replaces whatever the previous mode left in that slot,
      // and the flatScalar is named only when the user chose one, so the
      // author's stays in force.
      write[decl.colorKey] = paint;
      commitStyleDim(leaf, write, decl.face);
    } else {
      // Outside the value ramp's reach: the author's color and visibility
      // bit ride the merge untouched, but the user's flatScalar still does.
      commitStyleDimMerged(leaf, write, decl.face, false);
    }

    pinStyleOnHighlight(leaf, decl.dim, () => {
      const stored = liveValue();
      if (!stored) return null;
      // Resolve the live record exactly as the paint did, or a stale field
      // name compares unequal to the resolved config and the replay drops the
      // value color on the first mouseout.
      const currentValue = resolveStored(stored);
      // The mode changed since the cache was built: the flat commit owns the
      // leaf now, and this getter must not replay a color the active mode
      // does not own (a mode switch back to flat that leaves the value config
      // stored would otherwise re-apply the value fill on every mouseout).
      if (!decl.isValueActive(ui, layerId, currentValue)) return null;
      // Config changed since the cache was built — return null so the
      // author's face stays in force until the next scheduler tick.
      if (!sameValueConfig(currentValue, value)) return null;
      const replayScalar = readflatScalar();
      const curVal = leafPropertyValue(leaf, value.field);
      if (category && catScale !== null) {
        const label = categoryLabel(curVal);
        if (label !== undefined) {
          const color = catScale.colors.get(label) ?? catScale.other;
          return styleDimPayload(
            {
              [decl.colorKey]: color,
              ...(decl.flatScalar ? { [decl.flatScalar.key]: replayScalar } : {}),
            },
            decl.face,
          );
        }
      }
      if (!category && scale !== null && isFiniteNumber(curVal)) {
        // The face's visibility bit rides the replay too — folium's
        // resetStyle would otherwise re-apply the author's hollow flag on
        // mouseout and hide the fill. The flatScalar replays alongside it so the
        // hover restore does not drop the user's scalar.
        return styleDimPayload(
          {
            [decl.colorKey]: colorFor(scale, curVal),
            ...(decl.flatScalar ? { [decl.flatScalar.key]: replayScalar } : {}),
          },
          decl.face,
        );
      }
      // Out of the value ramp's reach: folium's restore already gave the author's
      // color and visibility bit back, so the only thing worth re-applying on
      // top of it is the user's flatScalar. With none chosen there is nothing
      // to add, and null lets the restore stand instead of rewriting it.
      if (decl.flatScalar === null) return null;
      if (replayScalar === undefined) return null;
      return styleDimOverAuthor(
        leaf,
        { [decl.flatScalar.key]: replayScalar },
        decl.face,
        false,
      );
    });
  }
};

export { forgetDegradedHint, paintByValue };
export type { ValueFaceDecl };

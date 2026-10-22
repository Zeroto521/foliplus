// core/ramp — the shared value → colour ramp: ordered class breaks, the
// scheme's per-class colours, and the value → class bisection.
//
// Consumed today by LayerControl's value-based fill (ui/style/fillRamp.ts),
// which owns the layer walk, the styleBag commit, and the highlight pin.
// By-value icon and by-value size reuse the same three pieces, so they live
// here rather than inside the fill dimension — the classifier (classify.ts)
// and the palette (palette.ts) are already shared, the bisect was the last
// piece of the ramp that was not.
//
// breaks.length - 1 is the class count: computeBreaks returns one boundary
// per class plus the final bound, so colors is requested for the span, not
// for the raw classes config (a 6-class quantile is 7 breaks, 6 colours).
import { computeBreaks } from "#core/classify.js";
import { SCHEME_FALLBACK_COLOR, getColorScale } from "#core/palette.js";

/** The three inputs a ramp is built from — the persisted FillRampConfig's
 *  values minus field, which selects the property key and is the caller's
 *  business, not the classifier's. */
type RampConfig = {
  method: string;
  classes: number;
  scheme: string;
};

/** A built ramp: ordered breaks, per-class colours, and the value → class
 *  index bisection. classOf always returns a non-negative index. */
type ValueRamp = {
  breaks: number[];
  colors: string[];
  classOf: (value: number) => number;
};

/** Build the ramp for a set of values under a method/classes/scheme config.
 *
 *  Empty input yields an empty ramp (breaks and colors both empty, classOf
 *  → 0) rather than throwing — the caller checks colors.length before
 *  painting, and an empty array is the honest "nothing to classify" answer.
 *  classes is capped at the value count: asking for 9 classes over 2
 *  features is a request the classifier cannot honor, and capping here keeps
 *  every consumer consistent.
 *
 *  classOf bisects the non-decreasing breaks the way the heatmap's
 *  valueToClassIdx does (first break at or above the value wins the class)
 *  and clamps to the last class for values beyond the final boundary — the
 *  two ends are the only places a value can fall outside. */
const buildRamp = (values: number[], config: RampConfig): ValueRamp => {
  // Empty input short-circuits before the palette call: chroma answers a
  // zero-colour request with the scheme's two endpoints, so an empty ramp
  // would come back carrying real colours and colorFor would paint one of
  // them instead of the fallback grey. The contract holds only if the array
  // is actually empty.
  if (values.length === 0) {
    return { breaks: [], colors: [], classOf: () => 0 };
  }
  const nClasses = Math.min(config.classes, values.length);
  const breaks = computeBreaks(values, nClasses, config.method);
  const colors = getColorScale(config.scheme, Math.max(0, breaks.length - 1));
  const classOf = (value: number): number => {
    if (breaks.length < 2) return 0;
    for (let i = 1; i < breaks.length; i++) {
      if (value <= breaks[i]) return i - 1;
    }
    return breaks.length - 2;
  };
  return { breaks, colors, classOf };
};

/** The colour for one value under a built ramp, carrying the two fallbacks
 *  a consumer would otherwise each re-derive: chroma (and its jsdom stub)
 *  may return fewer colours than requested, so an out-of-bounds class index
 *  takes the last available colour; an empty ramp degrades to the product's
 *  shared fallback grey, the same value an unreadable heatmap border uses. */
const colorFor = (ramp: ValueRamp, value: number): string =>
  ramp.colors[ramp.classOf(value)] ??
  ramp.colors[ramp.colors.length - 1] ??
  SCHEME_FALLBACK_COLOR;

export { buildRamp, colorFor };

// core/layer/visibility - the single-source "is it visible now" aggregation.
//
// resolveVisibility ANDs the four independent visibility factors and names the
// FIRST false one. It is pure over an input record: the caller (LayerAPI
// visibilityOf, or a control that reads its own sources) gathers each factor
// from its single source and delegates the composition here. Keeping it pure
// and DOM-free lets Heatmap/Measure - which do not all go through LayerAPI -
// reuse the same composition without a second copy of the AND + reason logic.

/** Why a layer is not visible right now. The fixed evaluation order below is
 *  part of the contract: a caller can branch on the reason knowing it names the
 *  first failing factor, not an arbitrary one. */
type VisibilityReason =
  "unregistered" | "declared" | "container" | "filter" | "ancestor";

/** The four independent visibility factors, gathered by the caller.
 *
 *  - declared: the intent fact (user choice, else the author's declared
 *    default). This is the panel checkbox's fact, NOT the map membership.
 *  - container: the effective container face - on the map and not carrying the
 *    HIDDEN class. This is the rendered truth for canvas-only surfaces.
 *  - filter: not hidden by the layer's current feature filter (feature-level).
 *  - ancestor: every ancestor group in the chain is expanded and visible.
 */
type VisibilityFactors = {
  declared: boolean;
  container: boolean;
  filter: boolean;
  ancestor: boolean;
};

/** The single-source visibility answer. visible is true only when all four
 *  factors hold; reason names the first false one (or null when visible). */
type VisibilityQuery = {
  visible: boolean;
  factors: VisibilityFactors;
  reason: VisibilityReason | null;
};

/** The fixed evaluation order for the reason. Declared first because it is the
 *  user's own choice (the most actionable), then container, then filter, then
 *  ancestor (the most indirect). */
const REASON_ORDER: ReadonlyArray<keyof VisibilityFactors> = [
  "declared",
  "container",
  "filter",
  "ancestor",
];

/** AND the four factors; name the first false one. Pure - no DOM, no map. */
const resolveVisibility = (factors: VisibilityFactors): VisibilityQuery => {
  let reason: VisibilityReason | null = null;
  for (const key of REASON_ORDER) {
    if (!factors[key]) {
      reason = key;
      break;
    }
  }
  return { visible: reason === null, factors, reason };
};

/** How a layer's current intent has drifted from the author's declaration.
 *  Each member is a dimension where the user's stored intent differs from what
 *  the author declared (an empty list = exactly as declared). */
type VisibilityDrift = "visible" | "opacity" | "filter";

/** @internal - LayerControl-private composition; not part of the public LayerAPI. */
export { resolveVisibility };
export type { VisibilityDrift, VisibilityFactors, VisibilityQuery, VisibilityReason };

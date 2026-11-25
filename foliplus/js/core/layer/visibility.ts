// core/layer/visibility - the single-source "is it visible now" aggregation.
//
// resolveVisibility ANDs the six independent visibility factors and names the
// FIRST false one. It is pure over an input record: the caller (LayerAPI
// visibilityOf, or a control that reads its own sources) gathers each factor
// from its single source and delegates the composition here. Keeping it pure
// and DOM-free lets Heatmap/Measure - which do not all go through LayerAPI -
// reuse the same composition without a second copy of the AND + reason logic.
//
// Three named projections answer the three questions the panel actually asks,
// each a subset of the same six factors:
//
//   intentProjection  = declared                       (the checkbox)
//   paintProjection   = declared*container*zoom*opacity (the basemap hatch)
//   labelProjection   = container*focus                (label rendering)
//
// A projection never re-derives its factors: it reads the SAME record the
// caller assembled for resolveVisibility, so the three answers cannot drift.

/** Why a layer is not visible right now. The fixed evaluation order below is
 *  part of the contract: a caller can branch on the reason knowing it names the
 *  first failing factor, not an arbitrary one. */
type VisibilityReason =
  "declared" | "container" | "zoom" | "opacity" | "filter" | "ancestor";

/** The six independent visibility factors, gathered by the caller.
 *
 *  - declared: the intent fact (user choice, else the author's declared
 *    default). This is the panel checkbox's fact, NOT the map membership.
 *  - container: the effective container face - on the map and not carrying the
 *    HIDDEN class. This is the rendered truth for canvas-only surfaces.
 *  - zoom: inside the layer's own minZoom/maxZoom (a tile-layer gate; vector
 *    layers render at any zoom and pass this by construction).
 *  - opacity: the resolved opacity is > 0 (a fully transparent layer paints
 *    nothing even though it is on the map).
 *  - filter: not hidden by the layer's current feature filter (feature-level).
 *  - ancestor: every ancestor group in the chain is expanded and visible.
 */
type VisibilityFactors = {
  declared: boolean;
  container: boolean;
  zoom: boolean;
  opacity: boolean;
  filter: boolean;
  ancestor: boolean;
};

/** The single-source visibility answer. visible is true only when all six
 *  factors hold; reason names the first false one (or null when visible). */
type VisibilityQuery = {
  visible: boolean;
  factors: VisibilityFactors;
  reason: VisibilityReason | null;
};

/** The fixed evaluation order for the reason. Declared first because it is the
 *  user's own choice (the most actionable), then container, then zoom, then
 *  opacity, then filter, then ancestor (the most indirect). */
const REASON_ORDER: ReadonlyArray<keyof VisibilityFactors> = [
  "declared",
  "container",
  "zoom",
  "opacity",
  "filter",
  "ancestor",
];

/** AND the six factors; name the first false one. Pure - no DOM, no map. */
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

/** The panel checkbox's answer: the intent fact alone. */
const intentProjection = (f: VisibilityFactors): boolean => f.declared;

/** The basemap-hatch answer: on the map, in range, and not fully transparent.
 *  Declared is deliberately excluded - a basemap can be "checked" yet absent
 *  from the screen (outside its zoom range, off the map, opacity 0), and the
 *  hatch judges the paint observation, not the intent flag. */
const paintProjection = (f: VisibilityFactors): boolean =>
  f.container && f.zoom && f.opacity;

/** The label-rendering answer: on the map and (while a focus is active) the
 *  spotlighted layer. Vector canvas has no zoom gate, so zoom is excluded. */
const labelProjection = (f: VisibilityFactors, focused: boolean): boolean =>
  f.container && focused;

/** How a layer's current intent has drifted from the author's declaration.
 *  Each member is a dimension where the user's stored intent differs from what
 *  the author declared (an empty list = exactly as declared). */
type VisibilityDrift = "visible" | "opacity" | "filter";

/** @internal - LayerControl-private composition; not part of the public LayerAPI. */
export { intentProjection, labelProjection, paintProjection, resolveVisibility };
export type { VisibilityDrift, VisibilityFactors, VisibilityQuery, VisibilityReason };

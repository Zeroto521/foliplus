// core/carrierTargets — where a layer's writes and its export land.
//
// One layer resolves to one carrier: a canvas face it owns, a pane set its
// surface owns, or the layer's own Leaflet options. Two pipelines ask that
// question — LayerControl's projection executor writes through it, and
// ExportControl's renderer reads pixels through it — and they used to answer
// it separately: the executor built its own identity token, the exporter
// filtered the pane list and composed the annotation pane name by hand. Two
// answers to one question drift silently: the writer styles one pane set while
// the export walks another, and only the exported pixels show it. This module
// is the single answer both sides ask for.
//
// Nothing here reads or writes DOM state or Leaflet options. The inputs are
// reads of the declaration (`LayerInfo`) and of the surface's own pane
// bookkeeping, so either caller can ask on its own schedule.
import { ANNOTATION_PANE_PREFIX, CAP_TIER } from "./layer/const.js";

/** A layer's carrier, as a writer or an exporter describes it.
 *
 *  Deliberately independent of the layer's role (`base` / `overlay`): where a
 *  layer's paint lives does not change when the role vocabulary is renamed, so
 *  this shape must not grow a role field. */
interface CarrierDecl {
  /** The canvas face of a self-drawn surface (heatmap / measure / solid color).
   *  When present it is the carrier on its own — there is nothing else to ask. */
  canvas?: HTMLCanvasElement | null;
  /** The layer whose own `options` object is the write target when the
   *  surface owns no opaque pane (GridLayer / ImageOverlay native setters). */
  layer?: L.Layer | null;
  /** Panes this surface owns, base first. Empty when it owns none. */
  panes: readonly string[];
  /** The surface's honest opacity tier: `"pane"` means a CSS write on
   *  `panes` reaches the layer's whole visible DOM. */
  opacityTier: (typeof CAP_TIER)[keyof typeof CAP_TIER];
}

/** Stable identity of the carrier a write lands on.
 *
 *  A numeric diff is not enough for carriers that can be replaced underneath
 *  the writer: a re-registered canvas starts opaque, so the previous value can
 *  match the next one while the element in front of the writer is fresh.
 *  Comparing this token says "the thing I wrote to before is not the thing in
 *  front of me now" and forces a rewrite.
 *
 *  A stable key, never an array: callers compare with `===`, so a freshly built
 *  array would never match and every pane layer would rewrite on every pass.
 *  Pane names are sorted so the order the specs happen to arrive in cannot
 *  register as "the carrier moved". */
const carrierToken = (decl: CarrierDecl): unknown => {
  if (decl.canvas) return decl.canvas;
  if (decl.opacityTier === CAP_TIER.PANE) {
    return [...decl.panes].sort().join("|");
  }
  return (decl.layer?.options ?? null) as object | null;
};

/** Panes a layer's content walk covers: the surface's own panes minus every
 *  pane an exporter's shadow channel owns.
 *
 *  Shadows are drawn from the owning leaves by that channel, so admitting their
 *  pane as content would paint the same pixels twice — once below the icon and
 *  once as a content root. The subtraction keeps the channel single-source. */
const contentPanesOf = (
  panes: readonly string[],
  shadowPanes: ReadonlySet<string>,
): string[] => panes.filter(name => !shadowPanes.has(name));

/** Name of the pane that carries a layer's annotation labels.
 *
 *  One name, both ends: the registration edge declares the
 *  `role: "annotation"` spec with it, and the exporter looks that pane up by
 *  it. Composing it here means the declaration and the renderer cannot drift
 *  apart by editing one side. */
const annotationPaneNameOf = (layerId: string): string =>
  `${ANNOTATION_PANE_PREFIX}${layerId}`;

export type { CarrierDecl };
export { annotationPaneNameOf, carrierToken, contentPanesOf };

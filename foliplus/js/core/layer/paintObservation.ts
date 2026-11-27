// core/layer/paintObservation — the one paint observation every consumer reads.
//
// Three questions used to be answered by three unsynchronised reads: what colour
// does this layer draw (`readLayerPaint`), is it painting on screen right now
// (`paintProjection` over a hand-assembled factor record), and who owns that
// paint (the style snapshot's provenance). They describe the same phenomenon at
// three depths, so a consumer that needed two of them re-derived one: the
// basemap attribution read the zoom gate and forgot opacity, the hatch read
// opacity and hard-coded the container, and no reader could say where a colour
// came from.
//
// This module is the composition point. It takes the facts its caller gathered,
// reads the paint value once, and attaches the style snapshot's provenance - it
// never re-derives a factor, a colour, or a source. The caller stays thin:
// `control/LayerControl/ui/paintAdapter` gathers the factors from the panel
// and the map, and every consumer reads the same observation.
//
// Provenance is read off `LayerStyleSnapshot.provenance` instead of being
// recomputed: the dimension registry's default `valueSource` is the one place
// that answers "who set this", so a second derivation here would be the exact
// drift this module exists to remove.
import { type LayerPaint, readLayerPaint } from "./paint.js";
import type { LayerStyleSnapshot, StyleProvenance } from "./type.js";
import { type VisibilityFactors, paintProjection } from "./visibility.js";

/** The channels a paint observation reports a source for: the two paint faces a
 *  layer can carry, the marker icon, and the whole-layer opacity. */
type PaintChannel = "fill" | "border" | "icon" | "opacity";

/** Everything one read answers about a layer's paint: the visibility facts that
 *  produced the verdict, the verdict itself, the effective values, and who owns
 *  each channel. `factors` is null when the caller could not gather them (no
 *  panel yet, an unregistered id) - then `paints` is false and no verdict is
 *  invented. */
interface PaintObservation {
  factors: VisibilityFactors | null;
  paints: boolean;
  paint: LayerPaint;
  style: LayerStyleSnapshot | null;
  source: Record<PaintChannel, StyleProvenance>;
}

const NO_SOURCE: Record<PaintChannel, StyleProvenance> = {
  fill: "none",
  border: "none",
  icon: "none",
  opacity: "none",
};

/** The resolved opacity of one layer, from the four inputs every read path has:
 *  a live focus, the user's intent, the author's declaration, and the author
 *  default on the registry record. Focus wins (the spotlight paints at full
 *  strength); then the user's stored value; then the author's declaration; then
 *  the registry default; then 1.
 *
 *  `declared` is a thunk so a call path pays for the declaration parse only when
 *  the user has not overridden the value - the same laziness the inline `??`
 *  chain had, now with one body instead of two. */
const resolvePaintOpacity = (input: {
  focused: boolean;
  intent: number | undefined;
  declared: () => number | undefined;
  authorDefault: number | undefined;
}): number => {
  if (input.focused) return 1;
  if (typeof input.intent === "number") return input.intent;
  return input.declared() ?? input.authorDefault ?? 1;
};

/** Compose one observation. Pure: it reads the layer tree (through
 *  `readLayerPaint`) and nothing else - no map, no DOM, no store. */
const observePaint = (input: {
  factors: VisibilityFactors | null;
  layer: unknown;
  style: LayerStyleSnapshot | null;
}): PaintObservation => {
  const { style } = input;
  return {
    factors: input.factors,
    paints: input.factors ? paintProjection(input.factors) : false,
    paint: readLayerPaint(input.layer),
    style,
    source: style
      ? {
          fill: style.provenance.fill ?? "none",
          border: style.provenance.border ?? "none",
          icon: style.provenance.icon ?? "none",
          opacity: style.provenance.opacity ?? "none",
        }
      : NO_SOURCE,
  };
};

export { observePaint, resolvePaintOpacity };
export type { PaintChannel, PaintObservation };

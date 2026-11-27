// control/LayerControl/ui/paintAdapter — the LayerControl read point for one
// layer's paint.
//
// The core composition (`core/layer/paintObservation`) is pure and reads no panel
// state; this module gathers that state from the one complete source the control
// already has - `visibilityOf`'s six visibility factors - and hands it to the
// composition together with the layer face and the style snapshot. Consumers (the
// focus pane, the basemap attribution, and the hatch when it can move) call
// `paintsNow` instead of assembling their own factor record, so "is this layer
// painting right now" has one answer inside the whole control.
//
// The gather is delegated, not re-implemented: `visibilityOf` is the only place
// that knows how container (HIDDEN face), zoom, opacity, filter and ancestor are
// read, and a second copy here is exactly the drift this file removes.
import type { LayerUI } from "./surface.js";
import {
  type LayerInfo,
  type PaintObservation,
  type VisibilityFactors,
  observePaint,
  paintProjection,
} from "#core/layer/index.js";

/** The six visibility factors of one layer, from `visibilityOf` - the only
 *  place that knows how each is read. Null when the control cannot answer (no
 *  panel yet, an unregistered id). */
const paintFactors = (ui: LayerUI, layerInfo: LayerInfo): VisibilityFactors | null => {
  const query =
    typeof ui.c.visibilityOf === "function" ? ui.c.visibilityOf(layerInfo.id) : null;
  return query?.factors ?? null;
};

/** One layer's paint as the panel and the map see it right now. */
const observeLayerPaint = (ui: LayerUI, layerInfo: LayerInfo): PaintObservation =>
  observePaint({
    factors: paintFactors(ui, layerInfo),
    layer: layerInfo.layer ?? ui.c.findLayer(layerInfo),
    style: ui.c.getStyle?.(layerInfo.id) ?? null,
  });

/** "Is this layer painting on screen right now?" - the one answer the basemap
 *  hatch, the attribution and the focus pane each used to derive on their own.
 *
 *  Deliberately verdict-only: it reads the factors and the composition, never
 *  the snapshot or the leaf values. A caller asking the yes/no question (the
 *  focus pane, a layer whose surface is gone) must not pay for - or fail on - a
 *  snapshot the control cannot build for that layer. */
const paintsNow = (ui: LayerUI, layerInfo: LayerInfo): boolean => {
  const factors = paintFactors(ui, layerInfo);
  return factors ? paintProjection(factors) : false;
};

export { observeLayerPaint, paintsNow };
export type { PaintObservation };

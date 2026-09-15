// LayerControl annotation layout — the decision side of a canvas label renderer.
//
// A canvas renderer cannot be unit-tested in jsdom, so everything that decides
// what to draw is pulled out of it: turn a feature's anchor and label text into
// a pixel box, cull to the viewport, and plan collisions. The renderer only
// executes the returned instructions — positioning the text, applying the halo —
// which leaves the whole decision side testable without a canvas.
//
// Boxes are *estimated*, not measured: measuring needs a canvas context. A label
// is one line of `text` in the shared label font, so its box is derived from the
// token sizes and the text length. Culling and collision only need a
// conservative footprint — a slightly wide box keeps a label, a slightly narrow
// one may hide it.
import { type Box, planVisible, withinRect } from "#core/labelCollision.js";

/** The label typography the renderer will apply; taken from the shared --label-*
 *  tokens by the renderer and handed in as plain numbers. */
interface LabelSpec {
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  /** Point leaves: the box's top edge sits this far below the marker. */
  pointOffsetY: number;
  /** Shape leaves: the box is centred on the anchor (offset 0). */
  shapeOffsetY: number;
}

/** One label the renderer is asked to place. */
interface LabelCandidate {
  /** Opaque to the planner; the caller keeps whatever identity it needs. */
  id: string;
  text: string;
  /** The feature's anchor in container pixels. */
  anchor: { x: number; y: number };
  /** Point vs shape: decides both the vertical offset and the centring. */
  atPoint: boolean;
  /** 0–100; the lowest values drop out first under collision. */
  priority: number;
}

/** A label with its screen box and how the renderer should centre its text. */
interface PlacedLabel extends LabelCandidate {
  box: Box;
}

/** Approximate width of one line of text in the label font. Only a footprint
 *  for culling and collision — the renderer draws from the box's geometry. */
const estimateTextWidth = (text: string, fontSize: number): number =>
  text.length * fontSize * 0.6;

/** The box a label will occupy in container pixels.
 *
 *  point leaves: horizontally centred on the marker, its top edge `pointOffsetY`
 *  below it — the [0, -10] relationship the DOM labels use.
 *  shape leaves: centred on the anchor in both axes.
 *  Both are centred horizontally: text extends from the anchor left and right. */
const layoutLabel = (label: LabelCandidate, spec: LabelSpec): PlacedLabel => {
  const w = estimateTextWidth(label.text, spec.fontSize);
  const h = spec.fontSize;
  const box: Box = label.atPoint
    ? { x: label.anchor.x - w / 2, y: label.anchor.y + spec.pointOffsetY, w, h }
    : { x: label.anchor.x - w / 2, y: label.anchor.y - h / 2, w, h };
  return { ...label, box };
};

/**
 * Which of the candidates to draw, and where — the full decision pipeline:
 * lay out → cull to the viewport → plan collisions. The caller then renders the
 * survivors and is responsible for supplying the *right* viewport: the live one
 * normally, never during an export (see core/labelCollision's withinRect).
 *
 * Results are returned in input order, so the caller can pair each surviving
 * label with its feature without bookkeeping.
 */
const planLabelLayout = (
  labels: readonly LabelCandidate[],
  spec: LabelSpec,
  viewport: Box,
  overlap?: number,
): PlacedLabel[] => {
  const placed = labels.map(label => layoutLabel(label, spec));
  const survivors = planVisible(withinRect(placed, viewport), overlap);
  return placed.filter(label => survivors.has(label));
};

export {
  layoutLabel,
  planLabelLayout,
  type LabelCandidate,
  type LabelSpec,
  type PlacedLabel,
};

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
  /** Halo stroke width (the shared --label-halo-width). The box must grow by
   *  it, or two labels whose text is clear of each other still have their black
   *  halos overlap into a smudge when the map is zoomed out. */
  haloWidth: number;
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

/** The box a label will occupy in container pixels, including its halo. The
 *  halo is the black stroke the canvas draws around the text, so it is part of
 *  the label's visual footprint — a box that stops at the glyphs would let two
 *  halos overlap into a dark smudge while both labels survive.
 *
 *  point leaves: horizontally centred on the marker, its top edge `pointOffsetY`
 *  below it — the [0, -10] relationship the DOM labels use.
 *  shape leaves: centred on the anchor in both axes.
 *  Both are centred horizontally: text extends from the anchor left and right. */
const layoutLabel = (label: LabelCandidate, spec: LabelSpec): PlacedLabel => {
  const w = estimateTextWidth(label.text, spec.fontSize) + 2 * spec.haloWidth;
  const h = spec.fontSize + 2 * spec.haloWidth;
  // The halo grows the box symmetrically around the *text centre*, so the
  // renderer can keep using the box centre as the text centre: the point
  // label's box top moves up by the halo it now extends below the text.
  const box: Box = label.atPoint
    ? {
        x: label.anchor.x - w / 2,
        y: label.anchor.y + spec.pointOffsetY - spec.haloWidth,
        w,
        h,
      }
    : { x: label.anchor.x - w / 2, y: label.anchor.y - h / 2, w, h };
  return { ...label, box };
};

/**
 * Which of the candidates to draw, and where — the full decision pipeline:
 * lay out → cull to the viewport → plan collisions. The caller then renders the
 * survivors and is responsible for supplying the *right* viewport: the live one
 * normally, never during an export (see core/labelCollision's withinRect).
 *
 * The default `overlap` is 0.5, not labelCollision's 0.75: the boxes already
 * include the halo, so "half the visual footprint covered" is already a heavy
 * collision — and it is the density that zooming out creates, where the old
 * bar was letting neighbouring labels keep their smudged overlap.
 *
 * Results are returned in input order, so the caller can pair each surviving
 * label with its feature without bookkeeping.
 */
const planLabelLayout = (
  labels: readonly LabelCandidate[],
  spec: LabelSpec,
  viewport: Box,
  overlap: number = 0.5,
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

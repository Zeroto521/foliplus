import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Collision from "#foliplus/MeasureControl/collision.js";

type Box = { x: number; y: number; w: number; h: number };

/** A real DOM chip so `style.visibility` behaves as it does in a browser. */
const makeChip = (): HTMLElement => {
  const el = document.createElement("div");
  el.className = "foliplus-measure-label";
  document.body.appendChild(el);
  return el;
};

/** Boxes are injected through this map so a test can move a chip between
 *  plans without touching the DOM. Unlisted chips fall back to the planner's
 *  minimum size. */
const boxes = new Map<HTMLElement, Box>();
const boxOf = (el: HTMLElement): Box => boxes.get(el) ?? { x: 0, y: 0, w: 64, h: 18 };

const projector: Collision.Projector = {
  box: el => boxOf(el),
};

const chipOf: Collision.ChipOf = marker =>
  (marker as unknown as { _el?: HTMLElement })._el ?? null;

const markerFor = (el: HTMLElement): L.Marker =>
  ({ _el: el, getElement: () => el }) as unknown as L.Marker;

/** A label with a fresh chip pinned to `box`. */
const label = (
  box: Box,
  priority: number,
): { lb: Collision.CollidableLabel; el: HTMLElement } => {
  const el = makeChip();
  boxes.set(el, box);
  return { el, lb: { marker: markerFor(el), priority } };
};

const plan = (labels: Collision.CollidableLabel[], collide = true): number =>
  Collision.placeLabels(labels, projector, collide, chipOf);

const ANCHOR: Box = { x: 0, y: 0, w: 60, h: 20 };
/** A second chip whose own box overlaps ANCHOR by most of its area. */
const OVERLAP: Box = { x: 10, y: 5, w: 60, h: 20 };
/** A chip that only barely grazes ANCHOR — light edge contact, not a real overlap. */
const GRAZE: Box = { x: 55, y: 0, w: 60, h: 20 };

beforeEach(() => {
  boxes.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("placeLabels", () => {
  it("keeps a label on its anchor and visible when nothing overlaps it", () => {
    const { lb, el } = label(ANCHOR, 60);
    const hidden = plan([lb]);
    expect(hidden).toBe(0);
    expect(el.style.visibility).toBe("");
  });

  it("hides the lower-priority chip when two labels overlap heavily", () => {
    const { lb: high, el: highEl } = label(ANCHOR, 80);
    const { lb: low, el: lowEl } = label(ANCHOR, 60); // same box, fully overlapping
    const hidden = plan([high, low]);
    expect(hidden).toBe(1);
    expect(highEl.style.visibility).toBe("");
    expect(lowEl.style.visibility).toBe("hidden");
  });

  it("does nothing when two labels only lightly graze each other", () => {
    const { lb: a, el: aEl } = label(ANCHOR, 60);
    const { lb: b, el: bEl } = label(GRAZE, 60); // only 5px of 1200px² overlap
    const hidden = plan([a, b]);
    expect(hidden).toBe(0);
    expect(aEl.style.visibility).toBe("");
    expect(bEl.style.visibility).toBe("");
  });

  it("uses the smaller chip's area as the threshold for the overlap fraction", () => {
    // A large chip and a tiny chip fully overlap (tiny is inside big). That
    // region is a tiny share of the large chip but 100% of the small one — so
    // the small chip must be the one judged, and hidden, not the large one.
    const bigBox: Box = { x: 0, y: 0, w: 200, h: 60 };
    const tinyBox: Box = { x: 40, y: 20, w: 40, h: 20 }; // fully inside big
    const { lb: big, el: bigEl } = label(bigBox, 60);
    const { lb: tiny, el: tinyEl } = label(tinyBox, 60);
    const hidden = plan([big, tiny]);
    expect(hidden).toBe(1);
    expect(bigEl.style.visibility).toBe("");
    expect(tinyEl.style.visibility).toBe("hidden");
  });

  it("breaks an equal-priority tie in favour of the wider chip", () => {
    const bigBox: Box = { x: 0, y: 0, w: 120, h: 20 };
    const smallBox: Box = { x: 50, y: 0, w: 40, h: 20 }; // fully overlapping, narrower
    const { lb: big, el: bigEl } = label(bigBox, 60);
    const { lb: small, el: smallEl } = label(smallBox, 60);
    const hidden = plan([big, small]);
    expect(hidden).toBe(1);
    expect(bigEl.style.visibility).toBe("");
    expect(smallEl.style.visibility).toBe("hidden");
  });

  it("lets priority dominate area: a large low-priority chip loses to a small high-priority one", () => {
    // Large chip fully contains the small one (100% overlap of the smaller).
    // Large chip has lower priority, so it must be hidden despite being wider.
    const bigBox: Box = { x: 0, y: 0, w: 100, h: 40 }; // area 4000, priority 60
    const smallBox: Box = { x: 20, y: 10, w: 60, h: 20 }; // area 1200, priority 90
    const { lb: big, el: bigEl } = label(bigBox, 60);
    const { lb: small, el: smallEl } = label(smallBox, 90);
    const hidden = plan([big, small]);
    expect(hidden).toBe(1);
    expect(bigEl.style.visibility).toBe("hidden");
    expect(smallEl.style.visibility).toBe("");
  });

  it("hides the lower-priority chip at exactly 50% overlap of the smaller box", () => {
    // bigBox (120×20, area 2400) and smallBox (60×20, area 1200) overlap for
    // 60×20 = 1200 px² — exactly 50% of smallBox's area. smallBox has lower
    // priority, so it must be hidden. This pins the >= 0.5 boundary: a
    // regression to > 0.5 would leave smallBox visible.
    const bigBox: Box = { x: 0, y: 0, w: 120, h: 20 }; // priority 80
    const smallBox: Box = { x: 60, y: 0, w: 60, h: 20 }; // area 1200, 1200px² inside big, priority 60
    const { lb: big, el: bigEl } = label(bigBox, 80);
    const { lb: small, el: smallEl } = label(smallBox, 60);
    const hidden = plan([big, small]);
    expect(hidden).toBe(1);
    expect(bigEl.style.visibility).toBe("");
    expect(smallEl.style.visibility).toBe("hidden");
  });

  it("leaves the chip visible just below the 50% overlap boundary", () => {
    // Two equal-area chips (60×20, area 1200 each) overlap for 29×20 = 580 px²
    // — 48.3% of the smaller box's area, just under the 0.5 threshold.
    // Neither should be hidden.
    const a: Box = { x: 0, y: 0, w: 60, h: 20 }; // priority 80
    const b: Box = { x: 31, y: 0, w: 60, h: 20 }; // area 1200, 580px² inside a, priority 60
    const { lb: la, el: aEl } = label(a, 80);
    const { lb: lb_, el: bEl } = label(b, 60);
    const hidden = plan([la, lb_]);
    expect(hidden).toBe(0);
    expect(aEl.style.visibility).toBe("");
    expect(bEl.style.visibility).toBe("");
  });

  it("recomputes boxes per plan from the projector", () => {
    const { lb, el } = label(ANCHOR, 60);
    plan([lb]);
    // A second plan that moves the chip clear reads the new box.
    boxes.set(el, { x: 300, y: 0, w: 60, h: 20 });
    const { lb: other, el: otherEl } = label(ANCHOR, 60);
    const hidden = plan([lb, other]);
    expect(hidden).toBe(0);
    expect(el.style.visibility).toBe("");
    expect(otherEl.style.visibility).toBe("");
  });

  it("shows every visible label and hides nothing when collision is off", () => {
    const { lb: high, el: highEl } = label(ANCHOR, 80);
    const { lb: low, el: lowEl } = label(ANCHOR, 60);
    // A prior plan that hid `low`.
    plan([high, low], true);
    expect(lowEl.style.visibility).toBe("hidden");

    const hidden = plan([high, low], false);
    expect(hidden).toBe(0);
    expect(highEl.style.visibility).toBe("");
    expect(lowEl.style.visibility).toBe("");
  });

  it("leaves already-hidden chips out of the competition and lets a later label show", () => {
    // `low` is hidden before the plan (simulating show_labels/destroy). It must
    // not claim space, so `late` — which would otherwise overlap the anchor —
    // stays visible on its anchor.
    const { lb: hiddenLabel, el: hiddenEl } = label(ANCHOR, 60);
    hiddenEl.style.visibility = "hidden";
    const { lb: late, el: lateEl } = label(ANCHOR, 50);
    const hidden = plan([hiddenLabel, late]);
    expect(hidden).toBe(0);
    expect(hiddenEl.style.visibility).toBe("hidden");
    expect(lateEl.style.visibility).toBe("");
  });

  it("re-hides a chip whose box now overlaps instead of leaving it permanently shown", () => {
    const { lb: a, el: aEl } = label(ANCHOR, 80);
    // `b` starts clear of the anchor, so it shows on the first plan.
    const { lb: b, el: bEl } = label(GRAZE, 60);
    plan([a, b]);
    expect(bEl.style.visibility).toBe("");

    // Move `b` onto the anchor; the next plan must re-hide it.
    boxes.set(bEl, ANCHOR);
    const hidden = plan([a, b]);
    expect(hidden).toBe(1);
    expect(aEl.style.visibility).toBe("");
    expect(bEl.style.visibility).toBe("hidden");
  });

  it("keeps a clear chip on its anchor even in the same run as a collision", () => {
    const { lb: a, el: aEl } = label(ANCHOR, 80);
    const { lb: b, el: bEl } = label(ANCHOR, 60);
    // Far away from both → untouched.
    const far: Box = { x: 300, y: 0, w: 60, h: 20 };
    const { lb: farLabel, el: farEl } = label(far, 70);
    const hidden = plan([a, b, farLabel]);
    expect(hidden).toBe(1);
    expect(bEl.style.visibility).toBe("hidden");
    expect(aEl.style.visibility).toBe("");
    expect(farEl.style.visibility).toBe("");
  });
});

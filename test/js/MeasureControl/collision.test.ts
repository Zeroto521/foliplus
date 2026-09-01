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
    const { lb: b, el: bEl } = label(GRAZE, 60); // only 5px of 60px horizontal overlap = 8.3%
    const hidden = plan([a, b]);
    expect(hidden).toBe(0);
    expect(aEl.style.visibility).toBe("");
    expect(bEl.style.visibility).toBe("");
  });

  it("skips labels whose chip is not on the map (chipOf returns null)", () => {
    // A marker that is not on the map (hidden layer, destroyed, etc.) has no
    // chip. The planner must silently skip it rather than throwing on the box
    // lookup — and must not count it as a collision participant.
    const { lb: visible } = label(ANCHOR, 60);
    const unrenderedMarker = {} as unknown as L.Marker; // no _el → chipOf → null
    const hidden = plan([visible, { marker: unrenderedMarker, priority: 90 }]);
    expect(hidden).toBe(0);
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

  it("breaks an equal-priority tie by width, and lets priority dominate width", () => {
    // Equal priority: the wider chip keeps its anchor, the narrower one hides.
    const bigBox: Box = { x: 0, y: 0, w: 120, h: 20 };
    const smallBox: Box = { x: 50, y: 0, w: 40, h: 20 };
    const { lb: big, el: bigEl } = label(bigBox, 60);
    const { lb: small, el: smallEl } = label(smallBox, 60);
    const hidden = plan([big, small]);
    expect(hidden).toBe(1);
    expect(bigEl.style.visibility).toBe("");
    expect(smallEl.style.visibility).toBe("hidden");

    // Priority trumps width: a small high-priority chip beats a large
    // low-priority one even when the large chip fully contains it.
    const largeBox: Box = { x: 0, y: 0, w: 100, h: 40 }; // area 4000, priority 60
    const tinyBox: Box = { x: 20, y: 10, w: 60, h: 20 }; // area 1200, priority 90
    const { lb: large, el: largeEl } = label(largeBox, 60);
    const { lb: tiny, el: tinyEl } = label(tinyBox, 90);
    const hidden2 = plan([large, tiny]);
    expect(hidden2).toBe(1);
    expect(largeEl.style.visibility).toBe("hidden");
    expect(tinyEl.style.visibility).toBe("");
  });

  it("hides the lower-priority chip at exactly 75% overlap of the smaller box", () => {
    // bigBox (120×20) and smallBox (60×20) overlap for 45×20 = 900 px² —
    // exactly 75% of smallBox's width. smallBox has lower priority, so it
    // must be hidden. This pins the >= 0.75 boundary: a regression to
    // > 0.75 would leave smallBox visible.
    const bigBox: Box = { x: 0, y: 0, w: 120, h: 20 }; // priority 80
    const smallBox: Box = { x: 75, y: 0, w: 60, h: 20 }; // overlap 45px = 75% of small width, priority 60
    const { lb: big, el: bigEl } = label(bigBox, 80);
    const { lb: small, el: smallEl } = label(smallBox, 60);
    const hidden = plan([big, small]);
    expect(hidden).toBe(1);
    expect(bigEl.style.visibility).toBe("");
    expect(smallEl.style.visibility).toBe("hidden");
  });

  it("leaves the chip visible just below the 75% overlap boundary", () => {
    // Two equal-area chips (60×20) overlap for 44×20 = 880 px² — 73.3% of
    // each box's width, just under the 0.75 threshold. Neither should be
    // hidden.
    const a: Box = { x: 0, y: 0, w: 60, h: 20 }; // priority 80
    const b: Box = { x: 16, y: 0, w: 60, h: 20 }; // overlap 44px = 73.3% of width, priority 60
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

  it("restores a previously-collision-hidden chip and resolves fresh collisions (regression)", () => {
    // `hiddenLabel` was hidden by a prior plan (the zoom scenario). It must
    // re-enter the competition. Here it overlaps `late`, so the lower-priority
    // `late` is hidden and `hiddenLabel` comes back.
    const { lb: hiddenLabel, el: hiddenEl } = label(ANCHOR, 60);
    hiddenEl.style.visibility = "hidden";
    const { lb: late, el: lateEl } = label(ANCHOR, 50);
    const hidden = plan([hiddenLabel, late]);
    expect(hidden).toBe(1);
    expect(hiddenEl.style.visibility).toBe("");
    expect(lateEl.style.visibility).toBe("hidden");
  });

  it("brings a previously-collapsed chip back when it no longer overlaps (regression)", () => {
    const { lb: high, el: highEl } = label(ANCHOR, 80);
    const { lb: low, el: lowEl } = label(ANCHOR, 60);

    // Zoom level A: boxes fully overlap → low hides.
    const hidden1 = plan([high, low]);
    expect(hidden1).toBe(1);
    expect(highEl.style.visibility).toBe("");
    expect(lowEl.style.visibility).toBe("hidden");

    // Zoom level B: boxes move clear → both show.
    boxes.set(highEl, { x: 0, y: 0, w: 60, h: 20 });
    boxes.set(lowEl, { x: 300, y: 0, w: 60, h: 20 });
    const hidden2 = plan([high, low]);
    expect(hidden2).toBe(0);
    expect(highEl.style.visibility).toBe("");
    expect(lowEl.style.visibility).toBe("");
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

  it("hides chips that overlap by width even when vertically offset (1D rule)", () => {
    // Two chips offset vertically (small 2D area overlap) but overlapping on
    // the x-axis by more than half the narrower chip's width. The 1D rule
    // treats this as a collision because the number text runs into each other;
    // the old 2D-area rule would miss it (area well under the 50% threshold).
    const a: Box = { x: 0, y: 0, w: 60, h: 20 }; // priority 60
    const b: Box = { x: 10, y: 15, w: 60, h: 20 }; // 50px horizontal overlap of 60px = 83%
    const { lb: la, el: aEl } = label(a, 60);
    const { lb: lb_, el: bEl } = label(b, 60);
    const hidden = plan([la, lb_]);
    expect(hidden).toBe(1);
    // Equal strength → one claims space, the other hides; exactly one visible.
    const visible =
      (aEl.style.visibility === "" ? 1 : 0) + (bEl.style.visibility === "" ? 1 : 0);
    expect(visible).toBe(1);
  });

  it("produces the same survivors regardless of input order (order independence)", () => {
    // Three mutually-overlapping equal-priority chips of differing widths. The
    // survivor set must depend only on (priority, area, position), not on the
    // order labels are fed in — the old asymmetric pairwise loop could hide a
    // different chip depending on registration order.
    const wideBox: Box = { x: 0, y: 0, w: 120, h: 20 };
    const midBox: Box = { x: 40, y: 0, w: 80, h: 20 };
    const narrowBox: Box = { x: 70, y: 0, w: 40, h: 20 };
    const wide = label(wideBox, 60);
    const mid = label(midBox, 60);
    const narrow = label(narrowBox, 60);

    const resultOf = (order: Collision.CollidableLabel[]): boolean[] => {
      plan(order);
      return [wide, mid, narrow].map(l => l.el.style.visibility === "");
    };

    const abc = resultOf([wide.lb, mid.lb, narrow.lb]);
    const cba = resultOf([narrow.lb, mid.lb, wide.lb]);
    const bac = resultOf([mid.lb, wide.lb, narrow.lb]);

    expect(cba).toEqual(abc);
    expect(bac).toEqual(abc);
    // Widest claims space; the two narrower (mutually overlapping it) hide.
    expect(abc).toEqual([true, false, false]);
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

  it("leaves two chips visible when they merely graze on the edge (regression)", () => {
    // Two 60px chips whose centers are 30px apart: horizontal overlap is 30px,
    // exactly 50% of each chip's width — well below the 0.75 threshold. Both
    // must stay visible. This catches any regression that lowers the threshold
    // to a value that hides chips which are merely touching on the edge.
    const a: Box = { x: 0, y: 0, w: 60, h: 20 };
    const b: Box = { x: 30, y: 0, w: 60, h: 20 };
    const { lb: la, el: aEl } = label(a, 80);
    const { lb: lb_, el: bEl } = label(b, 60);
    const hidden = plan([la, lb_]);
    expect(hidden).toBe(0);
    expect(aEl.style.visibility).toBe("");
    expect(bEl.style.visibility).toBe("");
  });
});

describe("mapProjector", () => {
  it("falls back to minimum chip size when a chip is not yet rendered", () => {
    // A chip that has not entered the DOM reports width/height 0 from
    // getBoundingClientRect; mapProjector must return sensible minimums so
    // the planner never treats an unrendered chip as sizeless.
    const container = document.createElement("div");
    document.body.appendChild(container);
    const map = { getContainer: () => container } as unknown as L.Map;

    const unrendered = document.createElement("div");
    // Not appended to the document — getBoundingClientRect returns zeros.

    const proj = Collision.mapProjector(map);
    const box = proj.box(unrendered);

    expect(box.w).toBe(64);
    expect(box.h).toBe(18);
  });

  it("returns the container-relative box for a rendered chip", () => {
    // A rendered chip inside an offset container: the projected box must report
    // the chip's position relative to the container (not the viewport) and its
    // real dimensions. jsdom reports 0 from getBoundingClientRect, so we stub
    // it to exercise the real offset math.
    const container = document.createElement("div");
    document.body.appendChild(container);
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 50,
      width: 500,
      height: 300,
      right: 600,
      bottom: 350,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    } as DOMRect);

    const chip = document.createElement("div");
    container.appendChild(chip);
    vi.spyOn(chip, "getBoundingClientRect").mockReturnValue({
      left: 110,
      top: 70,
      width: 60,
      height: 20,
      right: 170,
      bottom: 90,
      x: 110,
      y: 70,
      toJSON: () => ({}),
    } as DOMRect);

    const map = { getContainer: () => container } as unknown as L.Map;
    const proj = Collision.mapProjector(map);
    const box = proj.box(chip);

    expect(box.x).toBe(10);
    expect(box.y).toBe(20);
    expect(box.w).toBe(60);
    expect(box.h).toBe(20);
  });
});

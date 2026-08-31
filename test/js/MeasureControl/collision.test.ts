import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Collision from "#foliplus/MeasureControl/collision.js";

type Box = { x: number; y: number; w: number; h: number };

/** A real DOM chip so `style.translate` and `style.visibility` behave as they
 *  do in a browser (jsdom honours the standalone `translate` property). */
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
  px: () => ({ x: 0, y: 0 }) as L.Point,
  box: el => boxOf(el),
};

/** Every attempt lands on the chip's own spot — a stand-in for a label whose
 *  real candidates are all already occupied by a neighbour. Six entries also
 *  exercises the attempt cap. */
const blocked: Array<[number, number]> = [
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
];

const chipOf: Collision.ChipOf = marker =>
  (marker as unknown as { _el?: HTMLElement })._el ?? null;

const markerFor = (el: HTMLElement): L.Marker =>
  ({ _el: el, getElement: () => el }) as unknown as L.Marker;

/** A label with a fresh chip pinned to `box`. Candidates default to a fully
 *  blocked set; a test passes `open` to give the planner somewhere to push. */
const label = (
  box: Box,
  priority: number,
  candidates: Collision.CollidableLabel["candidates"] = () => blocked,
): { lb: Collision.CollidableLabel; el: HTMLElement } => {
  const el = makeChip();
  boxes.set(el, box);
  return { el, lb: { marker: markerFor(el), candidates, priority } };
};

const plan = (labels: Collision.CollidableLabel[], collide = true): number =>
  Collision.placeLabels(labels, projector, collide, chipOf);

const ANCHOR: Box = { x: 0, y: 0, w: 60, h: 20 };
/** A second chip whose own box overlaps ANCHOR. */
const OVERLAP: Box = { x: 10, y: 5, w: 60, h: 20 };

beforeEach(() => {
  boxes.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("segmentDir", () => {
  const dirProjector: Collision.Projector = {
    px: ll => ({ x: ll.lng, y: ll.lat }) as L.Point,
    box: el => boxOf(el),
  };

  it("returns the unit vector along a horizontal segment", () => {
    expect(
      Collision.segmentDir(dirProjector, { lat: 0, lng: 0 }, { lat: 0, lng: 2 }),
    ).toEqual([1, 0]);
  });

  it("returns the unit vector along a vertical segment", () => {
    expect(
      Collision.segmentDir(dirProjector, { lat: 0, lng: 0 }, { lat: 2, lng: 0 }),
    ).toEqual([0, 1]);
  });

  it("normalizes to unit length", () => {
    const d = Collision.segmentDir(
      dirProjector,
      { lat: 0, lng: 0 },
      { lat: 3, lng: 4 },
    );
    expect(Math.hypot(d[0], d[1])).toBeCloseTo(1, 10);
  });

  it("returns [1, 0] for a zero-length segment", () => {
    expect(
      Collision.segmentDir(dirProjector, { lat: 1, lng: 1 }, { lat: 1, lng: 1 }),
    ).toEqual([1, 0]);
  });
});

describe("perpCandidates", () => {
  it("returns six unit-length directions", () => {
    const out = Collision.perpCandidates([1, 0]);
    expect(out).toHaveLength(6);
    out.forEach(([x, y]) => expect(Math.hypot(x, y)).toBeCloseTo(1, 10));
  });

  it("makes the first two candidates perpendicular to the segment", () => {
    const [dx, dy] = [1, 0] as [number, number];
    const out = Collision.perpCandidates([dx, dy]);
    for (const c of out.slice(0, 2)) {
      expect(Math.abs(c[0] * dx + c[1] * dy)).toBeLessThan(1e-9);
    }
  });

  it("spreads the remaining candidates symmetrically around the normal", () => {
    const out = Collision.perpCandidates([1, 0]);
    const [ax, ay] = out[2]!;
    const [bx, by] = out[3]!;
    expect(ax).toBeCloseTo(bx, 10); // mirror the x component
    expect(ay).toBeCloseTo(-by, 10); // and flip the y component
  });

  it("handles a non-unit input direction", () => {
    const out = Collision.perpCandidates([3, 4]);
    expect(Math.hypot(out[0]![0], out[0]![1])).toBeCloseTo(1, 10);
  });
});

describe("placeLabels", () => {
  it("keeps a label on its anchor when nothing overlaps it", () => {
    const { lb, el } = label(ANCHOR, 60);
    const hidden = plan([lb]);
    expect(hidden).toBe(0);
    expect(el.style.translate).toBe("");
    expect(el.style.visibility).toBe("");
  });

  it("pushes a partially-overlapping label aside along its first free candidate", () => {
    const { lb: high, el: highEl } = label(ANCHOR, 80);
    // ANCHOR is [0,0,60,20]; `low` overlaps it by 10px in y, so it must move —
    // and one 18px push down clears the claimed box.
    const lowBox: Box = { x: 0, y: 10, w: 60, h: 20 };
    const open: Collision.CollidableLabel["candidates"] = () => [
      [0, 1],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ];
    const { lb: low, el: lowEl } = label(lowBox, 60, open);
    const hidden = plan([high, low]);
    expect(hidden).toBe(0);
    expect(highEl.style.translate).toBe("");
    // High claims the anchor; low moves down.
    expect(lowEl.style.translate).toBe(`0px ${18}px`);
    expect(lowEl.style.visibility).toBe("");
  });

  it("drops a label that has no free candidate instead of overlapping", () => {
    const { lb: high, el: highEl } = label(ANCHOR, 80);
    const { lb: low, el: lowEl } = label(ANCHOR, 60); // all candidates blocked
    const hidden = plan([high, low]);
    expect(hidden).toBe(1);
    expect(highEl.style.visibility).toBe("");
    expect(lowEl.style.visibility).toBe("hidden");
  });

  it("recomputes candidates per plan from the projector", () => {
    const candidates = vi.fn<Collision.CollidableLabel["candidates"]>(() => blocked);
    const { lb } = label(ANCHOR, 60, candidates);
    plan([lb]);
    expect(candidates).toHaveBeenCalledWith(projector);
  });

  it("clears every push and unhides every label when collision is off", () => {
    const { lb: high, el: highEl } = label(ANCHOR, 80);
    const { lb: low, el: lowEl } = label(ANCHOR, 60);
    // A prior plan that dropped `low`.
    Collision.placeLabels([high, low], projector, true, chipOf);
    const hidden = plan([high, low], false);
    expect(hidden).toBe(0);
    expect(highEl.style.translate).toBe("");
    expect(highEl.style.visibility).toBe("");
    expect(lowEl.style.translate).toBe("");
    expect(lowEl.style.visibility).toBe("");
  });

  it("places a later label even when an earlier one was hidden", () => {
    // `low` is fully blocked, but it claims no space, so `late` — placed after
    // it — still gets the one remaining escape and is pushed instead of hidden.
    const { lb: high, el: highEl } = label(ANCHOR, 80);
    const { lb: low, el: lowEl } = label(ANCHOR, 60);
    const open: Collision.CollidableLabel["candidates"] = () => [
      [0, 1],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ];
    const { lb: late, el: lateEl } = label(ANCHOR, 50, open);
    const hidden = plan([high, low, late]);
    expect(hidden).toBe(1);
    expect(lowEl.style.visibility).toBe("hidden");
    // `late` competes against high's claim only — low's hidden box is not taken.
    expect(lateEl.style.visibility).toBe("");
    expect(lateEl.style.translate).toBe(`0px ${18}px`);
    expect(highEl.style.translate).toBe("");
  });

  it("keeps a clear chip on its anchor even in the same run as a collision", () => {
    const { lb: high, el: highEl } = label(ANCHOR, 80);
    // Clear of every claimed box → the anchor-free shortcut must win and no
    // push may be applied.
    const far: Box = { x: 300, y: 0, w: 60, h: 20 };
    const { lb: other, el: otherEl } = label(far, 60);
    const hidden = plan([high, other]);
    expect(hidden).toBe(0);
    expect(otherEl.style.translate).toBe("");
    expect(otherEl.style.visibility).toBe("");
    expect(highEl.style.translate).toBe("");
  });
});

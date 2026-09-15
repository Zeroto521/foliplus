import { describe, expect, it } from "vitest";
import {
  layoutLabel,
  planLabelLayout,
} from "#foliplus/LayerControl/annotationLayout.js";

const SPEC = {
  fontFamily: "sans-serif",
  fontSize: 12,
  fontWeight: "bold",
  haloWidth: 3,
  pointOffsetY: 10,
  shapeOffsetY: 0,
};

const label = (
  id: string,
  text: string,
  anchor: { x: number; y: number },
  atPoint: boolean,
  priority = 50,
) => ({ id, text, anchor, atPoint, priority });

describe("layoutLabel", () => {
  it("places a point label below its marker, horizontally centred, halo included", () => {
    // 3 chars at 12px × 0.6 → 22px wide + 2×3 halo; the box is centred on the
    // text, so its top edge sits (10 − halo) below the marker.
    const { box } = layoutLabel(label("a", "abc", { x: 100, y: 200 }, true), SPEC);

    expect(box.x).toBeCloseTo(100 - 27.6 / 2, 5);
    expect(box.y).toBe(207);
    expect(box.w).toBeCloseTo(27.6, 5);
    expect(box.h).toBe(18);
  });

  it("centres a shape label on its anchor in both axes", () => {
    const { box } = layoutLabel(label("b", "abc", { x: 100, y: 200 }, false), SPEC);

    expect(box.x).toBeCloseTo(100 - 27.6 / 2, 5);
    expect(box.y).toBe(200 - 9);
    expect(box.w).toBeCloseTo(27.6, 5);
    expect(box.h).toBe(18);
  });
});

describe("planLabelLayout", () => {
  const viewport = { x: 0, y: 0, w: 400, h: 300 };

  it("drops nothing when everything fits and nothing overlaps", () => {
    const labels = [
      label("a", "aa", { x: 100, y: 100 }, true),
      label("b", "bb", { x: 250, y: 100 }, true),
    ];

    expect(planLabelLayout(labels, SPEC, viewport).map(l => l.id)).toEqual(["a", "b"]);
  });

  it("culls labels outside the viewport before planning", () => {
    const labels = [
      label("on", "aa", { x: 100, y: 100 }, true),
      label("off", "aa", { x: 5000, y: 100 }, true),
    ];

    const planned = planLabelLayout(labels, SPEC, viewport);

    expect(planned.map(l => l.id)).toEqual(["on"]);
  });

  it("hides the lower-priority label of an overlapping pair", () => {
    const labels = [
      label("low", "aaaaaaaa", { x: 100, y: 100 }, true, 10),
      label("high", "bbbbbbbb", { x: 105, y: 101 }, true, 90),
    ];

    const planned = planLabelLayout(labels, SPEC, viewport);

    expect(planned.map(l => l.id)).toEqual(["high"]);
  });

  it("returns survivors in input order", () => {
    const labels = [
      label("first", "bbbbbbbb", { x: 100, y: 100 }, true, 90),
      label("second", "aaaaaaaa", { x: 104, y: 101 }, true, 10),
    ];

    // The winner keeps its place; the loser drops; order is the caller's.
    expect(planLabelLayout(labels, SPEC, viewport).map(l => l.id)).toEqual(["first"]);
  });

  it("passes the caller threshold through to the planner", () => {
    const labels = [
      label("low", "aaaaaaaa", { x: 100, y: 100 }, true, 10),
      label("high", "bbbbbbbb", { x: 100 + 8, y: 100 }, true, 90),
    ];

    expect(planLabelLayout(labels, SPEC, viewport, 0.2).map(l => l.id)).toEqual([
      "high",
    ]);
  });

  it("treats the halo as part of the footprint, so dense short labels hide", () => {
    // Two one-character labels 6px apart: their glyphs nearly touch, and once
    // the 3px halo is inside each box the horizontal overlap covers over half
    // the narrower label — the case zooming out produces, where the pre-halo
    // boxes let neighbours survive into a black smudge.
    const labels = [
      label("a", "1", { x: 100, y: 100 }, true),
      label("b", "1", { x: 106, y: 100 }, true),
    ];

    const planned = planLabelLayout(labels, SPEC, viewport);

    expect(planned.map(l => l.id)).toEqual(["a"]);
  });
});

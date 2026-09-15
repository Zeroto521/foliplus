import { describe, expect, it } from "vitest";
import {
  layoutLabel,
  planLabelLayout,
} from "#foliplus/LayerControl/annotationLayout.js";

const SPEC = {
  fontFamily: "sans-serif",
  fontSize: 12,
  fontWeight: "bold",
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
  it("places a point label below its marker, horizontally centred", () => {
    // 3 chars at 12px × 0.6 → 22px wide; top edge at anchor.y + 10.
    const { box } = layoutLabel(label("a", "abc", { x: 100, y: 200 }, true), SPEC);

    expect(box.x).toBeCloseTo(100 - 21.6 / 2, 5);
    expect(box.y).toBe(210);
    expect(box.w).toBeCloseTo(21.6, 5);
    expect(box.h).toBe(12);
  });

  it("centres a shape label on its anchor in both axes", () => {
    const { box } = layoutLabel(label("b", "abc", { x: 100, y: 200 }, false), SPEC);

    expect(box.x).toBeCloseTo(100 - 21.6 / 2, 5);
    expect(box.y).toBe(200 - 6);
    expect(box.w).toBeCloseTo(21.6, 5);
    expect(box.h).toBe(12);
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
});

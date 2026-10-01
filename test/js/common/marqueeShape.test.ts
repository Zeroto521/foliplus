import { describe, expect, it } from "vitest";
import { type RectCorners, roundedRectOutline } from "#common/marqueeShape.js";

const SQUARE: RectCorners = [
  { u: 0, v: 0 },
  { u: 100, v: 0 },
  { u: 100, v: 100 },
  { u: 0, v: 100 },
];

describe("roundedRectOutline", () => {
  it("returns 16 points: 2 tangents + 2 bezier mids per corner", () => {
    const pts = roundedRectOutline(SQUARE);
    expect(pts).toHaveLength(16);
  });

  it("keeps the outline inside the bounds (outward fillet, not concave)", () => {
    const pts = roundedRectOutline(SQUARE, 0.1);
    // Every point must stay within [0,100] on both axes (corners are cut,
    // bezier bulges outward toward the corner, never inward past an edge).
    for (const p of pts) {
      expect(p.u).toBeGreaterThanOrEqual(0);
      expect(p.u).toBeLessThanOrEqual(100);
      expect(p.v).toBeGreaterThanOrEqual(0);
      expect(p.v).toBeLessThanOrEqual(100);
    }
    // The corner itself (0,0) is gone: the fillet pulls the path off it.
    const hasCorner = pts.some(p => p.u === 0 && p.v === 0);
    expect(hasCorner).toBe(false);
  });

  it("keeps straight edges between the two corner tangents", () => {
    const pts = roundedRectOutline(SQUARE, 0.05);
    // Top edge: corner0's outgoing tangent and corner1's incoming tangent
    // both sit on v=0 — the renderer joins them with a straight line.
    const topTangents = pts.filter(p => p.v === 0);
    expect(topTangents.length).toBe(2);
    expect(topTangents[0].u).toBe(5);
    expect(topTangents[1].u).toBe(95);
  });

  it("is axis-generic (identical shape in any rect)", () => {
    const rect: RectCorners = [
      { u: 10, v: 20 },
      { u: 50, v: 20 },
      { u: 50, v: 60 },
      { u: 10, v: 60 },
    ];
    const pts = roundedRectOutline(rect, 0.1);
    expect(pts).toHaveLength(16);
    for (const p of pts) {
      expect(p.u).toBeGreaterThanOrEqual(10);
      expect(p.u).toBeLessThanOrEqual(50);
      expect(p.v).toBeGreaterThanOrEqual(20);
      expect(p.v).toBeLessThanOrEqual(60);
    }
  });
});

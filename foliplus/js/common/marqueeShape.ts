// Shared rounded-rect outline for map marquees (focus rect, geometry
// selection bbox). Axis-generic: callers map latlng or pixel corners into
// {u, v} and map the result back into their own coordinate space, so one
// fillet math serves every box. Control point is the corner itself, which
// makes the bezier bulge OUTWARD — a true rounded corner, never concave.

export interface Vec2 {
  u: number;
  v: number;
}

/** Four corners in order (NW, NE, SE, SW). */
export type RectCorners = [Vec2, Vec2, Vec2, Vec2];

/**
 * Outline of a rounded rectangle: per corner, the two edge tangents plus
 * two bezier mid points (16 points total, closed by the caller's renderer).
 *
 * @param corners four corners, winding order (NW→NE→SE→SW)
 * @param f fillet radius as a fraction of each edge length
 */
const roundedRectOutline = (corners: RectCorners, f = 0.03): Vec2[] => {
  const pts: Vec2[] = [];
  for (let i = 0; i < 4; i++) {
    const c = corners[i];
    const prev = corners[(i + 3) % 4];
    const next = corners[(i + 1) % 4];
    const inU = (prev.u - c.u) * f;
    const inV = (prev.v - c.v) * f;
    const outU = (next.u - c.u) * f;
    const outV = (next.v - c.v) * f;
    const p0: Vec2 = { u: c.u + inU, v: c.v + inV };
    const p2: Vec2 = { u: c.u + outU, v: c.v + outV };
    const ctrl = c;
    pts.push(p0);
    for (let k = 1; k <= 2; k++) {
      const t = k / 3;
      const mt = 1 - t;
      pts.push({
        u: mt * mt * p0.u + 2 * mt * t * ctrl.u + t * t * p2.u,
        v: mt * mt * p0.v + 2 * mt * t * ctrl.v + t * t * p2.v,
      });
    }
    pts.push(p2);
  }
  return pts;
};

export { roundedRectOutline };

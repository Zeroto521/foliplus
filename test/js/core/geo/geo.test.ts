import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  area,
  areaCentroid,
  bearing,
  boundsToRect,
  centroid,
  distance,
  midpoint,
} from "#core/geo/index.js";

beforeEach(() => {
  globalThis.turf = {
    point: (coords: [number, number]) => ({ coords }),
    distance: vi.fn(() => 1234),
    bearing: vi.fn(() => 45),
    midpoint: vi.fn(() => ({ geometry: { coordinates: [12.5, 34.5] } })),
    polygon: vi.fn((coords: unknown[]) => ({ coords })),
    area: vi.fn(() => 5_000_000),
  };
});

afterEach(() => {
  delete globalThis.turf;
});

describe("geo.distance", () => {
  it("calls turf.distance in meters with turf points", () => {
    const d = distance({ lng: 10, lat: 20 }, { lng: 11, lat: 21 });
    expect(d).toBe(1234);
    expect(turf.distance).toHaveBeenCalledWith(
      { coords: [10, 20] },
      { coords: [11, 21] },
      { units: "meters" },
    );
  });
});

describe("geo.boundsToRect", () => {
  const makeMap = (points: Record<string, { x: number; y: number }>) => ({
    latLngToContainerPoint: vi.fn(
      (ll: { lat: number; lng: number }) =>
        points[`${ll.lat},${ll.lng}`] ?? { x: 0, y: 0 },
    ),
  });

  it("computes min-corner origin and abs dimensions", () => {
    const map = makeMap({
      "10,20": { x: 300, y: 200 },
      "11,21": { x: 100, y: 350 },
    });
    const rect = boundsToRect(map, {
      nw: { lat: 10, lng: 20 },
      se: { lat: 11, lng: 21 },
    });
    expect(rect).toEqual({ left: 100, top: 200, width: 200, height: 150 });
  });

  it("handles swapped corners (se is upper-left of nw)", () => {
    const map = makeMap({
      "40,120": { x: 50, y: 60 },
      "30,110": { x: 200, y: 150 },
    });
    const rect = boundsToRect(map, {
      nw: { lat: 40, lng: 120 },
      se: { lat: 30, lng: 110 },
    });
    expect(rect).toEqual({ left: 50, top: 60, width: 150, height: 90 });
  });
});

describe("geo.bearing", () => {
  it("normalizes negative bearings into 0–360", () => {
    turf.bearing = vi.fn(() => -45);
    expect(bearing({ lng: 0, lat: 0 }, { lng: 1, lat: 1 })).toBe(315);
  });

  it("keeps positive bearings as-is", () => {
    expect(bearing({ lng: 0, lat: 0 }, { lng: 1, lat: 1 })).toBe(45);
  });
});

describe("geo.midpoint", () => {
  it("returns L.LatLng from turf midpoint coordinates", () => {
    const m = midpoint({ lng: 10, lat: 20 }, { lng: 15, lat: 49 });
    expect(m).toEqual({ lat: 34.5, lng: 12.5 });
  });
});

describe("geo.centroid", () => {
  it("averages vertex lat/lng", () => {
    const c = centroid([
      { lng: 0, lat: 0 },
      { lng: 0, lat: 10 },
      { lng: 10, lat: 10 },
      { lng: 10, lat: 0 },
    ]);
    expect(c).toEqual({ lat: 5, lng: 5 });
  });
});

describe("geo.area", () => {
  it("returns 0 for fewer than 3 points", () => {
    expect(
      area([
        { lng: 0, lat: 0 },
        { lng: 1, lat: 1 },
      ]),
    ).toBe(0);
    expect(turf.area).not.toHaveBeenCalled();
  });

  it("closes the ring and calls turf.area", () => {
    const a = area([
      { lng: 0, lat: 0 },
      { lng: 0, lat: 10 },
      { lng: 10, lat: 10 },
    ]);
    expect(a).toBe(5_000_000);
    expect(turf.polygon).toHaveBeenCalledWith([
      [
        [0, 0],
        [0, 10],
        [10, 10],
        [0, 0],
      ],
    ]);
  });
});

describe("geo.areaCentroid", () => {
  it("computes the shoelace centroid of a Polygon", () => {
    // Unit square: shoelace centroid is the geometric center.
    const c = areaCentroid({
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      ],
    });
    expect(c).toEqual({ lat: 0.5, lng: 0.5 });
  });

  it("subtracts holes from the outer ring (signed shoelace)", () => {
    // 10×10 square with a 2×2 hole in the upper-right quadrant.
    // Signed-area centroid of the resulting annulus is NOT the square's center.
    const c = areaCentroid({
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [0, 10],
          [10, 10],
          [10, 0],
          [0, 0],
        ],
        [
          [8, 8],
          [9, 8],
          [9, 9],
          [8, 9],
          [8, 8],
        ],
      ],
    });
    // 96-area annulus; centroid shifted toward the lower-left of the outer
    // ring because the hole eats from the upper-right.
    expect(c.lng).toBeLessThan(5);
    expect(c.lat).toBeLessThan(5);
  });

  it("merges MultiPolygon parts by |area|, not by vertex count", () => {
    // A 10×10 square and a 1×1 square side by side. The area-weighted
    // centroid sits near the big square's center, not at the midpoint of
    // the two bounding boxes (which would be turf.centerOfMass's convex
    // shortcut on MultiPolygon).
    const c = areaCentroid({
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 0],
            [0, 10],
            [10, 10],
            [10, 0],
            [0, 0],
          ],
        ],
        [
          [
            [20, 0],
            [20, 1],
            [21, 1],
            [21, 0],
            [20, 0],
          ],
        ],
      ],
    });
    // Weighted average: (100 * 5 + 1 * 20.5) / 101, y symmetric at (100*5 + 1*0.5)/101.
    expect(c.lng).toBeCloseTo((100 * 5 + 20.5) / 101, 5);
    expect(c.lat).toBeCloseTo((100 * 5 + 0.5) / 101, 5);
  });
});

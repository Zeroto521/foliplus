import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  area,
  bearing,
  centroid,
  distance,
  midpoint,
} from "#common/geo.js";

beforeEach(() => {
  globalThis.turf = {
    point: coords => ({ coords }),
    distance: vi.fn((a, b) => 1234),
    bearing: vi.fn((a, b) => 45),
    midpoint: vi.fn((a, b) => ({ geometry: { coordinates: [12.5, 34.5] } })),
    polygon: vi.fn(coords => ({ coords })),
    area: vi.fn(poly => 5_000_000),
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

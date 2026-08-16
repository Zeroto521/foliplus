import { beforeEach, describe, expect, it, vi } from "vitest";
import * as SVGs from "#foliplus/LayerControl/icon.js";
import { getTypeSVG } from "#foliplus/LayerControl/util.js";

class Polygon {}
class Polyline {}
class CircleMarker {}
class Marker {}

const makeContainer = children => ({
  eachLayer: fn => children.forEach(fn),
});

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(window.L, { Polygon, Polyline, CircleMarker, Marker });
});

describe("getTypeSVG", () => {
  it("maps geometry types to their SVG icons", () => {
    expect(getTypeSVG(makeContainer([new Polygon()]))).toBe(SVGs.POLYGON);
    expect(getTypeSVG(makeContainer([new Polyline()]))).toBe(SVGs.LINE);
    expect(getTypeSVG(makeContainer([new CircleMarker()]))).toBe(SVGs.POINT);
    expect(getTypeSVG(makeContainer([]))).toBe(SVGs.EMPTY);
    expect(getTypeSVG(makeContainer([{}]))).toBe(SVGs.UNKNOWN);
  });
});

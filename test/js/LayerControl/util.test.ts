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

    expect(getTypeSVG(makeContainer([]))).toBe(SVGs.EMPTY);

    expect(getTypeSVG(makeContainer([{}]))).toBe(SVGs.UNKNOWN);
  });

  it("shows the point icon only for feature-bearing CircleMarkers", () => {
    // The point icon promises downstream-consumable data (extractPoints /
    // Heatmap), which require .feature. A plain CircleMarker is a geometric
    // point but not consumable, so it shows unknown — not point.
    const cm = new CircleMarker();

    cm.feature = {};

    expect(getTypeSVG(makeContainer([cm]))).toBe(SVGs.POINT);

    expect(getTypeSVG(makeContainer([new CircleMarker()]))).toBe(SVGs.UNKNOWN);
  });
});

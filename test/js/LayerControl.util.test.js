import { beforeEach, describe, expect, it, vi } from "vitest";
import * as SVGs from "../../foliplus/js/LayerControl/LayerControl.icon.js";
import * as Util from "../../foliplus/js/LayerControl/LayerControl.util.js";

class Polygon {}
class Polyline {}
class CircleMarker {}
class Marker {}

const makeContainer = (children) => ({
  eachLayer: (fn) => children.forEach(fn),
});

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(window.L, { Polygon, Polyline, CircleMarker, Marker });
});

describe("getGeometryType", () => {
  it("returns empty for an empty container", () => {
    expect(Util.getGeometryType(makeContainer([]))).toBe("empty");
  });

  it("detects polygon leaves", () => {
    expect(Util.getGeometryType(makeContainer([new Polygon()]))).toBe("polygon");
  });

  it("detects line leaves", () => {
    expect(Util.getGeometryType(makeContainer([new Polyline()]))).toBe("line");
  });

  it("detects point leaves (circle marker and marker with feature)", () => {
    expect(Util.getGeometryType(makeContainer([new CircleMarker()]))).toBe("point");
    expect(
      Util.getGeometryType(
        makeContainer([Object.assign(new Marker(), { feature: {} })]),
      ),
    ).toBe("point");
  });

  it("returns unknown for unrecognized leaves", () => {
    expect(Util.getGeometryType(makeContainer([{}]))).toBe("unknown");
  });

  it("returns unknown for mixed geometry types", () => {
    expect(Util.getGeometryType(makeContainer([new Polygon(), new Polyline()]))).toBe(
      "unknown",
    );
  });
});

describe("getTypeSVG", () => {
  it("maps geometry types to their SVG icons", () => {
    expect(Util.getTypeSVG(makeContainer([new Polygon()]))).toBe(SVGs.POLYGON);
    expect(Util.getTypeSVG(makeContainer([new Polyline()]))).toBe(SVGs.LINE);
    expect(Util.getTypeSVG(makeContainer([new CircleMarker()]))).toBe(SVGs.POINT);
    expect(Util.getTypeSVG(makeContainer([]))).toBe(SVGs.EMPTY);
    expect(Util.getTypeSVG(makeContainer([{}]))).toBe(SVGs.UNKNOWN);
  });
});

describe("findLayer", () => {
  it("resolves a layer from map._layers by id", () => {
    const layer = {};
    expect(Util.findLayer({ _layers: { foo: layer } }, "foo")).toBe(layer);
  });

  it("resolves a layer from the window global by id", () => {
    const layer = {};
    window.foo = layer;
    expect(Util.findLayer({ _layers: {} }, "foo")).toBe(layer);
    delete window.foo;
  });

  it("returns null when not found", () => {
    expect(Util.findLayer({ _layers: {} }, "nope")).toBeNull();
  });
});

describe("forEachLeaf / forEachLayer", () => {
  it("walks only leaves (recursively)", () => {
    const leafA = new Polygon();
    const leafB = new Polyline();
    const root = makeContainer([leafA, makeContainer([leafB])]);
    const seen = [];
    Util.forEachLeaf(root, (l) => seen.push(l));
    expect(seen).toEqual([leafA, leafB]);
  });

  it("walks every node including containers", () => {
    const leaf = new Polygon();
    const inner = makeContainer([leaf]);
    const root = makeContainer([inner]);
    const seen = [];
    Util.forEachLayer(root, (l) => seen.push(l));
    expect(seen).toContain(root);
    expect(seen).toContain(inner);
    expect(seen).toContain(leaf);
  });

  it("handles _layers-backed containers", () => {
    const leaf = new CircleMarker();
    const root = { _layers: { a: leaf } };
    const seen = [];
    Util.forEachLeaf(root, (l) => seen.push(l));
    expect(seen).toEqual([leaf]);
  });
});

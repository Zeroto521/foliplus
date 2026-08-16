import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findLayer,
  forEachLayer,
  forEachLeaf,
  getGeometryType,
  countFeatureGeometry,
} from "#foliplus/core/layer/util.js";

describe("core/layer util", () => {
  beforeEach(() => {
    // setup.ts does not define L.Marker — stub one so instanceof checks work.
    if (!window.L.Marker)
      window.L.Marker = class Marker {
        feature: unknown = null;
      };
  });

  describe("findLayer", () => {
    it("resolves a layer from map._layers", () => {
      const layer = {};
      const map = { _layers: { foo: layer } };
      expect(findLayer(map as never, "foo")).toBe(layer);
    });

    it("resolves a layer from a window global", () => {
      const layer = {};
      (window as unknown as Record<string, unknown>).myLayer = layer;
      expect(findLayer({} as never, "myLayer")).toBe(layer);
      delete (window as unknown as Record<string, unknown>).myLayer;
    });

    it("returns null when the layer is unknown", () => {
      expect(findLayer({} as never, "nope")).toBeNull();
    });
  });

  describe("forEachLayer / forEachLeaf", () => {
    const group = () => {
      const a = {};
      const b = {};
      return {
        a,
        b,
        layer: {
          eachLayer: (fn: (l: L.Layer) => void) => {
            fn(a as L.Layer);
            fn(b as L.Layer);
          },
        },
      };
    };

    it("walks containers and leaves", () => {
      const { a, b, layer } = group();
      const visited: L.Layer[] = [];
      forEachLayer(layer as never, l => visited.push(l));
      expect(visited).toEqual([layer, a, b]);
    });

    it("forEachLeaf visits only leaves", () => {
      const { a, b, layer } = group();
      const visited: L.Layer[] = [];
      forEachLeaf(layer as never, l => visited.push(l));
      expect(visited).toEqual([a, b]);
    });

    it("handles a plain layer with no children", () => {
      const plain = {};
      const visited: L.Layer[] = [];
      forEachLayer(plain as never, l => visited.push(l));
      expect(visited).toEqual([plain]);
    });

    it("walks the _layers map when eachLayer is absent", () => {
      const a = {};
      const layer = { _layers: { a } };
      const visited: L.Layer[] = [];
      forEachLeaf(layer as never, l => visited.push(l));
      expect(visited).toEqual([a]);
    });
  });

  describe("getGeometryType", () => {
    const wrap = (...leaves: L.Layer[]) => ({
      eachLayer: (fn: (l: L.Layer) => void) => leaves.forEach(fn),
    });

    it("returns polygon for L.Polygon leaves", () => {
      const group = wrap(new window.L.Polygon());
      expect(getGeometryType(group as never)).toBe("polygon");
    });

    it("returns line for L.Polyline leaves", () => {
      const group = wrap(new window.L.Polyline());
      expect(getGeometryType(group as never)).toBe("line");
    });

    it("returns point for markers with feature", () => {
      const marker = new window.L.Marker();
      marker.feature = {};
      const group = wrap(marker);
      expect(getGeometryType(group as never)).toBe("point");
    });

    it("returns empty for a container with no leaves", () => {
      const emptyGroup = { eachLayer: () => {} };
      expect(getGeometryType(emptyGroup as never)).toBe("empty");
    });

    it("returns unknown for mixed geometry", () => {
      const group = wrap(new window.L.Polygon(), new window.L.Polyline());
      expect(getGeometryType(group as never)).toBe("unknown");
    });
  });

  describe("countFeatureGeometry", () => {
    const wrap = (...leaves: L.Layer[]) => ({
      eachLayer: (fn: (l: L.Layer) => void) => leaves.forEach(fn),
    });

    it("counts Polygon leaves", () => {
      const group = wrap(new window.L.Polygon(), new window.L.Polygon());
      expect(countFeatureGeometry(group as never)).toBe(2);
    });

    it("counts Polyline leaves", () => {
      const group = wrap(new window.L.Polyline());
      expect(countFeatureGeometry(group as never)).toBe(1);
    });

    it("counts CircleMarker leaves as points", () => {
      const group = wrap(new window.L.CircleMarker());
      expect(countFeatureGeometry(group as never)).toBe(1);
    });

    it("counts Markers with feature as points", () => {
      const marker = new window.L.Marker();
      marker.feature = {};
      const group = wrap(marker);
      expect(countFeatureGeometry(group as never)).toBe(1);
    });

    it("ignores Markers without feature", () => {
      const marker = new window.L.Marker();
      const group = wrap(marker);
      expect(countFeatureGeometry(group as never)).toBe(0);
    });

    it("excludes label layers", () => {
      const polygon = new window.L.Polygon();
      (polygon as unknown as { isLabel: boolean }).isLabel = true;
      const group = wrap(polygon);
      expect(countFeatureGeometry(group as never)).toBe(0);
    });

    it("handles a mixed container", () => {
      const marker = new window.L.Marker();
      marker.feature = {};
      const label = new window.L.Polygon();
      (label as unknown as { isLabel: boolean }).isLabel = true;
      const group = wrap(new window.L.Polygon(), new window.L.Polyline(), marker, label);
      expect(countFeatureGeometry(group as never)).toBe(3);
    });

    it("returns 0 for an empty container", () => {
      const emptyGroup = { eachLayer: () => {} };
      expect(countFeatureGeometry(emptyGroup as never)).toBe(0);
    });
  });
});

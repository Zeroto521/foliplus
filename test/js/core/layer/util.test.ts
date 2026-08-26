import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/core/layer/const.js";
import {
  countFeatureGeometry,
  findLayer,
  forEachLayer,
  forEachLeaf,
  getGeometryType,
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

    it("recurses into nested _layers (fallback branch)", () => {
      const inner = { _layers: { leaf: {} } };
      const outer = { _layers: { inner } };
      const visited: L.Layer[] = [];
      forEachLeaf(outer as never, l => visited.push(l));
      expect(visited).toEqual([{}]);
    });

    it("respects the recursion depth limit", () => {
      const depth = CONST.RECURSION.LAYER_DEPTH + 2;
      // Build a chain of eachLayer containers deeper than LAYER_DEPTH.
      let tail: L.Layer = {
        eachLayer: (fn: (l: L.Layer) => void) => fn({} as L.Layer),
      };
      for (let i = 0; i < depth; i++) {
        const next = tail;
        tail = { eachLayer: (fn: (l: L.Layer) => void) => fn(next as L.Layer) };
      }
      const visited: L.Layer[] = [];
      forEachLayer(tail as never, l => visited.push(l));
      // Nodes beyond the depth limit must not be visited.
      expect(visited.length).toBeLessThan(depth + 1);
    });

    it("skips a null layer", () => {
      const visited: L.Layer[] = [];
      forEachLayer(null as never, l => visited.push(l));
      expect(visited).toEqual([]);
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

    it("ignores isLabel leaves when inferring type", () => {
      const label = new window.L.Polygon();
      (label as unknown as { isLabel: boolean }).isLabel = true;
      const group = wrap(label);
      expect(getGeometryType(group as never)).toBe("empty");
    });

    it("infers type from data leaves even when labels are present", () => {
      const dataPoly = new window.L.Polygon();
      const labelPoly = new window.L.Polyline();
      (labelPoly as unknown as { isLabel: boolean }).isLabel = true;
      const group = wrap(dataPoly, labelPoly);
      expect(getGeometryType(group as never)).toBe("polygon");
    });

    it("returns unknown for mixed geometry", () => {
      const group = wrap(new window.L.Polygon(), new window.L.Polyline());
      expect(getGeometryType(group as never)).toBe("unknown");
    });

    it("returns point for L.CircleMarker leaves", () => {
      const group = wrap(new window.L.CircleMarker());
      expect(getGeometryType(group as never)).toBe("point");
    });

    it("returns unknown for a Marker without a .feature property", () => {
      const marker = new window.L.Marker();
      const group = wrap(marker);
      expect(getGeometryType(group as never)).toBe("unknown");
    });

    it("returns unknown for a mix of Point + LineString + Polygon", () => {
      const marker = new window.L.Marker();
      marker.feature = {};
      const group = wrap(marker, new window.L.Polyline(), new window.L.Polygon());
      expect(getGeometryType(group as never)).toBe("unknown");
    });

    it("treats multiple Markers as point geometry (MultiPoint serialization)", () => {
      const m1 = new window.L.Marker();
      m1.feature = {};
      const m2 = new window.L.Marker();
      m2.feature = {};
      const group = wrap(m1, m2);
      expect(getGeometryType(group as never)).toBe("point");
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

    it("excludes isLabel CircleMarker", () => {
      const cm = new window.L.CircleMarker();
      (cm as unknown as { isLabel: boolean }).isLabel = true;
      const group = wrap(cm);
      expect(countFeatureGeometry(group as never)).toBe(0);
    });

    it("counts features nested in a label sub-group (real LayerFactory structure)", () => {
      const dataPoly = new window.L.Polygon();
      const labelPoly = new window.L.Polygon();
      (labelPoly as unknown as { isLabel: boolean }).isLabel = true;
      const labelGroup = {
        eachLayer: (fn: (l: L.Layer) => void) => fn(labelPoly),
      };
      const mainGroup = {
        eachLayer: (fn: (l: L.Layer) => void) => {
          fn(dataPoly);
          fn(labelGroup as L.Layer);
        },
      };
      expect(countFeatureGeometry(mainGroup as never)).toBe(1);
    });

    it("handles a mixed container", () => {
      const marker = new window.L.Marker();
      marker.feature = {};
      const label = new window.L.Polygon();
      (label as unknown as { isLabel: boolean }).isLabel = true;
      const group = wrap(
        new window.L.Polygon(),
        new window.L.Polyline(),
        marker,
        label,
      );
      expect(countFeatureGeometry(group as never)).toBe(3);
    });

    it("returns 0 for an empty container", () => {
      const emptyGroup = { eachLayer: () => {} };
      expect(countFeatureGeometry(emptyGroup as never)).toBe(0);
    });
  });
});

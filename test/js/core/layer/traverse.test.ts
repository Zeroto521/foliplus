import { describe, expect, it, vi } from "vitest";
import geometrySource from "#core/layer/geometry?raw";
import {
  countVisibleChildLayers,
  isGroupLayer,
  isGroupRow,
} from "#core/layer/index.js";
import interactionSource from "#core/layer/interaction?raw";
import traverseSource from "#core/layer/traverse?raw";

describe("core/layer traverse: isGroupLayer", () => {
  // A minimal group stub: group-like with a child registry + fixed list.
  const makeGroupStub = (children: unknown[] = []) => {
    const c: any = {
      options: {},
      clearLayers: vi.fn(),
      getBounds: vi.fn(),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      getLayers: vi.fn(() => children),
      _layers: {},
    };
    c.eachLayer = vi.fn((fn: (child: unknown) => void) => {
      for (const child of children) fn(child);
    });
    return c;
  };

  it("isGroupLayer: group-like true, plain polygon false, GeoJSON shape false", () => {
    const poly: any = { options: {} };
    Object.setPrototypeOf(poly, new (window as any).L.Polygon());
    const group = makeGroupStub([poly]);
    const geoShape = makeGroupStub([
      { feature: { type: "Feature" } },
      { feature: { type: "Feature" } },
    ]);
    expect(isGroupLayer(group)).toBe(true);
    expect(isGroupLayer(poly)).toBe(false);
    // GeoJSON shape: every child carries a feature envelope.
    expect(isGroupLayer(geoShape)).toBe(false);
  });

  it("isGroupLayer: a real L.FeatureGroup (not GeoJSON) with feature-leaf children is a group", () => {
    // Real-runtime class hierarchy: L.GeoJSON extends L.FeatureGroup extends L.LayerGroup.
    // A folium FeatureGroup is instanceof L.FeatureGroup but NOT instanceof L.GeoJSON. Its
    // direct children may carry .feature (feature leaves) — the GeoJSON SHAPE fallback would
    // wrongly exclude such a group. The canonical L.FeatureGroup branch must win.
    class FeatureGroupStub {
      _layers: Record<string, unknown> = {};
      eachLayer(fn: (c: unknown) => void): void {
        for (const c of Object.values(this._layers)) fn(c);
      }
    }

    class GeoJSONStub extends FeatureGroupStub {}

    const prevFG = (window as any).L.FeatureGroup;
    const prevGJ = (window as any).L.GeoJSON;
    (window as any).L.FeatureGroup = FeatureGroupStub;
    (window as any).L.GeoJSON = GeoJSONStub;
    try {
      const fg = new FeatureGroupStub();
      // Direct children are feature leaves (each carries a .feature envelope).
      fg._layers["1"] = { feature: { type: "Feature" } };
      fg._layers["2"] = { feature: { type: "Feature" } };
      // A folium FeatureGroup: group-like + child registry + instanceof FeatureGroup, not GeoJSON.
      Object.assign(fg, {
        options: {},
        addLayer: vi.fn(),
        removeLayer: vi.fn(),
        getLayers: vi.fn(() => Object.values(fg._layers)),
        clearLayers: vi.fn(),
        getBounds: vi.fn(),
      });
      expect(isGroupLayer(fg as unknown as L.Layer)).toBe(true);
    } finally {
      (window as any).L.FeatureGroup = prevFG;
      (window as any).L.GeoJSON = prevGJ;
    }
  });
  it("isGroupLayer: excludes a real L.GeoJSON instance", () => {
    // jsdom has no L.GeoJSON; the predicate guards the instanceof check, so
    // stub the class to exercise the GeoJSON exclusion branch.
    class GeoJSONStub {
      _layers: Record<string, unknown> = {};
      eachLayer(fn: (c: unknown) => void): void {
        for (const c of Object.values(this._layers)) fn(c);
      }
    }
    const prev = (window as any).L.GeoJSON;
    (window as any).L.GeoJSON = GeoJSONStub;
    try {
      const geo = new GeoJSONStub();
      geo._layers["1"] = { feature: { type: "Feature" } };
      expect(isGroupLayer(geo as unknown as L.Layer)).toBe(false);
    } finally {
      (window as any).L.GeoJSON = prev;
    }
  });
  it("isGroupLayer: a GeoJSON is not a group even when it is also a FeatureGroup", () => {
    // Real Leaflet: L.GeoJSON extends L.FeatureGroup, so a GeoJson layer is
    // instanceof L.GeoJSON AND instanceof L.FeatureGroup. The canonical
    // L.FeatureGroup branch must not claim a GeoJSON data layer as a group.
    class GeoJSONStub {
      _layers: Record<string, unknown> = {};
      eachLayer(fn: (c: unknown) => void): void {
        for (const c of Object.values(this._layers)) fn(c);
      }
    }
    const prevFG = (window as any).L.FeatureGroup;
    const prevGJ = (window as any).L.GeoJSON;
    (window as any).L.FeatureGroup = GeoJSONStub;
    (window as any).L.GeoJSON = GeoJSONStub;
    try {
      const geo = new GeoJSONStub();
      Object.assign(geo, {
        options: {},
        addLayer: vi.fn(),
        removeLayer: vi.fn(),
        getLayers: vi.fn(() => Object.values((geo as any)._layers)),
        clearLayers: vi.fn(),
        getBounds: vi.fn(),
      });
      geo._layers["1"] = { feature: { type: "Feature" } };
      expect(isGroupLayer(geo as unknown as L.Layer)).toBe(false);
    } finally {
      (window as any).L.FeatureGroup = prevFG;
      (window as any).L.GeoJSON = prevGJ;
    }
  });
});
describe("core/layer traverse: isGroupRow", () => {
  const makeGroup = () => {
    const c: any = {
      options: {},
      clearLayers: vi.fn(),
      getBounds: vi.fn(),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      getLayers: vi.fn(() => []),
      _layers: {},
    };
    c.eachLayer = vi.fn();
    return c;
  };
  const info = (extra: Record<string, unknown> = {}) =>
    ({ id: "L1", name: "L1", role: "overlay", ...extra }) as any;

  it("is a group row only when the entry declares no featureCountProvider", () => {
    const group = makeGroup();
    expect(isGroupRow(info(), group)).toBe(true);
    // MeasureControl and HeatmapControl register a group with a provider: the
    // count is provider-driven, so the row is data, not a sub-layer group.
    expect(isGroupRow(info({ featureCountProvider: () => 3 }), group)).toBe(false);
  });

  it("is never a group row without an entry or a layer", () => {
    const group = makeGroup();
    expect(isGroupRow(null, group)).toBe(false);
    expect(isGroupRow(undefined, group)).toBe(false);
    expect(isGroupRow(info(), null)).toBe(false);
    expect(isGroupRow(info(), undefined)).toBe(false);
  });
});
describe("core/layer traverse: countVisibleChildLayers", () => {
  const makeMap = (owned: Set<unknown>) =>
    ({
      hasLayer: (child: unknown) => owned.has(child),
    }) as unknown as L.Map;

  it("counts only children the map still owns (eachLayer path)", () => {
    const a = { options: {} };
    const b = { options: {} };
    const c = { options: {} };
    const layer = {
      options: {},
      eachLayer: (fn: (child: unknown) => void) => {
        fn(a);
        fn(b);
        fn(c);
      },
    } as unknown as L.Layer;
    const map = makeMap(new Set([a, b]));
    expect(countVisibleChildLayers(layer, map)).toBe(2);
  });

  it("falls back to the internal registry when there is no eachLayer", () => {
    const a = { options: {} };
    const b = { options: {} };
    const layer = {
      options: {},
      _layers: { "1": a, "2": b },
    } as unknown as L.Layer;
    const map = makeMap(new Set([b]));
    expect(countVisibleChildLayers(layer, map)).toBe(1);
  });

  it("returns 0 when the child enumeration throws", () => {
    const layer = {
      options: {},
      eachLayer: () => {
        throw new Error("boom");
      },
    } as unknown as L.Layer;
    const map = makeMap(new Set());
    expect(countVisibleChildLayers(layer, map)).toBe(0);
  });

  it("returns 0 when the layer has no children at all", () => {
    const layer = { options: {} } as unknown as L.Layer;
    const map = makeMap(new Set());
    expect(countVisibleChildLayers(layer, map)).toBe(0);
  });

  it("returns 0 when the map cannot answer membership", () => {
    // A stub map without hasLayer cannot say which children are on the map, so
    // the visible count is 0 rather than a throw.
    const a = { options: {} };
    const layer = {
      options: {},
      eachLayer: (fn: (child: unknown) => void) => fn(a),
    } as unknown as L.Layer;
    expect(countVisibleChildLayers(layer, {} as unknown as L.Map)).toBe(0);
  });
});

// What is worth pinning here is the other half: nothing in the split modules
// touches a private field any more.
describe("source pins", () => {
  it("layer/traverse.ts: no double assertions left", () => {
    expect(traverseSource.match(/as unknown as/g)).toBeNull();
  });
  it("layer/geometry.ts: no double assertions left", () => {
    expect(geometrySource.match(/as unknown as/g)).toBeNull();
  });
  it("layer/interaction.ts: no double assertions left", () => {
    expect(interactionSource.match(/as unknown as/g)).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  countFeatureGeometry,
  countVisibleChildLayers,
  findLayer,
  getGeometryType,
  isContainerLayer,
  isContainerRow,
  isLayerInPanes,
  paintsAtZoom,
  setInteractive,
  suspendMapInteractions,
  walkLeaf,
  walkTree,
} from "#core/layer/index.js";
import * as CONST from "#core/layer/index.js";
import utilSource from "#core/layer/util?raw";

// What is worth pinning here is the other half: nothing in
// util.ts touches a private field any more.

describe("source pins", () => {
  it("layer/util.ts: no double assertions left", () => {
    expect(utilSource.match(/as unknown as/g)).toBeNull();
  });
});

describe("core/layer util", () => {
  beforeEach(() => {
    // setup.ts does not define L.Marker — stub one so instanceof checks work.
    if (!window.L.Marker) {
      window.L.Marker = class Marker {
        feature: unknown = null;
      };
    }
    if (!window.L.CircleMarker) {
      window.L.CircleMarker = class CircleMarker {
        feature: unknown = null;
      };
    }
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

  describe("walkTree / walkLeaf", () => {
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
      walkTree(layer as never, l => visited.push(l));
      expect(visited).toEqual([layer, a, b]);
    });

    it("walkLeaf visits only leaves", () => {
      const { a, b, layer } = group();
      const visited: L.Layer[] = [];
      walkLeaf(layer as never, l => visited.push(l));
      expect(visited).toEqual([a, b]);
    });

    it("handles a plain layer with no children", () => {
      const plain = {};
      const visited: L.Layer[] = [];
      walkTree(plain as never, l => visited.push(l));
      expect(visited).toEqual([plain]);
    });

    it("walks the _layers map when eachLayer is absent", () => {
      const a = {};
      const layer = { _layers: { a } };
      const visited: L.Layer[] = [];
      walkLeaf(layer as never, l => visited.push(l));
      expect(visited).toEqual([a]);
    });

    it("walks only a node's own registry entries, not inherited ones", () => {
      // Leaflet's registries are plain objects, so a registry built on a
      // prototype would expose its keys to `for..in`. Only entries the node
      // actually owns are children of its tree.
      const own = { own: true };
      const registry = Object.assign(Object.create({ inherited: {} }), { own });
      const visited: L.Layer[] = [];
      walkLeaf({ _layers: registry } as never, l => visited.push(l));
      expect(visited).toEqual([own]);
    });

    it("recurses into nested _layers (fallback branch)", () => {
      // The fallback is distinguished only by which node ends up leaf: the
      // _layers branch recurses without calling fn, so a container that
      // carries _layers is never itself visited. Tag the real leaf and assert
      // on the tag — an empty {} is indistinguishable from a non-recursion.
      const leaf = { leaf: true };
      const outer = { _layers: { inner: { _layers: { leaf } } } };
      const visited: L.Layer[] = [];
      walkLeaf(outer as never, l => visited.push(l));
      expect(visited).toEqual([leaf]);
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
      walkTree(tail as never, l => visited.push(l));
      // traverse() stops once depth exceeds LAYER_DEPTH, so a correct limit
      // visits exactly LAYER_DEPTH + 1 nodes (depths 0..LAYER_DEPTH). An
      // absent limit visits depth + 1; one level early visits LAYER_DEPTH.
      expect(visited.length).toBe(CONST.RECURSION.LAYER_DEPTH + 1);
    });

    it("skips a null layer", () => {
      const visited: L.Layer[] = [];
      walkTree(null as never, l => visited.push(l));
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

    it("returns point for CircleMarker leaves with feature", () => {
      const cm = new window.L.CircleMarker();
      cm.feature = {};
      const group = wrap(cm);
      expect(getGeometryType(group as never)).toBe("point");
    });

    it("returns unknown for a CircleMarker without a .feature property", () => {
      // Same consumable-data contract as Marker: extractPoints gates on
      // .feature for CircleMarker too, so the icon must not promise "point"
      // for data downstream cannot consume.
      const cm = new window.L.CircleMarker();
      const group = wrap(cm);
      expect(getGeometryType(group as never)).toBe("unknown");
    });

    it("returns unknown for a Marker without a .feature property", () => {
      // The type icon reflects "structured, consumable point data" (the
      // extractPoints / Heatmap contract), not raw geometry.  A plain
      // folium.Marker() is a geometric point — countFeatureGeometry counts it
      // — but without a GeoJSON envelope it is not consumable point data, so
      // the icon stays unknown to avoid promising Heatmap/export support.
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

    it("counts Markers without feature as points", () => {
      // A plain folium.Marker() renders as L.Marker() with no .feature; it is
      // still a data point feature and must be counted.  .feature is only
      // required by extractPoints / Heatmap property lookup.
      const marker = new window.L.Marker();
      const group = wrap(marker);
      expect(countFeatureGeometry(group as never)).toBe(1);
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

  describe("plain Marker count-vs-icon divergence", () => {
    const wrap = (...leaves: L.Layer[]) => ({
      eachLayer: (fn: (l: L.Layer) => void) => leaves.forEach(fn),
    });

    // A plain folium.Marker() (no .feature) is a geometric point but not
    // "structured, consumable point data".  countFeatureGeometry and
    // getGeometryType intentionally use different contracts so the layer
    // panel shows an honest count without implying Heatmap/export support.
    it("counts it as a point but its type icon is unknown", () => {
      const marker = new window.L.Marker();
      const group = wrap(marker);
      expect(countFeatureGeometry(group as never)).toBe(1);
      expect(getGeometryType(group as never)).toBe("unknown");
    });

    it("a Marker with .feature counts as a point and its type is point", () => {
      const marker = new window.L.Marker();
      marker.feature = {};
      const group = wrap(marker);
      expect(countFeatureGeometry(group as never)).toBe(1);
      expect(getGeometryType(group as never)).toBe("point");
    });
  });

  describe("paintsAtZoom", () => {
    const makeMap = (zoom: number) =>
      ({
        getZoom: () => zoom,
        hasLayer: (layer: L.Layer) => layer !== null,
      }) as unknown as L.Map;

    it("returns false for a layer not on the map", () => {
      const map = { getZoom: () => 3, hasLayer: () => false } as unknown as L.Map;
      const layer = { options: {} } as L.Layer;
      expect(paintsAtZoom(map, layer)).toBe(false);
    });

    it("returns false when the zoom is below the layer's minZoom", () => {
      const map = makeMap(1);
      const layer = { options: { minZoom: 3, maxZoom: 4 } } as L.Layer;
      expect(paintsAtZoom(map, layer)).toBe(false);
    });

    it("returns false when the zoom is above the layer's maxZoom", () => {
      const map = makeMap(5);
      const layer = { options: { minZoom: 3, maxZoom: 4 } } as L.Layer;
      expect(paintsAtZoom(map, layer)).toBe(false);
    });

    it("returns true when the zoom is inside the layer's range", () => {
      const map = makeMap(3);
      const layer = { options: { minZoom: 3, maxZoom: 4 } } as L.Layer;
      expect(paintsAtZoom(map, layer)).toBe(true);
    });

    it("skips the range check for layers without minZoom/maxZoom", () => {
      const map = makeMap(7);
      const layer = { options: {} } as L.Layer;
      expect(paintsAtZoom(map, layer)).toBe(true);
    });

    it("checks each endpoint independently — minZoom without maxZoom", () => {
      const map = makeMap(5);
      const layer = { options: { minZoom: 3 } } as L.Layer;
      expect(paintsAtZoom(map, layer)).toBe(true);
      const low = makeMap(2);
      expect(paintsAtZoom(low, layer)).toBe(false);
    });

    it("checks each endpoint independently — maxZoom without minZoom", () => {
      const map = makeMap(2);
      const layer = { options: { maxZoom: 3 } } as L.Layer;
      expect(paintsAtZoom(map, layer)).toBe(true);
      const high = makeMap(4);
      expect(paintsAtZoom(high, layer)).toBe(false);
    });

    it("treats a null layer as not painting", () => {
      const map = makeMap(3);
      expect(paintsAtZoom(map, null)).toBe(false);
    });

    it("handles a layer with no options object (no declared range)", () => {
      const map = makeMap(7);
      const layer = {} as L.Layer;
      expect(paintsAtZoom(map, layer)).toBe(true);
    });
  });

  describe("setInteractive", () => {
    const makeLeaf = (interactive: boolean) => {
      const el = document.createElement("path");
      if (interactive) el.classList.add("leaflet-interactive");
      const leaf = {
        options: { interactive },
        _map: {} as L.Map,
        _path: el,
        _icon: undefined as HTMLElement | undefined,
        _container: undefined as HTMLElement | undefined,
        addInteractiveTarget: vi.fn(),
        removeInteractiveTarget: vi.fn(),
      };
      return { leaf, el };
    };

    it("is a no-op when already at the target value", () => {
      const { leaf, el } = makeLeaf(false);
      setInteractive(leaf as never, false);
      expect(leaf.removeInteractiveTarget).not.toHaveBeenCalled();
      expect(el.classList.contains("leaflet-interactive")).toBe(false);
    });

    it("is a no-op for a detached layer (no _map)", () => {
      const { leaf } = makeLeaf(true);
      delete (leaf as unknown as { _map?: unknown })._map;
      setInteractive(leaf as never, false);
      // The option still flips (applied on next add), but no targets touched.
      expect(leaf.options.interactive).toBe(false);
      expect(leaf.removeInteractiveTarget).not.toHaveBeenCalled();
    });

    it("disabling an SVG path removes the class and unregisters its hit target", () => {
      const { leaf, el } = makeLeaf(true);
      setInteractive(leaf as never, false);
      expect(leaf.options.interactive).toBe(false);
      expect(el.classList.contains("leaflet-interactive")).toBe(false);
      expect(leaf.removeInteractiveTarget).toHaveBeenCalledWith(el);
      expect(leaf.addInteractiveTarget).not.toHaveBeenCalled();
    });

    it("enabling an SVG path re-adds the class and re-registers its hit target", () => {
      const { leaf, el } = makeLeaf(false);
      setInteractive(leaf as never, true);
      expect(leaf.options.interactive).toBe(true);
      expect(el.classList.contains("leaflet-interactive")).toBe(true);
      expect(leaf.addInteractiveTarget).toHaveBeenCalledWith(el);
    });

    it("disabling a marker removes the class and target from its icon", () => {
      const icon = document.createElement("div");
      icon.classList.add("leaflet-interactive");
      const leaf = {
        options: { interactive: true },
        _map: {} as L.Map,
        _path: undefined,
        _icon: icon,
        _container: undefined,
        addInteractiveTarget: vi.fn(),
        removeInteractiveTarget: vi.fn(),
      };
      setInteractive(leaf as never, false);
      expect(icon.classList.contains("leaflet-interactive")).toBe(false);
      expect(leaf.removeInteractiveTarget).toHaveBeenCalledWith(icon);
    });

    it("enabling a marker delegates to its _initInteraction", () => {
      const initInteraction = vi.fn();
      const leaf = {
        options: { interactive: false },
        _map: {} as L.Map,
        _path: undefined,
        _icon: document.createElement("div"),
        _container: undefined,
        _initInteraction: initInteraction,
        addInteractiveTarget: vi.fn(),
        removeInteractiveTarget: vi.fn(),
      };
      setInteractive(leaf as never, true);
      expect(initInteraction).toHaveBeenCalledTimes(1);
      // The icon is handled by _initInteraction — not double-registered here.
      expect(leaf.addInteractiveTarget).not.toHaveBeenCalled();
    });

    it("does not throw for a layer without options", () => {
      const layer = { _map: {} as L.Map };
      expect(() => setInteractive(layer as never, false)).not.toThrow();
    });
  });

  describe("suspendMapInteractions", () => {
    /** Map whose eachLayer yields a single top-level container holding `leaf`. */
    const makeMapWithLeaf = (interactive = true) => {
      const el = document.createElement("path");
      if (interactive) el.classList.add("leaflet-interactive");
      const leaf = {
        options: { interactive },
        _path: el,
        _icon: undefined as HTMLElement | undefined,
        _container: undefined as HTMLElement | undefined,
        addInteractiveTarget: vi.fn(),
        removeInteractiveTarget: vi.fn(),
      };
      const map = {
        eachLayer: vi.fn((fn: (l: unknown) => void) =>
          fn({ eachLayer: (c: (l: unknown) => void) => c(leaf) }),
        ),
      };
      (leaf as unknown as { _map: unknown })._map = map;
      return { map, leaf, el };
    };

    it("disables interactive leaves and restores exactly those", () => {
      const { map, leaf, el } = makeMapWithLeaf();
      const restore = suspendMapInteractions(map as never);
      expect(leaf.options.interactive).toBe(false);
      expect(el.classList.contains("leaflet-interactive")).toBe(false);
      expect(leaf.removeInteractiveTarget).toHaveBeenCalledWith(el);

      restore();
      expect(leaf.options.interactive).toBe(true);
      expect(el.classList.contains("leaflet-interactive")).toBe(true);
      expect(leaf.addInteractiveTarget).toHaveBeenCalledWith(el);
    });

    it("leaves already non-interactive leaves untouched", () => {
      const { map, leaf } = makeMapWithLeaf(false);
      const restore = suspendMapInteractions(map as never);
      expect(leaf.options.interactive).toBe(false);
      expect(leaf.removeInteractiveTarget).not.toHaveBeenCalled();
      expect(() => restore()).not.toThrow();
    });

    it("walks top-level containers via map.eachLayer", () => {
      const map = { eachLayer: vi.fn() };
      suspendMapInteractions(map as never);
      expect(map.eachLayer).toHaveBeenCalledTimes(1);
    });
  });

  describe("isLayerInPanes", () => {
    const leafWithPane = (pane?: string) =>
      ({ options: { pane } }) as unknown as L.Layer;

    it("matches a leaf whose options.pane is in the list", () => {
      const match = isLayerInPanes(["overlayPane", "measure"]);
      expect(match(leafWithPane("overlayPane"))).toBe(true);
    });

    it("rejects a leaf whose options.pane is not in the list", () => {
      const match = isLayerInPanes(["overlayPane"]);
      expect(match(leafWithPane("measure"))).toBe(false);
    });

    it("rejects a leaf with no options.pane", () => {
      const match = isLayerInPanes(["overlayPane"]);
      expect(match(leafWithPane())).toBe(false);
    });

    it("rejects a leaf with no options at all", () => {
      const match = isLayerInPanes(["overlayPane"]);
      expect(match({} as unknown as L.Layer)).toBe(false);
    });

    it("matches nothing against an empty pane list", () => {
      const match = isLayerInPanes([]);
      expect(match(leafWithPane("overlayPane"))).toBe(false);
    });
  });
});

describe("core/layer util: isContainerLayer", () => {
  // A minimal container stub: group-like with a child registry + fixed list.
  const makeContainer = (children: unknown[] = []) => {
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

  it("isContainerLayer: group-like true, plain polygon false, GeoJSON shape false", () => {
    const poly: any = { options: {} };
    Object.setPrototypeOf(poly, new (window as any).L.Polygon());
    const container = makeContainer([poly]);
    const geoShape = makeContainer([
      { feature: { type: "Feature" } },
      { feature: { type: "Feature" } },
    ]);
    expect(isContainerLayer(container)).toBe(true);
    expect(isContainerLayer(poly)).toBe(false);
    // GeoJSON shape: every child carries a feature envelope.
    expect(isContainerLayer(geoShape)).toBe(false);
  });

  it("isContainerLayer: a real L.FeatureGroup (not GeoJSON) with feature-leaf children is a container", () => {
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
      expect(isContainerLayer(fg as unknown as L.Layer)).toBe(true);
    } finally {
      (window as any).L.FeatureGroup = prevFG;
      (window as any).L.GeoJSON = prevGJ;
    }
  });
  it("isContainerLayer: excludes a real L.GeoJSON instance", () => {
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
      expect(isContainerLayer(geo as unknown as L.Layer)).toBe(false);
    } finally {
      (window as any).L.GeoJSON = prev;
    }
  });
  it("isContainerLayer: a GeoJSON is not a container even when it is also a FeatureGroup", () => {
    // Real Leaflet: L.GeoJSON extends L.FeatureGroup, so a GeoJson layer is
    // instanceof L.GeoJSON AND instanceof L.FeatureGroup. The canonical
    // L.FeatureGroup branch must not claim a GeoJSON data layer as a container.
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
      expect(isContainerLayer(geo as unknown as L.Layer)).toBe(false);
    } finally {
      (window as any).L.FeatureGroup = prevFG;
      (window as any).L.GeoJSON = prevGJ;
    }
  });
});

describe("core/layer util: isContainerRow", () => {
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

  it("is a container row only when the entry declares no featureCountProvider", () => {
    const group = makeGroup();
    expect(isContainerRow(info(), group)).toBe(true);
    // MeasureControl and HeatmapControl register a group with a provider: the
    // count is provider-driven, so the row is data, not a sub-layer container.
    expect(isContainerRow(info({ featureCountProvider: () => 3 }), group)).toBe(false);
  });

  it("is never a container row without an entry or a layer", () => {
    const group = makeGroup();
    expect(isContainerRow(null, group)).toBe(false);
    expect(isContainerRow(undefined, group)).toBe(false);
    expect(isContainerRow(info(), null)).toBe(false);
    expect(isContainerRow(info(), undefined)).toBe(false);
  });
});

describe("core/layer util: countVisibleChildLayers", () => {
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
});

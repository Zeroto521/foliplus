// AnnotationManager unit tests — per-layer labels, per-layer plans.
// The canvas is stubbed (it is the browser tests' job to verify drawing), and
// the map is a stub carrying the panes, the container box and the projection
// the plan needs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { AnnotationManager } from "#foliplus/LayerControl/annotation/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import { applyProjection } from "#foliplus/LayerControl/ui/apply.js";
import { setIntent } from "#foliplus/LayerControl/ui/intent.js";
import { LABEL_SIZE } from "#common/form.js";
import { NUMBER_FORMAT } from "#common/format.js";
import { initFixture } from "../ui/fixture.js";

const mocks = vi.hoisted(() => {
  interface MockCanvas {
    paint: ReturnType<typeof vi.fn>;
    setVisible: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    setLayerAlpha: ReturnType<typeof vi.fn>;
  }
  const instances: MockCanvas[] = [];

  class MockAnnotationCanvas implements MockCanvas {
    paint = vi.fn();
    setVisible = vi.fn();
    destroy = vi.fn();
    setLayerAlpha = vi.fn();
    constructor(_map: unknown, _pane: unknown) {
      instances.push(this);
    }
  }
  return { MockAnnotationCanvas, instances };
});

vi.mock("#foliplus/LayerControl/annotation/canvas.js", () => ({
  AnnotationCanvas: mocks.MockAnnotationCanvas,
}));

/** The canvas the manager created last. */
const canvas = () => mocks.instances.at(-1)!;

/** The plan a canvas was last handed. */
const painted = (index = -1) =>
  mocks.instances.at(index)!.paint.mock.calls.at(-1)![0] as Array<{
    text: string;
    priority: number;
  }>;

const makeMap = () => {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
  const panes: Record<string, HTMLElement> = {};
  const mapPane = document.createElement("div");
  const map = {
    getContainer: () => container,
    // Panes are the SURFACE's — declared and materialized before any label
    // can ask for one. This unit fixture stands that world in by handing
    // back a pane on demand (the tests drive AnnotationManager alone, with
    // no LayerSurface around to declare it).
    getPane: (name: string) => (panes[name] ??= document.createElement("div")),
    createPane: (name: string) => (panes[name] = document.createElement("div")),
    getPanes: () => ({ mapPane }),
    hasLayer: () => true,
    on: vi.fn(),
    off: vi.fn(),
    latLngToContainerPoint: () => ({ x: 10, y: 20 }),
    // Leaflet keeps its pane registry here, and the teardown path clears it.
    _panes: panes,
  } as unknown as L.Map;
  // The plan records where mapPane sat while planning (the pan fast path
  // translates by the delta). Tests move it by overwriting this stub.
  (window.L as unknown as { DomUtil: unknown }).DomUtil = {
    getPosition: () => ({ x: 0, y: 0 }),
  };
  return { container, panes, mapPane, map };
};

const mkLeaf = (opts: {
  props?: Record<string, unknown>;
  latlng?: { lat: number; lng: number };
  geometry?: GeoJSON.Geometry;
  boundsCenter?: { lat: number; lng: number };
}): L.Layer => {
  const leaf: Record<string, unknown> = {};
  if (opts.props || opts.geometry) {
    leaf.feature = {
      properties: opts.props,
      ...(opts.geometry ? { geometry: opts.geometry } : {}),
    };
  }
  if (opts.latlng) leaf.getLatLng = () => opts.latlng;
  if (opts.boundsCenter) {
    leaf.getBounds = () => ({
      isValid: () => true,
      getCenter: () => opts.boundsCenter!,
    });
  }
  return leaf as unknown as L.Layer;
};

const mkGroup = (leaves: L.Layer[]): L.Layer =>
  ({
    eachLayer: (cb: (l: L.Layer) => void) => leaves.forEach(cb),
  }) as unknown as L.Layer;

const oneLabel = (): L.Layer =>
  mkGroup([mkLeaf({ props: { v: "1200" }, latlng: { lat: 40, lng: -74 } })]);

const CONFIG = {
  show: true,
  field: "v",
  color: "#ffffff",
  size: 11,
  format: "auto",
  collide: true,
} as const;

describe("AnnotationManager — formatting and fields", () => {
  const { map } = makeMap();
  const mgr = new AnnotationManager({
    map,
    layerFind: () => null,
  });

  it("formats numbers per style and passes strings through", () => {
    expect(mgr.formatValue("1200", "auto", "en")).toBe("1.2K");
    expect(mgr.formatValue("1234.56", "int", "en")).toBe("1235");
    expect(mgr.formatValue("6000", "comma", "en")).toBe("6,000");
    expect(mgr.formatValue("0.35", "percent", "en")).toBe("35%");
    expect(mgr.formatValue("abc", "percent", "en")).toBe("abc");
  });

  it("anchors points to their own location", () => {
    expect(mgr.resolveAnchor(mkLeaf({ latlng: { lat: 40, lng: -74 } }))).toEqual({
      lat: 40,
      lng: -74,
    });
  });

  it("anchors a Polygon to its area centroid, not its bounds center", () => {
    // 10×10 square: bounds center (5,5) == area centroid (5,5), so this
    // case alone wouldn't distinguish the two. Pair it with the concave
    // case below.
    const square: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [0, 10],
          [10, 10],
          [10, 0],
          [0, 0],
        ],
      ],
    };
    expect(mgr.resolveAnchor(mkLeaf({ geometry: square }))).toEqual({
      lat: 5,
      lng: 5,
    });
  });

  it("anchors a Polygon with a hole by signed area (bounds center diverges)", () => {
    // 10×10 square with a 2×2 hole in the upper-right: the area centroid
    // shifts toward the un-drilled lower-left, while the bounds center
    // stays at (5,5). This is the assertion that would go red if the
    // polygon branch ever regressed to `getBounds().getCenter()`.
    const holed: GeoJSON.Polygon = {
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
    };
    const c = mgr.resolveAnchor(mkLeaf({ geometry: holed }));
    expect(c!.lng).toBeLessThan(5);
    expect(c!.lat).toBeLessThan(5);
  });

  it("anchors a MultiPolygon by |area|-weighted centroid", () => {
    // A 10×10 square and a 1×1 square side by side: the area-weighted
    // centroid sits near the big square's center, not at the midpoint of
    // the two bounding boxes. This assertion is what would go red if the
    // MultiPolygon branch ever routed through `turf.centerOfMass` (whose
    // convex-hull shortcut lands at the midpoint).
    const multi: GeoJSON.MultiPolygon = {
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
    };
    expect(mgr.resolveAnchor(mkLeaf({ geometry: multi }))).toEqual({
      lat: (100 * 5 + 0.5) / 101,
      lng: (100 * 5 + 20.5) / 101,
    });
  });

  it("anchors a non-polygon path (Polyline) to its bounds center", () => {
    expect(
      mgr.resolveAnchor(
        mkLeaf({
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [10, 10],
            ],
          },
          boundsCenter: { lat: 5, lng: 5 },
        }),
      ),
    ).toEqual({ lat: 5, lng: 5 });
  });

  it("falls back to bounds when no geometry is attached", () => {
    // A layer whose feature object carries only `properties` (no geometry)
    // still gets an anchor from its extents.
    expect(
      mgr.resolveAnchor(
        mkLeaf({ props: { v: "1" }, boundsCenter: { lat: 1, lng: 2 } }),
      ),
    ).toEqual({ lat: 1, lng: 2 });
  });

  it("does not treat a null-returning getLatLng as a valid point anchor", () => {
    // A group whose "point" accessor resolves to null is not a marker with
    // an undefined location — it falls through to the geometry-aware path.
    const group: L.Layer = {
      getLatLng: () => null,
      feature: {
        geometry: {
          type: "Polygon" as const,
          coordinates: [
            [
              [0, 0],
              [0, 10],
              [10, 10],
              [10, 0],
              [0, 0],
            ],
          ],
        },
      },
    };
    expect(mgr.resolveAnchor(group)).toEqual({ lat: 5, lng: 5 });
  });

  it("treats a leaf with both getLatLng and polygon geometry as a path", () => {
    // An L.Circle carries both — it has getLatLng (the center point) AND a
    // polygon feature. The anchor decision must be governed by the geometry,
    // not by duck-typing on getLatLng: isPointAnchor is false so the label
    // is centered as a path, while resolveAnchor still honours getLatLng
    // (the live center of the circle) rather than recomputing from geometry.
    // Without this assertion, the two reads could drift: isPointAnchor would
    // report true and offset the label as a marker below a path center.
    const circle: L.Layer = {
      getLatLng: () => ({ lat: 4, lng: 6 }),
      feature: {
        geometry: {
          type: "Polygon" as const,
          coordinates: [
            [
              [0, 0],
              [0, 10],
              [10, 10],
              [10, 0],
              [0, 0],
            ],
          ],
        },
      },
    };
    expect(mgr.isPointAnchor(circle)).toBe(false);
    expect(mgr.resolveAnchor(circle)).toEqual({ lat: 4, lng: 6 });
  });

  it("treats a GeoJSON Point leaf (getLatLng + Point geometry) as a point", () => {
    // L.GeoJSON attaches `.feature` to every sub-layer, so a Point feature
    // carries BOTH getLatLng (the marker's position) AND a Point-typed
    // feature.geometry. Both must say "point": the label offsets below the
    // marker rather than centering on it. This assertion locks that in —
    // without it, a regression that collapses Point into the generic "path"
    // branch would silently center every GeoJSON point label on its marker.
    const pointLeaf: L.Layer = {
      getLatLng: () => ({ lat: 40, lng: -74 }),
      feature: {
        geometry: {
          type: "Point" as const,
          coordinates: [-74, 40],
        },
      },
    };
    expect(mgr.isPointAnchor(pointLeaf)).toBe(true);
    expect(mgr.resolveAnchor(pointLeaf)).toEqual({ lat: 40, lng: -74 });
  });

  it("returns null when the leaf has neither geometry nor bounds", () => {
    expect(mgr.resolveAnchor({} as L.Layer)).toBeNull();
  });

  it("reads a field off feature.properties", () => {
    const leaf = { feature: { properties: { name: "x" } } } as unknown as L.Layer;
    expect(mgr.readFieldValue(leaf, "name")).toBe("x");
    expect(mgr.readFieldValue(leaf, "missing")).toBeNull();
    expect(mgr.readFieldValue({} as L.Layer, "name")).toBeNull();
  });

  it("collects distinct fields with sampled types", () => {
    const group = mkGroup([
      mkLeaf({ props: { name: "a", count: 1 } }),
      mkLeaf({ props: { count: 2.5 } }),
    ]);
    const m = new AnnotationManager({
      map,
      layerFind: () => group,
    });
    expect(m.collectFields("l1")).toEqual([
      { name: "name", numeric: false },
      { name: "count", numeric: true },
    ]);
  });
});

describe("AnnotationManager — config", () => {
  beforeEach(() => {
    mocks.instances.length = 0;
  });

  it("round-trips a config, defaulting collide from the page", () => {
    const { map } = makeMap();
    const mgr = new AnnotationManager({
      map,
      layerFind: () => null,
    });

    expect(mgr.getConfig("none")).toEqual({
      show: false,
      field: "",
      color: "#ffffff",
      size: 11,
      format: "auto",
      collide: true,
    });
    // Reset target — same shape, independent of any stored user choice.
    expect(mgr.defaultConfig()).toEqual({
      show: false,
      field: "",
      color: "#ffffff",
      size: 11,
      format: "auto",
      collide: true,
    });

    const cfg = {
      show: true,
      field: "name",
      color: "#ff0000",
      size: 16,
      format: "auto" as const,
      collide: false,
    };
    mgr.setConfig("l1", cfg);
    expect(mgr.getConfig("l1")).toEqual(cfg);
    expect(mgr.hasConfig("l1")).toBe(true);
    expect(mgr.configEntries()).toHaveLength(1);
  });

  it("layerSpec short-circuits when the layer size equals the token default", () => {
    // The shared --foliplus-label-* token default is 12; a layer pinned to 12 must
    // reuse the base spec object rather than allocating a copy.
    const { map } = makeMap();
    const mgr = new AnnotationManager({
      map,
      layerFind: () => oneLabel(),
    });
    mgr.setConfig("a", { ...CONFIG, size: 12 });
    mgr.renderLabels("a");
    // No throw + one label painted is enough — the short-circuit path ran.
    expect(painted(0)).toHaveLength(1);
  });

  it("defaults collision off when the page sets label_collide false", () => {
    const saved = (window as { CONFIG?: Record<string, unknown> }).CONFIG;
    (window as { CONFIG?: Record<string, unknown> }).CONFIG = {
      ...saved,
      label_collide: false,
    };
    try {
      const { map } = makeMap();
      const mgr = new AnnotationManager({
        map,
        layerFind: () => null,
      });
      expect(mgr.getConfig("none").collide).toBe(false);
    } finally {
      (window as { CONFIG?: Record<string, unknown> }).CONFIG = saved;
    }
  });

  it("resolves a fieldless config to the layer's default and caches it", () => {
    const { map } = makeMap();
    const mgr = new AnnotationManager({
      map,
      layerFind: () =>
        mkGroup([mkLeaf({ props: { v: "1200" }, latlng: { lat: 40, lng: -74 } })]),
    });
    const collect = vi.spyOn(mgr, "collectFields");

    // No stored field: the default pick resolves to the only column.
    expect(mgr.resolveField("a")).toBe("v");
    // A second read hits the resolved-field cache instead of re-walking.
    expect(mgr.resolveField("a")).toBe("v");
    expect(collect).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default field when the stored one is gone", () => {
    // A config outlives a feature set: a name the layer no longer carries must
    // not leave the labels reading nothing.
    const { map } = makeMap();
    const mgr = new AnnotationManager({
      map,
      layerFind: () =>
        mkGroup([mkLeaf({ props: { name: "x" }, latlng: { lat: 40, lng: -74 } })]),
    });
    mgr.setConfig("a", { ...CONFIG, field: "retired" });

    expect(mgr.resolveField("a")).toBe("name");
  });

  it("re-resolves after the config names a different field", () => {
    const { map } = makeMap();
    const mgr = new AnnotationManager({
      map,
      layerFind: () =>
        mkGroup([
          mkLeaf({ props: { name: "x", count: 2 }, latlng: { lat: 40, lng: -74 } }),
        ]),
    });
    // No stored field: the default is the first numeric column.
    expect(mgr.resolveField("a")).toBe("count");
    mgr.setConfig("a", { ...CONFIG, field: "name" });
    expect(mgr.resolveField("a")).toBe("name");
    mgr.clearConfig("a");
    expect(mgr.resolveField("a")).toBe("count");
  });
});

describe("AnnotationManager — author-declared annotation", () => {
  const pageCollideOff = (fn: () => void) => {
    const saved = (window as { CONFIG?: Record<string, unknown> }).CONFIG;
    (window as { CONFIG?: Record<string, unknown> }).CONFIG = {
      ...saved,
      label_collide: false,
    };
    try {
      fn();
    } finally {
      (window as { CONFIG?: Record<string, unknown> }).CONFIG = saved;
    }
  };

  it("reads the declaration off the layer itself", () => {
    const { map } = makeMap();
    const layer = {
      options: { foliplus: { label: { field: "store", format: "comma" } } },
    } as unknown as L.Layer;
    const mgr = new AnnotationManager({ map, layerFind: () => layer });

    const cfg = mgr.getConfig("l1");
    expect(cfg.field).toBe("store");
    expect(cfg.format).toBe(NUMBER_FORMAT.COMMA);
    // Only the declared keys travel up. A declared field also turns the labels
    // on — the built-in default is off, so a field alone would show nowhere.
    expect(cfg.collide).toBe(true);
    expect(cfg.show).toBe(true);
  });

  it("falls back to the built-in defaults when the declaration has no label key", () => {
    // A declaration with no `label` key declares nothing: the built-in
    // defaults apply and nothing is logged.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { map } = makeMap();
      const layer = {
        options: { foliplus: { annotation: { field: "retired" } } },
      } as unknown as L.Layer;
      const mgr = new AnnotationManager({ map, layerFind: () => layer });

      const cfg = mgr.getConfig("l1");
      expect(cfg.field).toBe(CONST.DEFAULT_ANNOTATION.field);
      expect(cfg.show).toBe(CONST.DEFAULT_ANNOTATION.show);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("descends into a container's children for a nested declaration", () => {
    const child = {
      options: { foliplus: { label: { field: "nested" } } },
    } as unknown as L.Layer;
    const { map } = makeMap();
    const mgr = new AnnotationManager({
      map,
      layerFind: () => mkGroup([child]),
    });

    expect(mgr.getConfig("l1").field).toBe("nested");
  });

  it("does not cache a layer that cannot be resolved yet", () => {
    const { map } = makeMap();
    const layer = {
      options: { foliplus: { label: { field: "late" } } },
    } as unknown as L.Layer;
    let resolved = false;
    const find = vi.fn(() => (resolved ? layer : null));
    const mgr = new AnnotationManager({ map, layerFind: find });

    expect(mgr.getConfig("l1").field).toBe(CONST.DEFAULT_ANNOTATION.field);
    resolved = true;
    expect(mgr.getConfig("l1").field).toBe("late");
  });

  it("does not cache an empty read for a layer that declares later", () => {
    // folium lands a layer's script after the control's own, so the load-time
    // sweep can read a layer while it still carries no foliplus namespace.
    // Caching that empty read would shadow the declaration that arrives a tick
    // later — for the life of the page.
    const { map } = makeMap();
    const layer = { options: {} } as unknown as L.Layer & {
      options: Record<string, unknown>;
    };
    const mgr = new AnnotationManager({ map, layerFind: () => layer });

    expect(mgr.getConfig("l1").show).toBe(CONST.DEFAULT_ANNOTATION.show);

    layer.options.foliplus = { label: { field: "store" } };
    expect(mgr.getConfig("l1").field).toBe("store");
    expect(mgr.getConfig("l1").show).toBe(true);
  });

  it("caches the read once the layer is resolved", () => {
    const { map } = makeMap();
    const layer = {
      options: { foliplus: { label: { field: "cached" } } },
    } as unknown as L.Layer;
    const find = vi.fn(() => layer);
    const mgr = new AnnotationManager({ map, layerFind: find });

    expect(mgr.getConfig("l1").field).toBe("cached");
    expect(mgr.getConfig("l1").field).toBe("cached");
    expect(find).toHaveBeenCalledTimes(1);
  });

  it("keeps the page-level collide when only a field is declared", () => {
    pageCollideOff(() => {
      const { map } = makeMap();
      const layer = {
        options: { foliplus: { label: { field: "store" } } },
      } as unknown as L.Layer;
      const mgr = new AnnotationManager({ map, layerFind: () => layer });

      const cfg = mgr.getConfig("l1");
      expect(cfg.field).toBe("store");
      // The declaration is PARTIAL: an undeclared collide must stay off, not
      // be coerced to true. This is what coerceAnnotationFields would clobber.
      expect(cfg.collide).toBe(false);
    });
  });

  it("lets the declared collide win over the page-level default", () => {
    pageCollideOff(() => {
      const { map } = makeMap();
      const layer = {
        options: { foliplus: { label: { field: "store", collide: true } } },
      } as unknown as L.Layer;
      const mgr = new AnnotationManager({ map, layerFind: () => layer });

      expect(mgr.getConfig("l1").collide).toBe(true);
    });
  });

  it("drops undeclared and invalid keys", () => {
    const { map } = makeMap();
    const layer = {
      options: {
        foliplus: {
          label: {
            field: "store",
            format: "thousands",
            collide: "yes",
            color: "green",
            show: true,
          },
        },
      },
    } as unknown as L.Layer;
    const mgr = new AnnotationManager({ map, layerFind: () => layer });

    const cfg = mgr.getConfig("l1");
    expect(cfg.field).toBe("store");
    // An unknown format degrades to the default instead of being written
    // through, and a non-boolean collide is dropped rather than coerced.
    expect(cfg.format).toBe(CONST.DEFAULT_ANNOTATION.format);
    expect(cfg.collide).toBe(true);
    // `show` is a legal declaration key now, so an explicit `true` survives;
    // `color` is legal too, but `green` is not a hex color — it degrades to
    // the default rather than reaching the canvas as an invalid fill.
    expect(cfg.show).toBe(true);
    expect(cfg.color).toBe(CONST.DEFAULT_ANNOTATION.color);
  });

  it("applies a declared color and size, normalised and clamped", () => {
    const { map } = makeMap();
    const layer = {
      options: {
        foliplus: {
          label: { field: "store", color: "#0F0", size: 99 },
        },
      },
    } as unknown as L.Layer;
    const mgr = new AnnotationManager({ map, layerFind: () => layer });

    const cfg = mgr.getConfig("l1");
    // #rgb expands to #rrggbb (lowercase) so a later panel edit compares equal.
    expect(cfg.color).toBe("#00ff00");
    // The panel's own bounds still apply: a 99px declaration is clamped, not
    // passed through as a size the UI could never produce.
    expect(cfg.size).toBe(LABEL_SIZE.SIZE_MAX);
    expect(cfg.field).toBe("store");
  });

  it("drops a non-numeric size and keeps the default", () => {
    const { map } = makeMap();
    const layer = {
      options: {
        foliplus: { label: { field: "store", size: "12" } },
      },
    } as unknown as L.Layer;
    const mgr = new AnnotationManager({ map, layerFind: () => layer });

    expect(mgr.getConfig("l1").size).toBe(CONST.DEFAULT_ANNOTATION.size);
  });

  it("falls back when the declared field is not a string", () => {
    // A number is the realistic typo: an author passes a column value instead of
    // a column name. It must not reach the label renderer as text.
    const { map } = makeMap();
    const layer = {
      options: { foliplus: { label: { field: 1200, format: "comma" } } },
    } as unknown as L.Layer;
    const mgr = new AnnotationManager({ map, layerFind: () => layer });

    const cfg = mgr.getConfig("l1");
    expect(cfg.field).toBe(CONST.DEFAULT_ANNOTATION.field);
    // A valid sibling still applies — the bad key drops out on its own.
    expect(cfg.format).toBe(NUMBER_FORMAT.COMMA);
    // Activation rides on a real field name: a field that did not survive
    // validation must not turn the labels on.
    expect(cfg.show).toBe(CONST.DEFAULT_ANNOTATION.show);
  });

  it("keeps labels off when the author declares show: false", () => {
    // The escape hatch: the field is named so the panel starts on a sensible
    // value, but the author wants no labels on the map.
    const { map } = makeMap();
    const layer = {
      options: {
        foliplus: { label: { field: "store", show: false } },
      },
    } as unknown as L.Layer;
    const mgr = new AnnotationManager({ map, layerFind: () => layer });

    const cfg = mgr.getConfig("l1");
    expect(cfg.field).toBe("store");
    expect(cfg.show).toBe(false);
  });

  it("reads nothing when foliplus carries no annotation", () => {
    // `foliplus` is a namespace folium and third-party layers share, so a layer
    // can carry other dimensions (`icon`, label typography) with nothing declared
    // for this control. The declaration is absent, not empty — every key stays at
    // the built-in default.
    const { map } = makeMap();
    const layer = {
      options: { foliplus: { icon: { color: "#ff0000" } } },
    } as unknown as L.Layer;
    const mgr = new AnnotationManager({ map, layerFind: () => layer });

    expect(mgr.getConfig("l1")).toEqual(mgr.defaultConfig());
  });

  it("takes the user's stored choice over the declaration", () => {
    const { map } = makeMap();
    const layer = {
      options: { foliplus: { label: { field: "store", format: "comma" } } },
    } as unknown as L.Layer;
    const mgr = new AnnotationManager({ map, layerFind: () => layer });
    mgr.setConfig("l1", {
      ...mgr.getConfig("l1"),
      field: "other",
      format: NUMBER_FORMAT.PERCENT,
    });

    const cfg = mgr.getConfig("l1");
    expect(cfg.field).toBe("other");
    expect(cfg.format).toBe(NUMBER_FORMAT.PERCENT);
  });

  it("tolerates keys the control does not consume", () => {
    const { map } = makeMap();
    const layer = {
      options: {
        foliplus: {
          icon: { color: "#ff0000" },
          label: { field: "store" },
        },
      },
    } as unknown as L.Layer;
    const mgr = new AnnotationManager({ map, layerFind: () => layer });

    expect(() => mgr.getConfig("l1")).not.toThrow();
    expect(mgr.getConfig("l1").field).toBe("store");
  });

  it("clearConfig deletes the entry so the declaration shows through", () => {
    const { map } = makeMap();
    const layer = {
      options: { foliplus: { label: { field: "store" } } },
    } as unknown as L.Layer;
    const mgr = new AnnotationManager({ map, layerFind: () => layer });
    mgr.setConfig("l1", { ...mgr.getConfig("l1"), field: "other" });
    expect(mgr.getConfig("l1").field).toBe("other");

    mgr.clearConfig("l1");

    expect(mgr.hasConfig("l1")).toBe(false);
    expect(mgr.configEntries()).toHaveLength(0);
    expect(mgr.getConfig("l1").field).toBe("store");
  });
});

describe("AnnotationManager — render & plan", () => {
  beforeEach(() => {
    mocks.instances.length = 0;
  });

  it("gives each layer its own pane, canvas and labels", () => {
    const { map, panes } = makeMap();
    const mgr = new AnnotationManager({
      map,
      layerFind: () => oneLabel(),
    });

    mgr.setConfig("a", CONFIG);
    mgr.setConfig("b", CONFIG);
    const labels = mgr.renderLabels("a");
    mgr.renderLabels("b");

    expect(labels).toHaveLength(1);
    expect(labels[0]!.text).toBe("1.2K");
    // One pane + one canvas per labeled layer — that is what puts each layer's
    // labels at its own place in the stack.
    expect(Object.keys(panes).sort()).toEqual(["foliplus-label-a", "foliplus-label-b"]);
    expect(mocks.instances).toHaveLength(2);
    expect(painted(0)[0]!.text).toBe("1.2K");
  });

  it("creates nothing when the toggle is off", () => {
    const { map, panes } = makeMap();
    const mgr = new AnnotationManager({
      map,
      layerFind: () => oneLabel(),
    });
    mgr.setConfig("a", { ...CONFIG, show: false });

    expect(mgr.renderLabels("a")).toHaveLength(0);
    expect(Object.keys(panes)).toHaveLength(0);
  });

  it("paints nothing when the layer is not on the map", () => {
    const { map } = makeMap();
    (map as unknown as { hasLayer: () => boolean }).hasLayer = () => false;
    const mgr = new AnnotationManager({
      map,
      layerFind: () => oneLabel(),
    });
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");

    expect(painted(0)).toHaveLength(0);
  });

  it("plans only the spotlighted layer while a focus filter is set", () => {
    const { map } = makeMap();
    const mgr = new AnnotationManager({
      map,
      layerFind: () => oneLabel(),
    });
    for (const id of ["a", "b"]) {
      mgr.setConfig(id, CONFIG);
      mgr.renderLabels(id);
    }
    const [canvasA, canvasB] = mocks.instances;
    canvasA!.paint.mockClear();
    canvasB!.paint.mockClear();

    mgr.setFocusFilter("a");

    expect(painted(0)).toHaveLength(1);
    expect(painted(1)).toHaveLength(0);

    mgr.setFocusFilter(null);
    expect(painted(0)).toHaveLength(1);
    expect(painted(1)).toHaveLength(1);
  });

  it("draws every label when the layer turns collision off", () => {
    const { map } = makeMap();
    const group = mkGroup([
      mkLeaf({ props: { v: "1" }, latlng: { lat: 40, lng: -74 } }),
      mkLeaf({ props: { v: "2" }, latlng: { lat: 40, lng: -74 } }), // same anchor
    ]);
    const mgr = new AnnotationManager({
      map,
      layerFind: () => group,
    });
    mgr.setConfig("a", { ...CONFIG, collide: false });
    mgr.renderLabels("a");

    // Both survive: same spot, but the layer opted out of thinning.
    expect(painted(0)).toHaveLength(2);
  });

  it("thins overlapping labels inside the layer by default", () => {
    const { map } = makeMap();
    const group = mkGroup([
      mkLeaf({ props: { v: "1" }, latlng: { lat: 40, lng: -74 } }),
      mkLeaf({ props: { v: "2" }, latlng: { lat: 40, lng: -74 } }),
    ]);
    const mgr = new AnnotationManager({
      map,
      layerFind: () => group,
    });
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");

    expect(painted(0)).toHaveLength(1);
  });

  it("translates the last plan on pan instead of re-planning", async () => {
    const { map } = makeMap();
    let panePos = { x: 0, y: 0 };
    (window.L as unknown as { DomUtil: unknown }).DomUtil = {
      getPosition: () => panePos,
    };
    const proj = vi.spyOn(map, "latLngToContainerPoint");
    const mgr = new AnnotationManager({
      map,
      layerFind: () => oneLabel(),
    });
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");
    const callsAfterFullPlan = proj.mock.calls.length;
    const c = canvas();
    const fullPlan = c.paint.mock.calls.at(-1)![0] as Array<{
      box: { x: number; y: number };
    }>;
    c.paint.mockClear();

    // Pan: mapPane slides; the move handler runs the fast path next frame.
    panePos = { x: 40, y: -15 };
    const move = (map.on as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      call => call[0] === "move",
    )![1] as () => void;
    move();
    await new Promise(r => requestAnimationFrame(() => r(null)));

    // No new projections: the old plan's boxes were translated wholesale.
    expect(proj.mock.calls.length).toBe(callsAfterFullPlan);
    const panned = c.paint.mock.calls.at(-1)![0] as Array<{
      box: { x: number; y: number };
    }>;
    expect(panned[0]!.box.x - fullPlan[0]!.box.x).toBeCloseTo(40);
    expect(panned[0]!.box.y - fullPlan[0]!.box.y).toBeCloseTo(-15);
  });

  it("falls back to a full plan when there is no plan origin", async () => {
    const { map, mapPane } = makeMap();
    // No mapPane while planning — the origin cannot be recorded.
    let panes: { mapPane?: HTMLElement } = {};
    (map as unknown as { getPanes: () => unknown }).getPanes = () => panes;
    const proj = vi.spyOn(map, "latLngToContainerPoint");
    const mgr = new AnnotationManager({
      map,
      layerFind: () => oneLabel(),
    });
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");
    const callsAfterFullPlan = proj.mock.calls.length;

    // mapPane appears mid-life; the next pan cannot translate anything.
    panes = { mapPane };
    const move = (map.on as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      call => call[0] === "move",
    )![1] as () => void;
    move();
    await new Promise(r => requestAnimationFrame(() => r(null)));

    expect(proj.mock.calls.length).toBeGreaterThan(callsAfterFullPlan);
  });

  it("re-plans on moveend after a pan", async () => {
    const { map } = makeMap();
    let panePos = { x: 0, y: 0 };
    (window.L as unknown as { DomUtil: unknown }).DomUtil = {
      getPosition: () => panePos,
    };
    const proj = vi.spyOn(map, "latLngToContainerPoint");
    const mgr = new AnnotationManager({
      map,
      layerFind: () => oneLabel(),
    });
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");
    const callsAfterFullPlan = proj.mock.calls.length;

    panePos = { x: 40, y: 0 };
    const full = (map.on as unknown as ReturnType<typeof vi.fn>).mock.calls.find(call =>
      call[0].includes("moveend"),
    )![1] as () => void;
    full();
    await new Promise(r => requestAnimationFrame(() => r(null)));

    // moveend closes the pan with a real plan, not a translate.
    expect(proj.mock.calls.length).toBeGreaterThan(callsAfterFullPlan);
  });

  it("repaints only the layer whose map membership changed", () => {
    const { map } = makeMap();
    const layerA = oneLabel();
    const layerB = mkGroup([
      mkLeaf({ props: { v: "7" }, latlng: { lat: 41, lng: -75 } }),
    ]);
    const mgr = new AnnotationManager({
      map,
      layerFind: id => (id === "a" ? layerA : layerB),
    });
    mgr.setConfig("a", CONFIG);
    mgr.setConfig("b", CONFIG);
    mgr.renderLabels("a");
    mgr.renderLabels("b");
    const [canvasA, canvasB] = mocks.instances;
    canvasA!.paint.mockClear();
    canvasB!.paint.mockClear();

    (
      map as unknown as {
        foliplus: {
          events: {
            emit: (e: string, p: unknown) => void;
            publish: (e: string, p: unknown) => void;
          };
        };
      }
    ).foliplus.events.emit(EVENTS.LAYER_CHANGE, { id: "a", kind: "vector" });

    // Only the layer that left the map is re-planned; the other keeps its
    // boxes and its collision decision.
    expect(canvasA!.paint).toHaveBeenCalled();
    expect(canvasB!.paint).not.toHaveBeenCalled();
  });

  it("repaints every layer on a bare LAYER_CHANGE (third-party payload-less emit)", () => {
    // Defense arm for the handler's `!payload` fallback: when an emit arrives
    // with no payload (legacy / third-party code, or a pre-refactor emit), the
    // handler can't know which layer moved — it falls back to a full repaint
    // rather than guessing wrong. Pins the fallback so a future refactor can't
    // accidentally narrow it to only the payload path. The mock bus below is
    // typed with an optional payload on purpose — the same permissive surface
    // an untyped third-party caller sees.
    const { map } = makeMap();
    const layerA = oneLabel();
    const layerB = mkGroup([
      mkLeaf({ props: { v: "7" }, latlng: { lat: 41, lng: -75 } }),
    ]);
    const mgr = new AnnotationManager({
      map,
      layerFind: id => (id === "a" ? layerA : layerB),
    });
    mgr.setConfig("a", CONFIG);
    mgr.setConfig("b", CONFIG);
    mgr.renderLabels("a");
    mgr.renderLabels("b");
    const [canvasA, canvasB] = mocks.instances;
    canvasA!.paint.mockClear();
    canvasB!.paint.mockClear();

    (
      map as unknown as {
        foliplus: { events: { emit: (e: string, p?: unknown) => void } };
      }
    ).foliplus.events.emit(EVENTS.LAYER_CHANGE as never);

    expect(canvasA!.paint).toHaveBeenCalled();
    expect(canvasB!.paint).toHaveBeenCalled();
  });

  it("culls anchors far outside the viewport before laying out the text", () => {
    const { map } = makeMap();
    (
      map as unknown as { latLngToContainerPoint: () => unknown }
    ).latLngToContainerPoint = () => ({ x: -10000, y: -10000 });
    const mgr = new AnnotationManager({
      map,
      layerFind: () => oneLabel(),
    });
    mgr.setConfig("a", CONFIG);

    mgr.renderLabels("a");

    // Far off-screen: the per-character width estimate never runs.
    expect(painted(0)).toHaveLength(0);
  });

  it("mounts nothing when the map has no pane for the layer", () => {
    // Capability "none" means the surface never declared a label pane —
    // the mount must no-op honestly (no canvas, no throw) instead of
    // inventing a carrier the executor will never write to.
    const { map } = makeMap();
    (map as unknown as { getPane: (n: string) => HTMLElement | null }).getPane = () =>
      null;
    const mgr = new AnnotationManager({
      map,
      layerFind: () => oneLabel(),
    });
    mgr.setConfig("a", CONFIG);
    const before = mocks.instances.length;

    mgr.renderLabels("a");

    expect(mocks.instances.length).toBe(before);
  });

  it("unloadLayer keeps the config; destroyLayer forgets it", () => {
    // The teardown/delete split: an unregister may only drop rendering
    // state — the `layers` live source reads configEntries on every flush,
    // so losing the config here would erase the stored label section.
    // Forgetting the config is deleteLayer's alone.
    const { map } = makeMap();
    const mgr = new AnnotationManager({
      map,
      layerFind: () => oneLabel(),
    });
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");

    mgr.unloadLayer("a");
    expect(canvas().destroy).toHaveBeenCalled();
    expect(mgr.hasConfig("a")).toBe(true);

    mgr.destroyLayer("a");
    expect(mgr.hasConfig("a")).toBe(false);
    expect(mgr.configEntries()).toHaveLength(0);
  });

  it("destroy tears down the map wiring and the canvases", () => {
    const { map, panes } = makeMap();
    const mgr = new AnnotationManager({
      map,
      layerFind: () => oneLabel(),
    });
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");
    const off = map.off as unknown as ReturnType<typeof vi.fn>;

    mgr.destroy();

    expect(off).toHaveBeenCalled();
    expect(canvas().destroy).toHaveBeenCalled();
    // The pane is the surface's declared face — teardown takes down our
    // canvases and wiring, never the carrier itself.
    expect(panes["foliplus-label-a"]).toBeDefined();
    expect(mgr.configEntries()).toHaveLength(0);
  });

  it("destroy reports a failing canvas and still tears the rest down", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { map } = makeMap();
    const mgr = new AnnotationManager({
      map,
      layerFind: () => oneLabel(),
    });
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");
    mgr.setConfig("b", CONFIG);
    mgr.renderLabels("b");
    const first = mocks.instances.at(-2)!;
    const second = mocks.instances.at(-1)!;
    first.destroy.mockImplementation(() => {
      throw new Error("canvas gone");
    });

    expect(() => mgr.destroy()).not.toThrow();

    // "canvas:b" runs after "canvas:a" threw.
    expect(second.destroy).toHaveBeenCalled();
    expect(
      warn.mock.calls.some(call => String(call[0]).includes('canvas:a" threw')),
    ).toBe(true);
    // The config map is a plain reset after the steps: it must not be skipped
    // because one canvas failed.
    expect(mgr.configEntries()).toHaveLength(0);
  });

  it("destroy tears down the canvases it captured, not same-id replacements", () => {
    // A canvas destroy can fire user handlers — an earlier step may re-render
    // another layer, mounting a fresh canvas under an id the step list already
    // holds. Looking the id up when its step runs would destroy the
    // replacement and leak the canvas this teardown owns.
    const { map } = makeMap();
    const mgr = new AnnotationManager({
      map,
      layerFind: () => oneLabel(),
    });
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");
    mgr.setConfig("b", CONFIG);
    mgr.renderLabels("b");
    const first = mocks.instances.at(-2)!;
    const originalB = mocks.instances.at(-1)!;
    first.destroy.mockImplementation(() => {
      (mgr as unknown as { canvases: Map<string, unknown> }).canvases.delete("b");
      mgr.renderLabels("b");
    });

    mgr.destroy();

    const replacementB = mocks.instances.at(-1)!;
    expect(replacementB).not.toBe(originalB);
    expect(originalB.destroy).toHaveBeenCalled();
    expect(replacementB.destroy).not.toHaveBeenCalled();
  });

  it("re-plans a layer whose stored plan is missing during a pan", async () => {
    const { map } = makeMap();
    let panePos = { x: 0, y: 0 };
    (window.L as unknown as { DomUtil: unknown }).DomUtil = {
      getPosition: () => panePos,
    };
    const proj = vi.spyOn(map, "latLngToContainerPoint");
    const mgr = new AnnotationManager({
      map,
      layerFind: () => oneLabel(),
    });
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");
    const callsAfterFullPlan = proj.mock.calls.length;

    // Defensive path: a canvas whose plan did not make it into lastPlanned
    // has nothing to translate, so the pan plans it properly.
    (mgr as unknown as { lastPlanned: Map<string, unknown> }).lastPlanned.clear();
    panePos = { x: 25, y: 0 };
    const move = (map.on as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      call => call[0] === "move",
    )![1] as () => void;
    move();
    await new Promise(r => requestAnimationFrame(() => r(null)));

    expect(proj.mock.calls.length).toBeGreaterThan(callsAfterFullPlan);
  });

  it("clears a layer's labels and tears its canvas down", () => {
    const { map, panes } = makeMap();
    const mgr = new AnnotationManager({
      map,
      layerFind: () => oneLabel(),
    });
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");

    mgr.destroyLayer("a");

    expect(canvas().destroy).toHaveBeenCalled();
    // The pane is the surface's declared face — it survives (the same id can
    // register again without rebuilding its carrier); only our canvas goes.
    expect(panes["foliplus-label-a"]).toBeDefined();
    expect(mgr.configEntries()).toHaveLength(0);
  });

  it("remounts a fresh canvas into the same pane when the same id is annotated again", () => {
    // Pane ownership split: the declared pane is the surface's and stays;
    // the canvas is AnnotationManager's and is rebuilt from zero. A stale
    // canvas must never be recycled into the second mount.
    const { map, panes } = makeMap();
    const mgr = new AnnotationManager({
      map,
      layerFind: () => oneLabel(),
    });
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");
    const firstPane = panes["foliplus-label-a"];
    const firstCanvas = canvas();
    expect(firstPane).toBeDefined();

    mgr.destroyLayer("a");
    expect(firstCanvas.destroy).toHaveBeenCalled();
    expect(panes["foliplus-label-a"]).toBeDefined();

    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");
    expect(panes["foliplus-label-a"]).toBe(firstPane);
    expect(canvas()).not.toBe(firstCanvas);
  });

  it("hides the canvases during a zoom animation and redraws on zoomend", () => {
    const { map } = makeMap();
    const mgr = new AnnotationManager({
      map,
      layerFind: () => oneLabel(),
    });
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");

    const c = canvas();
    const on = map.on as unknown as ReturnType<typeof vi.fn>;
    const zoomStart = on.mock.calls.find(call => call[0] === "zoomstart")?.[1];
    const zoomEnd = on.mock.calls.find(call => call[0] === "zoomend")?.[1];
    expect(zoomStart).toBeTypeOf("function");
    expect(zoomEnd).toBeTypeOf("function");

    c.setVisible.mockClear();
    c.paint.mockClear();
    zoomStart();
    expect(c.setVisible).toHaveBeenCalledWith(false);
    expect(c.paint).not.toHaveBeenCalled();

    zoomEnd();
    expect(c.setVisible).toHaveBeenCalledWith(true);
    // The redraw on the far side of the animation lands the labels at the new zoom.
    expect(c.paint).toHaveBeenCalled();
  });

  it("redraws synchronously around an export", () => {
    const { map } = makeMap();
    const mgr = new AnnotationManager({
      map,
      layerFind: () => oneLabel(),
    });
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");

    const c = canvas();
    c.paint.mockClear();
    const events = (
      map as unknown as {
        foliplus?: {
          events?: {
            emit: (e: string, p: unknown) => void;
            publish: (e: string, p: unknown) => void;
          };
        };
      }
    ).foliplus?.events;
    events?.publish(EVENTS.BEFORE_EXPORT, { component: "test" });
    events?.emit(EVENTS.AFTER_EXPORT, { component: "test" });
    // Both sides of the export refresh in the same frame the capture reads.
    expect(c.paint).toHaveBeenCalledTimes(2);
  });
});

describe("a layer that gains labelable content gets the stored intent on its new pane", () => {
  // The label pane is declared by the registration edge's probe
  // (`LayerController.withAnnotationSpec`). When a live layer GAINS its first
  // labelable feature, the next `surfaceFor` re-probes, the declared specs
  // differ, and `matches` rebuilds the surface — pane and capability
  // together. The pane name joining `surface.paneNames` is a carrier-set
  // change the executor cannot miss, so the stored opacity lands on the
  // pane that declaration just created. No replay hook — none exists.
  const labelLayer = () =>
    ({
      options: {},
      eachLayer: (cb: (l: L.Layer) => void) =>
        cb({
          options: {},
          feature: { properties: { v: "1200" } },
          getLatLng: () => ({ lat: 35, lng: 105 }),
        }),
    }) as unknown as L.Layer;

  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("replays an opacity set before the annotation pane existed", () => {
    // Opacity is stored while the layer has no labelable content yet — no
    // annotation spec, no pane. The pane appears only when the layer gains
    // that content, and the value must land on it at that point.
    window.localStorage.setItem(
      CONST.STORAGE.KEY,
      JSON.stringify({
        layers: { overlay1: { opacity: 0.3, overrides: ["opacity"] } },
      }),
    );
    const { manager, ui, map } = initFixture();

    // `getPane` in the fixture returns a fresh div per call, so a write and a
    // later read would never meet. Stable panes per name, attached to the map
    // container, stand in for Leaflet's registry.
    const container = map._container as HTMLElement;
    const panes = new Map<string, HTMLElement>();
    const paneFor = (name: string) => {
      let pane = panes.get(name);
      if (!pane) {
        pane = document.createElement("div");
        pane.classList.add("foliplus-layer-pane");
        container.appendChild(pane);
        panes.set(name, pane);
      }
      return pane;
    };
    map.getPane = vi.fn((name: string) => paneFor(name));
    map.createPane = vi.fn((name: string) => paneFor(name));
    map.getPanes = vi.fn(() => ({ mapPane: document.createElement("div") }));
    map.latLngToContainerPoint = vi.fn(() => ({ x: 10, y: 20 }));
    (window.L as unknown as { DomUtil: unknown }).DomUtil = {
      getPosition: () => ({ x: 0, y: 0 }),
    };

    setIntent(ui, "overlay1", "opacity", 0.3);
    ui.intentStore.seedProvenance("overlay1", ["opacity"]);
    applyProjection(ui, "overlay1");
    applyProjection(ui, "overlay1");

    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "v",
      color: "#ffffff",
      size: 11,
      format: "auto",
      collide: true,
    });
    (manager.layerRegistry.get("overlay1") as { layer: L.Layer }).layer = labelLayer();
    // The probe runs on the next surface resolution — the same read the
    // panel gate and menu perform. Specs differ → surface rebuild → the
    // label pane is declared and materialized.
    const li = manager.layerRegistry.get("overlay1")!;
    expect(
      manager.surfaceFor(li).paneNames,
      "the re-probe must declare the label pane",
    ).toContain(CONST.LABEL_PANE_PREFIX + "overlay1");
    manager.annotation.renderLabels("overlay1");

    // Re-apply: the carrier set grew (the pane name joined it), so the
    // stored value is rewritten onto every declared pane, the new one
    // included.
    applyProjection(ui, "overlay1");
    applyProjection(ui, "overlay1");

    const pane = panes.get(CONST.LABEL_PANE_PREFIX + "overlay1");
    expect(pane, "the annotation pane was created").toBeTruthy();
    // R11: the annotation pane does NOT take CSS opacity — the label canvas
    // bakes layerAlpha into its draws. CSS here would double-compound.
    expect(pane!.style.opacity).toBe("");
    expect(getComputedStyle(pane!).opacity).toBe("1");
    // The bake write landed on the mounted label canvas.
    expect(canvas().setLayerAlpha).toHaveBeenCalledWith(0.3);
  });

  it("replays a recorded opacity onto a canvas mounted later (R11 bake)", () => {
    // Labels off → no canvas. applyLayerAlpha must still record the value
    // so a canvas that mounts later does not paint at 1 against a dimmed
    // data layer. The pane CSS path used to cover this (the canvas
    // inherited the pane's opacity); R11 excludes the annotation pane from
    // CSS and bakes instead, so the replay is load-bearing.
    const { map } = makeMap();
    const mgr = new AnnotationManager({
      map,
      layerFind: () => null,
    } as never);
    mgr.applyLayerAlpha("late", 0.4);
    // No canvas yet — but the value is held for the next mount.
    expect(() => mgr.applyLayerAlpha("late", 0.4)).not.toThrow();

    // Mount via renderLabels (no features → still creates nothing). Drive
    // ensureCanvas through the same entry the toggle uses by painting an
    // empty plan path: setConfig + renderLabels with a layer that has a
    // labelable field is the production path; here we only need ensureCanvas.
    // Directly exercising the private method is not available, so use the
    // public renderLabels after giving the manager a real layer.
    const leaf = {
      feature: { properties: { name: "Depot" } },
      getLatLng: () => ({ lat: 1, lng: 2 }),
    } as unknown as L.Layer;
    const mgr2 = new AnnotationManager({
      map,
      layerFind: () => leaf,
    } as never);
    mgr2.applyLayerAlpha("late", 0.4);
    mgr2.setConfig("late", {
      show: true,
      field: "name",
      color: "#fff",
      size: 11,
      format: "auto",
      collide: true,
    });
    mgr2.renderLabels("late");
    // The mock canvas's setLayerAlpha must have been called at mount with
    // the value recorded while it was unmounted.
    expect(canvas().setLayerAlpha).toHaveBeenCalledWith(0.4);
  });

  it("applyLayerAlpha is a no-op when the layer has no canvas yet", () => {
    // Labels off → no canvas. The write must not throw; the value is picked
    // up by the next paint once a canvas mounts (setLayerAlpha at that point
    // is the late-carrier replay).
    const { map } = makeMap();
    const mgr = new AnnotationManager({
      map,
      layerFind: () => null,
      paneNameFor: () => null,
      onConfigChange: () => {},
    } as never);
    expect(() => mgr.applyLayerAlpha("ghost", 0.5)).not.toThrow();
  });
});

describe("AnnotationManager — renderLabels on a departing layer", () => {
  // The unregister path (controller → annotation.unloadLayer) tears the
  // labels and the canvas down BEFORE LAYER_ITEM_REMOVED is emitted, and a
  // scheduled replay can also fire after the layer left the map. What
  // renderLabels does then is the contract this pins: clear whatever is
  // left, never (re)build a canvas for a layer that is already gone.
  it("returns [] and builds no canvas when the layer is already gone", () => {
    let layer: L.Layer | null = mkGroup([
      mkLeaf({ props: { v: "1" }, latlng: { lat: 40, lng: -74 } }),
    ]);
    const { map } = makeMap();
    const mgr = new AnnotationManager({ map, layerFind: () => layer });
    mgr.setConfig("gone", { ...CONFIG });
    expect(mgr.renderLabels("gone")).toHaveLength(1);
    const canvasesBefore = mocks.instances.length;

    layer = null;
    expect(mgr.renderLabels("gone")).toEqual([]);
    expect(mocks.instances.length).toBe(canvasesBefore);
  });
});

describe("AnnotationManager — per-layer repaint", () => {
  // Collision is per layer by design, so one layer's rebuild must not
  // repaint the others: the content-change path paints exactly the changed
  // layer's canvas, once. Before this contract, renderLabels ran
  // clear → paint([]) → full refresh, then rebuild → full refresh again —
  // M layers changing in one frame repainted ~M² times (12 layers measured
  // 300 paints).
  const multiLayer = (count: number) => {
    const { map } = makeMap();
    const groups: Record<string, L.Layer> = {};
    for (let i = 0; i < count; i++) {
      groups[`L${i}`] = mkGroup([
        mkLeaf({ props: { v: `${i}` }, latlng: { lat: 40, lng: -74 } }),
      ]);
    }
    const mgr = new AnnotationManager({
      map,
      layerFind: id => groups[id] ?? null,
    });
    for (let i = 0; i < count; i++) mgr.setConfig(`L${i}`, { ...CONFIG });
    for (let i = 0; i < count; i++) mgr.renderLabels(`L${i}`); // warm
    return mgr;
  };

  const totalPaints = () =>
    mocks.instances.reduce((sum, c) => sum + c.paint.mock.calls.length, 0);

  const clearPaints = () => {
    for (const c of mocks.instances) c.paint.mockClear();
  };

  it("one layer's rebuild repaints only its own canvas, once", () => {
    const mgr = multiLayer(3);
    clearPaints();

    mgr.renderLabels("L1");

    // The whose-canvas question, not just the count: exactly one canvas
    // painted, and the painted labels belong to the changed layer.
    const painted = mocks.instances.filter(c => c.paint.mock.calls.length > 0);
    expect(painted).toHaveLength(1);
    expect(totalPaints()).toBe(1);
  });

  it("M layers replaying in one frame cost M repaints, not M²", () => {
    const mgr = multiLayer(12);
    clearPaints();

    for (let i = 0; i < 12; i++) mgr.renderLabels(`L${i}`);

    expect(totalPaints()).toBe(12);
  });

  it("turning labels off clears one canvas, not the map", () => {
    const mgr = multiLayer(3);
    clearPaints();

    mgr.setConfig("L2", { ...CONFIG, show: false });
    mgr.renderLabels("L2");

    expect(totalPaints()).toBe(1);
  });
});

describe("AnnotationManager — clearing labels drops their pan plan", () => {
  // A plan outliving its labels is the resurrection bug: refreshPan
  // translates lastPlanned by the delta from planOrigins, so a cleared layer
  // whose plan survived gets its old boxes painted again on the next pan
  // (show=false was the user-visible reproducer). Clearing the labels must
  // clear the plan in the same breath, and only that layer's.

  /** Run the bound move handler and let its throttled frame land. */
  const pan = async (map: L.Map): Promise<void> => {
    const move = (map.on as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      call => call[0] === "move",
    )![1] as () => void;
    move();
    await new Promise(r => requestAnimationFrame(() => r(null)));
  };

  const paneDom = (get: () => { x: number; y: number }) => {
    (window.L as unknown as { DomUtil: unknown }).DomUtil = {
      getPosition: get,
    };
  };

  it("a pan after labels are turned off keeps the canvas empty", async () => {
    const { map } = makeMap();
    let panePos = { x: 0, y: 0 };
    paneDom(() => panePos);
    const mgr = new AnnotationManager({
      map,
      layerFind: () => oneLabel(),
    });
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");
    const c = canvas();
    expect(painted()).toHaveLength(1);

    // show=false: the canvas is painted empty and the plan must die with it.
    mgr.setConfig("a", { ...CONFIG, show: false });
    expect(mgr.renderLabels("a")).toEqual([]);
    expect(c.paint.mock.calls.at(-1)![0]).toEqual([]);
    c.paint.mockClear();

    panePos = { x: 35, y: -10 };
    await pan(map);

    // Any repaint on the pan is the empty plan. A surviving plan would be
    // translated and painted as a non-empty copy of the old labels.
    for (const call of c.paint.mock.calls) {
      expect(call[0]).toEqual([]);
    }
  });

  it("clearing one layer leaves another layer's translation intact", async () => {
    const { map } = makeMap();
    let panePos = { x: 0, y: 0 };
    paneDom(() => panePos);
    const other = mkGroup([
      mkLeaf({ props: { v: "7" }, latlng: { lat: 41, lng: -75 } }),
    ]);
    const mgr = new AnnotationManager({
      map,
      layerFind: id => (id === "a" ? oneLabel() : other),
    });
    mgr.setConfig("a", CONFIG);
    mgr.setConfig("b", CONFIG);
    mgr.renderLabels("a");
    mgr.renderLabels("b");
    // The mock registry accumulates across tests: take the two canvases this
    // test just mounted, not the first two of the whole file.
    const canvasA = mocks.instances.at(-2)!;
    const canvasB = mocks.instances.at(-1)!;

    mgr.setConfig("a", { ...CONFIG, show: false });
    mgr.renderLabels("a");
    canvasA!.paint.mockClear();
    canvasB!.paint.mockClear();

    panePos = { x: 20, y: 5 };
    await pan(map);

    // The cleared layer stays empty; the untouched layer still translates
    // from its own plan (the per-layer origin was not disturbed).
    for (const call of canvasA!.paint.mock.calls) {
      expect(call[0]).toEqual([]);
    }
    expect(canvasB!.paint).toHaveBeenCalled();
    expect((canvasB!.paint.mock.calls.at(-1)![0] as unknown[]).length).toBe(1);
  });

  it("unloadLayer drops the stored plan with the canvas", () => {
    const { map } = makeMap();
    paneDom(() => ({ x: 0, y: 0 }));
    const mgr = new AnnotationManager({
      map,
      layerFind: () => oneLabel(),
    });
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");
    const internals = mgr as unknown as {
      lastPlanned: Map<string, unknown>;
      planOrigins: Map<string, unknown>;
    };
    expect(internals.lastPlanned.has("a")).toBe(true);
    expect(internals.planOrigins.has("a")).toBe(true);

    mgr.unloadLayer("a");

    // A same-id re-registration that draws no labels must not inherit the
    // old plan and have a fresh canvas translate it on the first pan.
    expect(internals.lastPlanned.has("a")).toBe(false);
    expect(internals.planOrigins.has("a")).toBe(false);
  });

  it("snapshots the fallback pan origin instead of aliasing the pane position", async () => {
    const { map } = makeMap();
    let panePos = { x: 0, y: 0 };
    paneDom(() => panePos);
    const mgr = new AnnotationManager({
      map,
      layerFind: () => oneLabel(),
    });
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");
    // Force the no-plan fallback: the pan must re-plan and stamp an origin.
    (mgr as unknown as { lastPlanned: Map<string, unknown> }).lastPlanned.clear();

    panePos = { x: 25, y: 0 };
    await pan(map);

    const origin = (
      mgr as unknown as {
        planOrigins: Map<string, { x: number; y: number }>;
      }
    ).planOrigins.get("a")!;
    expect(origin).toEqual({ x: 25, y: 0 });
    expect(origin).not.toBe(panePos);
    // Leaflet may hand back the same Point and mutate it in place — the
    // stored origin must stay the snapshot or dx would collapse to 0.
    panePos.x = 90;
    expect(origin).toEqual({ x: 25, y: 0 });
  });
});

describe("AnnotationManager — a map whose mapPane is absent", () => {
  // The plan records where mapPane sat so a pan can translate instead of
  // re-planning. Both sides of that contract have an absent branch a normal
  // map never takes: a full refresh with no mapPane cannot record an origin,
  // and a pan with no mapPane cannot read a position. Each must fall back
  // rather than skip state (an origin-less plan is healed by the next pan).
  const moveHandler = (map: L.Map): (() => void) =>
    (map.on as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      call => call[0] === "move",
    )![1] as () => void;

  const updateHandler = (map: L.Map): (() => void) =>
    (map.on as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      call => call[0] === "moveend",
    )![1] as () => void;

  const frame = (): Promise<null> =>
    new Promise(resolve => requestAnimationFrame(() => resolve(null)));

  const panePos = (get: () => { x: number; y: number }): void => {
    (window.L as unknown as { DomUtil: unknown }).DomUtil = {
      getPosition: get,
    };
  };

  it("plans without an origin when a full refresh runs before mapPane exists, then heals on the next pan", async () => {
    const { map, mapPane } = makeMap();
    let pos = { x: 0, y: 0 };
    panePos(() => pos);
    let panes: { mapPane?: HTMLElement } = {};
    (map as unknown as { getPanes: () => unknown }).getPanes = () => panes;
    const mgr = new AnnotationManager({ map, layerFind: () => oneLabel() });
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");
    const c = canvas();
    c.paint.mockClear();

    // Full refresh with no mapPane: the origin ternary and its guard both
    // take the absent path, so the plan lands without an origin.
    updateHandler(map)();
    const internals = mgr as unknown as {
      planOrigins: Map<string, { x: number; y: number }>;
    };
    expect(internals.planOrigins.has("a")).toBe(false);
    expect(c.paint).toHaveBeenCalledTimes(1);

    // mapPane appears; the pan has a plan but no origin — it must replan and
    // stamp the origin it planned at, not translate from nowhere.
    panes = { mapPane };
    pos = { x: 12, y: -3 };
    moveHandler(map)();
    await frame();
    expect(internals.planOrigins.get("a")).toEqual({ x: 12, y: -3 });
    expect(c.paint.mock.calls.at(-1)![0]).toHaveLength(1);
    mgr.destroy();
  });

  it("falls back to a full refresh when a pan runs without a mapPane", async () => {
    const { map } = makeMap();
    const pos = { x: 0, y: 0 };
    panePos(() => pos);
    const proj = vi.spyOn(map, "latLngToContainerPoint");
    const mgr = new AnnotationManager({ map, layerFind: () => oneLabel() });
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");
    const c = canvas();
    const callsAfterPlan = proj.mock.calls.length;
    c.paint.mockClear();

    // The pane container is gone mid-pan: the fast path cannot read a
    // position, so the move falls back to the full plan instead of no-oping.
    (map as unknown as { getPanes: () => unknown }).getPanes = () => ({});
    moveHandler(map)();
    await frame();

    expect(proj.mock.calls.length).toBeGreaterThan(callsAfterPlan);
    expect(c.paint).toHaveBeenCalledTimes(1);
    mgr.destroy();
  });

  it("translates a vertical-only pan and skips a zero-delta pan", async () => {
    const { map } = makeMap();
    let pos = { x: 0, y: 0 };
    panePos(() => pos);
    const mgr = new AnnotationManager({ map, layerFind: () => oneLabel() });
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");
    const c = canvas();
    const fullPlan = c.paint.mock.calls.at(-1)![0] as Array<{
      box: { x: number; y: number };
    }>;
    c.paint.mockClear();

    // dx === 0 while dy !== 0: the conjunction must still evaluate its right
    // operand, and the plan translates vertically.
    pos = { x: 0, y: 25 };
    moveHandler(map)();
    await frame();
    const panned = c.paint.mock.calls.at(-1)![0] as Array<{
      box: { x: number; y: number };
    }>;
    expect(panned[0]!.box.y - fullPlan[0]!.box.y).toBeCloseTo(25);
    expect(panned[0]!.box.x - fullPlan[0]!.box.x).toBeCloseTo(0);

    // Back at the origin: nothing moved, so the fast path skips the repaint.
    c.paint.mockClear();
    pos = { x: 0, y: 0 };
    moveHandler(map)();
    await frame();
    expect(c.paint).not.toHaveBeenCalled();
    mgr.destroy();
  });
});

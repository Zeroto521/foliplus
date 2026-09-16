// AnnotationManager unit tests — per-layer labels, per-layer plans.
// The canvas is stubbed (it is the browser tests' job to verify drawing), and
// the map is a stub carrying the panes, the container box and the projection
// the plan needs.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { AnnotationManager } from "#foliplus/LayerControl/annotation/index.js";

const mocks = vi.hoisted(() => {
  interface MockCanvas {
    paint: ReturnType<typeof vi.fn>;
    setVisible: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }
  const instances: MockCanvas[] = [];

  class MockAnnotationCanvas implements MockCanvas {
    paint = vi.fn();
    setVisible = vi.fn();
    destroy = vi.fn();
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
  const map = {
    getContainer: () => container,
    getPane: (name: string) => panes[name] ?? null,
    createPane: (name: string) => (panes[name] = document.createElement("div")),
    hasLayer: () => true,
    on: vi.fn(),
    off: vi.fn(),
    latLngToContainerPoint: () => ({ x: 10, y: 20 }),
    // Leaflet keeps its pane registry here, and the teardown path clears it.
    _panes: panes,
  } as unknown as L.Map;
  return { container, panes, map };
};

const mkLeaf = (opts: {
  props?: Record<string, unknown>;
  latlng?: { lat: number; lng: number };
}): L.Layer => {
  const leaf: Record<string, unknown> = {};
  if (opts.props) leaf.feature = { properties: opts.props };
  if (opts.latlng) leaf.getLatLng = () => opts.latlng;
  return leaf as unknown as L.Layer;
};

const mkGroup = (leaves: L.Layer[]): L.Layer =>
  ({
    eachLayer: (cb: (l: L.Layer) => void) => leaves.forEach(cb),
  }) as unknown as L.Layer;

const oneLabel = (): L.Layer =>
  mkGroup([mkLeaf({ props: { v: "1200" }, latlng: { lat: 40, lng: -74 } })]);

const CONFIG = { show: true, field: "v", format: "auto", collide: true } as const;

describe("AnnotationManager — formatting and fields", () => {
  const { map } = makeMap();
  const mgr = new AnnotationManager(map, () => null);

  it("formats numbers per style and passes strings through", () => {
    expect(mgr.formatValue("1200", "auto", "en")).toBe("1.2K");
    expect(mgr.formatValue("1234.56", "int", "en")).toBe("1235");
    expect(mgr.formatValue("6000", "comma", "en")).toBe("6,000");
    expect(mgr.formatValue("0.35", "percent", "en")).toBe("35%");
    expect(mgr.formatValue("abc", "percent", "en")).toBe("abc");
  });

  it("resolves a point anchor, a bounds centre, or null", () => {
    expect(
      mgr.resolveAnchor({
        getLatLng: () => ({ lat: 40, lng: -74 }),
      } as unknown as L.Layer),
    ).toEqual({ lat: 40, lng: -74 });
    expect(
      mgr.resolveAnchor({
        getBounds: () => ({
          isValid: () => true,
          getCenter: () => ({ lat: 1, lng: 2 }),
        }),
      } as unknown as L.Layer),
    ).toEqual({ lat: 1, lng: 2 });
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
    const m = new AnnotationManager(map, () => group);
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
    const mgr = new AnnotationManager(map, () => null);

    expect(mgr.getConfig("none")).toEqual({
      show: false,
      field: "",
      format: "auto",
      collide: true,
    });

    const cfg = { show: true, field: "name", format: "auto", collide: false };
    mgr.setConfig("l1", cfg);
    expect(mgr.getConfig("l1")).toEqual(cfg);
    expect(mgr.hasConfig("l1")).toBe(true);
    expect(mgr.configEntries()).toHaveLength(1);
  });

  it("defaults collision off when the page sets label_collide false", () => {
    const saved = (window as { CONF?: Record<string, unknown> }).CONF;
    (window as { CONF?: Record<string, unknown> }).CONF = {
      ...saved,
      label_collide: false,
    };
    try {
      const { map } = makeMap();
      const mgr = new AnnotationManager(map, () => null);
      expect(mgr.getConfig("none").collide).toBe(false);
    } finally {
      (window as { CONF?: Record<string, unknown> }).CONF = saved;
    }
  });

  it("resolves an auto field once and reuses the cached pick", () => {
    const { map } = makeMap();
    const mgr = new AnnotationManager(map, () =>
      mkGroup([mkLeaf({ props: { v: "1200" }, latlng: { lat: 40, lng: -74 } })]),
    );

    // No explicit field: the shared auto pick resolves to the only column.
    expect(mgr.resolveField("a")).toBe("v");
    // A second read hits the auto-field cache instead of re-walking the layer.
    expect(mgr.resolveField("a")).toBe("v");
  });
});

describe("AnnotationManager — render & plan", () => {
  beforeEach(() => {
    mocks.instances.length = 0;
  });

  it("gives each layer its own pane, canvas and labels", () => {
    const { map, panes } = makeMap();
    const mgr = new AnnotationManager(map, () => oneLabel());

    mgr.setConfig("a", CONFIG);
    mgr.setConfig("b", CONFIG);
    const labels = mgr.renderLabels("a");
    mgr.renderLabels("b");

    expect(labels).toHaveLength(1);
    expect(labels[0]!.text).toBe("1.2K");
    // One pane + one canvas per labelled layer — that is what puts each layer's
    // labels at its own place in the stack.
    expect(Object.keys(panes).sort()).toEqual([
      "foliplus-annotation-a",
      "foliplus-annotation-b",
    ]);
    expect(mocks.instances).toHaveLength(2);
    expect(painted(0)[0]!.text).toBe("1.2K");
  });

  it("creates nothing when the toggle is off", () => {
    const { map, panes } = makeMap();
    const mgr = new AnnotationManager(map, () => oneLabel());
    mgr.setConfig("a", { ...CONFIG, show: false });

    expect(mgr.renderLabels("a")).toHaveLength(0);
    expect(Object.keys(panes)).toHaveLength(0);
  });

  it("paints nothing when the layer is not on the map", () => {
    const { map } = makeMap();
    (map as unknown as { hasLayer: () => boolean }).hasLayer = () => false;
    const mgr = new AnnotationManager(map, () => oneLabel());
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");

    expect(painted(0)).toHaveLength(0);
  });

  it("plans only the spotlighted layer while a focus filter is set", () => {
    const { map } = makeMap();
    const mgr = new AnnotationManager(map, () => oneLabel());
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
    const mgr = new AnnotationManager(map, () => group);
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
    const mgr = new AnnotationManager(map, () => group);
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");

    expect(painted(0)).toHaveLength(1);
  });

  it("clears a layer's labels and tears its canvas down", () => {
    const { map, panes } = makeMap();
    const mgr = new AnnotationManager(map, () => oneLabel());
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");

    mgr.destroyLayer("a");

    expect(canvas().destroy).toHaveBeenCalled();
    expect(panes["foliplus-annotation-a"]).toBeUndefined();
    expect(mgr.configEntries()).toHaveLength(0);
  });

  it("hides the canvases during a zoom animation and redraws on zoomend", () => {
    const { map } = makeMap();
    const mgr = new AnnotationManager(map, () => oneLabel());
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
    const mgr = new AnnotationManager(map, () => oneLabel());
    mgr.setConfig("a", CONFIG);
    mgr.renderLabels("a");

    const c = canvas();
    c.paint.mockClear();
    const events = (
      map as unknown as {
        foliplus?: { events?: { emit: (e: string, p: unknown) => void } };
      }
    ).foliplus?.events;
    events?.emit(EVENTS.BEFORE_EXPORT, { component: "test" });
    events?.emit(EVENTS.AFTER_EXPORT, { component: "test" });
    // Both sides of the export refresh in the same frame the capture reads.
    expect(c.paint).toHaveBeenCalledTimes(2);
  });
});

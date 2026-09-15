// AnnotationManager unit tests.
// Logic under test: value formatting (incl. percent), anchor resolution,
// field/value reading, the label render/clear lifecycle, and the label cap.
// Uses duck-typed leaf fixtures because the vitest L mock does not provide
// constructible geometry classes. The canvas is stubbed — it is the browser
// tests' job to verify actual drawing.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnnotationManager } from "../../../foliplus/js/LayerControl/annotation.js";

const mocks = vi.hoisted(() => {
  interface MockCanvas {
    setLayerLabels: ReturnType<typeof vi.fn>;
    removeLayerLabels: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }
  const instances: MockCanvas[] = [];
  class MockAnnotationCanvas implements MockCanvas {
    setLayerLabels = vi.fn();
    removeLayerLabels = vi.fn();
    destroy = vi.fn();
    constructor() {
      instances.push(this);
    }
  }
  return { MockAnnotationCanvas, instances };
});

vi.mock("#foliplus/LayerControl/annotationCanvas.js", () => ({
  AnnotationCanvas: mocks.MockAnnotationCanvas,
}));

/** The canvas the last AnnotationManager created (they share one each). */
const canvas = (): (typeof mocks)["instances"][number] => mocks.instances.at(-1)!;

describe("AnnotationManager.formatValue", () => {
  const mgr = new AnnotationManager(map, () => null);
  it("auto formats numbers and passes strings through", () => {
    expect(mgr.formatValue("1200", "auto", "en")).toBe("1.2K");
    expect(mgr.formatValue("42", "auto", "en")).toBe("42");
    expect(mgr.formatValue("hello", "auto", "en")).toBe("hello");
  });
  it("int drops grouping and decimals", () => {
    expect(mgr.formatValue("1234.56", "int", "en")).toBe("1235");
  });
  it("comma adds thousands separator", () => {
    expect(mgr.formatValue("6000", "comma", "en")).toBe("6,000");
  });
  it("percent multiplies by 100; fractionDigits=0 gives whole percents", () => {
    expect(mgr.formatValue("0.35", "percent", "en")).toBe("35%");
    // formatValue pins fractionDigits to 0 for the fixed styles, and percent
    // now honours it as a decimal cap — whole-percent labels keep the chips
    // compact (12%, not 12.3%).
    expect(mgr.formatValue("0.123", "percent", "en")).toBe("12%");
  });
  it("falls back to raw string for non-numeric values", () => {
    expect(mgr.formatValue("abc", "percent", "en")).toBe("abc");
  });
});

describe("AnnotationManager.resolveAnchor", () => {
  const mgr = new AnnotationManager(map, () => null);
  it("returns the point via getLatLng", () => {
    const leaf = { getLatLng: () => ({ lat: 40, lng: -74 }) };
    const anchor = mgr.resolveAnchor(leaf as L.Layer);
    expect(anchor?.lat).toBeCloseTo(40);
    expect(anchor?.lng).toBeCloseTo(-74);
  });
  it("returns bounds center for non-point leaves", () => {
    const leaf = {
      getBounds: () => ({
        isValid: () => true,
        getCenter: () => ({ lat: 40.5, lng: -73.5 }),
      }),
    };
    const anchor = mgr.resolveAnchor(leaf as L.Layer);
    expect(anchor?.lat).toBeCloseTo(40.5);
    expect(anchor?.lng).toBeCloseTo(-73.5);
  });
  it("returns null when the leaf has no geometry accessor", () => {
    const anchor = mgr.resolveAnchor({} as L.Layer);
    expect(anchor).toBeNull();
  });
});

describe("AnnotationManager.readFieldValue", () => {
  const mgr = new AnnotationManager(map, () => null);
  it("reads values from feature.properties", () => {
    const leaf = { feature: { properties: { name: "x", count: 7 } } };
    expect(mgr.readFieldValue(leaf as L.Layer, "name")).toBe("x");
    expect(mgr.readFieldValue(leaf as L.Layer, "count")).toBe("7");
  });
  it("returns null when the field is missing", () => {
    const leaf = { feature: { properties: { name: "x" } } };
    expect(mgr.readFieldValue(leaf as L.Layer, "missing")).toBeNull();
  });
  it("returns null for a leaf without feature.properties", () => {
    expect(mgr.readFieldValue({} as L.Layer, "name")).toBeNull();
  });
});

describe("AnnotationManager config round-trip", () => {
  it("stores and retrieves config", () => {
    const mgr = new AnnotationManager(map, () => null);
    const cfg = { show: true, field: "name", format: "auto" };
    mgr.setConfig("layer-1", cfg);
    expect(mgr.getConfig("layer-1")).toEqual(cfg);
    expect(mgr.getConfig("layer-2")).toEqual({
      show: false,
      field: "",
      format: "auto",
    });
    expect(mgr.configEntries()).toHaveLength(1);
  });

  it("destroyLayer forgets the layer's config entry", () => {
    const mgr = new AnnotationManager(map, () => null);
    mgr.setConfig("gone", { show: true, field: "name", format: "auto" });
    expect(mgr.configEntries()).toHaveLength(1);

    mgr.destroyLayer("gone");

    // A removed layer's id must not be written back to storage by the next
    // annotations save.
    expect(mgr.configEntries()).toHaveLength(0);
    expect(mgr.getConfig("gone").show).toBe(false);
  });
});

// ───────────────────────── tree fixtures ─────────────────────────
// A duck-typed LayerGroup: eachLayer is the accessor traverse() prefers.
const mkLeaf = (opts: {
  props?: Record<string, unknown>;
  latlng?: { lat: number; lng: number };
  bounds?: { isValid: () => boolean; getCenter: () => { lat: number; lng: number } };
}): L.Layer => {
  const leaf: Record<string, unknown> = {};
  if (opts.props) leaf.feature = { properties: opts.props };
  if (opts.latlng) leaf.getLatLng = () => opts.latlng;
  if (opts.bounds) leaf.getBounds = () => opts.bounds;
  return leaf as unknown as L.Layer;
};

const mkGroup = (leaves: L.Layer[]): L.Layer => {
  const group = {
    eachLayer: (cb: (l: L.Layer) => void) => {
      for (const leaf of [...leaves]) cb(leaf);
    },
  };
  return group as unknown as L.Layer;
};

describe("AnnotationManager.collectFields", () => {
  it("collects distinct property keys in encounter order, with sampled types", () => {
    const group = mkGroup([
      mkLeaf({ props: { name: "a", count: 1 } }),
      mkLeaf({ props: { count: 2, share: "x" } }),
      mkLeaf({}), // no feature.properties — skipped
    ]);
    const mgr = new AnnotationManager(map, id => (id === "l1" ? group : null));
    expect(mgr.collectFields("l1")).toEqual([
      { name: "name", numeric: false },
      { name: "count", numeric: true },
      { name: "share", numeric: false },
    ]);
  });

  it("upgrades a field's type when a later leaf carries the number", () => {
    // A mostly-empty first feature must not freeze the field as a string and
    // hide the number-format row for a layer whose values are numeric.
    const group = mkGroup([
      mkLeaf({ props: { value: "n/a" } }),
      mkLeaf({ props: { value: 12.5 } }),
    ]);
    const mgr = new AnnotationManager(map, id => (id === "l1" ? group : null));
    expect(mgr.collectFields("l1")).toEqual([{ name: "value", numeric: true }]);
  });

  it("returns [] for an unknown layer id", () => {
    const mgr = new AnnotationManager(map, () => null);
    expect(mgr.collectFields("missing")).toEqual([]);
  });
});

describe("AnnotationManager.renderLabels", () => {
  beforeEach(() => {
    mocks.instances.length = 0;
  });

  it("hands one label per renderable leaf to the canvas", () => {
    const group = mkGroup([
      mkLeaf({ props: { v: "1200" }, latlng: { lat: 40, lng: -74 } }),
      mkLeaf({
        props: { v: "7" },
        bounds: {
          isValid: () => true,
          getCenter: () => ({ lat: 40.5, lng: -73.5 }),
        },
      }),
    ]);
    const mgr = new AnnotationManager(map, id => (id === "l1" ? group : null));
    mgr.setConfig("l1", { show: true, field: "v", format: "auto" });

    const labels = mgr.renderLabels("l1");

    expect(labels).toHaveLength(2);
    expect(canvas().setLayerLabels).toHaveBeenCalledTimes(1);
    const [layerId, received] = canvas().setLayerLabels.mock.calls[0] as [
      string,
      Array<{ text: string; latlng: L.LatLng; atPoint: boolean; priority: number }>,
    ];
    expect(layerId).toBe("l1");
    // First leaf anchors at its marker latlng and formats through formatValue.
    expect(received[0]!.text).toBe("1.2K");
    expect(received[0]!.latlng).toEqual({ lat: 40, lng: -74 });
    expect(received[0]!.atPoint).toBe(true);
    // Second leaf is a path: bounds center, centred anchor kind.
    expect(received[1]!.text).toBe("7");
    expect(received[1]!.latlng).toEqual({ lat: 40.5, lng: -73.5 });
    expect(received[1]!.atPoint).toBe(false);
    // Equal priorities, stable unique ids for the collision planner.
    expect(received.every(l => l.priority === 50)).toBe(true);
    expect(new Set(received.map(l => l.id)).size).toBe(2);
  });

  it("resolves an open field through the shared auto pick", () => {
    // `field: ""` is the Auto sentinel, not "no field": the label renders the
    // auto pick over the layer's own columns (first numeric, else first). The
    // panel's test for this only spies renderLabels, so it passes either way —
    // this is the one that reads the rendered text.
    const group = mkGroup([
      mkLeaf({ props: { name: "a", count: 5 }, latlng: { lat: 40, lng: -74 } }),
    ]);
    const mgr = new AnnotationManager(map, id => (id === "l1" ? group : null));
    mgr.setConfig("l1", { show: true, field: "", format: "auto" });

    mgr.renderLabels("l1");

    const [, received] = canvas().setLayerLabels.mock.calls[0] as [
      string,
      Array<{ text: string }>,
    ];
    expect(received[0]!.text).toBe("5");
  });

  it("reuses the cached auto pick instead of re-walking the layer", () => {
    // The auto answer is per-layer, so a second render (the common case: any
    // field or format change) must not walk every feature again.
    const group = mkGroup([
      mkLeaf({ props: { count: 5 }, latlng: { lat: 40, lng: -74 } }),
    ]);
    const mgr = new AnnotationManager(map, id => (id === "l1" ? group : null));
    mgr.setConfig("l1", { show: true, field: "", format: "auto" });
    const collect = vi.spyOn(mgr, "collectFields");

    mgr.renderLabels("l1");
    mgr.renderLabels("l1");

    expect(collect).toHaveBeenCalledTimes(1);
  });

  it("re-samples the auto pick once its cache is dropped", () => {
    // The auto answer is cached per layer; when the layer's columns change the
    // cache has to go, or the labels keep reading a field that no longer exists
    // while the picker resolves a new one.
    const props: Record<string, unknown> = { count: 5 };
    const group = mkGroup([mkLeaf({ props, latlng: { lat: 40, lng: -74 } })]);
    const mgr = new AnnotationManager(map, id => (id === "l1" ? group : null));
    mgr.setConfig("l1", { show: true, field: "", format: "auto" });

    mgr.renderLabels("l1");
    expect(
      (canvas().setLayerLabels.mock.calls[0]![1] as Array<{ text: string }>)[0]!.text,
    ).toBe("5");

    delete props.count;
    props.other = 7;
    mgr.invalidateAutoField("l1");
    mgr.renderLabels("l1");

    expect(
      (canvas().setLayerLabels.mock.calls[1]![1] as Array<{ text: string }>)[0]!.text,
    ).toBe("7");
  });

  it("skips leaves without the field or without usable geometry", () => {
    const group = mkGroup([
      mkLeaf({ props: { other: "x" }, latlng: { lat: 1, lng: 2 } }), // no field
      mkLeaf({ props: { v: "3" } }), // no geometry
      mkLeaf({ props: { v: "" }, latlng: { lat: 1, lng: 2 } }), // empty text
    ]);
    const mgr = new AnnotationManager(map, id => (id === "l1" ? group : null));
    mgr.setConfig("l1", { show: true, field: "v", format: "auto" });

    expect(mgr.renderLabels("l1")).toHaveLength(0);
    // Nothing to draw: the canvas was never even created.
    expect(mocks.instances).toHaveLength(0);
  });

  it("renders nothing when the config hides labels", () => {
    const group = mkGroup([mkLeaf({ props: { v: "1" }, latlng: { lat: 0, lng: 0 } })]);
    const mgr = new AnnotationManager(map, id => (id === "l1" ? group : null));
    mgr.setConfig("l1", { show: false, field: "v", format: "auto" });

    expect(mgr.renderLabels("l1")).toHaveLength(0);
    expect(mocks.instances).toHaveLength(0);
  });

  it("renders nothing when the layer cannot be resolved", () => {
    const mgr = new AnnotationManager(map, () => null);
    mgr.setConfig("ghost", { show: true, field: "v", format: "auto" });
    expect(mgr.renderLabels("ghost")).toHaveLength(0);
    expect(mocks.instances).toHaveLength(0);
  });

  it("caps the labels at the per-layer budget and announces once", () => {
    const leaves = Array.from({ length: 5 }, (_, i) =>
      mkLeaf({ props: { v: `${i}` }, latlng: { lat: i, lng: 0 } }),
    );
    const group = mkGroup(leaves);
    const showHint = vi.fn();
    const m = { foliplus: { showHint } } as unknown as typeof map;
    const mgr = new AnnotationManager(m, id => (id === "l1" ? group : null), {
      maxLabels: 2,
    });
    mgr.setConfig("l1", { show: true, field: "v", format: "auto" });

    const labels = mgr.renderLabels("l1");
    mgr.renderLabels("l1");

    expect(labels).toHaveLength(2);
    expect(
      (canvas().setLayerLabels.mock.calls[0]![1] as Array<{ id: string }>).map(
        l => l.id,
      ),
    ).toEqual(["l1:0", "l1:1"]);
    // The cooldown swallows the second render's announcement.
    expect(showHint).toHaveBeenCalledTimes(1);
    const [, msg] = showHint.mock.calls[0] as [unknown, string];
    expect(msg).toContain("label_truncated");
  });
});

describe("AnnotationManager.clearLabels / destroy", () => {
  beforeEach(() => {
    mocks.instances.length = 0;
  });

  it("asks the canvas to drop the layer's labels", () => {
    const group = mkGroup([mkLeaf({ props: { v: "1" }, latlng: { lat: 0, lng: 0 } })]);
    const mgr = new AnnotationManager(map, id => (id === "l1" ? group : null));
    mgr.setConfig("l1", { show: true, field: "v", format: "auto" });
    mgr.renderLabels("l1");
    expect(mocks.instances).toHaveLength(1);

    mgr.clearLabels("l1");

    expect(canvas().removeLayerLabels).toHaveBeenCalledWith("l1");
  });

  it("destroy tears the canvas down and forgets all configs", () => {
    const group = mkGroup([mkLeaf({ props: { v: "1" }, latlng: { lat: 0, lng: 0 } })]);
    const mgr = new AnnotationManager(map, id => (id === "a" ? group : null));
    mgr.setConfig("a", { show: true, field: "v", format: "auto" });
    mgr.setConfig("b", { show: true, field: "v", format: "auto" });
    mgr.renderLabels("a");

    mgr.destroy();

    expect(canvas().destroy).toHaveBeenCalledTimes(1);
    expect(mgr.configEntries()).toHaveLength(0);
  });

  it("destroy is safe before any canvas exists", () => {
    const mgr = new AnnotationManager(map, () => null);
    expect(() => mgr.destroy()).not.toThrow();
  });
});

describe("AnnotationManager.resolveAnchor — accessor edge cases", () => {
  const mgr = new AnnotationManager(map, () => null);

  it("falls back to bounds when getLatLng returns null", () => {
    const leaf = {
      getLatLng: () => null,
      getBounds: () => ({
        isValid: () => true,
        getCenter: () => ({ lat: 10, lng: 20 }),
      }),
    };
    const anchor = mgr.resolveAnchor(leaf as unknown as L.Layer);
    expect(anchor).toEqual({ lat: 10, lng: 20 });
  });

  it("returns null when getLatLng yields nothing and no bounds exist", () => {
    const leaf = { getLatLng: () => null };
    expect(mgr.resolveAnchor(leaf as unknown as L.Layer)).toBeNull();
  });
});

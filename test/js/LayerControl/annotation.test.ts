// AnnotationManager unit tests.
// Logic under test: value formatting (incl. percent), anchor resolution,
// field/value reading, and the label render/clear lifecycle. Uses duck-typed
// leaf fixtures because the vitest L mock does not provide constructible
// geometry classes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnnotationManager } from "../../../foliplus/js/LayerControl/annotation.js";

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
// A duck-typed LayerGroup: eachLayer is the accessor traverse() prefers, and
// add/removeLayer mirror the container calls renderLabels/clearLabels make.
const mkLeaf = (opts: {
  props?: Record<string, unknown>;
  latlng?: { lat: number; lng: number };
  bounds?: { isValid: () => boolean; getCenter: () => { lat: number; lng: number } };
  isLabel?: boolean;
}): L.Layer => {
  const leaf: Record<string, unknown> = {};
  if (opts.props) leaf.feature = { properties: opts.props };
  if (opts.latlng) leaf.getLatLng = () => opts.latlng;
  if (opts.bounds) leaf.getBounds = () => opts.bounds;
  if (opts.isLabel) leaf.isLabel = true;
  return leaf as unknown as L.Layer;
};

const mkGroup = (leaves: L.Layer[]): L.Layer => {
  const removeLayer = vi.fn();
  const group = {
    eachLayer: (cb: (l: L.Layer) => void) => {
      for (const leaf of [...leaves]) cb(leaf);
    },
    addLayer: vi.fn(),
    removeLayer,
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
  const markerMock = L.marker as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    markerMock.mockClear();
  });

  it("creates one label marker per renderable leaf and parents it to the layer", () => {
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
    expect(markerMock).toHaveBeenCalledTimes(2);
    // First leaf anchors at its marker latlng and formats through formatValue.
    const [firstCall, secondCall] = markerMock.mock.calls;
    expect(firstCall[0]).toEqual({ lat: 40, lng: -74 });
    expect(secondCall[0]).toEqual({ lat: 40.5, lng: -73.5 });
    // The label node is handed to divIcon as an element (never an HTML
    // string); the vitest stub discards its options, so read it back from
    // the divIcon call arguments.
    const iconOpts = (L.divIcon as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as { html: HTMLElement };
    expect(iconOpts.html.tagName).toBe("SPAN");
    expect(iconOpts.html.textContent).toBe("1.2K");
    expect(iconOpts.html.className).toContain("foliplus-annotation-label-text");
    // Markers are added as children of the source layer and flagged isLabel.
    const added = (
      group as unknown as { addLayer: ReturnType<typeof vi.fn> }
    ).addLayer.mock.calls.map(c => c[0]);
    expect(added).toHaveLength(2);
    expect(added.every(m => (m as { isLabel?: boolean }).isLabel)).toBe(true);
  });

  it("anchors a point label below its marker and a path label on its centroid", () => {
    // The two anchor kinds want different relationships to their anchor, and a
    // divIcon cannot place itself: the chip's width is unknown until layout, so
    // the horizontal placement is a CSS transform on the inner span (see the
    // label rules in LayerControl.css) and the offset comes from iconAnchor.
    // Leaflet's divIcon default iconSize of 12x12 is what used to push a fixed
    // box up against the anchor and let the text spill out to its right.
    const group = mkGroup([
      mkLeaf({ props: { v: "1" }, latlng: { lat: 40, lng: -74 } }),
      mkLeaf({
        props: { v: "2" },
        bounds: {
          isValid: () => true,
          getCenter: () => ({ lat: 40.5, lng: -73.5 }),
        },
      }),
    ]);
    const mgr = new AnnotationManager(map, id => (id === "l1" ? group : null));
    mgr.setConfig("l1", { show: true, field: "v", format: "auto" });
    const divIconMock = L.divIcon as unknown as ReturnType<typeof vi.fn>;
    divIconMock.mockClear();

    mgr.renderLabels("l1");

    const [pointIcon, shapeIcon] = divIconMock.mock.calls.map(
      c => c[0] as { className: string; iconAnchor: number[]; iconSize: number[] },
    );
    expect(pointIcon.iconSize).toEqual([0, 0]);
    expect(pointIcon.iconAnchor).toEqual([0, -10]);
    expect(pointIcon.className).toContain("foliplus-annotation-label-point");
    expect(shapeIcon.iconSize).toEqual([0, 0]);
    expect(shapeIcon.iconAnchor).toEqual([0, 0]);
    expect(shapeIcon.className).toContain("foliplus-annotation-label-shape");
  });

  it("resolves an open field through the shared auto pick", () => {
    // ield: "" is the Auto sentinel, not "no field": the label renders the
    // auto pick over the layer's own columns (first numeric, else first). The
    // panel's test for this only spies renderLabels, so it passes either way —
    // this is the one that reads the rendered text.
    const group = mkGroup([
      mkLeaf({ props: { name: "a", count: 5 }, latlng: { lat: 40, lng: -74 } }),
    ]);
    const mgr = new AnnotationManager(map, id => (id === "l1" ? group : null));
    mgr.setConfig("l1", { show: true, field: "", format: "auto" });
    const divIconMock = L.divIcon as unknown as ReturnType<typeof vi.fn>;
    divIconMock.mockClear();

    mgr.renderLabels("l1");

    const icon = divIconMock.mock.calls[0]![0] as { html: HTMLElement };
    expect(icon.html.textContent).toBe("5");
  });

  it("re-samples the auto pick once its cache is dropped", () => {
    // The auto answer is cached per layer; when the layer's columns change the
    // cache has to go, or the labels keep reading a field that no longer exists
    // while the picker resolves a new one.
    const props: Record<string, unknown> = { count: 5 };
    const group = mkGroup([mkLeaf({ props, latlng: { lat: 40, lng: -74 } })]);
    const mgr = new AnnotationManager(map, id => (id === "l1" ? group : null));
    mgr.setConfig("l1", { show: true, field: "", format: "auto" });
    const divIconMock = L.divIcon as unknown as ReturnType<typeof vi.fn>;

    divIconMock.mockClear();
    mgr.renderLabels("l1");
    expect((divIconMock.mock.calls[0]![0] as { html: HTMLElement }).html.textContent).toBe("5");

    delete props.count;
    props.other = 7;
    mgr.invalidateAutoField("l1");
    divIconMock.mockClear();
    mgr.renderLabels("l1");

    expect((divIconMock.mock.calls[0]![0] as { html: HTMLElement }).html.textContent).toBe("7");
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
    expect(markerMock).not.toHaveBeenCalled();
  });

  it("renders nothing when the config hides labels", () => {
    const group = mkGroup([mkLeaf({ props: { v: "1" }, latlng: { lat: 0, lng: 0 } })]);
    const mgr = new AnnotationManager(map, id => (id === "l1" ? group : null));
    mgr.setConfig("l1", { show: false, field: "v", format: "auto" });

    expect(mgr.renderLabels("l1")).toHaveLength(0);
    expect(markerMock).not.toHaveBeenCalled();
  });

  it("renders nothing when the layer cannot be resolved", () => {
    const mgr = new AnnotationManager(map, () => null);
    mgr.setConfig("ghost", { show: true, field: "v", format: "auto" });
    expect(mgr.renderLabels("ghost")).toHaveLength(0);
  });
});

describe("AnnotationManager.clearLabels / refreshAll / destroy", () => {
  const markerMock = L.marker as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    markerMock.mockClear();
  });

  it("removes only isLabel leaves from the layer tree", () => {
    const label = mkLeaf({ isLabel: true });
    const data = mkLeaf({ props: { v: "1" }, latlng: { lat: 0, lng: 0 } });
    const group = mkGroup([label, data]);
    const mgr = new AnnotationManager(map, id => (id === "l1" ? group : null));

    mgr.clearLabels("l1");

    const removeLayer = (group as unknown as { removeLayer: ReturnType<typeof vi.fn> })
      .removeLayer;
    expect(removeLayer).toHaveBeenCalledTimes(1);
    expect(removeLayer).toHaveBeenCalledWith(label);
  });

  it("refreshAll re-renders only layers whose config shows labels", () => {
    const shown = mkGroup([mkLeaf({ props: { v: "5" }, latlng: { lat: 0, lng: 0 } })]);
    const hidden = mkGroup([mkLeaf({ props: { v: "6" }, latlng: { lat: 1, lng: 1 } })]);
    const mgr = new AnnotationManager(map, id =>
      id === "a" ? shown : id === "b" ? hidden : null,
    );
    mgr.setConfig("a", { show: true, field: "v", format: "auto" });
    mgr.setConfig("b", { show: false, field: "v", format: "auto" });

    mgr.refreshAll();

    expect(markerMock).toHaveBeenCalledTimes(1);
  });

  it("destroy clears every layer's labels and forgets all configs", () => {
    const group = mkGroup([
      mkLeaf({ props: { v: "1" }, latlng: { lat: 0, lng: 0 }, isLabel: true }),
    ]);
    const mgr = new AnnotationManager(map, () => group);
    mgr.setConfig("a", { show: true, field: "v", format: "auto" });
    mgr.setConfig("b", { show: true, field: "v", format: "auto" });

    mgr.destroy();

    expect(mgr.configEntries()).toHaveLength(0);
    expect(
      (group as unknown as { removeLayer: ReturnType<typeof vi.fn> }).removeLayer,
    ).toHaveBeenCalled();
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

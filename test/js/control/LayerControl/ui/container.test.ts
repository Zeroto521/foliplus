import { initFixture } from "./fixture.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { countChildLayersOf, isContainerLayer } from "#core/layer/index.js";
import { buildRowCell } from "#control/LayerControl/ui/listPanel/index.js";

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

describe("container layer row", () => {
  let manager: any;
  let ui: any;
  afterEach(() => {
    manager?.destroy?.();
    ui?.uiContainer?.remove();
  });

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

  it("countChildLayers: direct children, not deep leaves", () => {
    const leaf1: any = { options: {} };
    const leaf2: any = { options: {} };
    const inner = makeContainer([leaf1]);
    const outer = makeContainer([inner, leaf2]);
    expect(countChildLayersOf(outer)).toBe(2);
    expect(countChildLayersOf(inner)).toBe(1);
    expect(countChildLayersOf(makeContainer([]))).toBe(0);
  });

  it("row shows the container type icon and the child count", () => {
    const leaf: any = { options: {} };
    const container = makeContainer([leaf, leaf]);
    const r = initFixture({
      data: [{ id: "grp", name: "Group", role: "overlay", layer: container }],
    });
    manager = r.manager;
    ui = r.ui;
    const info = manager.layerRegistry.get("grp");
    const cell = buildRowCell(ui, info);
    // Container type: group icon + type_container label.
    expect(cell.typeSvg).toContain("<polygon");
    expect(cell.typeLabel).toBe("LayerControl.type_container");
    // Child count in the count column.
    expect(cell.countText).toBe("2");
  });

  it("a logical layer backed by a group with a featureCountProvider is NOT a container", () => {
    // Regression: the browser filter test registers a layer backed by an empty
    // L.layerGroup() with a provider-driven count. isContainerLayer(empty group)
    // is true (group-like + child registry), so the row misclassified it as a
    // container and showed the child count (0) instead of the provider count.
    // The group is the layer's Leaflet REPRESENTATION, not a folder of
    // sub-layers — a provider-carrying layer keeps its provider count.
    const group = makeContainer([]);
    const r = initFixture({
      data: [{ id: "grp", name: "Group", role: "overlay", layer: group }],
    });
    manager = r.manager;
    ui = r.ui;
    // Re-register with a provider (the CONFIG path supplies featureCountProvider
    // for layers whose count is provider-authoritative).
    const info = manager.registerLayer({
      id: "grp",
      name: "Group",
      role: "overlay",
      layer: group,
      featureCountProvider: () => 8,
    });
    expect(info).not.toBeNull();
    const cell = buildRowCell(ui, manager.layerRegistry.get("grp")!);
    // Provider count wins over the child count.
    expect(cell.countText).toBe("8");
    // Not a container row: no group icon, no type_container label.
    expect(cell.typeLabel).not.toBe("LayerControl.type_container");
  });

  it("container delete and teardown are safe", () => {
    const container = makeContainer([{ options: {} }]);
    const r = initFixture({
      data: [{ id: "grp", name: "Group", role: "overlay", layer: container }],
    });
    manager = r.manager;
    ui = r.ui;
    // Delete the layer; the container's clearLayers should be called and no throw.
    expect(() => manager.deleteLayer("grp")).not.toThrow();
    expect(container.clearLayers).toHaveBeenCalled();
  });
});

// HeatmapControl × LayerAPI content-signal integration.
//
// The unit tests in ./filter.test.ts clear the caches by hand before calling
// renderHexagons, which proves the revalidation algorithm but not the runtime
// chain. These tests drive the real chain instead:
//
//   LayerAPI.createLayers() handle addLayer / removeLayer / clearLayers
//     → LayerFactory's patched group → controller.refreshCount
//     → LAYER_ITEM_COUNT_CHANGE on the shared bus
//     → HeatmapManager's source-content listener
//     → cache invalidation + debounced renderHexagons
//
// The map is the real LayerController fixture (test/js/LayerControl/ui), so
// the bus, the registry and the factory are the production instances; only the
// heatmap's own draw is stubbed (jsdom has no 2D canvas).
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import type { HeatmapManager } from "#foliplus/HeatmapControl/manager.js";
import type { LayerController } from "#foliplus/LayerControl/controller.js";
import { initFixture, trackMembership } from "../LayerControl/ui/fixture.js";
import { makeManagerOn } from "./fixture.js";

/** A real-enough layer group: the factory patches and walks its children. */
class FakeGroup {
  options: Record<string, unknown> = {};
  private children = new Set<unknown>();

  addLayer(layer: unknown): this {
    this.children.add(layer);
    return this;
  }
  removeLayer(layer: unknown): this {
    this.children.delete(layer);
    return this;
  }
  clearLayers(): this {
    this.children.clear();
    return this;
  }
  hasLayer(layer: unknown): boolean {
    return this.children.has(layer);
  }
  getLayers(): unknown[] {
    return [...this.children];
  }
  eachLayer(fn: (layer: unknown) => void): void {
    [...this.children].forEach(fn);
  }
}

/** A Marker instance the controller's `extractPoints` accepts: `instanceof
 *  L.Marker`, a `feature` bag and a `getLatLng`, plus the folium `value`
 *  contract the heatmap reads. */
const makeMarker = (value: number) => {
  const marker = new (
    window.L.Marker as unknown as new () => Record<string, unknown>
  )();
  marker.options = {};
  marker.value = value;
  marker.feature = { properties: {} };
  marker.getLatLng = () => ({ lat: 26 + value / 1000, lng: 119 + value / 1000 });
  return marker;
};

const SCAN_DEBOUNCE = 200;

describe("HeatmapControl source content signal (LayerAPI integration)", () => {
  let ctrl: LayerController;
  let map: any;
  let mgr: HeatmapManager;
  let src: ReturnType<LayerController["createLayers"]>;
  let filterSpy: Mock<(payload: { id: string }) => void>;

  /** Flush both debounces the manager uses for layer/content changes. */
  const flushScans = () => vi.advanceTimersByTime(SCAN_DEBOUNCE + 50);

  beforeEach(() => {
    vi.restoreAllMocks();
    const fixture = initFixture();
    ctrl = fixture.manager;
    map = fixture.map;
    trackMembership(map);

    // The factory creates its groups through L.layerGroup — give it a real
    // one so addLayer/removeLayer/clearLayers actually move children.
    window.L.layerGroup = vi.fn(() => new FakeGroup()) as any;

    mgr = makeManagerOn(map);
    // HeatmapManager reads the LayerAPI through the free `map` global
    // (window.map) in getSelectedPoints / publishCount. Point it at the real
    // controller mounted on the fixture map.
    window.map.foliplus = map.foliplus;
    vi.spyOn(mgr, "redrawHeatmap").mockImplementation(() => {});

    vi.useFakeTimers();
    src = ctrl.createLayers({
      id: "src",
      name: "Source",
      panes: [{ name: "srcPane" }],
    });
    filterSpy = vi.fn<(payload: { id: string }) => void>();
    mgr.events.on(EVENTS.LAYER_FILTER_CHANGE, filterSpy);
  });

  afterEach(() => {
    mgr?.onSourceContentChange?.cancel?.();
    mgr?.onLayerChange?.cancel?.();
    ctrl?.debouncedEnforce?.cancel?.();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  /** Register the source with its initial points, flush the registration
   *  scan, then hand the manager the source row the production scan would
   *  have built (the fixture's source is a vector row, so the type filter
   *  drops it from `getLayersByType("point")`). */
  const selectSource = (values: number[]) => {
    const markers = values.map(makeMarker);
    markers.forEach(marker => src.addLayer(marker as unknown as L.Layer));
    flushScans();
    mgr.selectedLayerId = "src";
    mgr.pointLayers = [
      { id: "src", name: "Source", layer: src.mainLayer, count: values.length },
    ];
    return markers;
  };

  it("re-renders from a real addLayer and updates the panel model range", () => {
    const markers = selectSource([10, 30]);
    mgr.renderHexagons();
    expect(mgr.getFilterModel()!.range).toEqual([10, 30]);

    // Move the content through the public API: the values now span [1, 5].
    // removeLayer keeps the row registered (only clearLayers retires it), so
    // this is a data update, not a source departure.
    markers.forEach(marker => src.removeLayer(marker as unknown as L.Layer));
    src.addLayer(makeMarker(1) as unknown as L.Layer);
    src.addLayer(makeMarker(5) as unknown as L.Layer);

    // The count signal drops the extraction caches synchronously, before the
    // debounced repaint — a panel read in between must not answer from the
    // retired snapshot.
    expect((mgr as any).cachedPoints).toBeNull();
    expect((mgr as any).cachedSnapshot).toBeNull();

    flushScans();

    expect(mgr.getFilterModel()!.range).toEqual([1, 5]);
    expect(mgr.getFilterModel()!.total).toBe(2);
  });

  it("a real content change clamps a committed filter and notifies once", () => {
    const markers = selectSource([10, 30]);
    mgr.renderHexagons();
    mgr.setFilter({
      kind: "atom",
      field: "value",
      op: "between",
      range: [10, 20],
    });
    expect(mgr.getFilterModel()!.filter).toBeDefined();
    filterSpy.mockClear();

    markers.forEach(marker => src.removeLayer(marker as unknown as L.Layer));
    src.addLayer(makeMarker(1) as unknown as L.Layer);
    src.addLayer(makeMarker(5) as unknown as L.Layer);
    flushScans();

    // [10, 20] cannot intersect [1, 5]: the stored band clamps to the only
    // still-valid point, and the one notification lands after the render.
    expect(mgr.getFilterModel()!.filter).toEqual({
      kind: "atom",
      field: "value",
      op: "between",
      range: [5, 5],
    });
    expect(filterSpy).toHaveBeenCalledTimes(1);
    expect(filterSpy).toHaveBeenCalledWith({ id: mgr.layerId });
  });

  it("notifies a content change even when the stored filter survives", () => {
    selectSource([10, 30]);
    mgr.renderHexagons();
    mgr.setFilter({
      kind: "atom",
      field: "value",
      op: "between",
      range: [10, 20],
    });
    expect(mgr.getFilterModel()!.kept).toBe(1);
    filterSpy.mockClear();

    // An added point inside the committed band leaves [10, 20] valid and
    // unchanged, but `kept` moves 1 → 2. An open panel's live readout is
    // derived from that model, so the content signal owes a notification even
    // without a clamp.
    src.addLayer(makeMarker(15) as unknown as L.Layer);
    flushScans();

    const model = mgr.getFilterModel()!;
    expect(model.filter).toEqual({
      kind: "atom",
      field: "value",
      op: "between",
      range: [10, 20],
    });
    expect(model.kept).toBe(2);
    expect(filterSpy).toHaveBeenCalledTimes(1);
  });

  it("a real removeLayer shrinks the snapshot and rebuilds the geometry cache", () => {
    const markers = selectSource([10, 20, 30]);
    mgr.renderHexagons();
    const binsBefore = (mgr as any).cachedBins;

    src.removeLayer(markers[1] as unknown as L.Layer);
    flushScans();

    const model = mgr.getFilterModel()!;
    expect(model.range).toEqual([10, 30]);
    expect(model.total).toBe(2);
    expect(model.kept).toBe(2);
    // Point identity moved, so the bin walk is redone for the new set.
    expect((mgr as any).cachedBins).not.toBe(binsBefore);
  });

  it("clearLayers on the selected source drops the selection, canvas and filter", () => {
    selectSource([10, 30]);
    mgr.renderHexagons();
    mgr.setFilter({
      kind: "atom",
      field: "value",
      op: "between",
      range: [10, 20],
    });
    filterSpy.mockClear();

    src.clearLayers();
    flushScans();

    expect(mgr.selectedLayerId).toBeNull();
    expect(mgr.layerFilters.size).toBe(0);
    expect((mgr as any).cachedFeatures).toBeNull();
    // Exactly one notification, whichever debounced pass revalidates first.
    expect(filterSpy).toHaveBeenCalledTimes(1);
  });

  it("ignores the count signal of its own output row (no self-trigger)", () => {
    selectSource([10, 30]);
    mgr.renderHexagons();
    const cachedPoints = (mgr as any).cachedPoints;
    const renderSpy = vi.spyOn(mgr, "renderHexagons");

    // The manager publishes this event for its own row after every render;
    // consuming it would make each paint schedule another paint.
    mgr.events.publish(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: mgr.layerId });
    flushScans();

    expect(renderSpy).not.toHaveBeenCalled();
    expect((mgr as any).cachedPoints).toBe(cachedPoints);
  });
});

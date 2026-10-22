// Stage-2 pilot: HeatmapControl single-field dual-slider filter.
// Verifies the core invariant: a filter change reuses the bin cache
// (zero h3 calls) and only reruns the pure aggregateBins arithmetic.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents } from "#core/event/index.js";
import type { LayerFilter } from "#core/layer/index.js";
import type { HeatmapManager } from "#foliplus/HeatmapControl/manager.js";
import { makeManager } from "./fixture.js";

/** Set up a manager with a point layer, selected, and points extracted. */
function setupWithPoints(
  m: HeatmapManager,
  points: Array<{ lat: number; lng: number; value: number; field?: string }>,
): void {
  const layerId = "layer1";
  m.selectedLayerId = layerId;
  m.agg = "count";
  m.field = "";
  m.numClasses = 6;
  m.method = "jenks";
  m.scheme = "Reds";
  m.labelShow = false;
  vi.spyOn(m, "redrawHeatmap").mockImplementation(() => {});
  m.map = {
    _container: { clientWidth: 800, clientHeight: 600 },
    getZoom: () => 5,
    getBounds: () => ({ isValid: () => true, contains: () => true }),
    getContainer: () => ({ clientWidth: 800, clientHeight: 600 }),
  } as any;
  m.overlay = {
    canvas: { style: {} },
    ctx: {
      setTransform: () => {},
      clearRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      fillText: () => {},
    },
    register: vi.fn(),
    unregister: vi.fn(),
    setVisible: vi.fn(),
    hooks: { before: [], after: [] },
  } as any;
  m.pointLayers = [{ id: layerId, name: "P", layer: {}, count: points.length }];

  const markers = points.map((p, i) => {
    const marker = {
      _latlng: { lat: p.lat, lng: p.lng },
      getLatLng: () => ({ lat: p.lat, lng: p.lng }),
      options: p.field ? { value: p.value } : {},
      value: p.field ? undefined : p.value,
      feature: {
        properties: p.field ? { [p.field]: p.value } : {},
      },
      _foliplus_stamp: `m${i}`,
    } as any;
    return marker;
  });

  vi.spyOn(window.map.foliplus!.LayerAPI!, "extractPoints").mockReturnValue(
    markers.map(m => ({
      lat: m._latlng.lat,
      lng: m._latlng.lng,
      marker: m,
    })),
  );
}

describe("HeatmapControl filter (stage-2 pilot)", () => {
  let m: HeatmapManager;
  let events: ReturnType<typeof ensureEvents>;

  beforeEach(() => {
    vi.restoreAllMocks();
    m = makeManager();
    events = ensureEvents(m.map as any);
  });

  it("filterKey is stable across identical range filters", () => {
    const f1: LayerFilter = {
      kind: "atom",
      field: "value",
      op: "between",
      range: [15, 18],
    };
    const f2: LayerFilter = {
      kind: "atom",
      field: "value",
      op: "between",
      range: [15, 18],
    };
    // Different array instances, same values → same key.
    const key1 = JSON.stringify(f1);
    const key2 = JSON.stringify(f2);
    expect(key1).toBe(key2);
  });

  it("filterKey differs when the range changes", () => {
    const f1: LayerFilter = {
      kind: "atom",
      field: "value",
      op: "between",
      range: [15, 18],
    };
    const f2: LayerFilter = {
      kind: "atom",
      field: "value",
      op: "between",
      range: [10, 20],
    };
    expect(JSON.stringify(f1)).not.toBe(JSON.stringify(f2));
  });

  it("LAYER_FILTER_CHANGE invalidates the agg cache and re-renders", () => {
    const points = [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 20 },
      { lat: 26.1, lng: 119.32, value: 30 },
    ];
    setupWithPoints(m, points);

    // First render — builds the agg cache.
    m.renderHexagons();
    const aggKey1 = (m as any).cachedAgg?.key;
    expect(aggKey1).toBeDefined();

    // Emit a filter change for this heatmap's own row (the panel lives on
    // the heatmap row; its filter governs this heatmap's source).
    const filter: LayerFilter = {
      kind: "atom",
      field: "value",
      op: "between",
      range: [15, 25],
    };
    events.emit(EVENTS.LAYER_FILTER_CHANGE, { id: m.layerId, filter });

    // The agg cache was invalidated and rebuilt with a new key
    // that includes the filter JSON.
    const aggKey2 = (m as any).cachedAgg?.key;
    expect(aggKey2).toBeDefined();
    expect(aggKey2).not.toBe(aggKey1);
    expect(aggKey2).toContain(filter.kind);
  });

  it("ignores a LAYER_FILTER_CHANGE for another heatmap's row", () => {
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 20 },
    ]);

    m.renderHexagons();
    const aggKey1 = (m as any).cachedAgg?.key;

    events.emit(EVENTS.LAYER_FILTER_CHANGE, {
      id: "some-other-heatmap",
      filter: { kind: "atom", field: "value", op: "between", range: [10, 20] },
    });

    // Not this heatmap's row: the agg cache is untouched.
    expect((m as any).cachedAgg?.key).toBe(aggKey1);
  });

  it("filter application reduces the point set via aggregateBins", () => {
    const points = [
      { lat: 26.08, lng: 119.3, value: 5 },
      { lat: 26.09, lng: 119.31, value: 15 },
      { lat: 26.1, lng: 119.32, value: 25 },
      { lat: 26.11, lng: 119.33, value: 35 },
    ];
    setupWithPoints(m, points);

    // No filter — all points included.
    m.renderHexagons();
    const unfilteredAgg = (m as any).cachedAgg?.data;
    expect(unfilteredAgg).toBeDefined();
    const unfilteredCount = Object.values(unfilteredAgg.hexCells).reduce(
      (sum: number, c: any) => sum + c.count,
      0,
    );
    expect(unfilteredCount).toBe(4);

    // Clear caches and apply a filter that includes only 2 of 4 points.
    (m as any).cachedAgg = null;
    (m as any).cachedBins = null;
    m.layerFilters.set("layer1", {
      kind: "atom",
      field: "value",
      op: "between",
      range: [10, 30],
    });
    m.renderHexagons();
    const filteredAgg = (m as any).cachedAgg?.data;
    expect(filteredAgg).toBeDefined();
    const filteredCount = Object.values(filteredAgg.hexCells).reduce(
      (sum: number, c: any) => sum + c.count,
      0,
    );
    // Values 5 and 35 are excluded → 2 points remain.
    expect(filteredCount).toBe(2);
  });

  it("filter change does NOT call h3.latLngToCell (bin cache reuse)", () => {
    const points = [
      { lat: 26.08, lng: 119.3, value: 5 },
      { lat: 26.09, lng: 119.31, value: 15 },
      { lat: 26.1, lng: 119.32, value: 25 },
    ];
    setupWithPoints(m, points);

    // First render — h3.latLngToCell is called for binning.
    const h3Spy = vi.spyOn(globalThis.h3, "latLngToCell");
    h3Spy.mockClear();
    m.renderHexagons();
    expect(h3Spy).toHaveBeenCalled();
    const initialCalls = h3Spy.mock.calls.length;
    expect(initialCalls).toBeGreaterThan(0);

    // Apply a filter — h3.latLngToCell should NOT be called again.
    h3Spy.mockClear();
    m.layerFilters.set("layer1", {
      kind: "atom",
      field: "value",
      op: "between",
      range: [10, 20],
    });
    m.renderHexagons();
    expect(h3Spy).not.toHaveBeenCalled();
  });

  it("zoom change invalidates the bin cache (h3 calls again)", () => {
    const points = [
      { lat: 26.08, lng: 119.3, value: 5 },
      { lat: 26.09, lng: 119.31, value: 15 },
    ];
    setupWithPoints(m, points);

    const h3Spy = vi.spyOn(globalThis.h3, "latLngToCell");
    m.renderHexagons();
    expect(h3Spy).toHaveBeenCalled();

    // Change zoom — bin cache key changes (res changes), h3 calls again.
    (m as any).map = {
      _container: { clientWidth: 800, clientHeight: 600 },
      getZoom: () => 10,
      getBounds: () => ({ isValid: () => true, contains: () => true }),
      getContainer: () => ({ clientWidth: 800, clientHeight: 600 }),
    } as any;
    h3Spy.mockClear();
    m.renderHexagons();
    expect(h3Spy).toHaveBeenCalled();
    expect(h3Spy.mock.calls.length).toBeGreaterThan(0);
  });

  it("clearHeatmapCanvas resets the filter state", () => {
    setupWithPoints(m, [{ lat: 26.08, lng: 119.3, value: 10 }]);
    m.layerFilters.set("layer1", {
      kind: "atom",
      field: "value",
      op: "between",
      range: [5, 15],
    });
    expect(m.layerFilters.size).toBe(1);

    m.clearHeatmapCanvas();
    expect(m.layerFilters.size).toBe(0);
    expect((m as any).cachedSnapshot).toBeNull();
    expect((m as any).cachedSnapshotLayerId).toBeNull();
    expect((m as any).cachedBins).toBeNull();
  });

  it("extractMarkerFields resolves value, options.value, and properties fields", () => {
    const marker1 = {
      value: 42,
      options: {},
      feature: { properties: {} },
    } as any;
    const fields1 = (m as any).extractMarkerFields(marker1);
    expect(fields1).toEqual({ value: 42 });

    const marker2 = {
      options: { value: 99 },
      feature: { properties: {} },
    } as any;
    const fields2 = (m as any).extractMarkerFields(marker2);
    expect(fields2).toEqual({ value: 99 });

    const marker3 = {
      options: {},
      feature: { properties: { temperature: 36.5, status: "ok" } },
    } as any;
    const fields3 = (m as any).extractMarkerFields(marker3);
    expect(fields3).toEqual({ temperature: 36.5 });
  });

  it("extractMarkerFields skips a properties key the contract already holds", () => {
    const marker = {
      value: 42,
      options: {},
      feature: { properties: { value: 7, other: 3 } },
    } as any;
    const fields = (m as any).extractMarkerFields(marker);
    expect(fields).toEqual({ value: 42, other: 3 });
  });

  it("stores under the row id and skips render when no source is selected", () => {
    // No selected source: the heatmap row's filter is parked on the row id
    // and nothing re-renders (there is no source to filter yet).
    setupWithPoints(m, [{ lat: 26.08, lng: 119.3, value: 10 }]);
    m.selectedLayerId = null;
    events.emit(EVENTS.LAYER_FILTER_CHANGE, {
      id: m.layerId,
      filter: { kind: "atom", field: "value", op: "between", range: [10, 20] },
    });
    expect(m.layerFilters.get(m.layerId)).toEqual({
      kind: "atom",
      field: "value",
      op: "between",
      range: [10, 20],
    });
    expect((m as any).cachedAgg).toBeNull();
  });

  it("extends the range downward when a later point is smaller", () => {
    // First point sets the [30, 30] seed; the second, smaller point must
    // widen the lower bound (the upper-bound widen path is covered by the
    // ascending fixtures elsewhere).
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 30 },
      { lat: 26.09, lng: 119.31, value: 10 },
      { lat: 26.1, lng: 119.32, value: 20 },
    ]);
    m.renderHexagons();
    expect((m as any).cachedSnapshot.ranges.value).toEqual([10, 30]);
  });

  it("drops a cell whose points are all filtered out", () => {
    // Two co-located points share the fixture's single h3 cell; a filter
    // excluding both empties the cell, and the aggregate falls through to
    // the canvas clear instead of emitting an empty cell.
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.08, lng: 119.3, value: 20 },
    ]);
    m.layerFilters.set("layer1", {
      kind: "atom",
      field: "value",
      op: "between",
      range: [0, 5],
    });
    m.renderHexagons();
    expect((m as any).cachedFeatures).toBeNull();
    expect((m as any).cachedAgg).toBeNull();
  });
});

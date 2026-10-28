// HeatmapControl filter owner: capability registration, model and setter.
//
// The manager owns the filter: the LayerControl panel writes through the
// `filterSetter` capability and reads through `filterProvider`. These tests
// pin the owner contract — validation/clamping, the "full range = no filter"
// collapse, per-source attribution across a source switch, revalidation on
// content change, the clear/reset lifecycle, and the bins-cache reuse (a
// filter change never re-runs the H3 geometry).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents, publish } from "#core/event/index.js";
import { type LayerFilter, extractMarkerFields } from "#core/layer/index.js";
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
  // One distinct hex cell per marker: the model counts cells, and these
  // fixtures want the pre-cell semantics (one point ↔ one cell) to stay
  // readable in assertions such as kept === 2.
  (globalThis.h3 as any).latLngToCell = vi.fn(
    (lat: number, lng: number) => `${lat}:${lng}`,
  );
}

/** A spy on the manager's own LAYER_FILTER_CHANGE channel — the payload the
 *  panel and any other observer receives after the owner has settled. The
 *  bus is the one `init()` bound (the fixture map's); setupWithPoints swaps
 *  `m.map` for a zoom stub afterwards, but `this.events` stays put. */
const watchFilterEvents = (
  m: HeatmapManager,
  events: ReturnType<typeof ensureEvents>,
) => {
  const spy = vi.fn();
  events.on(EVENTS.LAYER_FILTER_CHANGE, spy);
  return spy;
};

describe("HeatmapControl filter owner", () => {
  let m: HeatmapManager;
  let events: ReturnType<typeof ensureEvents>;

  beforeEach(() => {
    vi.restoreAllMocks();
    m = makeManager();
    // The bus init() bound to the fixture map — the manager publishes here
    // even after a test replaces m.map with a zoom stub.
    events = ensureEvents(m.map as any);
  });

  it("the manager never subscribes to LAYER_FILTER_CHANGE (no leak by construction)", () => {
    // The write path is the capability call; the owner has nothing to
    // listen for. A listener here would accumulate one consumer per
    // remove/re-add. Publishing at the owner must not move its state.
    publish(events, EVENTS.LAYER_FILTER_CHANGE, { id: m.layerId });
    expect(m.layerFilters.size).toBe(0);
  });

  it("setFilter applies, re-renders from the bins cache, and publishes the id-only signal", () => {
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 20 },
      { lat: 26.1, lng: 119.32, value: 30 },
    ]);
    m.renderHexagons();
    const h3Spy = vi.spyOn(globalThis.h3, "latLngToCell");
    h3Spy.mockClear();
    const spy = watchFilterEvents(m, events);

    m.setFilter({ kind: "atom", field: "value", op: "between", range: [15, 25] });

    // Zero h3 calls: the bins survived; only aggregateBins reran.
    expect(h3Spy).not.toHaveBeenCalled();
    // The notification is id-only — observers pull the model, never read
    // the filter from the payload.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ id: m.layerId });
  });

  it("setFilter is a no-op when the validated filter equals the stored one", () => {
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 20 },
    ]);
    m.renderHexagons();
    const spy = watchFilterEvents(m, events);
    const f: LayerFilter = {
      kind: "atom",
      field: "value",
      op: "between",
      range: [12, 18],
    };
    m.setFilter(f);
    expect(spy).toHaveBeenCalledTimes(1);
    m.setFilter({ ...f });
    expect(spy).toHaveBeenCalledTimes(1); // unchanged → no second publish
  });

  it("clamps an out-of-range band into the snapshot bounds", () => {
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.1, lng: 119.32, value: 30 },
    ]);
    m.renderHexagons();

    m.setFilter({ kind: "atom", field: "value", op: "between", range: [0, 100] });
    expect(m.getFilterModel()!.filter).toBeUndefined(); // full extent → no filter

    m.setFilter({ kind: "atom", field: "value", op: "between", range: [-5, 20] });
    expect(m.getFilterModel()!.filter).toEqual({
      kind: "atom",
      field: "value",
      op: "between",
      range: [10, 20],
    });
  });

  it("collapses a full-range atom to no filter (missing-field points stay in)", () => {
    // A point without the field: an atom — even over the full extent —
    // would exclude it. Only `undefined` keeps it, which is what dragging
    // both thumbs back to the ends means.
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 30 },
    ]);
    // Third point carries no numeric data at all (the harness's field
    // variant leaks value into options.value, so hand-build this one).
    const extract = window.map.foliplus!.LayerAPI!
      .extractPoints as unknown as ReturnType<typeof vi.fn>;
    extract.mockImplementation(() =>
      [
        { lat: 26.08, lng: 119.3, value: 10 },
        { lat: 26.09, lng: 119.31, value: 30 },
      ]
        .map(p => ({
          lat: p.lat,
          lng: p.lng,
          marker: {
            getLatLng: () => ({ lat: p.lat, lng: p.lng }),
            value: p.value,
            feature: { properties: {} },
          },
        }))
        .concat([
          {
            lat: 26.1,
            lng: 119.32,
            marker: {
              getLatLng: () => ({ lat: 26.1, lng: 119.32 }),
              feature: { properties: {} },
            },
          },
        ] as any),
    );
    (m as any).cachedPoints = null;
    (m as any).cachedSnapshot = null;
    (m as any).cachedSnapshotLayerId = null;
    m.renderHexagons();
    expect(m.getFilterModel()!.total).toBe(3);

    m.setFilter({ kind: "atom", field: "value", op: "between", range: [10, 30] });
    const model = m.getFilterModel()!;
    expect(model.filter).toBeUndefined();
    expect(model.kept).toBe(model.total); // the field-less point is back in
  });

  it("drops an atom whose field is unknown to the snapshot", () => {
    setupWithPoints(m, [{ lat: 26.08, lng: 119.3, value: 10 }]);
    m.renderHexagons();

    m.setFilter({ kind: "atom", field: "nonexistent", op: "between", range: [0, 1] });

    expect(m.layerFilters.size).toBe(0);
  });

  it("a write that changes nothing does not publish (idempotent)", () => {
    // Clearing a filter that was never set, or writing the band already
    // stored, is a no-op — no render, no notification.
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 30 },
    ]);
    m.renderHexagons();
    const spy = watchFilterEvents(m, events);
    m.setFilter(undefined);
    expect(spy).not.toHaveBeenCalled();
    m.setFilter({ kind: "atom", field: "value", op: "between", range: [10, 20] });
    m.setFilter({ kind: "atom", field: "value", op: "between", range: [10, 20] });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("setFilter on a manager with no selected source is a no-op", () => {
    setupWithPoints(m, [{ lat: 26.08, lng: 119.3, value: 10 }]);
    m.selectedLayerId = null;
    const spy = watchFilterEvents(m, events);

    m.setFilter({ kind: "atom", field: "value", op: "between", range: [0, 10] });

    expect(m.layerFilters.size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("getFilterModel reports field, extent, kept/total and a data-derived step", () => {
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 20 },
      { lat: 26.1, lng: 119.32, value: 30 },
    ]);
    m.renderHexagons();

    const model = m.getFilterModel()!;
    expect(model.dimensions[0]).toMatchObject({ kind: "range", field: "value" });
    expect(model.dimensions[0]).toMatchObject({ kind: "range", range: [10, 30] });
    expect(model.filter).toBeUndefined();
    expect(model.kept).toBe(3);
    expect(model.total).toBe(3);
    expect(model.dimensions[0]).toMatchObject({ kind: "range", step: 1 }); // integer data

    m.setFilter({ kind: "atom", field: "value", op: "between", range: [12, 20] });
    expect(m.getFilterModel()!.kept).toBe(1);
  });

  it("the step honours the data's decimals (no magic 1)", () => {
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 0.5 },
      { lat: 26.09, lng: 119.31, value: 2.75 },
    ]);
    m.renderHexagons();
    const stepDim = m.getFilterModel()!.dimensions[0];
    expect(stepDim.kind).toBe("range");
    expect(stepDim).toMatchObject({ step: 0.01 });
  });

  it("getFilterModel is null without a selection or without numeric fields", () => {
    setupWithPoints(m, [{ lat: 26.08, lng: 119.3, value: 10 }]);
    m.selectedLayerId = null;
    expect(m.getFilterModel()).toBeNull();

    m.selectedLayerId = "layer1";
    // A marker that carries no numeric data at all.
    vi.spyOn(window.map.foliplus!.LayerAPI!, "extractPoints").mockReturnValue([
      {
        lat: 26.08,
        lng: 119.3,
        marker: { getLatLng: () => ({ lat: 26.08, lng: 119.3 }) } as any,
      },
    ]);
    expect(m.getFilterModel()).toBeNull();
  });

  it("filters are attributed per source: A → B → A restores A's filter", () => {
    const ptsA = [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 30 },
    ];
    const ptsB = [
      { lat: 26.08, lng: 119.3, value: 100 },
      { lat: 26.09, lng: 119.31, value: 200 },
      { lat: 26.1, lng: 119.32, value: 300 },
    ];
    setupWithPoints(m, ptsA);
    const extract = window.map.foliplus!.LayerAPI!
      .extractPoints as unknown as ReturnType<typeof vi.fn>;

    // Source A: commit a filter.
    m.renderHexagons();
    m.setFilter({ kind: "atom", field: "value", op: "between", range: [10, 20] });
    expect(m.getFilterModel()!.filter).toBeDefined();

    // Switch to source B (different extent, different count). Both source
    // infos stay registered — a switch changes the selection, not the list.
    m.pointLayers.push({ id: "layer2", name: "Q", layer: {}, count: ptsB.length });
    m.selectedLayerId = "layer2";
    extract.mockImplementation(() =>
      ptsB.map(p => ({
        lat: p.lat,
        lng: p.lng,
        marker: {
          getLatLng: () => ({ lat: p.lat, lng: p.lng }),
          value: p.value,
          feature: { properties: {} },
        },
      })),
    );
    m.renderHexagons();
    const modelB = m.getFilterModel()!;
    expect(modelB.dimensions[0]).toMatchObject({ kind: "range", range: [100, 300] });
    expect(modelB.filter).toBeUndefined(); // B never had a filter
    expect(modelB.total).toBe(3);

    // …and back to A: A's filter is exactly what the user left there.
    extract.mockImplementation(() =>
      ptsA.map(p => ({
        lat: p.lat,
        lng: p.lng,
        marker: {
          getLatLng: () => ({ lat: p.lat, lng: p.lng }),
          value: p.value,
          feature: { properties: {} },
        },
      })),
    );
    m.selectedLayerId = "layer1";
    m.renderHexagons();
    const modelA = m.getFilterModel()!;
    expect(modelA.dimensions[0]).toMatchObject({ kind: "range", range: [10, 30] });
    expect(modelA.filter).toEqual({
      kind: "atom",
      field: "value",
      op: "between",
      range: [10, 20],
    });
  });

  it("revalidates the stored filter when the source content shrinks", () => {
    const original = [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 30 },
    ];
    setupWithPoints(m, original);
    m.renderHexagons();
    m.setFilter({ kind: "atom", field: "value", op: "between", range: [10, 20] });
    expect(m.getFilterModel()!.filter).toBeDefined();

    // Data update: the same source now only carries values 1..5 — the
    // stored band [10, 20] no longer intersects the extent.
    const extract = window.map.foliplus!.LayerAPI!
      .extractPoints as unknown as ReturnType<typeof vi.fn>;
    extract.mockImplementation(() =>
      [
        { lat: 26.08, lng: 119.3, value: 1 },
        { lat: 26.09, lng: 119.31, value: 5 },
      ].map(p => ({
        lat: p.lat,
        lng: p.lng,
        marker: {
          getLatLng: () => ({ lat: p.lat, lng: p.lng }),
          value: p.value,
          feature: { properties: {} },
        },
      })),
    );
    // Invalidate the extraction caches the way onLayerChange does.
    (m as any).cachedPoints = null;
    (m as any).cachedSnapshot = null;
    (m as any).cachedSnapshotLayerId = null;
    const spy = watchFilterEvents(m, events);
    m.renderHexagons();

    // The band clamps into the new extent [1, 5] → [5, 5]; the notification
    // goes out once, after the render that used the corrected filter.
    expect(m.getFilterModel()!.filter).toEqual({
      kind: "atom",
      field: "value",
      op: "between",
      range: [5, 5],
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("drops the filter when its field disappears from the source", () => {
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 30 },
    ]);
    m.renderHexagons();
    m.setFilter({ kind: "atom", field: "value", op: "between", range: [10, 20] });

    // Content update: same layer, but the numeric field is gone.
    const extract = window.map.foliplus!.LayerAPI!
      .extractPoints as unknown as ReturnType<typeof vi.fn>;
    extract.mockImplementation(() =>
      [
        { lat: 26.08, lng: 119.3 },
        { lat: 26.09, lng: 119.31 },
      ].map(p => ({
        lat: p.lat,
        lng: p.lng,
        marker: {
          getLatLng: () => ({ lat: p.lat, lng: p.lng }),
          feature: { properties: { label: "x" } },
        },
      })),
    );
    (m as any).cachedPoints = null;
    (m as any).cachedSnapshot = null;
    (m as any).cachedSnapshotLayerId = null;
    const spy = watchFilterEvents(m, events);
    m.renderHexagons();

    expect(m.layerFilters.size).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("resetState clears every source's filter and publishes the change", () => {
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 30 },
    ]);
    m.renderHexagons();
    m.setFilter({ kind: "atom", field: "value", op: "between", range: [10, 20] });
    const spy = watchFilterEvents(m, events);

    m.resetState({} as any);

    expect(m.layerFilters.size).toBe(0);
    expect((m as any).cachedSnapshot).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ id: m.layerId });
  });

  it("resetState without a filter does not publish", () => {
    setupWithPoints(m, [{ lat: 26.08, lng: 119.3, value: 10 }]);
    m.renderHexagons();
    const spy = watchFilterEvents(m, events);
    m.resetState({} as any);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a departing filtered source is cleared and notified exactly once", () => {
    // The review's matrix: selection null, canvas clear, filter deleted, and
    // one LAYER_FILTER_CHANGE after the local state settled. This drives the
    // real onLayerChange pass instead of calling resetState directly.
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 30 },
    ]);
    m.renderHexagons();
    m.setFilter({ kind: "atom", field: "value", op: "between", range: [10, 20] });
    const spy = watchFilterEvents(m, events);

    // The source left the panel's layer list: onLayerChange rescans, finds
    // the selected id missing, and converges the selection/canvas/filter.
    m.pointLayers = [];
    m.onLayerChange();
    m.onLayerChange.flush();

    expect(m.selectedLayerId).toBeNull();
    expect(m.layerFilters.size).toBe(0);
    expect((m as any).cachedFeatures).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ id: m.layerId });
  });

  it("a departing source without a filter does not publish", () => {
    setupWithPoints(m, [{ lat: 26.08, lng: 119.3, value: 10 }]);
    m.renderHexagons();
    const spy = watchFilterEvents(m, events);

    m.pointLayers = [];
    m.onLayerChange();
    m.onLayerChange.flush();

    expect(m.selectedLayerId).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("a throwing terminal count consumer cannot truncate the filter notification", () => {
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 30 },
    ]);
    m.renderHexagons();
    const boom = vi.fn(() => {
      throw new Error("count boom");
    });
    const after = vi.fn();
    events.on(EVENTS.LAYER_ITEM_COUNT_CHANGE, boom);
    events.on(EVENTS.LAYER_ITEM_COUNT_CHANGE, after);
    const spy = watchFilterEvents(m, events);

    expect(() =>
      m.setFilter({ kind: "atom", field: "value", op: "between", range: [10, 20] }),
    ).toThrow("count boom");

    // The count fan-out ran in full, the notification still reached its
    // observers, and the terminal failure surfaced only at the operation's
    // end — not mid-fan-out.
    expect(boom).toHaveBeenCalled();
    expect(after).toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(m.getFilterModel()!.filter).toBeDefined();
  });

  it("clearHeatmapCanvas keeps per-source filters (a repaint is not a clear)", () => {
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 30 },
    ]);
    m.renderHexagons();
    m.setFilter({ kind: "atom", field: "value", op: "between", range: [10, 20] });

    m.clearHeatmapCanvas();

    expect(m.layerFilters.size).toBe(1);
  });

  it("filter application reduces the point set via aggregateBins", () => {
    const points = [
      { lat: 26.08, lng: 119.3, value: 5 },
      { lat: 26.09, lng: 119.31, value: 15 },
      { lat: 26.1, lng: 119.32, value: 25 },
      { lat: 26.11, lng: 119.33, value: 35 },
    ];
    setupWithPoints(m, points);

    m.renderHexagons();
    const unfilteredAgg = (m as any).cachedAgg?.data;
    const unfilteredCount = Object.values(unfilteredAgg.hexCells).reduce(
      (sum: number, c: any) => sum + c.count,
      0,
    );
    expect(unfilteredCount).toBe(4);

    m.setFilter({ kind: "atom", field: "value", op: "between", range: [10, 30] });
    const filteredAgg = (m as any).cachedAgg?.data;
    const filteredCount = Object.values(filteredAgg.hexCells).reduce(
      (sum: number, c: any) => sum + c.count,
      0,
    );
    // Values 5 and 35 are excluded → 2 points remain.
    expect(filteredCount).toBe(2);
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

    (m as any).map = {
      _container: { clientWidth: 800, clientHeight: 600 },
      getZoom: () => 10,
      getBounds: () => ({ isValid: () => true, contains: () => true }),
      getContainer: () => ({ clientWidth: 800, clientHeight: 600 }),
    } as any;
    h3Spy.mockClear();
    m.renderHexagons();
    expect(h3Spy.mock.calls.length).toBeGreaterThan(0);
  });

  it("drops a cell whose points are all filtered out", () => {
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.08, lng: 119.3, value: 20 },
    ]);
    m.renderHexagons();
    // [15, 15] survives clamping (extent [10, 20]) and excludes both
    // co-located points — the aggregate falls through to the canvas clear
    // instead of emitting an empty cell.
    m.setFilter({ kind: "atom", field: "value", op: "between", range: [15, 15] });
    expect((m as any).cachedFeatures).toBeNull();
  });

  it("extractMarkerFields resolves value, options.value, and properties fields", () => {
    const marker1 = { value: 42, options: {}, feature: { properties: {} } } as any;
    expect(extractMarkerFields(marker1)).toEqual({ value: 42 });

    const marker2 = { options: { value: 99 }, feature: { properties: {} } } as any;
    expect(extractMarkerFields(marker2)).toEqual({ value: 99 });

    const marker3 = {
      options: {},
      feature: { properties: { temperature: 36.5, status: "ok" } },
    } as any;
    expect(extractMarkerFields(marker3)).toEqual({ temperature: 36.5 });
  });

  it("extractMarkerFields skips a properties key the contract already holds", () => {
    const marker = {
      value: 42,
      options: {},
      feature: { properties: { value: 7, other: 3 } },
    } as any;
    expect(extractMarkerFields(marker)).toEqual({ value: 42, other: 3 });
  });
});

// ── Field linkage (first batch of the #724 review) ──
describe("HeatmapControl filter field follows the aggregation field", () => {
  let m: HeatmapManager;

  const points = [
    { lat: 26.08, lng: 119.3, value: 10, field: "b" },
    { lat: 26.09, lng: 119.31, value: 20, field: "a" },
    { lat: 26.1, lng: 119.32, value: 30, field: "a" },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    m = makeManager();
    setupWithPoints(m, points);
  });

  it("reads this.field, not numericFields[0]", () => {
    // numericFields order is ["b", "a"]; the aggregation field is "a".
    m.agg = "sum";
    m.field = "a";
    m.renderHexagons();
    const model = m.getFilterModel();
    expect(model).not.toBeNull();
    expect(model!.dimensions[0]).toMatchObject({ kind: "range", field: "a" });
    expect(model!.dimensions[0]).toMatchObject({ kind: "range", range: [20, 30] });
    expect(model!.total).toBe(3);
  });

  it("falls back to the first numeric field when this.field is empty", () => {
    // Marker values are exposed as the "value" field, which the snapshot
    // orders first — the default field is numericFields[0].
    m.field = "";
    const model = m.getFilterModel()!;
    expect(model.dimensions[0]).toMatchObject({ kind: "range", field: "value" });
    expect(model.dimensions[0]).toMatchObject({ kind: "range", range: [10, 30] });
  });

  it("syncFilterField drops a filter written for the previous field", () => {
    m.agg = "sum";
    m.field = "a";
    m.setFilter({ kind: "atom", field: "a", op: "between", range: [20, 25] });
    expect(m.layerFilters.size).toBe(1);
    m.field = "b";
    m.syncFilterField();
    expect(m.layerFilters.size).toBe(0);
  });

  it("syncFilterField keeps a filter bound to the same field", () => {
    m.agg = "sum";
    m.field = "a";
    m.setFilter({ kind: "atom", field: "a", op: "between", range: [20, 25] });
    m.syncFilterField();
    expect(m.layerFilters.size).toBe(1);
  });
});

describe("HeatmapManager aggregateData onEmpty default", () => {
  it("falls back to clearHeatmapCanvas when no onEmpty is passed", () => {
    const m = makeManager();
    setupWithPoints(m, []);
    const clear = vi.spyOn(m, "clearHeatmapCanvas").mockImplementation(() => {});
    expect(m.aggregateData([], 5)).toBeNull();
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });
});

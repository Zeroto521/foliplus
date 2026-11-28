// Unit tests for HeatmapControl/filter — the filter mixin methods.
import {
  RANGE,
  USER_RANGE,
  fsGet,
  fsHas,
  fsSize,
  makeConfig,
  makeCtrl,
  makeManager,
  prepare,
  reload,
  seedable,
  snapshot,
  userWrite,
} from "./fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents, publish } from "#core/event/index.js";
import { type LayerFilter, filterStoreKey } from "#core/layer/index.js";
import type { HeatmapManager } from "#control/HeatmapControl/manager.js";

afterEach(() => {
  delete globalThis.h3;
  delete globalThis.chroma;
});

describe("HeatmapManager — declared filter guards", () => {
  beforeEach(() => window.localStorage.clear());

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("clamps the declared range to the snapshot extent", () => {
    const manager = seedable({ ...RANGE, range: [10, 500] });

    manager.seedDeclaredFilter();

    expect(fsGet(manager, "pts")).toEqual({
      kind: "atom",
      field: "score",
      op: "between",
      range: [10, 100],
    });
  });

  it("a declared range covering the whole extent is not a filter", () => {
    const manager = seedable({ ...RANGE, range: [0, 100] });
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

    manager.seedDeclaredFilter();

    expect(fsHas(manager, "pts")).toBe(false);
    // Covering the whole extent is the same state as "no filter", so it is a
    // legal no-op — reporting it would call a valid declaration a data problem.
    expect(warn).not.toHaveBeenCalled();
  });

  it("reports a field with no numeric extent and starts unfiltered", () => {
    const manager = seedable(RANGE);
    // The source has points but the field carries no value on any of them, so
    // the panel has no range to render the declaration on.
    manager.cachedSnapshot = {
      points: [{ value: 0 }],
      numericFields: ["score"],
      ranges: {},
    } as any;
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

    manager.seedDeclaredFilter();

    expect(fsHas(manager, "pts")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a snapshot that is not populated yet is not a data problem", () => {
    // The seed runs from the panel build, which can precede the source's first
    // paint. An empty snapshot then is timing, not a declaration defect:
    // reporting it would blame the author's declaration for an empty read —
    // and the report would be remembered in declarationWarned, silencing the
    // real problem once the data arrives.
    const manager = seedable(RANGE);
    manager.cachedSnapshot = {
      points: [],
      numericFields: ["score"],
      ranges: {},
    } as any;
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});
    const debug = vi.spyOn((manager as any).log, "debug").mockImplementation(() => {});

    manager.seedDeclaredFilter();

    expect(fsHas(manager, "pts")).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
    expect(String(debug.mock.calls[0][0])).toContain("not populated");
    expect(manager.declarationWarned.size).toBe(0);
  });

  it("a snapshot that was never built is not a data problem either", () => {
    // The other branch of the same timing check: no snapshot object at all (the
    // cache is cleared on a source or content change and the seed can run
    // before getSelectedPoints rebuilds it). Still not a declaration defect.
    const manager = seedable(RANGE);
    manager.cachedSnapshot = null;
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});
    const debug = vi.spyOn((manager as any).log, "debug").mockImplementation(() => {});

    manager.seedDeclaredFilter();

    expect(fsHas(manager, "pts")).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it("still reports the real missing extent once the frame arrives", () => {
    // Same manager, two phases: quiet while the snapshot is empty, then the
    // genuine report is not swallowed by a flag the empty read would have set.
    const manager = seedable(RANGE);
    manager.cachedSnapshot = {
      points: [],
      numericFields: ["score"],
      ranges: {},
    } as any;
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});
    vi.spyOn((manager as any).log, "debug").mockImplementation(() => {});

    manager.seedDeclaredFilter();
    manager.cachedSnapshot = {
      points: [{ value: 0 }],
      numericFields: ["score"],
      ranges: {},
    } as any;
    manager.seedDeclaredFilter();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][1])).toContain("no usable extent");
  });

  it("an unrelated save persists the seeded declaration", () => {
    // Per the declaration-only contract: a seeded declaration is readable
    // after the load but is NEVER written to persistence. An unrelated save
    // (a color change) writes style fields only; the store's record stays
    // empty because the user never took the slot.
    const manager = seedable(RANGE);
    manager.seedDeclaredFilter();
    expect(fsGet(manager, "pts")).toEqual(RANGE);
    expect(manager.filterStore.isOwned(manager.layerId, "pts")).toBe(false);

    manager.saveConfig();
    // The old component key keeps only style fields — no filters, no flag.
    expect(manager.loadSavedConfig()?.filters).toBeUndefined();
    // The shared store key has no record either: nothing user-set.
    expect(window.localStorage.getItem(filterStoreKey(manager.map))).toBeNull();
    manager.clearSavedConfig();
  });

  it("seeds a hand-edited atom that carries no range to check", () => {
    // F15: CONF can be hand-edited into an equality atom, which has no range
    // for the extent-intersection guard to test. The guard is range-only on
    // purpose; the atom passes through to the runtime's normalizer instead of
    // being rejected as "outside the extent".
    const manager = seedable({ kind: "atom", field: "score", op: "eq", value: 42 });
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

    manager.seedDeclaredFilter();

    expect(fsGet(manager, "pts")).toEqual({
      kind: "atom",
      field: "score",
      op: "eq",
      value: 42,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("reports a declaration outside the extent and starts unfiltered", () => {
    const manager = seedable({ ...RANGE, range: [1000, 2000] });
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

    manager.seedDeclaredFilter();

    // Clamping would collapse it onto one bound and hide the data; the seed
    // reports it and keeps the layer unfiltered instead.
    expect(fsHas(manager, "pts")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("an invalid declaration stays undeclared after Clear and reload, warning once", () => {
    const manager = seedable({ ...RANGE, range: [1000, 2000] });
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

    manager.seedDeclaredFilter();
    manager.seedDeclaredFilter();

    // Warn once per manager, never a half-applied clamp.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(fsHas(manager, "pts")).toBe(false);

    // Clear returns to the declared state; the declaration is still invalid,
    // so the slot stays empty and the warning is not repeated.
    manager.resetState(makeConfig());
    manager.selectedLayerId = "pts";
    manager.availableFields = ["score"];
    manager.cachedSnapshot = snapshot();
    manager.seedDeclaredFilter();
    expect(fsHas(manager, "pts")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);

    // A reload reads the same invalid declaration and starts undeclared too.
    const reloaded = seedable({ ...RANGE, range: [1000, 2000] });
    reloaded.seedDeclaredFilter();
    expect(fsHas(reloaded, "pts")).toBe(false);
  });

  it("keeps the declaration out when a restored per-source filter exists", () => {
    const manager = seedable(RANGE);
    const restored = USER_RANGE;
    manager.filterStore.restore(manager.layerId, "pts", restored);

    manager.seedDeclaredFilter();

    expect(fsGet(manager, "pts")).toEqual(restored);
  });

  it("ignores a declaration bound to a field the panel does not filter", () => {
    const manager = seedable({
      kind: "atom",
      field: "ghost",
      op: "between",
      range: [10, 50],
    });
    // The fixture's env log is a stub; the report goes through it, not console.
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

    manager.seedDeclaredFilter();
    manager.seedDeclaredFilter();

    expect(fsHas(manager, "pts")).toBe(false);
    // The seed runs on every rebuild of the first open; one report is enough.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("seeds before the frame is drawn when the user picks a source", async () => {
    const { initScan } = await import("#control/HeatmapControl/ui.js");
    const declared = {
      kind: "atom",
      field: "val",
      op: "between",
      range: [1, 2],
    } as LayerFilter;
    const manager = makeManager({ filter: declared as Record<string, unknown> });
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => [
      { id: "first", name: "First", layer: {} },
      { id: "second", name: "Second", layer: {} },
    ]);
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 1, marker: { feature: { properties: { val: 1 } } } },
      { lat: 2, lng: 2, marker: { feature: { properties: { val: 3 } } } },
    ]);
    const ctrl = makeCtrl(manager);
    initScan(ctrl);
    // Two point layers: nothing is auto-selected, so the dropdown is the only
    // way in and the declaration has to cover it too.
    expect(manager.selectedLayerId).toBeNull();

    let filterAtRender: LayerFilter | undefined;
    const render = vi.spyOn(manager, "renderHexagons").mockImplementation(() => {
      filterAtRender = fsGet(manager, "second");
    });
    ctrl.layerSelect.value = "second";
    ctrl.layerSelect.onchange?.(new Event("change"));

    // The frame is drawn with the declaration already in the slot; seeding
    // after the draw would paint unfiltered and leave the panel ahead of it.
    expect(filterAtRender).toEqual(declared);
    expect(fsGet(manager, "second")).toEqual(declared);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("the factory Reset drops the ownership so the declaration returns", () => {
    const manager = seedable(RANGE);
    manager.filterStore.restore(manager.layerId, manager.selectedLayerId!, RANGE);

    manager.resetState(makeConfig());

    expect(manager.filterStore.isOwned(manager.layerId, manager.selectedLayerId)).toBe(
      false,
    );
    expect(manager.hasScanned).toBe(false);
  });

  it("a data change that drops the field re-seeds the declaration on rebuild", () => {
    const manager = seedable(RANGE);
    // Seed on first open: the declaration owns the slot.
    manager.seedDeclaredFilter();
    expect(fsGet(manager, "pts")).toEqual(RANGE);
    expect(manager.filterStore.isOwned(manager.layerId, manager.selectedLayerId)).toBe(
      false,
    );

    // Data change drops the field: the source's rebuilt snapshot no longer
    // carries "score". A public render of the selected source revalidates the
    // stored filter against it, normalising to undefined and deleting the
    // slot (it is a statement about data that no longer exists).
    manager.cachedSnapshot = snapshot({});
    manager.renderHexagons();
    expect(fsHas(manager, "pts")).toBe(false);

    // Rebuild: the snapshot is rebuilt with the field back and the manager
    // re-runs the one-shot declaration guard (seedDeclaredFilter, the panel
    // build entry), so the declaration re-seeds.
    manager.cachedSnapshot = snapshot();
    manager.seedDeclaredFilter();
    expect(manager.filterStore.isOwned(manager.layerId, manager.selectedLayerId)).toBe(
      false,
    );
    expect(fsGet(manager, "pts")).toEqual(RANGE);
  });
});

// ── Cross-branch filter contract (range branch) ─────────────────────────────
//
// One half of a mirrored pair. The sibling
// test/js/control/MeasureControl/manager.test.ts pins the same rows against
// the enum branch; the describe/it structure is identical on purpose, so a
// change that moves one branch without the other fails here instead of in a
// user report.
//
// The rows, in order:
//   1. a declared filter is a starting condition and owns nothing;
//   2. a user write owns the slot and wins from then on;
//   3. a stored filter wins over the declaration;
//   4. the filter row's Clear keeps the empty slot, while the factory Reset
//      drops ownership and re-seeds the declaration;
//   5. an unusable declaration warns once and never leaves a half-open state;
//   6. a saved filter round-trips through persistence;
//   7. the dimension carries values only — captions are panel chrome.
describe("HeatmapManager — filter contract (range branch)", () => {
  beforeEach(() => window.localStorage.clear());

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  describe("1. a declared filter is a starting condition", () => {
    it("seeds the declaration without taking ownership", () => {
      const manager = seedable(RANGE);

      manager.seedDeclaredFilter();

      expect(fsGet(manager, "pts")).toEqual(RANGE);
      // A declaration is not a user choice: the factory Reset can still
      // return to it.
      expect(
        manager.filterStore.isOwned(manager.layerId, manager.selectedLayerId),
      ).toBe(false);
    });

    it("does not seed while a stored record owns the slot", () => {
      const manager = seedable(RANGE);
      // The stored record owns the slot with no value — the user cleared the
      // filter (old semantics: filtersTouched flag set, no map entry). A
      // restore with a VALUE would model the opposite (user set a filter),
      // which seeding must also respect but this test pins the cleared case.
      manager.filterStore.restore(manager.layerId, manager.selectedLayerId!, undefined);

      manager.seedDeclaredFilter();

      expect(fsHas(manager, "pts")).toBe(false);
      expect(
        manager.filterStore.isOwned(manager.layerId, manager.selectedLayerId),
      ).toBe(true);
    });
  });

  describe("2. a user write owns the slot", () => {
    it("takes ownership and persists the user's choice", () => {
      const manager = userWrite(seedable(null));

      expect(
        manager.filterStore.isOwned(manager.layerId, manager.selectedLayerId),
      ).toBe(true);
      expect(fsGet(manager, "pts")).toEqual(USER_RANGE);
      // The user's choice persists under the shared store key.
      const saved = manager.loadSavedConfig();
      expect(saved?.filters).toBeUndefined();
      const storeRecord = JSON.parse(
        window.localStorage.getItem(filterStoreKey(manager.map))!,
      );
      expect(storeRecord.data.layers[manager.layerId].sources.pts).toEqual({
        touched: true,
        value: USER_RANGE,
      });
    });
  });

  describe("3. a stored filter wins over the declaration", () => {
    it("restores the stored filter instead of the declaration", () => {
      // A record from an earlier session, with its ownership flag: the shared
      // store owns the slot, so the declaration must not re-seed.
      const manager = makeManager({ filter: RANGE } as Partial<ComponentConfig>);
      manager.filterStore.restore(manager.layerId, "pts", USER_RANGE);

      manager.applySavedConfig(manager.loadSavedConfig()!);
      prepare(manager).seedDeclaredFilter();

      expect(fsGet(manager, "pts")).toEqual(USER_RANGE);
      expect(
        manager.filterStore.isOwned(manager.layerId, manager.selectedLayerId!),
      ).toBe(true);
    });
  });

  describe("4. the two clear paths are not the same", () => {
    it("the filter row's Clear keeps the user's empty slot", () => {
      const manager = seedable(RANGE);
      manager.renderHexagons = vi.fn() as any;
      manager.seedDeclaredFilter();
      expect(fsGet(manager, "pts")).toEqual(RANGE);

      manager.setFilter(undefined);
      expect(
        manager.filterStore.isOwned(manager.layerId, manager.selectedLayerId),
      ).toBe(true);
      expect(fsHas(manager, "pts")).toBe(false);

      // The declaration must not come back in this session...
      manager.seedDeclaredFilter();
      expect(fsHas(manager, "pts")).toBe(false);

      // ...or on the next one: the record owns an explicitly empty slot.
      const reloaded = reload(RANGE);
      reloaded.seedDeclaredFilter();
      expect(
        reloaded.filterStore.isOwned(reloaded.layerId, reloaded.selectedLayerId),
      ).toBe(true);
      expect(fsHas(reloaded, "pts")).toBe(false);
    });

    it("the factory Reset drops ownership and re-seeds the declaration", () => {
      const manager = seedable(RANGE);
      manager.filterStore.restore(manager.layerId, "pts", USER_RANGE); // a user wrote earlier
      manager.filterStore.restore(manager.layerId, "pts", USER_RANGE);

      // The panel's Clear is a factory Reset: resetState + clearSavedConfig,
      // exactly what the real button runs.
      manager.resetState(window.CONFIG);
      manager.clearSavedConfig();
      expect(
        manager.filterStore.isOwned(manager.layerId, manager.selectedLayerId),
      ).toBe(false);
      expect(fsSize(manager)).toBe(0);

      prepare(manager).seedDeclaredFilter();
      expect(fsGet(manager, "pts")).toEqual(RANGE);
      expect(
        manager.filterStore.isOwned(manager.layerId, manager.selectedLayerId),
      ).toBe(false);

      // The record is gone, so a reload starts from the declaration again.
      const reloaded = reload(RANGE);
      reloaded.seedDeclaredFilter();
      expect(fsGet(reloaded, "pts")).toEqual(RANGE);
      expect(
        reloaded.filterStore.isOwned(reloaded.layerId, reloaded.selectedLayerId),
      ).toBe(false);
    });
  });

  describe("5. an unusable declaration warns once, never half-applies", () => {
    it("reports the declaration once and starts unfiltered", () => {
      const manager = seedable({ kind: "atom", field: "score", op: "nope" });
      const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

      manager.seedDeclaredFilter();
      manager.seedDeclaredFilter();

      expect(fsHas(manager, "pts")).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("rejects the other branch whole instead of coercing it", () => {
      const manager = seedable({
        kind: "enum",
        field: "score",
        values: ["a", "b"],
      });
      const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

      manager.seedDeclaredFilter();

      // No partial range and no enum leaking into the numeric slot: the wrong
      // branch is undeclared, not coerced.
      expect(fsHas(manager, "pts")).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("stays undeclared after the factory Reset and a reload", () => {
      const manager = seedable({ kind: "atom", field: "score", op: "nope" });
      manager.resetState(window.CONFIG);
      manager.clearSavedConfig();

      prepare(manager).seedDeclaredFilter();
      expect(fsHas(manager, "pts")).toBe(false);

      const reloaded = reload({ kind: "atom", field: "score", op: "nope" });
      reloaded.seedDeclaredFilter();
      expect(fsHas(reloaded, "pts")).toBe(false);
    });
  });

  describe("6. a saved filter round-trips through persistence", () => {
    it("save → load → apply restores the filter and its ownership", () => {
      userWrite(seedable(null));

      const reloaded = reload(RANGE);
      reloaded.seedDeclaredFilter();

      expect(
        reloaded.filterStore.isOwned(reloaded.layerId, reloaded.selectedLayerId),
      ).toBe(true);
      expect(fsGet(reloaded, "pts")).toEqual(USER_RANGE);
    });
  });

  describe("7. the dimension carries values only", () => {
    it("exposes values with captions left to the panel", () => {
      const manager = seedable(RANGE);
      manager.seedDeclaredFilter();

      const dim = manager.getFilterModel()!.dimensions[0];

      expect(dim).toMatchObject({ kind: "range", field: "score" });
      // The panel reads its shared locale keys (filter_field / filter_range);
      // a component-owned caption here is the defect the contract prevents.
      expect(dim).not.toHaveProperty("fieldLabel");
      expect(dim).not.toHaveProperty("label");
    });
  });
});

// ── Filter owner fixtures ─────────────────────────────────────────────
// Shared by the filter-owner suites below; both build a real manager and
// drive the same extract → bins path the UI does.

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
    expect(fsSize(m)).toBe(0);
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
    expect(spy).toHaveBeenCalledWith(
      { id: m.layerId },
      { origin: { kind: "user", via: "panel" }, revision: expect.any(Number) },
    );
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

    expect(fsSize(m)).toBe(0);
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

    expect(fsSize(m)).toBe(0);
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

  it("binds the filter dimension to the aggregation field without owning captions", () => {
    setupWithPoints(m, [
      { lat: 26.08, lng: 119.3, value: 10 },
      { lat: 26.09, lng: 119.31, value: 20 },
    ]);
    m.renderHexagons();
    const dim = m.getFilterModel()!.dimensions[0];
    // The popup repeats the aggregation field the user picked with field= as
    // a read-only row; its wording is the panel's shared vocabulary, so the
    // dimension carries the field as a value and no caption of its own.
    expect(dim.kind).toBe("range");
    expect(dim.field).toBe("value");
    expect(dim).not.toHaveProperty("fieldLabel");
    expect(dim).not.toHaveProperty("label");
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

    expect(fsSize(m)).toBe(0);
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

    expect(fsSize(m)).toBe(0);
    expect((m as any).cachedSnapshot).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      { id: m.layerId },
      { origin: { kind: "user", via: "panel" }, revision: expect.any(Number) },
    );
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
    expect(fsSize(m)).toBe(0);
    expect((m as any).cachedFeatures).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      { id: m.layerId },
      { origin: { kind: "user", via: "panel" }, revision: expect.any(Number) },
    );
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

    expect(fsSize(m)).toBe(1);
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
});

// ── Field linkage (first batch of the #724 review) ──

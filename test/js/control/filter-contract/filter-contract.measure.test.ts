// Cross-arm filter contract — MEASURE (enum) arm.
//
// The second half of the cross-arm contract matrix. The sibling
// filter-contract.heatmap.test.ts pins the same rows against the range arm;
// keeping the describe/it structure identical is the point: a change that
// moves one arm without the other fails here instead of in a user report.
//
// The rows, in order:
//   1. a declared filter is a starting condition and owns nothing;
//   2. a user write owns the slot and wins from then on;
//   3. a stored filter wins over the declaration;
//   4. the filter row's Clear owns the empty slot, while the factory Reset
//      drops ownership and re-seeds the declaration;
//   5. an unusable declaration warns once and never leaves a half-open state;
//   6. a saved filter round-trips through persistence;
//   7. the dimension carries values only — captions are panel chrome.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#control/MeasureControl/const.js";
import { MeasureManager } from "#control/MeasureControl/manager.js";
import { makeControlEnv } from "../../fixture.js";

// ── Module-level mocks (hoisted before the manager import) ──
const placeLabels = vi.hoisted(() => vi.fn(() => 0));
vi.mock("#control/MeasureControl/collision.js", () => ({
  placeLabels,
  mapProjector: () => ({ box: () => ({ x: 0, y: 0, w: 64, h: 18 }) }),
}));
const modeMocks = vi.hoisted(() => ({ guardBlocked: vi.fn(() => false) }));
vi.mock("#core/mode.js", async () => {
  const real = (await vi.importActual("#core/mode.js")) as Record<string, unknown>;
  return { ...real, guardBlocked: modeMocks.guardBlocked };
});

/** The enum filter shape the Measure panel writes. */
const filter = (values: string[]): any => ({
  kind: "enum",
  field: CONST.FILTER.FIELD,
  values,
});

/** Build a MeasureManager on a fresh container. The layer id is derived from
 *  the container id + generateId(prefix) — no opts id keeps it stable across
 *  "reloads" (a second makeManager on a new container with the same id). */
function makeManager(opts?: { id?: string }) {
  window.CONFIG = { ...window.CONFIG, name: "MeasureControl", locale_code: "en" };
  const env = makeControlEnv();
  const attached = new Set<unknown>();
  const layers = {
    register: vi.fn(),
    unregister: vi.fn(),
    clearLayers: vi.fn(),
    addLayer: vi.fn((l: unknown) => l),
    removeLayer: vi.fn(),
    mainLayer: {
      addLayer: vi.fn((leaf: unknown) => {
        attached.add(leaf);
        return leaf;
      }),
      removeLayer: vi.fn((leaf: unknown) => {
        attached.delete(leaf);
        return leaf;
      }),
      hasLayer: vi.fn((leaf: unknown) => attached.has(leaf)),
    },
  };
  window.L.marker = vi.fn(() => {
    const m: any = {
      bindPopup: vi.fn(() => m),
      openPopup: vi.fn(),
      addTo: vi.fn(() => m),
      getPopup: () => null,
      setPopupContent: vi.fn(),
      closePopup: vi.fn(),
      getLatLng: vi.fn(() => ({ lat: 0, lng: 0 })),
      setLatLng: vi.fn(),
      getElement: vi.fn(() => null),
    };
    m.on = vi.fn(() => m);
    m.off = vi.fn(() => m);
    return m;
  });
  window.L.circleMarker = vi.fn(() => ({}));
  window.L.divIcon = vi.fn(() => ({}));
  window.L.polyline = vi.fn(() => ({ addTo: vi.fn(), on: vi.fn() }));
  window.L.polygon = vi.fn(() => ({ addTo: vi.fn(), on: vi.fn() }));
  window.L.latLng = vi.fn((lat: number, lng: number) => ({ lat, lng }));

  const container = document.createElement("div");
  const map = {
    getContainer: () => container,
    on: vi.fn(),
    off: vi.fn(),
    eachLayer: vi.fn(),
    getSize: () => ({ x: 1000, y: 800 }),
    latLngToContainerPoint: () => ({ x: 0, y: 0 }),
    foliplus: {
      showHint: vi.fn(),
      hideHint: vi.fn(),
      interaction: { shortcuts: [] as Array<Record<string, unknown>> },
      events: { emit: vi.fn(), publish: vi.fn() },
      LayerAPI: { createLayers: vi.fn(() => layers) },
    },
  };
  const manager = new MeasureManager(map, env, opts);
  manager.init();
  return { manager, map, container, layers };
}

const addMeasurements = (manager: any): void => {
  manager.store.add({ id: "m1", type: CONST.MEASURE_MODE.MARKER });
  manager.store.add({ id: "m2", type: CONST.MEASURE_MODE.DISTANCE });
  manager.store.add({ id: "m3", type: CONST.MEASURE_MODE.POLYGON });
};

const createLayersOpts = (map: any): any =>
  (map.foliplus.LayerAPI.createLayers.mock.calls as unknown[][])[0][0];

const storageKey = (manager: any): string => manager.filterStorageKey as string;

/** Write a filter record as if an earlier session had owned the slot. A probe
 *  manager supplies the stable key (container id + layer id). */
const seedRecord = (record: unknown): string => {
  const { manager } = makeManager();
  const key = storageKey(manager);
  window.localStorage.setItem(key, JSON.stringify(record));
  // The measurements list must not distract the reload; the filter record is
  // the thing under test.
  window.localStorage.removeItem(CONST.STORAGE.KEY);
  return key;
};

/** A reload: the measurements list is dropped, the filter record survives. */
const reload = () => {
  window.localStorage.removeItem(CONST.STORAGE.KEY);
  return makeManager();
};

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  window.localStorage.clear();
  // CONFIG is shared process-wide; a declared-filter test must not leak its
  // declaration into the next manager.
  window.CONFIG = { ...window.CONFIG, filter: null };
});

describe("filter contract — measure (enum arm)", () => {
  describe("1. a declared filter is a starting condition", () => {
    it("seeds the declared enum and leaves the slot unowned", () => {
      window.CONFIG = {
        ...window.CONFIG,
        filter: filter([CONST.MEASURE_MODE.DISTANCE]),
      };
      const { manager, map } = makeManager();
      addMeasurements(manager);

      expect((manager as any).measureFilter).toEqual(
        filter([CONST.MEASURE_MODE.DISTANCE]),
      );
      // A declaration is not a user choice: the factory Reset can still
      // return to it.
      expect((manager as any).filtersTouched).toBe(false);

      const model = createLayersOpts(map).filterProvider();
      expect(model.filter).toEqual(filter([CONST.MEASURE_MODE.DISTANCE]));
      expect(model.kept).toBe(1);
      expect(model.total).toBe(3);
    });

    it("does not seed when the stored record owns the slot", () => {
      // A deliberate empty record (the user cleared the filter earlier): the
      // declaration must stay out even though no filter value is stored.
      seedRecord({
        version: CONST.FILTER.RECORD_VERSION,
        filtersTouched: true,
      });
      window.CONFIG = {
        ...window.CONFIG,
        filter: filter([CONST.MEASURE_MODE.DISTANCE]),
      };

      const { manager } = makeManager();

      expect((manager as any).filtersTouched).toBe(true);
      expect((manager as any).measureFilter).toBeUndefined();
    });
  });

  describe("2. a user write owns the slot", () => {
    it("marks the slot owned and stores the user's enum", () => {
      window.CONFIG = {
        ...window.CONFIG,
        filter: filter([CONST.MEASURE_MODE.DISTANCE]),
      };
      const { manager, map } = makeManager();
      addMeasurements(manager);

      createLayersOpts(map).filterSetter(filter([CONST.MEASURE_MODE.MARKER]));

      expect((manager as any).filtersTouched).toBe(true);
      expect((manager as any).measureFilter).toEqual(
        filter([CONST.MEASURE_MODE.MARKER]),
      );
      const record = JSON.parse(window.localStorage.getItem(storageKey(manager))!);
      expect(record.version).toBe(CONST.FILTER.RECORD_VERSION);
      expect(record.filter).toEqual(filter([CONST.MEASURE_MODE.MARKER]));
      expect(record.filtersTouched).toBe(true);
    });
  });

  describe("3. a stored filter wins over the declaration", () => {
    it("restores the stored enum instead of seeding the declaration", () => {
      seedRecord({
        version: CONST.FILTER.RECORD_VERSION,
        filter: filter([CONST.MEASURE_MODE.MARKER]),
        filtersTouched: true,
      });
      window.CONFIG = {
        ...window.CONFIG,
        filter: filter([CONST.MEASURE_MODE.DISTANCE]),
      };

      const { manager, map } = makeManager();

      expect((manager as any).filtersTouched).toBe(true);
      expect((manager as any).measureFilter).toEqual(
        filter([CONST.MEASURE_MODE.MARKER]),
      );
      expect(createLayersOpts(map).filterProvider().filter).toEqual(
        filter([CONST.MEASURE_MODE.MARKER]),
      );
    });
  });

  describe("4. the two clear paths are not the same", () => {
    it("the filter row's Clear owns the empty slot — no resurrection on reload", () => {
      window.CONFIG = {
        ...window.CONFIG,
        filter: filter([CONST.MEASURE_MODE.DISTANCE]),
      };
      const { manager, map } = makeManager();
      addMeasurements(manager);
      expect((manager as any).measureFilter).toEqual(
        filter([CONST.MEASURE_MODE.DISTANCE]),
      );

      createLayersOpts(map).filterSetter(undefined);

      expect((manager as any).filtersTouched).toBe(true);
      expect((manager as any).measureFilter).toBeUndefined();

      const { manager: reloaded } = reload();
      expect((reloaded as any).filtersTouched).toBe(true);
      expect((reloaded as any).measureFilter).toBeUndefined();
    });

    it("the factory Reset drops ownership and re-seeds the declaration", () => {
      window.CONFIG = {
        ...window.CONFIG,
        filter: filter([CONST.MEASURE_MODE.DISTANCE]),
      };
      const { manager, map } = makeManager();
      addMeasurements(manager);
      createLayersOpts(map).filterSetter(filter([CONST.MEASURE_MODE.MARKER]));
      expect((manager as any).filtersTouched).toBe(true);

      manager.clearAll();

      expect((manager as any).filtersTouched).toBe(false);
      expect((manager as any).measureFilter).toEqual(
        filter([CONST.MEASURE_MODE.DISTANCE]),
      );
      expect(window.localStorage.getItem(storageKey(manager))).toBeNull();

      const { manager: reloaded } = reload();
      expect((reloaded as any).filtersTouched).toBe(false);
      expect((reloaded as any).measureFilter).toEqual(
        filter([CONST.MEASURE_MODE.DISTANCE]),
      );
    });
  });

  describe("5. an unusable declaration warns once, never half-applies", () => {
    it("rejects a partially unknown list whole, warning once", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      window.CONFIG = {
        ...window.CONFIG,
        filter: filter([CONST.MEASURE_MODE.DISTANCE, "bogus"]),
      };

      const { manager } = makeManager();

      // Keeping DISTANCE would apply a condition the author never declared.
      expect((manager as any).measureFilter).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);

      // The cached declaration is still invalid on the factory Reset; it is
      // not re-normalised, so the warning is not repeated.
      manager.clearAll();
      expect((manager as any).measureFilter).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);

      const { manager: reloaded } = reload();
      expect((reloaded as any).measureFilter).toBeUndefined();
    });

    it("rejects a declaration from the other arm", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      window.CONFIG = {
        ...window.CONFIG,
        filter: {
          kind: "atom",
          field: CONST.FILTER.FIELD,
          op: "between",
          range: [1, 2],
        },
      };

      const { manager } = makeManager();

      // The panel's only dimension is the measurement type; a numeric range is
      // not coerced into it.
      expect((manager as any).measureFilter).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe("6. a saved filter round-trips through persistence", () => {
    it("save → load restores the enum and its ownership", () => {
      window.CONFIG = {
        ...window.CONFIG,
        filter: filter([CONST.MEASURE_MODE.DISTANCE]),
      };
      const { manager, map } = makeManager();
      addMeasurements(manager);
      createLayersOpts(map).filterSetter(filter([CONST.MEASURE_MODE.MARKER]));

      const { manager: reloaded, map: nextMap } = reload();

      expect((reloaded as any).filtersTouched).toBe(true);
      expect((reloaded as any).measureFilter).toEqual(
        filter([CONST.MEASURE_MODE.MARKER]),
      );
      expect(createLayersOpts(nextMap).filterProvider().filter).toEqual(
        filter([CONST.MEASURE_MODE.MARKER]),
      );
    });
  });

  describe("7. the dimension carries values only", () => {
    it("exposes the enum options in toolbar order, with captions left to the panel", () => {
      const { manager, map } = makeManager();
      addMeasurements(manager);

      const dim = createLayersOpts(map).filterProvider().dimensions[0];

      expect(dim).toMatchObject({
        kind: "enum",
        field: CONST.FILTER.FIELD,
        multi: true,
      });
      expect(dim.options.map((option: any) => option.value)).toEqual([
        CONST.MEASURE_MODE.MARKER,
        CONST.MEASURE_MODE.DISTANCE,
        CONST.MEASURE_MODE.POLYGON,
      ]);
      // The panel reads its shared locale keys (filter_enum); a
      // component-owned caption here is the defect the contract prevents.
      expect(dim).not.toHaveProperty("label");
    });
  });
});

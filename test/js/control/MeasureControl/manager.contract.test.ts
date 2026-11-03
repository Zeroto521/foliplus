// Cross-arm filter contract — MEASURE (enum) arm.
//
// The other half of a mirrored pair. The sibling
// test/js/control/HeatmapControl/manager.contract.test.ts pins the same rows
// against the range arm; the describe/it structure is identical on purpose, so
// a change that moves one arm without the other fails here instead of in a
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
import { afterEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#control/MeasureControl/const.js";
import { makeManager, resetMeasureControlState } from "./fixture.js";

// Label-collision lifecycle tests mock the collision module. It must be
// hoisted + mocked before MeasureManager is imported, because manager.ts
// imports collision.js synchronously at module load.
const placeLabels = vi.hoisted(() => vi.fn(() => 0));
vi.mock("#control/MeasureControl/collision.js", () => ({
  placeLabels,
  mapProjector: () => ({ box: () => ({ x: 0, y: 0, w: 64, h: 18 }) }),
}));

// Hoistable mock for guardBlocked — allows per-test override to exercise the
// blocked-path in setMode() without affecting the real ensureModes/ModeManager
// that the interaction-lock tests depend on.
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

/** Three measurements, one per type, so a declared subset has something to
 *  keep and total against. */
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

/** A user write through the same setter the panel's filter row calls. */
const userWrite = (manager: any, map: any, values = [CONST.MEASURE_MODE.MARKER]) => {
  createLayersOpts(map).filterSetter(filter(values));
  return manager;
};

afterEach(() => {
  vi.restoreAllMocks();
  resetMeasureControlState();
});

describe("filter contract — measure (enum arm)", () => {
  describe("1. a declared filter is a starting condition", () => {
    it("seeds the declaration without taking ownership", () => {
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

    it("does not seed while a stored record owns the slot", () => {
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
    it("takes ownership and persists the user's choice", () => {
      window.CONFIG = {
        ...window.CONFIG,
        filter: filter([CONST.MEASURE_MODE.DISTANCE]),
      };
      const { manager, map } = makeManager();
      addMeasurements(manager);

      userWrite(manager, map);

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
    it("restores the stored filter instead of the declaration", () => {
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
    it("the filter row's Clear keeps the user's empty slot", () => {
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

      // The declaration must not come back on the next load either.
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
      userWrite(manager, map);
      expect((manager as any).filtersTouched).toBe(true);

      // The CLEAR mode is the factory Reset: delete the record, drop
      // ownership, and return to the declaration.
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
    it("reports the declaration once and starts unfiltered", () => {
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
    });

    it("rejects the other arm whole instead of coercing it", () => {
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

    it("stays undeclared after the factory Reset and a reload", () => {
      window.CONFIG = {
        ...window.CONFIG,
        filter: filter([CONST.MEASURE_MODE.DISTANCE, "bogus"]),
      };

      const { manager } = makeManager();
      manager.clearAll();
      expect((manager as any).measureFilter).toBeUndefined();

      const { manager: reloaded } = reload();
      expect((reloaded as any).measureFilter).toBeUndefined();
    });
  });

  describe("6. a saved filter round-trips through persistence", () => {
    it("save → load → apply restores the filter and its ownership", () => {
      window.CONFIG = {
        ...window.CONFIG,
        filter: filter([CONST.MEASURE_MODE.DISTANCE]),
      };
      const { manager, map } = makeManager();
      addMeasurements(manager);

      userWrite(manager, map);

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
    it("exposes values with captions left to the panel", () => {
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
      // The panel reads its shared locale key (filter_enum); a
      // component-owned caption here is the defect the contract prevents.
      expect(dim).not.toHaveProperty("label");
    });
  });
});

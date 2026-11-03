// Cross-arm filter contract — HEATMAP (range) arm.
//
// One half of the cross-arm contract matrix. The sibling
// filter-contract.measure.test.ts pins the same rows against the enum arm;
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
import type { LayerFilter } from "#core/layer/index.js";
import * as CONST from "#control/HeatmapControl/const.js";
import { makeManager } from "../HeatmapControl/fixture.js";

/** A valid numeric-range atom on the fixture's snapshot field. */
const RANGE = {
  kind: "atom",
  field: "score",
  op: "between",
  range: [10, 50],
} as LayerFilter;

/** A different range the user picks themselves. */
const USER_RANGE = {
  kind: "atom",
  field: "score",
  op: "between",
  range: [20, 30],
} as LayerFilter;

/** A populated snapshot so the timing guard (empty = not painted) does not
 *  swallow the seed. */
const snapshot = (ranges: Record<string, [number, number]> = { score: [0, 100] }) =>
  ({
    points: [{ value: ranges.score?.[0] ?? 0 }],
    numericFields: Object.keys(ranges),
    ranges,
  }) as any;

/** Give a manager the inputs seedDeclaredFilter needs without a LayerAPI scan. */
const prepare = (manager: any) => {
  manager.selectedLayerId = "pts";
  manager.availableFields = ["score"];
  manager.field = "";
  manager.cachedSnapshot = snapshot();
  manager.getSelectedPoints = vi.fn(() => []) as any;
  return manager;
};

/** A manager whose source is selected and whose snapshot is already built. */
const seedable = (filter: unknown = RANGE) =>
  prepare(makeManager({ filter } as Partial<ComponentConfig>));

/** The reload path: read the saved record and apply it to a fresh manager. */
const reload = (filter: unknown = RANGE) => {
  const manager = makeManager({ filter } as Partial<ComponentConfig>);
  const saved = manager.loadSavedConfig();
  if (saved) manager.applySavedConfig(saved);
  return prepare(manager);
};

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("filter contract — heatmap (range arm)", () => {
  describe("1. a declared filter is a starting condition", () => {
    it("seeds the declared range and leaves the slot unowned", () => {
      const manager = seedable(RANGE);

      manager.seedDeclaredFilter();

      expect(manager.layerFilters.get("pts")).toEqual(RANGE);
      // A declaration is not a user choice: the factory Reset can still
      // return to it.
      expect(manager.filtersTouched).toBe(false);
    });

    it("does not seed when the stored record owns the slot", () => {
      const manager = seedable(RANGE);
      manager.filtersTouched = true; // a persisted record owns the slot

      manager.seedDeclaredFilter();

      expect(manager.layerFilters.has("pts")).toBe(false);
      expect(manager.filtersTouched).toBe(true);
    });
  });

  describe("2. a user write owns the slot", () => {
    it("marks the slot owned and stores the user's range", () => {
      const manager = seedable(null);
      manager.renderHexagons = vi.fn() as any;

      manager.setFilter(USER_RANGE);

      expect(manager.filtersTouched).toBe(true);
      expect(manager.layerFilters.get("pts")).toEqual(USER_RANGE);
      const saved = manager.loadSavedConfig();
      expect(saved?.filters?.pts).toEqual(USER_RANGE);
      expect(saved?.filtersTouched).toBe(true);
    });

    it("does not re-seed the declaration over the user's own choice", () => {
      const manager = seedable(null);
      manager.renderHexagons = vi.fn() as any;
      manager.setFilter(USER_RANGE);

      manager.seedDeclaredFilter();

      expect(manager.layerFilters.get("pts")).toEqual(USER_RANGE);
      expect(manager.filtersTouched).toBe(true);
    });
  });

  describe("3. a stored filter wins over the declaration", () => {
    it("restores the stored range instead of seeding the declaration", () => {
      // A record from an earlier session, with its ownership flag.
      window.localStorage.setItem(
        CONST.STORAGE.KEY,
        JSON.stringify({
          version: CONST.RECORD_VERSION,
          layerId: "pts",
          filters: { pts: USER_RANGE },
          filtersTouched: true,
        }),
      );

      const manager = makeManager({ filter: RANGE } as Partial<ComponentConfig>);
      manager.applySavedConfig(manager.loadSavedConfig()!);
      prepare(manager).seedDeclaredFilter();

      expect(manager.layerFilters.get("pts")).toEqual(USER_RANGE);
      expect(manager.filtersTouched).toBe(true);
    });
  });

  describe("4. the two clear paths are not the same", () => {
    it("the filter row's Clear owns the empty slot — the declaration stays out", () => {
      const manager = seedable(RANGE);
      manager.renderHexagons = vi.fn() as any;
      manager.seedDeclaredFilter();
      expect(manager.layerFilters.get("pts")).toEqual(RANGE);

      manager.setFilter(undefined);
      expect(manager.filtersTouched).toBe(true);
      expect(manager.layerFilters.has("pts")).toBe(false);

      manager.seedDeclaredFilter();
      expect(manager.layerFilters.has("pts")).toBe(false);
    });

    it("the factory Reset drops ownership and re-seeds the declaration", () => {
      const manager = seedable(RANGE);
      manager.filtersTouched = true; // a user wrote earlier
      manager.layerFilters.set("pts", USER_RANGE);

      // The panel's Clear is a factory Reset: resetState + clearSavedConfig,
      // exactly what the real button runs.
      manager.resetState(window.CONFIG);
      manager.clearSavedConfig();
      expect(manager.filtersTouched).toBe(false);
      expect(manager.layerFilters.size).toBe(0);

      prepare(manager).seedDeclaredFilter();
      expect(manager.layerFilters.get("pts")).toEqual(RANGE);
      expect(manager.filtersTouched).toBe(false);

      // The record is gone, so a reload starts from the declaration again.
      const reloaded = reload(RANGE);
      reloaded.seedDeclaredFilter();
      expect(reloaded.layerFilters.get("pts")).toEqual(RANGE);
      expect(reloaded.filtersTouched).toBe(false);
    });
  });

  describe("5. an unusable declaration warns once, never half-applies", () => {
    it("reports an unreadable declaration once and starts unfiltered", () => {
      const manager = seedable({ kind: "atom", field: "score", op: "nope" });
      const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

      manager.seedDeclaredFilter();
      manager.seedDeclaredFilter();

      expect(manager.layerFilters.has("pts")).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("rejects an enum declaration whole (the panel's dimension is a range)", () => {
      const manager = seedable({
        kind: "enum",
        field: "score",
        values: ["a", "b"],
      });
      const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

      manager.seedDeclaredFilter();

      // No partial range and no enum leaking into the numeric slot: the wrong
      // arm is undeclared, not coerced.
      expect(manager.layerFilters.has("pts")).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("stays undeclared after the factory Reset and a reload", () => {
      const manager = seedable({ kind: "atom", field: "score", op: "nope" });
      manager.resetState(window.CONFIG);
      manager.clearSavedConfig();

      prepare(manager).seedDeclaredFilter();
      expect(manager.layerFilters.has("pts")).toBe(false);

      const reloaded = reload({ kind: "atom", field: "score", op: "nope" });
      reloaded.seedDeclaredFilter();
      expect(reloaded.layerFilters.has("pts")).toBe(false);
    });
  });

  describe("6. a saved filter round-trips through persistence", () => {
    it("save → load → apply restores the range and its ownership", () => {
      const manager = seedable(null);
      manager.renderHexagons = vi.fn() as any;
      manager.setFilter(USER_RANGE);

      const reloaded = reload(RANGE);

      expect(reloaded.filtersTouched).toBe(true);
      expect(reloaded.layerFilters.get("pts")).toEqual(USER_RANGE);
    });
  });

  describe("7. the dimension carries values only", () => {
    it("exposes the bound field and range, with captions left to the panel", () => {
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

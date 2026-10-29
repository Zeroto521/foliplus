// Declared Heatmap filter (CONFIG.filter): the seed and the slot's owner.
//
// The declaration is a starting condition only. It seeds into the per-source
// filter store on the first open; from then on the user's own slot wins —
// including an explicit clear, which is what filtersTouched records. The
// factory Reset drops that ownership, so the declaration returns with the
// rest of the declared defaults.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LayerFilter } from "#core/layer/index.js";
import { makeConfig, makeManager } from "./fixture.js";

const RANGE = {
  kind: "atom",
  field: "score",
  op: "between",
  range: [10, 50],
} as LayerFilter;

const snapshot = (ranges: Record<string, [number, number]> = { score: [0, 100] }) =>
  ({ points: [], numericFields: Object.keys(ranges), ranges }) as any;

/** A manager whose source is selected and whose snapshot is already built:
 *  seedDeclaredFilter's inputs, without the LayerAPI scan. */
const seedable = (filter: Record<string, unknown> | null) => {
  const manager = makeManager({ filter });
  manager.selectedLayerId = "pts";
  manager.availableFields = ["score"];
  manager.field = "";
  manager.cachedSnapshot = snapshot();
  manager.getSelectedPoints = vi.fn(() => []) as any;
  return manager;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("declared heatmap filter — seed", () => {
  it("seeds the declared range on the first open", () => {
    const manager = seedable(RANGE as Record<string, unknown>);

    manager.seedDeclaredFilter();

    expect(manager.layerFilters.get("pts")).toEqual(RANGE);
    // A declaration is not a user choice: the slot stays unowned.
    expect(manager.filtersTouched).toBe(false);
  });

  it("clamps the declared range to the snapshot extent", () => {
    const manager = seedable({ ...RANGE, range: [10, 500] } as Record<string, unknown>);

    manager.seedDeclaredFilter();

    expect(manager.layerFilters.get("pts")).toEqual({
      kind: "atom",
      field: "score",
      op: "between",
      range: [10, 100],
    });
  });

  it("a declared range covering the whole extent is not a filter", () => {
    const manager = seedable({ ...RANGE, range: [0, 100] } as Record<string, unknown>);

    manager.seedDeclaredFilter();

    expect(manager.layerFilters.has("pts")).toBe(false);
  });

  it("reports a declaration outside the extent and starts unfiltered", () => {
    const manager = seedable({
      ...RANGE,
      range: [1000, 2000],
    } as Record<string, unknown>);
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

    manager.seedDeclaredFilter();

    // Clamping would collapse it onto one bound and hide the data; the seed
    // reports it and keeps the layer unfiltered instead.
    expect(manager.layerFilters.has("pts")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("keeps the declaration out when a persisted record owns the slot", () => {
    const manager = seedable(RANGE as Record<string, unknown>);
    manager.filtersTouched = true;

    manager.seedDeclaredFilter();

    expect(manager.layerFilters.has("pts")).toBe(false);
  });

  it("keeps the declaration out when a restored per-source filter exists", () => {
    const manager = seedable(RANGE as Record<string, unknown>);
    const restored = {
      kind: "atom",
      field: "score",
      op: "between",
      range: [20, 30],
    } as LayerFilter;
    manager.layerFilters.set("pts", restored);

    manager.seedDeclaredFilter();

    expect(manager.layerFilters.get("pts")).toEqual(restored);
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

    expect(manager.layerFilters.has("pts")).toBe(false);
    // The seed runs on every rebuild of the first open; one report is enough.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("ignores an enum declaration (the panel's dimension is a numeric range)", () => {
    const manager = seedable({ kind: "enum", field: "cat", values: ["a"] });
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

    manager.seedDeclaredFilter();

    expect(manager.layerFilters.has("pts")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("reports an unreadable declaration once and starts unfiltered", () => {
    const manager = seedable({ kind: "atom", field: "score", op: "nope" });
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

    manager.seedDeclaredFilter();
    manager.seedDeclaredFilter();

    expect(manager.layerFilters.has("pts")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("declared heatmap filter — slot ownership", () => {
  it("a user filter write takes ownership of the slot", () => {
    const manager = seedable(null);
    manager.renderHexagons = vi.fn() as any;

    manager.setFilter(RANGE);

    expect(manager.filtersTouched).toBe(true);
    expect(manager.layerFilters.get("pts")).toEqual(RANGE);
  });

  it("the factory Reset drops the ownership so the declaration returns", () => {
    const manager = seedable(RANGE as Record<string, unknown>);
    manager.filtersTouched = true;

    manager.resetState(makeConfig());

    expect(manager.filtersTouched).toBe(false);
    expect(manager.hasScanned).toBe(false);
  });
});

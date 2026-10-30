// Declared Heatmap filter (CONFIG.filter): the seed and the slot's owner.
//
// The declaration is a starting condition only. It seeds into the per-source
// filter store on the first open; from then on the user's own slot wins —
// including an explicit clear, which is what filtersTouched records. The
// factory Reset drops that ownership, so the declaration returns with the
// rest of the declared defaults.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LayerFilter } from "#core/layer/index.js";
import { makeConfig, makeCtrl, makeManager } from "./fixture.js";

const RANGE = {
  kind: "atom",
  field: "score",
  op: "between",
  range: [10, 50],
} as LayerFilter;

/** A populated snapshot: an extent exists because at least one point carries
 *  a value, so the timing guard (empty snapshot = not painted yet) does not
 *  swallow the seed. Cases that need the empty state set it explicitly. */
const snapshot = (ranges: Record<string, [number, number]> = { score: [0, 100] }) =>
  ({
    points: [{ value: ranges.score?.[0] ?? 0 }],
    numericFields: Object.keys(ranges),
    ranges,
  }) as any;

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
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

    manager.seedDeclaredFilter();

    expect(manager.layerFilters.has("pts")).toBe(false);
    // Covering the whole extent is the same state as "no filter", so it is a
    // legal no-op — reporting it would call a valid declaration a data problem.
    expect(warn).not.toHaveBeenCalled();
  });

  it("reports a field with no numeric extent and starts unfiltered", () => {
    const manager = seedable(RANGE as Record<string, unknown>);
    // The source has points but the field carries no value on any of them, so
    // the panel has no range to render the declaration on.
    manager.cachedSnapshot = {
      points: [{ value: 0 }],
      numericFields: ["score"],
      ranges: {},
    } as any;
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});

    manager.seedDeclaredFilter();

    expect(manager.layerFilters.has("pts")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a snapshot that is not populated yet is not a data problem", () => {
    // The seed runs from the panel build, which can precede the source's first
    // paint. An empty snapshot then is timing, not a declaration defect:
    // reporting it would blame the author's declaration for an empty read —
    // and the report would be remembered in declarationWarned, silencing the
    // real problem once the data arrives.
    const manager = seedable(RANGE as Record<string, unknown>);
    manager.cachedSnapshot = {
      points: [],
      numericFields: ["score"],
      ranges: {},
    } as any;
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});
    const debug = vi.spyOn((manager as any).log, "debug").mockImplementation(() => {});

    manager.seedDeclaredFilter();

    expect(manager.layerFilters.has("pts")).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
    expect(String(debug.mock.calls[0][0])).toContain("not populated");
    expect(manager.declarationWarned.size).toBe(0);
  });

  it("a snapshot that was never built is not a data problem either", () => {
    // The other arm of the same timing check: no snapshot object at all (the
    // cache is cleared on a source or content change and the seed can run
    // before getSelectedPoints rebuilds it). Still not a declaration defect.
    const manager = seedable(RANGE as Record<string, unknown>);
    manager.cachedSnapshot = null;
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});
    const debug = vi.spyOn((manager as any).log, "debug").mockImplementation(() => {});

    manager.seedDeclaredFilter();

    expect(manager.layerFilters.has("pts")).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it("still reports the real missing extent once the frame arrives", () => {
    // Same manager, two phases: quiet while the snapshot is empty, then the
    // genuine report is not swallowed by a flag the empty read would have set.
    const manager = seedable(RANGE as Record<string, unknown>);
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
    // F5, pinned: the seeded filter lives in the same per-source store a panel
    // write uses, so a save triggered by anything else (a colour change) makes
    // it durable. Consequence documented on seedDeclaredFilter: after the
    // author changes the declaration, a user who ever saved another setting
    // keeps hitting the restored per-source filter first.
    const manager = seedable(RANGE as Record<string, unknown>);
    manager.seedDeclaredFilter();
    expect(manager.layerFilters.get("pts")).toEqual(RANGE);

    manager.saveConfig();
    const saved = manager.loadSavedConfig();

    expect(saved?.filters?.pts).toEqual(RANGE);
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

    expect(manager.layerFilters.get("pts")).toEqual({
      kind: "atom",
      field: "score",
      op: "eq",
      value: 42,
    });
    expect(warn).not.toHaveBeenCalled();
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

describe("declared heatmap filter — a source picked by hand", () => {
  it("seeds before the frame is drawn when the user picks a source", async () => {
    const { initScan } = await import("#foliplus/HeatmapControl/ui.js");
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
      filterAtRender = manager.layerFilters.get("second");
    });
    ctrl.layerSelect.value = "second";
    ctrl.layerSelect.onchange?.(new Event("change"));

    // The frame is drawn with the declaration already in the slot; seeding
    // after the draw would paint unfiltered and leave the panel ahead of it.
    expect(filterAtRender).toEqual(declared);
    expect(manager.layerFilters.get("second")).toEqual(declared);
    expect(render).toHaveBeenCalledTimes(1);
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

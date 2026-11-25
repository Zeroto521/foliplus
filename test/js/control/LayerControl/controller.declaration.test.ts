// test/js/control/LayerControl/controller.declaration — generic filter declaration and model.
import { makeStore } from "./controller.fixture.js";
import { initFixture, makeDerivedUI, polygonLayer } from "./ui/fixture.js";
import { describe, expect, it, vi } from "vitest";
import { FILTER_SOURCE, LayerRuntimeStore } from "#core/layer/index.js";

describe("generic filter declaration seeding", () => {
  // The author's declared filter (CONF data[].filter) is a construction-time
  // constant, not a user write: the constructor captures it on the shared
  // store's declaration channel (never persisted, never owned) and mirrors it
  // into the read-compatible map + registry slot exactly as the old
  // write-through did. A declaration-only slot must NOT answer isOwned, so a
  // later reload that re-seeds it keeps the declaration winning over a stale
  // persisted value.
  const declared = {
    kind: "atom",
    field: "mag",
    op: "between",
    range: [2, 8],
  } as const;

  it("seeds a declared filter as a store declaration, not an owned value", () => {
    const { manager } = initFixture({
      data: [
        {
          id: "overlay1",
          name: "Polygons",
          role: "overlay",
          layer: polygonLayer(),
          filter: declared,
        },
      ],
    });

    // The store carries the committed value read back as the declaration...
    expect(
      (manager as any).filterStore.getFilter("overlay1", FILTER_SOURCE.GENERIC),
    ).toEqual(declared);
    // ...but the slot is NOT owned: a declaration is construction-time state,
    // and only a user write (setLayerFilter) takes the slot and persists.
    expect(
      (manager as any).filterStore.isOwned("overlay1", FILTER_SOURCE.GENERIC),
    ).toBe(false);
    // The read-compatible mirror and the registry slot carry the same value
    // (S4b reads layers[id].filter directly; the panel never re-derives).
    expect(manager.layerRegistry.get("overlay1")!.filter).toEqual(declared);
    expect(manager.layerRegistry.get("overlay1")!.filter).toEqual(declared);
  });

  it("a user write takes the slot, and the declaration no longer seeds it", () => {
    const { manager } = initFixture({
      data: [
        {
          id: "overlay1",
          name: "Polygons",
          role: "overlay",
          layer: polygonLayer(),
          filter: declared,
        },
      ],
    });

    // The user commits their own value over the declaration.
    manager.setLayerFilter("overlay1", {
      kind: "atom",
      field: "mag",
      op: "between",
      range: [4, 9],
    } as any);
    expect(
      (manager as any).filterStore.isOwned("overlay1", FILTER_SOURCE.GENERIC),
    ).toBe(true);
    expect(
      (manager as any).filterStore.getFilter("overlay1", FILTER_SOURCE.GENERIC),
    ).toEqual({
      kind: "atom",
      field: "mag",
      op: "between",
      range: [4, 9],
    });
    expect(manager.layerRegistry.get("overlay1")!.filter).toEqual({
      kind: "atom",
      field: "mag",
      op: "between",
      range: [4, 9],
    });
  });

  it("a layer with no declared filter keeps no committed filter", () => {
    const { manager } = initFixture({
      data: [
        { id: "overlay1", name: "Polygons", role: "overlay", layer: polygonLayer() },
      ],
    });
    expect(
      (manager as any).filterStore.getFilter("overlay1", FILTER_SOURCE.GENERIC),
    ).toBeUndefined();
    expect(manager.layerRegistry.get("overlay1")!.filter).toBeUndefined();
  });
});

describe("genericFilterModel — enum dimensions", () => {
  const makeRuntimeStore = (
    features: Partial<import("#core/layer/index.js").LayerFilterFeatures>,
  ) => {
    const s = new LayerRuntimeStore();
    s.setFilterFeatures("overlay1", {
      features: [],
      numericFields: [],
      ranges: {},
      enumFields: [],
      enumValues: {},
      total: 0,
      ...features,
    } as any);
    return s;
  };

  const makeManager = () => {
    const { manager } = initFixture({
      data: [
        { id: "overlay1", name: "Polygons", role: "overlay", layer: polygonLayer() },
      ],
    });
    manager.uiContainer = document.createElement("div");
    return manager;
  };

  it("produces an enum dimension for a string field and marks the field non-numeric", () => {
    const manager = makeManager();
    manager.ui = makeDerivedUI({
      intentStore: makeStore(),
      runtimeStore: makeRuntimeStore({
        enumFields: ["kind"],
        enumValues: { kind: ["a", "b", "c"] },
        total: 3,
      }),
      colorSurface: {} as any,
      currentColor: "#000000",
      dropPersistedLayerState: vi.fn(),
      saveState: vi.fn(),
      syncToggleAll: vi.fn(),
      syncNoBasemap: vi.fn(),
      renamedNames: {},
      saveNamesState: vi.fn(),
      invalidateFields: vi.fn(),
    }) as any;

    const model = manager.genericFilterModel("overlay1");
    expect(model).not.toBeNull();
    expect(model!.dimensions).toEqual([
      {
        kind: "enum",
        field: "kind",
        options: [
          { value: "a", label: "a" },
          { value: "b", label: "b" },
          { value: "c", label: "c" },
        ],
        multi: true,
        truncated: false,
      },
    ]);
    expect(model!.fields).toEqual([{ value: "kind", label: "kind", numeric: false }]);
  });

  it("offers numeric fields before enum fields in the picker", () => {
    const manager = makeManager();
    manager.ui = makeDerivedUI({
      intentStore: makeStore(),
      runtimeStore: makeRuntimeStore({
        numericFields: ["mag"],
        ranges: { mag: [0, 10] },
        enumFields: ["kind"],
        enumValues: { kind: ["a", "b"] },
        total: 5,
      }),
      colorSurface: {} as any,
      currentColor: "#000000",
      dropPersistedLayerState: vi.fn(),
      saveState: vi.fn(),
      syncToggleAll: vi.fn(),
      syncNoBasemap: vi.fn(),
      renamedNames: {},
      saveNamesState: vi.fn(),
      invalidateFields: vi.fn(),
    }) as any;

    const model = manager.genericFilterModel("overlay1");
    expect(model).not.toBeNull();
    expect(model!.dimensions.map(d => d.field)).toEqual(["mag", "kind"]);
    expect(model!.dimensions[0]).toMatchObject({ kind: "range", field: "mag" });
    expect(model!.dimensions[1]).toMatchObject({ kind: "enum", field: "kind" });
    expect(model!.fields).toEqual([
      { value: "mag", label: "mag", numeric: true },
      { value: "kind", label: "kind", numeric: false },
    ]);
  });

  it("returns null when the layer has neither numeric nor enum fields", () => {
    const manager = makeManager();
    manager.ui = makeDerivedUI({
      intentStore: makeStore(),
      runtimeStore: makeRuntimeStore({}),
      colorSurface: {} as any,
      currentColor: "#000000",
      dropPersistedLayerState: vi.fn(),
      saveState: vi.fn(),
      syncToggleAll: vi.fn(),
      syncNoBasemap: vi.fn(),
      renamedNames: {},
      saveNamesState: vi.fn(),
      invalidateFields: vi.fn(),
    }) as any;

    expect(manager.genericFilterModel("overlay1")).toBeNull();
  });
  it("treats an enum-only field set as filterable through the injected gate", () => {
    // The two disjuncts are separate evidence: a categorical-only layer
    // (no measurable attribute at all) must open the panel as well, so the
    // gate cannot reduce to "has a numeric field".
    const manager = makeManager();
    manager.ui = makeDerivedUI({
      intentStore: makeStore(),
      runtimeStore: makeRuntimeStore({
        enumFields: ["kind"],
        enumValues: { kind: ["a", "b"] },
        total: 2,
      }),
      colorSurface: {} as any,
      currentColor: "#000000",
      dropPersistedLayerState: vi.fn(),
      saveState: vi.fn(),
      syncToggleAll: vi.fn(),
      syncNoBasemap: vi.fn(),
      renamedNames: {},
      saveNamesState: vi.fn(),
      invalidateFields: vi.fn(),
    }) as any;
    // Numeric fields stay empty: the enumeration alone must carry the gate.
    expect(manager.genericFilterModel("overlay1")!.fields).toEqual([
      { value: "kind", label: "kind", numeric: false },
    ]);
    expect(manager.hasFilterableFields("overlay1")).toBe(true);
  });

  it("truncates a large enum domain to the panel limit and marks it", () => {
    const manager = makeManager();
    const many = Array.from({ length: 60 }, (_, i) => `v${i}`);
    manager.ui = makeDerivedUI({
      intentStore: makeStore(),
      runtimeStore: makeRuntimeStore({
        enumFields: ["kind"],
        enumValues: { kind: many },
        total: 60,
      }),
      colorSurface: {} as any,
      currentColor: "#000000",
      dropPersistedLayerState: vi.fn(),
      saveState: vi.fn(),
      syncToggleAll: vi.fn(),
      syncNoBasemap: vi.fn(),
      renamedNames: {},
      saveNamesState: vi.fn(),
      invalidateFields: vi.fn(),
    }) as any;

    const model = manager.genericFilterModel("overlay1");
    expect(model).not.toBeNull();
    const dim = model!.dimensions[0] as any;
    expect(dim.kind).toBe("enum");
    expect(dim.truncated).toBe(true);
    expect(dim.options).toHaveLength(50);
    expect(dim.options[0]).toEqual({ value: "v0", label: "v0" });
    expect(dim.options[49]).toEqual({ value: "v49", label: "v49" });
  });

  it("tolerates an enum field whose value table is missing (corrupt store) without throwing", () => {
    const manager = makeManager();
    manager.ui = makeDerivedUI({
      intentStore: makeStore(),
      runtimeStore: makeRuntimeStore({
        enumFields: ["kind"],
        enumValues: {},
        total: 3,
      }),
      colorSurface: {} as any,
      currentColor: "#000000",
      dropPersistedLayerState: vi.fn(),
      saveState: vi.fn(),
      syncToggleAll: vi.fn(),
      syncNoBasemap: vi.fn(),
      renamedNames: {},
      saveNamesState: vi.fn(),
      invalidateFields: vi.fn(),
    }) as any;

    const model = manager.genericFilterModel("overlay1");
    expect(model).not.toBeNull();
    const dim = model!.dimensions[0] as any;
    expect(dim.kind).toBe("enum");
    expect(dim.options).toEqual([]);
    expect(dim.truncated).toBe(false);
  });

  it("returns null when the host snapshot is missing (defensive read)", () => {
    const manager = makeManager();
    manager.ui = makeDerivedUI({
      intentStore: makeStore(),
      // A bare store with no seeded filterFeatures row: getFilterFeatures
      // returns undefined, and the defensive read falls back to the empty
      // state (null) instead of throwing on a non-null assertion.
      runtimeStore: new LayerRuntimeStore(),
      colorSurface: {} as any,
      currentColor: "#000000",
      dropPersistedLayerState: vi.fn(),
      saveState: vi.fn(),
      syncToggleAll: vi.fn(),
      syncNoBasemap: vi.fn(),
      renamedNames: {},
      saveNamesState: vi.fn(),
      invalidateFields: vi.fn(),
    }) as any;
    expect(manager.genericFilterModel("overlay1")).toBeNull();
  });
});

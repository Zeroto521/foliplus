// Unit tests for core/layer/filterStore — the single per-layer, multi-source
// filter record. This pins the two reset invariants the design turns on, plus
// the guard that keeps the removed per-surface teardown channel from growing
// back.
//
// The store is surface-agnostic: a surface supplies normalize / apply /
// publish / dimensions / counts and nothing else. Read, write and reset all go
// through the store, so there is no per-surface key to assemble and no
// per-surface teardown callback to forget.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LayerFilter } from "#core/layer/filter.js";
import {
  FILTER_STORE_KEY,
  type FilterSourceHost,
  createFilterStore,
} from "#core/layer/filterStore.js";

/** A host over a closed enum domain (mirrors a measurement type filter). */
const makeEnumHost = (domain: readonly string[]): FilterSourceHost => {
  const allowed = new Set(domain);
  return {
    normalize(filter) {
      if (filter?.kind !== "enum" || filter.field !== "type") return undefined;
      const values = filter.values.filter(v => allowed.has(v));
      return values.length > 0 ? { kind: "enum", field: "type", values } : undefined;
    },
    apply: vi.fn(),
    publish: vi.fn(),
  };
};

const enumFilter = (...values: string[]): LayerFilter => ({
  kind: "enum",
  field: "type",
  values,
});

describe("filterStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("registered surfaces are reported in registration order", () => {
    const store = createFilterStore();
    store.register("filter", makeEnumHost(["marker"]));
    store.register("measure", makeEnumHost(["distance"]));
    expect(store.sources()).toEqual(["filter", "measure"]);
  });

  it("a user write takes the slot: normalized value is applied, persisted under the one key, and ownership is set", () => {
    const store = createFilterStore();
    const host = makeEnumHost(["marker", "distance"]);
    store.register("filter", host);
    const applied = vi.mocked(host.apply);

    const changed = store.setFilter("L1", "filter", enumFilter("marker", "ghost"));
    expect(changed).toBe(true);
    expect(store.getFilter("L1", "filter")).toEqual(enumFilter("marker"));
    expect(store.isOwned("L1", "filter")).toBe(true);
    // The carrier got the normalized value, not the raw candidate.
    expect(applied).toHaveBeenCalledWith(enumFilter("marker"));
    // Persistence is the store's job: the value survives under the one key.
    expect(window.localStorage.getItem(FILTER_STORE_KEY)).not.toBeNull();
  });

  it("reset(layerId, source) clears only that source and leaves siblings", () => {
    const store = createFilterStore();
    store.register("filter", makeEnumHost(["marker"]));
    store.register("measure", makeEnumHost(["distance"]));

    store.setFilter("L1", "filter", enumFilter("marker"));
    store.setFilter("L1", "measure", enumFilter("distance"));
    expect(store.isOwned("L1", "filter")).toBe(true);
    expect(store.isOwned("L1", "measure")).toBe(true);

    // Panel Reset on the filter dimension only.
    store.reset("L1", "filter");

    // The filter source is back to un-owned and empty...
    expect(store.isOwned("L1", "filter")).toBe(false);
    expect(store.getFilter("L1", "filter")).toBeUndefined();
    // ...while the sibling measurement source is untouched.
    expect(store.isOwned("L1", "measure")).toBe(true);
    expect(store.getFilter("L1", "measure")).toEqual(enumFilter("distance"));
  });

  it("reset(layerId) drops the whole layer record (a layer delete)", () => {
    const store = createFilterStore();
    store.register("filter", makeEnumHost(["marker"]));
    store.register("measure", makeEnumHost(["distance"]));

    store.setFilter("L1", "filter", enumFilter("marker"));
    store.setFilter("L1", "measure", enumFilter("distance"));

    store.reset("L1");

    expect(store.isOwned("L1", "filter")).toBe(false);
    expect(store.isOwned("L1", "measure")).toBe(false);
    expect(store.getFilter("L1", "filter")).toBeUndefined();
    expect(store.getFilter("L1", "measure")).toBeUndefined();
    // The whole layer entry is gone from the persisted record.
    const raw = window.localStorage.getItem(FILTER_STORE_KEY) ?? "{}";
    expect(JSON.parse(raw).layers.L1).toBeUndefined();
  });

  it("never routes persistence through a host callback (no clearPersist channel)", () => {
    const store = createFilterStore();
    // Smuggle a persist/clearPersist-shaped pair onto the host. The contract
    // does not declare them, and the store must never call them — if it ever
    // does, the per-surface teardown channel this module removed has grown
    // back and the store no longer single-sources the persistence lifecycle.
    const persist = vi.fn();
    const clearPersist = vi.fn();
    const host: FilterSourceHost & { persist?: unknown; clearPersist?: unknown } = {
      ...makeEnumHost(["marker"]),
      persist,
      clearPersist,
    };
    store.register("filter", host);

    store.setFilter("L1", "filter", enumFilter("marker"));
    store.reset("L1", "filter");
    store.reset("L1");

    expect(persist).not.toHaveBeenCalled();
    expect(clearPersist).not.toHaveBeenCalled();
  });

  it("a publish side effect cannot substitute for the store's persistence", () => {
    const store = createFilterStore();
    // A surface that tries to own persistence from inside publish, writing a
    // rogue per-surface key the way the old hand-rolled code did. The store
    // neither reads nor relies on that key, so the surface gains nothing: the
    // committed value is served from the store's own single record.
    const rogueHost: FilterSourceHost = {
      ...makeEnumHost(["marker"]),
      publish: vi.fn(() => {
        window.localStorage.setItem(
          "foliplus_measure_filter_L1",
          JSON.stringify({ a: 1 }),
        );
      }),
    };
    store.register("filter", rogueHost);

    store.setFilter("L1", "filter", enumFilter("marker"));
    store.reset("L1", "filter");

    // The store's own record no longer holds the filter...
    expect(store.getFilter("L1", "filter")).toBeUndefined();
    // ...and the rogue key the surface wrote is simply orphaned: the store
    // never consults it, so it is not a persistence channel.
    expect(window.localStorage.getItem("foliplus_measure_filter_L1")).not.toBeNull();
    expect(store.getFilter("L1", "filter")).toBeUndefined();
  });
});

describe("filterStore — invariants", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("setFilter on an unregistered source is a no-op that writes nothing", () => {
    const store = createFilterStore();
    expect(store.setFilter("L1", "ghost", enumFilter("marker"))).toBe(false);
    expect(window.localStorage.getItem(FILTER_STORE_KEY)).toBeNull();
  });

  it("re-affirming an owned slot writes nothing new (a choice already made is not re-recorded)", () => {
    const store = createFilterStore();
    store.register("filter", makeEnumHost(["marker"]));
    store.setFilter("L1", "filter", enumFilter("marker"));
    const before = window.localStorage.getItem(FILTER_STORE_KEY);
    // Same value again, and the user already owns the slot: no second record.
    expect(store.setFilter("L1", "filter", enumFilter("marker"))).toBe(false);
    expect(window.localStorage.getItem(FILTER_STORE_KEY)).toBe(before);
  });

  it("a restored slot shows the declaration when the user never took it, their value when they did", () => {
    const store = createFilterStore();
    store.register("filter", makeEnumHost(["marker"]));
    const declared = enumFilter("distance");
    // Never taken -> the declaration seeds.
    expect(store.restore("L1", "filter", declared)).toEqual(declared);
    // Taken -> their value survives, even though a declaration is on offer.
    store.setFilter("L1", "filter", enumFilter("marker"));
    expect(store.restore("L1", "filter", declared)).toEqual(enumFilter("marker"));
  });

  it("clearing a slot that is already empty and un-owned is a no-op, so the declaration can still seed", () => {
    const store = createFilterStore();
    store.register("filter", makeEnumHost(["marker"]));
    // No user write has happened: the slot holds nothing and is not owned.
    expect(store.setFilter("L1", "filter", undefined)).toBe(false);
    expect(store.isOwned("L1", "filter")).toBe(false);
    expect(window.localStorage.getItem(FILTER_STORE_KEY)).toBeNull();
  });

  it("reset of a layer that was never persisted is a safe no-op", () => {
    const store = createFilterStore();
    store.register("filter", makeEnumHost(["marker"]));
    // No setFilter ever ran for L1: there is no layer entry to drop.
    expect(() => store.reset("L1")).not.toThrow();
    expect(() => store.reset("L1", "filter")).not.toThrow();
  });

  it("reset of an unregistered source on a known layer is a no-op", () => {
    const store = createFilterStore();
    store.register("filter", makeEnumHost(["marker"]));
    store.setFilter("L1", "filter", enumFilter("marker"));
    // A layer exists, but this source never wrote into it.
    expect(() => store.reset("L1", "ghost")).not.toThrow();
    expect(store.isOwned("L1", "filter")).toBe(true);
  });

  it("a corrupt persisted record is discarded, not trusted (fresh state, not a throw)", () => {
    window.localStorage.setItem(FILTER_STORE_KEY, "{not json");
    const store = createFilterStore();
    store.register("filter", makeEnumHost(["marker"]));
    // The unreadable record falls back to empty: nothing is owned, nothing leaked.
    expect(store.isOwned("L1", "filter")).toBe(false);
    expect(store.getFilter("L1", "filter")).toBeUndefined();
    // A subsequent write rebuilds a clean record on top of the discarded one.
    expect(store.setFilter("L1", "filter", enumFilter("marker"))).toBe(true);
    expect(store.getFilter("L1", "filter")).toEqual(enumFilter("marker"));
  });

  it("a persisted record missing fields is treated as un-owned rather than trusted", () => {
    // A record whose layer entry lost its sources map: the slot reads un-owned.
    window.localStorage.setItem(
      FILTER_STORE_KEY,
      JSON.stringify({ version: 1, layers: { L1: {} } }),
    );
    const store = createFilterStore();
    store.register("filter", makeEnumHost(["marker"]));
    expect(store.isOwned("L1", "filter")).toBe(false);
    expect(store.getFilter("L1", "filter")).toBeUndefined();
  });

  it("reset hands a value that lost its ownership flag back to the surface, not to the void", () => {
    // Guard the touched/value pairing. The store only ever writes the two
    // together, so the only way to observe a value with touched=false is to
    // seed it directly — which is exactly the regression worth pinning: if the
    // write path ever drops the flag, reset must still hand the surface its
    // stored value rather than silently clearing to undefined.
    window.localStorage.setItem(
      FILTER_STORE_KEY,
      JSON.stringify({
        version: 1,
        layers: {
          L1: { sources: { filter: { touched: false, value: enumFilter("marker") } } },
        },
      }),
    );
    const applied: LayerFilter[] = [];
    const store = createFilterStore();
    store.register("filter", {
      ...makeEnumHost(["marker"]),
      apply: f => applied.push(f),
    });

    store.reset("L1", "filter");

    expect(applied).toEqual([enumFilter("marker")]);
  });

  it("filterModel carries the host dimensions and kept/total when the host provides them", () => {
    const store = createFilterStore();
    store.register("filter", {
      ...makeEnumHost(["marker"]),
      dimensions: () => [{ key: "type", caption: "type" }] as never,
      counts: () => ({ kept: 3, total: 7 }),
    });
    store.setFilter("L1", "filter", enumFilter("marker"));
    const model = store.filterModel("L1", "filter");
    expect(model.filter).toEqual(enumFilter("marker"));
    expect(model.kept).toBe(3);
    expect(model.total).toBe(7);
    expect(model.dimensions).toHaveLength(1);
  });

  it("filterModel degrades to no dimensions and a zero kept/total when the host declares neither", () => {
    const store = createFilterStore();
    store.register("filter", makeEnumHost(["marker"]));
    const model = store.filterModel("L1", "filter");
    expect(model.dimensions).toEqual([]);
    expect(model.kept).toBe(0);
    expect(model.total).toBe(0);
    // An unregistered source yields the same empty model rather than throwing.
    expect(store.filterModel("L1", "ghost")).toEqual({
      dimensions: [],
      filter: undefined,
      kept: 0,
      total: 0,
    });
  });
});

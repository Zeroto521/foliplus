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

  it("registers surfaces and reports them in order", () => {
    const store = createFilterStore();
    store.register("filter", makeEnumHost(["marker"]));
    store.register("measure", makeEnumHost(["distance"]));
    expect(store.sources()).toEqual(["filter", "measure"]);
  });

  it("setFilter normalizes, applies, persists and publishes a taken slot", () => {
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

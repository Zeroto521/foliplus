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
import {
  FILTER_SOURCE,
  FILTER_STORE_KEY,
  type FilterSourceHost,
  type LayerFilter,
  createFilterStore,
} from "#core/layer/index.js";

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
    store.registerHost("L1", "filter", makeEnumHost(["marker"]));
    store.registerHost("L1", "measure", makeEnumHost(["distance"]));
    expect(store.sources("L1")).toEqual(["filter", "measure"]);
  });

  it("a user write takes the slot: normalized value is applied, persisted under the one key, and ownership is set", () => {
    const store = createFilterStore();
    const host = makeEnumHost(["marker", "distance"]);
    store.registerHost("L1", "filter", host);
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
    store.registerHost("L1", "filter", makeEnumHost(["marker"]));
    store.registerHost("L1", "measure", makeEnumHost(["distance"]));

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
    store.registerHost("L1", "filter", makeEnumHost(["marker"]));
    store.registerHost("L1", "measure", makeEnumHost(["distance"]));

    store.setFilter("L1", "filter", enumFilter("marker"));
    store.setFilter("L1", "measure", enumFilter("distance"));

    store.reset("L1");

    expect(store.isOwned("L1", "filter")).toBe(false);
    expect(store.isOwned("L1", "measure")).toBe(false);
    expect(store.getFilter("L1", "filter")).toBeUndefined();
    expect(store.getFilter("L1", "measure")).toBeUndefined();
    // The whole layer entry is gone from the persisted record. With the
    // record now empty the store removes the key entirely (a reset of the
    // only layer leaves no residue).
    const raw = window.localStorage.getItem(FILTER_STORE_KEY);
    if (raw) {
      expect(JSON.parse(raw).layers.L1).toBeUndefined();
    } else {
      expect(raw).toBeNull();
    }
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
    store.registerHost("L1", "filter", host);

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
    store.registerHost("L1", "filter", rogueHost);

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

  it("a single-source measure-shaped slot restores from the declaration and resets back to it", () => {
    const store = createFilterStore();
    store.registerHost("L1", "measure", makeEnumHost(["distance", "time"]));
    const declared = enumFilter("distance");
    // Never owned: the declaration seeds.
    expect(store.resolve("L1", "measure", declared)).toEqual(declared);
    // A user write takes the slot.
    expect(store.setFilter("L1", "measure", enumFilter("time"))).toBe(true);
    expect(store.isOwned("L1", "measure")).toBe(true);
    // A panel reset returns to un-owned; the declaration seeds again on the next restore.
    store.reset("L1", "measure");
    expect(store.isOwned("L1", "measure")).toBe(false);
    expect(store.getFilter("L1", "measure")).toBeUndefined();
    expect(store.resolve("L1", "measure", declared)).toEqual(declared);
  });
  it("setFilter on an unregistered source is a no-op that writes nothing", () => {
    const store = createFilterStore();
    expect(store.setFilter("L1", "ghost", enumFilter("marker"))).toBe(false);
    expect(window.localStorage.getItem(FILTER_STORE_KEY)).toBeNull();
  });

  it("re-affirming an owned slot writes nothing new (a choice already made is not re-recorded)", () => {
    const store = createFilterStore();
    store.registerHost("L1", "filter", makeEnumHost(["marker"]));
    store.setFilter("L1", "filter", enumFilter("marker"));
    const before = window.localStorage.getItem(FILTER_STORE_KEY);
    // Same value again, and the user already owns the slot: no second record.
    expect(store.setFilter("L1", "filter", enumFilter("marker"))).toBe(false);
    expect(window.localStorage.getItem(FILTER_STORE_KEY)).toBe(before);
  });

  it("a restored slot shows the declaration when the user never took it, their value when they did", () => {
    const store = createFilterStore();
    store.registerHost("L1", "filter", makeEnumHost(["marker"]));
    const declared = enumFilter("distance");
    // Never taken -> the declaration seeds.
    expect(store.resolve("L1", "filter", declared)).toEqual(declared);
    // Taken -> their value survives, even though a declaration is on offer.
    store.setFilter("L1", "filter", enumFilter("marker"));
    expect(store.resolve("L1", "filter", declared)).toEqual(enumFilter("marker"));
  });

  it("clearing a slot that is already empty and un-owned is a no-op, so the declaration can still seed", () => {
    const store = createFilterStore();
    store.registerHost("L1", "filter", makeEnumHost(["marker"]));
    // No user write has happened: the slot holds nothing and is not owned.
    expect(store.setFilter("L1", "filter", undefined)).toBe(false);
    expect(store.isOwned("L1", "filter")).toBe(false);
    expect(window.localStorage.getItem(FILTER_STORE_KEY)).toBeNull();
  });

  it("reset of a layer that was never persisted is a safe no-op", () => {
    const store = createFilterStore();
    store.registerHost("L1", "filter", makeEnumHost(["marker"]));
    // No setFilter ever ran for L1: there is no layer entry to drop.
    expect(() => store.reset("L1")).not.toThrow();
    expect(() => store.reset("L1", "filter")).not.toThrow();
  });

  it("reset of an unregistered source on a known layer is a no-op", () => {
    const store = createFilterStore();
    store.registerHost("L1", "filter", makeEnumHost(["marker"]));
    store.setFilter("L1", "filter", enumFilter("marker"));
    // A layer exists, but this source never wrote into it.
    expect(() => store.reset("L1", "ghost")).not.toThrow();
    expect(store.isOwned("L1", "filter")).toBe(true);
  });

  it("a corrupt persisted record is discarded, not trusted (fresh state, not a throw)", () => {
    window.localStorage.setItem(FILTER_STORE_KEY, "{not json");
    const store = createFilterStore();
    store.registerHost("L1", "filter", makeEnumHost(["marker"]));
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
    store.registerHost("L1", "filter", makeEnumHost(["marker"]));
    expect(store.isOwned("L1", "filter")).toBe(false);
    expect(store.getFilter("L1", "filter")).toBeUndefined();
  });

  it("a captured declaration re-seeds a reset slot immediately (the factory reset contract)", () => {
    const store = createFilterStore();
    store.registerHost("L1", "measure", makeEnumHost(["distance", "time"]));
    store.setDeclaration("L1", "measure", enumFilter("distance"));
    // Reset with no user write yet: the slot returns to the declaration.
    store.reset("L1", "measure");
    expect(store.getFilter("L1", "measure")).toEqual(enumFilter("distance"));
    // A user write takes the slot, then the factory reset returns to the declaration.
    store.setFilter("L1", "measure", enumFilter("time"));
    expect(store.getFilter("L1", "measure")).toEqual(enumFilter("time"));
    store.reset("L1", "measure");
    expect(store.getFilter("L1", "measure")).toEqual(enumFilter("distance"));
    expect(store.isOwned("L1", "measure")).toBe(false);
  });

  it("reset of a layer with a captured declaration clears the declaration too (a layer delete)", () => {
    const store = createFilterStore();
    store.registerHost("L1", "measure", makeEnumHost(["distance", "time"]));
    store.setDeclaration("L1", "measure", enumFilter("distance"));
    store.setFilter("L1", "measure", enumFilter("time"));
    store.reset("L1");
    expect(store.isOwned("L1", "measure")).toBe(false);
    expect(store.getFilter("L1", "measure")).toBeUndefined();
    // A re-registered surface with the same declaration seeds fresh.
    store.setDeclaration("L1", "measure", enumFilter("distance"));
    expect(store.resolve("L1", "measure", enumFilter("distance"))).toEqual(
      enumFilter("distance"),
    );
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
    store.registerHost("L1", "filter", {
      ...makeEnumHost(["marker"]),
      apply: f => applied.push(f),
    });

    store.reset("L1", "filter");

    expect(applied).toEqual([enumFilter("marker")]);
  });

  it("filterModel carries the host dimensions and kept/total when the host provides them", () => {
    const store = createFilterStore();
    store.registerHost("L1", "filter", {
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
    store.registerHost("L1", "filter", makeEnumHost(["marker"]));
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

  it("restore writes the value and ownership without normalising or applying (the recovery path)", () => {
    const store = createFilterStore();
    const applied: LayerFilter[] = [];
    const host: FilterSourceHost = {
      ...makeEnumHost(["marker"]),
      apply: f => applied.push(f),
    };
    store.registerHost("L1", "filter", host);
    // A raw, un-normalised candidate (the recovery contract: the draw is the
    // render path's job, so restore hands the value through verbatim).
    store.restore("L1", "filter", enumFilter("marker", "ghost"));
    expect(store.getFilter("L1", "filter")).toEqual(enumFilter("marker", "ghost"));
    expect(store.isOwned("L1", "filter")).toBe(true);
    // No apply, no publish — only setFilter does that.
    expect(applied).toEqual([]);
  });

  it("a seeded declaration is readable after load but is never written to persistence by an unrelated save", () => {
    const store = createFilterStore();
    store.registerHost("L1", "measure", makeEnumHost(["distance", "time"]));
    store.registerHost("L1", "filter", makeEnumHost(["marker"]));
    store.setDeclaration("L1", "measure", enumFilter("distance"));
    // (a) The declaration is readable, and the slot is not owned.
    expect(store.getFilter("L1", "measure")).toEqual(enumFilter("distance"));
    expect(store.isOwned("L1", "measure")).toBe(false);
    expect(window.localStorage.getItem(FILTER_STORE_KEY)).toBeNull();
    // (b) An unrelated save (the filter surface) must not write the
    // declaration into persistence — only user-set values persist.
    store.setFilter("L1", "filter", enumFilter("marker"));
    const persisted = JSON.parse(window.localStorage.getItem(FILTER_STORE_KEY)!);
    expect(persisted.layers.L1.sources.measure).toBeUndefined();
    expect(persisted.layers.L1.sources.filter.value).toEqual(enumFilter("marker"));
  });

  it("same name on different layers never cross-affects (the owner dimension guard)", () => {
    const store = createFilterStore();
    // Two heatmap-style controls, both registering a source named "points"
    // against different canvas layers — the name alone must not collide.
    store.registerHost("H1", "points", makeEnumHost(["marker", "distance"]));
    store.registerHost("H2", "points", makeEnumHost(["marker", "distance"]));
    store.setFilter("H1", "points", enumFilter("marker"));
    expect(store.getFilter("H1", "points")).toEqual(enumFilter("marker"));
    expect(store.isOwned("H1", "points")).toBe(true);
    // The sibling layer is untouched.
    expect(store.getFilter("H2", "points")).toBeUndefined();
    expect(store.isOwned("H2", "points")).toBe(false);
    expect(store.sources("H1")).toEqual(["points"]);
    expect(store.sources("H2")).toEqual(["points"]);
  });

  it("re-registering the same (layerId, name) is idempotent and keeps the stored value", () => {
    const store = createFilterStore();
    store.registerHost("L1", "filter", makeEnumHost(["marker"]));
    store.setFilter("L1", "filter", enumFilter("marker"));
    // A control rebuild re-registers the same key with a fresh host object.
    store.registerHost("L1", "filter", makeEnumHost(["marker", "distance"]));
    expect(store.getFilter("L1", "filter")).toEqual(enumFilter("marker"));
    expect(store.isOwned("L1", "filter")).toBe(true);
    // The fresh host is in force (its wider domain is served).
    expect(store.setFilter("L1", "filter", enumFilter("distance"))).toBe(true);
    expect(store.getFilter("L1", "filter")).toEqual(enumFilter("distance"));
  });

  it("revalidate transforms a committed value without applying or publishing", () => {
    const store = createFilterStore();
    const applied: LayerFilter[] = [];
    const published: LayerFilter[] = [];
    store.registerHost("L1", "filter", {
      ...makeEnumHost(["marker", "distance"]),
      apply: f => applied.push(f),
      publish: f => published.push(f),
    });
    store.setFilter("L1", "filter", enumFilter("marker"));
    // setFilter already applied + published (a user write); clear the record so
    // the revalidate assertion below proves IT neither applies nor publishes.
    applied.length = 0;
    published.length = 0;
    const changed = store.revalidate("L1", "filter", f =>
      f?.kind === "enum" ? { ...f, values: ["marker", "distance"] } : f,
    );
    expect(changed).toBe(true);
    expect(store.getFilter("L1", "filter")).toEqual(enumFilter("marker", "distance"));
    expect(store.isOwned("L1", "filter")).toBe(true);
    // No apply, no publish — the render path owns the repaint.
    expect(applied).toEqual([]);
    expect(published).toEqual([]);
  });

  it("revalidate on an un-owned slot keeps the declaration-owned flag and returns false on no change", () => {
    const store = createFilterStore();
    store.registerHost("L1", "measure", makeEnumHost(["distance", "time"]));
    store.setDeclaration("L1", "measure", enumFilter("distance"));
    // No change: declaration intact, not owned, not persisted.
    expect(store.revalidate("L1", "measure", f => (f ? { ...f } : f))).toBe(false);
    expect(store.isOwned("L1", "measure")).toBe(false);
    expect(store.resolve("L1", "measure", enumFilter("distance"))).toEqual(
      enumFilter("distance"),
    );
  });

  it("revalidate dropping a declaration's value clears it so the seed can re-establish", () => {
    const store = createFilterStore();
    store.registerHost("L1", "measure", makeEnumHost(["distance", "time"]));
    store.setDeclaration("L1", "measure", enumFilter("distance"));
    // A content change removed the field: the transform yields undefined.
    expect(store.revalidate("L1", "measure", () => undefined)).toBe(true);
    expect(store.resolve("L1", "measure", enumFilter("distance"))).toEqual(
      enumFilter("distance"),
    );
  });
  it("drop removes a source's persisted value and declaration without applying or publishing", () => {
    const store = createFilterStore();
    const applied: unknown[] = [];
    const published: unknown[] = [];
    store.registerHost("L1", "filter", {
      ...makeEnumHost(["marker", "distance"]),
      apply: f => applied.push(f),
      publish: f => published.push(f),
    });
    store.setDeclaration("L1", "filter", enumFilter("marker"));
    store.setFilter("L1", "filter", enumFilter("distance"));
    expect(store.isOwned("L1", "filter")).toBe(true);
    // drop: record value + declaration removed, no apply/publish (the caller —
    // a departed data layer — owns the repaint).
    applied.length = 0;
    published.length = 0;
    store.drop("L1", "filter");
    expect(store.isOwned("L1", "filter")).toBe(false);
    expect(store.getFilter("L1", "filter")).toBeUndefined();
    expect(store.resolve("L1", "filter", enumFilter("marker"))).toEqual(
      enumFilter("marker"),
    );
    expect(applied).toEqual([]);
    expect(published).toEqual([]);
  });

  it("drop is a no-op on an unregistered or empty source", () => {
    const store = createFilterStore();
    expect(store.drop("L1", "ghost")).toBeUndefined();
    expect(store.sources("L1")).toEqual([]);
  });

  it("whole-layer reset keeps sibling layers and rewrites the record", () => {
    // The removeRecord-vs-writeRecord branch: a reset of one layer while
    // another layer's record survives must keep the key and rewrite, not
    // remove it.
    const store = createFilterStore();
    store.registerHost("L1", "filter", makeEnumHost(["marker"]));
    store.registerHost("L2", "filter", makeEnumHost(["marker"]));
    store.setFilter("L1", "filter", enumFilter("marker"));
    store.setFilter("L2", "filter", enumFilter("marker"));

    store.reset("L1");

    // L1 is gone from the record; L2's value survives.
    expect(store.isOwned("L1", "filter")).toBe(false);
    expect(store.isOwned("L2", "filter")).toBe(true);
    expect(store.getFilter("L2", "filter")).toEqual(enumFilter("marker"));
    const raw = JSON.parse(window.localStorage.getItem(FILTER_STORE_KEY)!);
    expect(raw.layers.L1).toBeUndefined();
    expect(raw.layers.L2.sources.filter.value).toEqual(enumFilter("marker"));
  });

  it("revalidate follows a changed declaration value on an un-owned slot", () => {
    // The declarations.set branch: a declaration-only slot whose transform
    // yields a NEW non-empty value (not undefined — that's the drop branch)
    // updates the declaration in place, stays un-owned, and is not persisted.
    const store = createFilterStore();
    store.registerHost("L1", "measure", makeEnumHost(["distance", "time"]));
    store.setDeclaration("L1", "measure", enumFilter("distance"));

    const changed = store.revalidate("L1", "measure", () => enumFilter("time"));
    expect(changed).toBe(true);
    expect(store.isOwned("L1", "measure")).toBe(false);
    // The new declaration value is what reads back now (getFilter consults
    // the store's declaration; resolve's declared argument is a caller
    // fallback, not the store's state).
    expect(store.getFilter("L1", "measure")).toEqual(enumFilter("time"));
    // Never persisted: a declaration is a construction-time constant.
    expect(window.localStorage.getItem(FILTER_STORE_KEY)).toBeNull();
  });

  describe("filterStore — generic vs measure source isolation", () => {
    it("generic and measure sources on the same layer never cross-affect (G2)", () => {
      const store = createFilterStore();
      store.registerHost("L1", FILTER_SOURCE.GENERIC, {
        normalize: filter => filter,
        apply: vi.fn(),
        publish: vi.fn(),
      });
      store.registerHost(
        "L1",
        FILTER_SOURCE.MEASURE,
        makeEnumHost(["marker", "distance"]),
      );
      const generic = {
        kind: "atom",
        field: "mag",
        op: "between",
        range: [2, 8],
      } as LayerFilter;
      store.setFilter("L1", FILTER_SOURCE.GENERIC, generic);
      expect(store.getFilter("L1", FILTER_SOURCE.GENERIC)).toEqual(generic);
      expect(store.isOwned("L1", FILTER_SOURCE.GENERIC)).toBe(true);
      expect(store.getFilter("L1", FILTER_SOURCE.MEASURE)).toBeUndefined();
      expect(store.isOwned("L1", FILTER_SOURCE.MEASURE)).toBe(false);
      store.setFilter("L1", FILTER_SOURCE.MEASURE, enumFilter("marker"));
      expect(store.getFilter("L1", FILTER_SOURCE.MEASURE)).toEqual(
        enumFilter("marker"),
      );
      expect(store.getFilter("L1", FILTER_SOURCE.GENERIC)).toEqual(generic);
      expect(store.sources("L1")).toEqual([
        FILTER_SOURCE.GENERIC,
        FILTER_SOURCE.MEASURE,
      ]);
    });
    it("a generic reset clears only the generic slot and keeps the declaration (G2)", () => {
      const store = createFilterStore();
      const apply = vi.fn();
      store.registerHost("L1", FILTER_SOURCE.GENERIC, {
        normalize: filter => filter,
        apply,
        publish: vi.fn(),
      });
      store.registerHost(
        "L1",
        FILTER_SOURCE.MEASURE,
        makeEnumHost(["marker", "distance"]),
      );
      store.setDeclaration("L1", FILTER_SOURCE.GENERIC, enumFilter("distance"));
      store.setFilter("L1", FILTER_SOURCE.GENERIC, {
        kind: "atom",
        field: "mag",
        op: "between",
        range: [2, 8],
      });
      store.reset("L1", FILTER_SOURCE.GENERIC);
      expect(store.getFilter("L1", FILTER_SOURCE.GENERIC)).toEqual(
        enumFilter("distance"),
      );
      expect(store.isOwned("L1", FILTER_SOURCE.GENERIC)).toBe(false);
      expect(store.getFilter("L1", FILTER_SOURCE.MEASURE)).toBeUndefined();
      expect(apply).toHaveBeenCalledWith(enumFilter("distance"));
    });
  });
});

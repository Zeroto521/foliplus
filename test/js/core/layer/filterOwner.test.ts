// Unit tests for core/layer/filterOwner — the shared filter orchestration
// controller. This pins the orchestration contract (F4): setFilter /
// filterModel / restore / reset behave exactly as the control hand-rolled it,
// so a control that swaps its copy for the owner keeps every observable
// behaviour.
//
// The owner is host-agnostic: the host's normalize / apply / publish / persist
// are the only carriers, so a control can verify its own equivalence here and
// reuse the same rows for Measure / Heatmap / Layer.
import { describe, expect, it } from "vitest";
import type { LayerFilter } from "#core/layer/filter.js";
import { type FilterOwnerHost, createFilterOwner } from "#core/layer/filterOwner.js";

/** An enum-arm host mirroring MeasureControl: the panel writes one enum atom,
 *  normalize keeps only the declared domain, apply records the committed
 *  filter on a spy. */
const makeHost = (): {
  host: FilterOwnerHost;
  applied: LayerFilter[];
  published: LayerFilter[];
  persisted: Array<{ filter: LayerFilter; owned: boolean }>;
  cleared: () => number;
} => {
  const applied: LayerFilter[] = [];
  const published: LayerFilter[] = [];
  const persisted: Array<{ filter: LayerFilter; owned: boolean }> = [];
  let cleared = 0;
  const domain = new Set(["marker", "distance", "polygon"]);
  const host: FilterOwnerHost = {
    normalize(filter) {
      if (filter?.kind !== "enum" || filter.field !== "type") return undefined;
      const values = filter.values.filter(v => domain.has(v));
      return values.length > 0 ? { kind: "enum", field: "type", values } : undefined;
    },
    apply(filter) {
      applied.push(filter);
    },
    publish(filter) {
      published.push(filter);
    },
    persist(filter, owned) {
      persisted.push({ filter, owned });
    },
    clearPersist() {
      cleared += 1;
    },
    dimensions: () => [
      {
        kind: "enum",
        field: "type",
        multi: true,
        options: [
          { value: "marker", label: "Marker" },
          { value: "distance", label: "Distance" },
        ],
      },
    ],
    counts: () => ({ kept: 1, total: 3 }),
  };
  return { host, applied, published, persisted, cleared: () => cleared };
};

const filter = (values: string[]): LayerFilter => ({
  kind: "enum",
  field: "type",
  values,
});

describe("createFilterOwner — orchestration", () => {
  it("setFilter normalizes, applies, persists, and publishes", () => {
    const { host, applied, published, persisted } = makeHost();
    const owner = createFilterOwner(host);
    expect(owner.setFilter(filter(["marker"]))).toBe(true);
    expect(owner.getFilter()).toEqual(filter(["marker"]));
    expect(applied).toEqual([filter(["marker"])]);
    expect(published).toEqual([filter(["marker"])]);
    expect(persisted).toEqual([{ filter: filter(["marker"]), owned: true }]);
    expect(owner.isOwned()).toBe(true);
  });

  it("drops values outside the domain and an empty selection is no filter", () => {
    const { host, applied, persisted } = makeHost();
    const owner = createFilterOwner(host);
    owner.setFilter(filter(["marker"]));
    expect(applied).toHaveLength(1);
    // Values outside the declared domain are dropped whole, never half-applied:
    // a write that normalizes to "no filter" clears the committed filter.
    expect(owner.setFilter({ kind: "enum", field: "type", values: ["bogus"] })).toBe(
      true,
    );
    expect(owner.getFilter()).toBeUndefined();
    // An empty selection means "no filter" (matchesValues semantics), not a
    // hidden-everything condition — but on an already-empty slot it is a
    // no-op, not a choice to remember.
    expect(owner.setFilter(filter([]))).toBe(false);
    expect(owner.getFilter()).toBeUndefined();
    expect(applied).toHaveLength(2);
    expect(persisted).toHaveLength(2);
  });

  it("a no-op write is skipped once the slot is owned", () => {
    const { host, applied, published, persisted } = makeHost();
    const owner = createFilterOwner(host);
    owner.setFilter(filter(["marker"]));
    expect(applied).toHaveLength(1);
    expect(published).toHaveLength(1);
    // A repeated identical write changes nothing: no re-apply, no re-publish,
    // no re-persist.
    expect(owner.setFilter(filter(["marker"]))).toBe(false);
    expect(applied).toHaveLength(1);
    expect(published).toHaveLength(1);
    expect(persisted).toHaveLength(1);
  });

  it("clearing an already-empty slot is not a choice to remember", () => {
    const { host, applied, persisted } = makeHost();
    const owner = createFilterOwner(host);
    // With no ownership and an empty slot, a clear write is a no-op: the
    // declaration may still seed.
    expect(owner.setFilter(undefined)).toBe(false);
    expect(owner.isOwned()).toBe(false);
    expect(applied).toHaveLength(0);
    expect(persisted).toHaveLength(0);
  });

  it("restore seeds the declaration when not touched, else the stored filter", () => {
    const { host } = makeHost();
    const owner = createFilterOwner(host);
    owner.setDeclaration(filter(["distance"]));
    owner.restore(undefined, false);
    expect(owner.declared()).toEqual(filter(["distance"]));
    expect(owner.getFilter()).toEqual(filter(["distance"]));
    expect(owner.isOwned()).toBe(false);
    // A touched record (even a cleared one) wins over the declaration.
    owner.restore(undefined, true);
    expect(owner.getFilter()).toBeUndefined();
    expect(owner.isOwned()).toBe(true);
  });

  it("reset clears persistence and re-seeds the declaration", () => {
    const { host, cleared } = makeHost();
    const owner = createFilterOwner(host);
    owner.setDeclaration(filter(["distance"]));
    owner.restore(undefined, false);
    expect(owner.getFilter()).toEqual(filter(["distance"]));
    owner.setFilter(filter(["marker"]));
    expect(owner.isOwned()).toBe(true);
    owner.reset();
    expect(cleared()).toBe(1);
    expect(owner.isOwned()).toBe(false);
    expect(owner.getFilter()).toEqual(filter(["distance"]));
  });

  it("filterModel reports owner-supplied counts and dimensions", () => {
    const { host } = makeHost();
    const owner = createFilterOwner(host);
    owner.setFilter(filter(["marker"]));
    const model = owner.filterModel();
    expect(model.dimensions[0]).toMatchObject({
      kind: "enum",
      field: "type",
      multi: true,
    });
    expect(model.filter).toEqual(filter(["marker"]));
    expect(model.kept).toBe(1);
    expect(model.total).toBe(3);
  });

  it("reset with the current filter already at the declaration is a no-op (no re-publish)", () => {
    const { host, published } = makeHost();
    const owner = createFilterOwner(host);
    owner.setDeclaration(filter(["distance"]));
    owner.restore(undefined, false); // current = declaration
    owner.reset();
    // Already at the declaration: the early return skips the re-publish.
    expect(published).toHaveLength(0);
    expect(owner.getFilter()).toEqual(filter(["distance"]));
  });

  it("an owner without publish/persist/clearPersist/counts/dimensions still runs", () => {
    // A host with only the mandatory normalize + apply: every optional carrier
    // is absent, so the owner degrades to a pure session filter.
    const applied: LayerFilter[] = [];
    const owner = createFilterOwner({
      normalize: filter => filter,
      apply: filter => {
        applied.push(filter);
      },
    });
    expect(owner.setFilter(filter(["marker"]))).toBe(true);
    expect(owner.getFilter()).toEqual(filter(["marker"]));
    // filterModel without dimensions/counts reports empty defaults.
    const model = owner.filterModel();
    expect(model.dimensions).toEqual([]);
    expect(model.kept).toBe(0);
    expect(model.total).toBe(0);
    // reset without clearPersist is safe.
    owner.reset();
    expect(owner.isOwned()).toBe(false);
    expect(owner.getFilter()).toBeUndefined();
  });
});

// Unit tests for core/layer/filter — pure evaluator over the filter AST.
//
// The evaluator is the single point of truth for the AST's edge semantics,
// which are stated once here and pinned:
//   - an atom naming a field the point does not carry is false
//   - an empty `and` matches everything, an empty `or` matches nothing
//   - only `typeof v === "number" && Number.isFinite(v)` survives — a NaN
//     or ±Infinity in a source field is excluded, so a predicate never
//     sees a sentinel value
//
// No DOM, no Leaflet, no h3 — `matches` and `select` are pure over
// `{ SnapshotPoint, LayerFilter }`, so this file exercises them directly
// without a browser.
import { describe, expect, it } from "vitest";
import {
  type LayerFilter,
  buildFilterModel,
  dropFilterForField,
  dropStaleFilter,
  filterKey,
  filterStep,
  filtersEqual,
  matches,
  normalizeFilter,
  parsePersistedFilter,
  parsePersistedFilters,
  pickFilterField,
  restoreFilters,
  revalidateStoredFilter,
  select,
  selectIndices,
  serializedFilters,
  storeFilter,
} from "#core/layer/filter.js";
import type { LayerSnapshot, SnapshotPoint } from "#core/layer/type.js";

const makePt = (fields: Record<string, number> = {}): SnapshotPoint => ({
  lat: 0,
  lng: 0,
  marker: {} as L.Marker,
  fields,
});

describe("atom ops", () => {
  it("between is inclusive of both bounds", () => {
    const expr: LayerFilter = {
      kind: "atom",
      field: "count",
      op: "between",
      range: [1, 10],
    };
    expect(matches(makePt({ count: 1 }), expr)).toBe(true);
    expect(matches(makePt({ count: 10 }), expr)).toBe(true);
    expect(matches(makePt({ count: 0 }), expr)).toBe(false);
    expect(matches(makePt({ count: 11 }), expr)).toBe(false);
  });

  it("inverted between range matches nothing", () => {
    const expr: LayerFilter = {
      kind: "atom",
      field: "count",
      op: "between",
      range: [10, 1],
    };
    expect(matches(makePt({ count: 5 }), expr)).toBe(false);
  });

  it("eq / ne are strict on both sides", () => {
    const eq: LayerFilter = {
      kind: "atom",
      field: "count",
      op: "eq",
      value: 5,
    };
    const ne: LayerFilter = {
      kind: "atom",
      field: "count",
      op: "ne",
      value: 5,
    };
    expect(matches(makePt({ count: 5 }), eq)).toBe(true);
    expect(matches(makePt({ count: 5 }), ne)).toBe(false);
    expect(matches(makePt({ count: 6 }), eq)).toBe(false);
    expect(matches(makePt({ count: 6 }), ne)).toBe(true);
  });

  it("in matches against the set", () => {
    const expr: LayerFilter = {
      kind: "atom",
      field: "type",
      op: "in",
      values: [1, 2, 3],
    };
    expect(matches(makePt({ type: 1 }), expr)).toBe(true);
    expect(matches(makePt({ type: 3 }), expr)).toBe(true);
    expect(matches(makePt({ type: 4 }), expr)).toBe(false);
  });

  it("a malformed atom missing its input reads false", () => {
    // The evaluator tolerates a hand-built AST with an `op` whose input
    // is missing. A `between` with no range falls back to [0,0] so only
    // zero matches — the safe default is "match the narrowest thing"
    // rather than "match everything". Same idea for `in` with no values.
    const noRange: LayerFilter = {
      kind: "atom",
      field: "count",
      op: "between",
    };
    expect(matches(makePt({ count: 0 }), noRange)).toBe(true);
    expect(matches(makePt({ count: 1 }), noRange)).toBe(false);
    expect(matches(makePt({ count: -5 }), noRange)).toBe(false);
    const noValues: LayerFilter = {
      kind: "atom",
      field: "count",
      op: "in",
    };
    expect(matches(makePt({ count: 1 }), noValues)).toBe(false);
    expect(matches(makePt({ count: 0 }), noValues)).toBe(false);
  });

  it("a missing field is false for every op", () => {
    const missing: LayerFilter[] = [
      { kind: "atom", field: "absent", op: "between", range: [0, 100] },
      { kind: "atom", field: "absent", op: "eq", value: 0 },
      { kind: "atom", field: "absent", op: "in", values: [0] },
    ];
    for (const expr of missing) expect(matches(makePt({ count: 1 }), expr)).toBe(false);
    // `ne` is the one op where a missing field still reads false — treating
    // absent as zero would silently match a `ne` predicate.
    expect(
      matches(makePt({ count: 1 }), {
        kind: "atom",
        field: "absent",
        op: "ne",
        value: 0,
      }),
    ).toBe(false);
  });
});

describe("and / or", () => {
  it("an empty `and` matches everything", () => {
    const expr: LayerFilter = { kind: "and", children: [] };
    expect(matches(makePt({}), expr)).toBe(true);
  });

  it("an empty `or` matches nothing", () => {
    const expr: LayerFilter = { kind: "or", children: [] };
    expect(matches(makePt({ count: 1 }), expr)).toBe(false);
  });

  it("and short-circuits on the first false", () => {
    const expr: LayerFilter = {
      kind: "and",
      children: [
        { kind: "atom", field: "count", op: "eq", value: 1 },
        { kind: "atom", field: "count", op: "eq", value: 2 },
        { kind: "atom", field: "count", op: "eq", value: 1 },
      ],
    };
    expect(matches(makePt({ count: 1 }), expr)).toBe(false);
    expect(matches(makePt({ count: 2 }), expr)).toBe(false);
    expect(matches(makePt({ count: 1, other: 1 }), expr)).toBe(false);
  });

  it("or short-circuits on the first true", () => {
    const expr: LayerFilter = {
      kind: "or",
      children: [
        { kind: "atom", field: "count", op: "eq", value: 1 },
        { kind: "atom", field: "count", op: "eq", value: 2 },
      ],
    };
    expect(matches(makePt({ count: 1 }), expr)).toBe(true);
    expect(matches(makePt({ count: 2 }), expr)).toBe(true);
    expect(matches(makePt({ count: 3 }), expr)).toBe(false);
  });

  it("supports nested grouping", () => {
    // `(count = 1 OR count = 2) AND size = 3` — the AST supports this
    // today, though no renderer emits it in this version.
    const expr: LayerFilter = {
      kind: "and",
      children: [
        {
          kind: "or",
          children: [
            { kind: "atom", field: "count", op: "eq", value: 1 },
            { kind: "atom", field: "count", op: "eq", value: 2 },
          ],
        },
        { kind: "atom", field: "size", op: "eq", value: 3 },
      ],
    };
    expect(matches(makePt({ count: 1, size: 3 }), expr)).toBe(true);
    expect(matches(makePt({ count: 2, size: 3 }), expr)).toBe(true);
    expect(matches(makePt({ count: 3, size: 3 }), expr)).toBe(false);
    expect(matches(makePt({ count: 1, size: 4 }), expr)).toBe(false);
  });
});

describe("undefined filter", () => {
  it("an absent filter matches every point", () => {
    const expr: LayerFilter = undefined;
    expect(matches(makePt({ count: 1 }), expr)).toBe(true);
    expect(matches(makePt({}), expr)).toBe(true);
  });
});

describe("select", () => {
  const snapshot = (fieldsList: Array<Record<string, number>>): LayerSnapshot => ({
    points: fieldsList.map(fields => makePt(fields)),
    numericFields: [],
    ranges: {},
  });

  it("an absent filter returns every point", () => {
    const snap = snapshot([{ count: 1 }, { count: 2 }, { count: 3 }]);
    expect(select(snap, undefined)).toHaveLength(3);
  });

  it("filters out points whose field the predicate reads is missing", () => {
    // The point with no `count` field is excluded, not treated as zero.
    const snap = snapshot([{ count: 1 }, {}, { count: 3 }]);
    const kept = select(snap, {
      kind: "atom",
      field: "count",
      op: "eq",
      value: 1,
    });
    expect(kept).toHaveLength(1);
    expect(kept[0].fields.count).toBe(1);
  });

  it("matches an and-of-atoms group of conditions", () => {
    const snap = snapshot([
      { count: 1, size: 3 },
      { count: 5, size: 3 },
      { count: 2, size: 3 },
    ]);
    const kept = select(snap, {
      kind: "and",
      children: [
        { kind: "atom", field: "count", op: "between", range: [2, 3] },
        { kind: "atom", field: "size", op: "eq", value: 3 },
      ],
    });
    expect(kept).toHaveLength(1);
    expect(kept[0].fields.count).toBe(2);
  });
});

describe("non-finite exclusion", () => {
  // The evaluator itself refuses NaN / ±Infinity values, in addition to
  // the builder (`core/layer/snapshot`) excluding them at record time.
  // The defence in depth matters because a filter predicate that silently
  // matched on a sentinel value would print nonsense numbers downstream.
  it("a NaN value never matches between / eq / in", () => {
    const withNaN: SnapshotPoint = makePt({ count: Number.NaN });
    const between: LayerFilter = {
      kind: "atom",
      field: "count",
      op: "between",
      range: [-Infinity, Infinity],
    };
    expect(matches(withNaN, between)).toBe(false);
    expect(
      matches(withNaN, {
        kind: "atom",
        field: "count",
        op: "eq",
        value: 0,
      }),
    ).toBe(false);
    expect(
      matches(withNaN, {
        kind: "atom",
        field: "count",
        op: "ne",
        value: 0,
      }),
    ).toBe(false);
    expect(
      matches(withNaN, {
        kind: "atom",
        field: "count",
        op: "in",
        values: [1, 2],
      }),
    ).toBe(false);
  });

  it("±Infinity values are excluded from every op", () => {
    const withInf: SnapshotPoint = makePt({ count: Infinity });
    const withNegInf: SnapshotPoint = makePt({ count: -Infinity });
    for (const pt of [withInf, withNegInf]) {
      expect(
        matches(pt, {
          kind: "atom",
          field: "count",
          op: "between",
          range: [-Infinity, Infinity],
        }),
      ).toBe(false);
      expect(
        matches(pt, {
          kind: "atom",
          field: "count",
          op: "eq",
          value: Infinity,
        }),
      ).toBe(false);
      expect(
        matches(pt, {
          kind: "atom",
          field: "count",
          op: "in",
          values: [Infinity],
        }),
      ).toBe(false);
    }
  });
});

// ── Owner helpers (persisted schema, model builder, row/cache helpers) ──
// These are the pure functions the Heatmap component externalises; pinned here
// so the component bundle stays logic-free and the persisted schema cannot drift.
describe("filterStep / filterKey", () => {
  it("derives the slider step from the data precision, capped at 6", () => {
    expect(filterStep([10, 69])).toBe(1);
    expect(filterStep([0.5, 2.25])).toBe(0.01);
    expect(filterStep([0.123456789, 1])).toBe(0.000001);
  });

  it("a degenerate or non-finite span falls back to 1", () => {
    expect(filterStep([5, 5])).toBe(1);
    expect(filterStep([10, 1])).toBe(1);
    expect(filterStep([Number.NaN, 10])).toBe(1);
  });

  it("keys an AST by its JSON shape (undefined is the empty key)", () => {
    const atom = { kind: "atom" as const, field: "c", op: "eq" as const, value: 1 };
    expect(filterKey(atom)).toBe(JSON.stringify(atom));
    expect(filterKey(undefined)).toBe("");
  });
});

describe("normalizeFilter", () => {
  const snap: LayerSnapshot = {
    points: [makePt({ c: 10 }), makePt({ c: 30 })],
    numericFields: ["c"],
    ranges: { c: [10, 30] },
  };

  it("drops an unknown field and a missing snapshot", () => {
    expect(
      normalizeFilter({ kind: "atom", field: "zzz", op: "eq", value: 1 }, snap),
    ).toBeUndefined();
    expect(
      normalizeFilter({ kind: "atom", field: "c", op: "eq", value: 1 }, null),
    ).toBeUndefined();
    expect(normalizeFilter(undefined, snap)).toBeUndefined();
  });

  it("passes a logical tree through untouched", () => {
    const tree = { kind: "and" as const, children: [] };
    expect(normalizeFilter(tree, snap)).toBe(tree);
  });

  it("passes a non-between op through untouched", () => {
    const eq = { kind: "atom" as const, field: "c", op: "eq" as const, value: 20 };
    expect(normalizeFilter(eq, snap)).toBe(eq);
  });

  it("clamps a between range into the extent and collapses a full range", () => {
    expect(
      normalizeFilter(
        { kind: "atom", field: "c", op: "between", range: [0, 20] },
        snap,
      ),
    ).toEqual({ kind: "atom", field: "c", op: "between", range: [10, 20] });
    expect(
      normalizeFilter(
        { kind: "atom", field: "c", op: "between", range: [10, 30] },
        snap,
      ),
    ).toBeUndefined();
  });
});

describe("selectIndices / filtersEqual / dropStaleFilter", () => {
  const snap: LayerSnapshot = {
    points: [makePt({ c: 10 }), makePt({ c: 20 }), makePt({ c: 30 })],
    numericFields: ["c"],
    ranges: { c: [10, 30] },
  };

  it("includes every index without a filter/snapshot and the matching subset otherwise", () => {
    expect(Array.from(selectIndices(snap, undefined, 3))).toEqual([0, 1, 2]);
    expect(Array.from(selectIndices(null, undefined, 2))).toEqual([0, 1]);
    expect(
      Array.from(
        selectIndices(
          snap,
          { kind: "atom", field: "c", op: "between", range: [10, 20] },
          3,
        ),
      ),
    ).toEqual([0, 1]);
  });

  it("filtersEqual compares JSON shapes (undefined = no filter)", () => {
    expect(filtersEqual(undefined, undefined)).toBe(true);
    expect(filtersEqual(undefined, { kind: "and", children: [] })).toBe(false);
    expect(
      filtersEqual(
        { kind: "atom", field: "c", op: "eq", value: 1 },
        { kind: "atom", field: "c", op: "eq", value: 1 },
      ),
    ).toBe(true);
  });

  it("dropStaleFilter keeps a filter bound to the field and drops the rest", () => {
    const atom = { kind: "atom" as const, field: "c", op: "eq" as const, value: 1 };
    expect(dropStaleFilter(atom, "c")).toBe(atom);
    expect(dropStaleFilter(atom, "d")).toBeUndefined();
    const tree = { kind: "and" as const, children: [] };
    expect(dropStaleFilter(tree, "d")).toBe(tree);
    expect(dropStaleFilter(undefined, "c")).toBeUndefined();
  });
});

describe("pickFilterField / buildFilterModel", () => {
  const snap: LayerSnapshot = {
    points: [makePt({ a: 1, b: 2 })],
    numericFields: ["a", "b"],
    ranges: { a: [1, 1], b: [2, 2] },
  };

  it("prefers the owner field, then the auto key, then the first numeric key", () => {
    expect(pickFilterField(snap, "b", "a")).toBe("b");
    expect(pickFilterField(snap, "", "b")).toBe("b");
    expect(pickFilterField(snap, "", null)).toBe("a");
    expect(pickFilterField(null, "", null)).toBeUndefined();
  });

  it("returns null for no filterable data", () => {
    expect(buildFilterModel(null, undefined, "", null)).toBeNull();
    expect(
      buildFilterModel(
        { points: [], numericFields: [], ranges: {} },
        undefined,
        "",
        null,
      ),
    ).toBeNull();
  });

  it("uses owner-provided counts when the unit is not a snapshot point", () => {
    const countsFilter = {
      kind: "atom" as const,
      field: "a",
      op: "between" as const,
      range: [1, 1] as [number, number],
    };
    expect(
      buildFilterModel(snap, countsFilter, "a", null, { kept: 7, total: 137 }),
    ).toMatchObject({
      kept: 7,
      total: 137,
    });
  });

  it("falls back to [0, 0] when the resolved field has no extent", () => {
    const noExtent: LayerSnapshot = {
      points: [makePt({ a: 1 })],
      numericFields: ["a"],
      ranges: {},
    };
    expect(buildFilterModel(noExtent, undefined, "a", null)!.range).toEqual([0, 0]);
  });

  it("composes the panel model from the snapshot", () => {
    const filter = {
      kind: "atom" as const,
      field: "a",
      op: "between" as const,
      range: [1, 1] as [number, number],
    };
    expect(buildFilterModel(snap, filter, "a", null)).toEqual({
      field: "a",
      range: [1, 1],
      filter,
      kept: 1,
      total: 1,
      step: 1,
    });
  });
});

describe("parsePersistedFilter / parsePersistedFilters", () => {
  it("accepts every atom op and rejects malformed payloads", () => {
    expect(
      parsePersistedFilter({ kind: "atom", field: "c", op: "between", range: [1, 2] }),
    ).toEqual({
      kind: "atom",
      field: "c",
      op: "between",
      range: [1, 2],
    });
    expect(
      parsePersistedFilter({ kind: "atom", field: "c", op: "eq", value: 2 }),
    ).toEqual({
      kind: "atom",
      field: "c",
      op: "eq",
      value: 2,
    });
    expect(
      parsePersistedFilter({ kind: "atom", field: "c", op: "ne", value: 2 }),
    ).toEqual({
      kind: "atom",
      field: "c",
      op: "ne",
      value: 2,
    });
    expect(
      parsePersistedFilter({ kind: "atom", field: "c", op: "in", values: [1, 2] }),
    ).toEqual({
      kind: "atom",
      field: "c",
      op: "in",
      values: [1, 2],
    });
    for (const bad of [
      null,
      5,
      [],
      { kind: "atom" },
      { kind: "atom", field: "", op: "eq", value: 1 },
      { kind: "atom", field: "c", op: "nope" },
      { kind: "atom", field: "c", op: "between", range: [1] },
      { kind: "atom", field: "c", op: "between", range: [2, 1] },
      { kind: "atom", field: "c", op: "between", range: ["1", 2] },
      { kind: "atom", field: "c", op: "eq" },
      { kind: "atom", field: "c", op: "in" },
      { kind: "atom", field: "c", op: "in", values: [] },
      { kind: "atom", field: "c", op: "in", values: ["1"] },
      { kind: "nope" },
    ]) {
      expect(parsePersistedFilter(bad)).toBeUndefined();
    }
  });

  it("rebuilds and/or trees, collapsing a single surviving child", () => {
    const child = { kind: "atom", field: "c", op: "eq", value: 1 };
    expect(
      parsePersistedFilter({ kind: "and", children: [child, { kind: "bad" }] }),
    ).toEqual(child);
    expect(parsePersistedFilter({ kind: "or", children: [child, child] })).toEqual({
      kind: "or",
      children: [child, child],
    });
    expect(parsePersistedFilter({ kind: "and", children: [] })).toBeUndefined();
    expect(parsePersistedFilter({ kind: "and", children: [42] })).toBeUndefined();
    expect(parsePersistedFilter({ kind: "or" })).toBeUndefined();
  });

  it("drops invalid entries from a persisted map", () => {
    const ok = { kind: "atom", field: "c", op: "eq", value: 1 };
    expect(parsePersistedFilters({ a: ok, b: { kind: "bad" } })).toEqual({ a: ok });
    expect(parsePersistedFilters({ a: { kind: "bad" } })).toBeUndefined();
    expect(parsePersistedFilters({ "": ok, b: ok })).toEqual({ b: ok });
    expect(parsePersistedFilters(null)).toBeUndefined();
    expect(parsePersistedFilters([])).toBeUndefined();
  });
});

describe("store / revalidate / serialize / restore", () => {
  const atom = {
    kind: "atom" as const,
    field: "c",
    op: "between" as const,
    range: [1, 2] as [number, number],
  };
  const snap: LayerSnapshot = {
    points: [makePt({ c: 1 }), makePt({ c: 2 })],
    numericFields: ["c"],
    ranges: { c: [1, 2] },
  };

  it("storeFilter writes, compares, and deletes undefined", () => {
    const filters = new Map<string, LayerFilter>();
    expect(storeFilter(filters, "s", atom)).toBe(true);
    expect(storeFilter(filters, "s", atom)).toBe(false);
    expect(storeFilter(filters, "s", undefined)).toBe(true);
    expect(filters.size).toBe(0);
  });

  it("dropFilterForField drops only a filter bound to another field", () => {
    const filters = new Map<string, LayerFilter>([["s", atom]]);
    expect(dropFilterForField(filters, "s", "c")).toBe(false);
    expect(dropFilterForField(filters, "s", "d")).toBe(true);
    expect(filters.size).toBe(0);
  });

  it("revalidateStoredFilter clamps or drops against the snapshot", () => {
    const filters = new Map<string, LayerFilter>([["s", atom]]);
    // The stored full-range atom collapses to "no filter" on revalidation.
    expect(revalidateStoredFilter(filters, "s", snap)).toBe(true);
    expect(filters.size).toBe(0);
    filters.set("s", { kind: "atom", field: "c", op: "between", range: [0, 1.5] });
    expect(revalidateStoredFilter(filters, "s", snap)).toBe(true);
    expect(filters.get("s")).toEqual({
      kind: "atom",
      field: "c",
      op: "between",
      range: [1, 1.5],
    });
    expect(revalidateStoredFilter(filters, "missing", snap)).toBe(false);
  });

  it("serializes only a non-empty map and restores it", () => {
    expect(serializedFilters(new Map())).toBeUndefined();
    expect(serializedFilters(new Map([["s", atom]]))).toEqual({ s: atom });
    const target = new Map<string, LayerFilter>([["old", atom]]);
    restoreFilters(target, undefined);
    expect(target.size).toBe(0);
    restoreFilters(target, { s: atom, bad: undefined });
    expect(target.size).toBe(1);
    expect(target.get("s")).toEqual(atom);
  });
});

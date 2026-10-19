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
import { type LayerFilter, matches, select } from "#core/layer/filter.js";
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

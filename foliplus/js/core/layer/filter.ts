// core/layer/filter — filter AST and pure evaluator.
//
// A layer's filter is a tree of `and | or | atom` nodes, or absent. Absent
// means "no filtering" and is distinct from an empty `and` (which matches
// everything). The tree shape supports nested grouping today even though
// the first renderer only emits flat AND lists — the AST stays fixed so
// a grouped UI is a new renderer, not a data migration.
//
// No DOM, no Leaflet, no h3 — the evaluator is pure over
// `{ SnapshotPoint, LayerFilter }`, so it is unit-testable without a
// browser. `matches` decides a single point; `select` maps it over a
// snapshot.
import type { LayerSnapshot, SnapshotPoint } from "./type.js";

/** One condition. `op` selects which of `range` / `value` / `values` is
 *  the input — a well-formed atom sets exactly the field its op reads.
 *  Field naming that this point does not carry is false (a missing field
 *  is not "0"; treating absent as zero silently widens a filter). */
type FilterAtom = {
  readonly kind: "atom";
  readonly field: string;
  readonly op: "between" | "eq" | "ne" | "in";
  /** Point-valued: `[min, max]` for `between`, bounds inclusive. */
  readonly range?: readonly [number, number];
  /** Scalar-valued ops (`eq` / `ne`). */
  readonly value?: number;
  /** Set-valued: `in`. */
  readonly values?: ReadonlyArray<number>;
};

type FilterExpr =
  | FilterAtom
  | { readonly kind: "and"; readonly children: ReadonlyArray<FilterExpr> }
  | { readonly kind: "or"; readonly children: ReadonlyArray<FilterExpr> };

/** A filter is a tree or absent. Absent = no filtering; empty `and` and
 *  empty `or` are stated below and treated as different things. */
type LayerFilter = FilterExpr | undefined;

/** The strict numeric predicate shared across the data layer. The
 *  builder (`core/layer/snapshot`) excludes non-finite values at
 *  record time, so a normal snapshot never carries them — but the
 *  evaluator is defensive too: a hand-built snapshot or a legacy
 *  record can still carry NaN / ±Infinity, and a predicate should
 *  not silently match on a sentinel value. */
const isNumeric = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Decide a single point. Recurses `and` (short-circuit on first false)
 *  and `or` (short-circuit on first true). Empty `and` → true, empty
 *  `or` → false — stated once here and pinned by tests. */
const matches = (pt: SnapshotPoint, expr: FilterExpr | undefined): boolean => {
  if (!expr) return true;
  switch (expr.kind) {
    case "and":
      for (const child of expr.children) if (!matches(pt, child)) return false;
      return true;
    case "or":
      for (const child of expr.children) if (matches(pt, child)) return true;
      return false;
    case "atom": {
      const v = pt.fields[expr.field];
      if (!isNumeric(v)) return false;
      switch (expr.op) {
        case "between": {
          const [lo, hi] = expr.range ?? [0, 0];
          return v >= lo && v <= hi;
        }
        case "eq":
          return v === expr.value;
        case "ne":
          return v !== expr.value;
        case "in":
          return expr.values?.includes(v) ?? false;
      }
    }
  }
};

/** Apply a filter to a snapshot. `undefined` = no filtering, returns the
 *  snapshot's points array by reference — callers must not mutate it. A
 *  filter returns a new array of the matching points; an absent field on
 *  any point is false, so a filter over points that never carried that
 *  field returns an empty array. */
const select = (
  snapshot: LayerSnapshot,
  filter: LayerFilter,
): ReadonlyArray<SnapshotPoint> => {
  if (!filter) return snapshot.points;
  return snapshot.points.filter(p => matches(p, filter));
};

/** Everything a filter panel renders, computed by the filter's owner
 *  (the component that declared `filterProvider`) so exactly one reader
 *  of the filter state exists. The panel is a view over this model —
 *  it never touches the owner's internal maps or caches. */
interface LayerFilterModel {
  /** The numeric field the filter evaluates. The owner picks the
   *  default field (first numeric key of the snapshot today); the panel
   *  renders it read-only. */
  field: string;
  /** The field's full data extent — the slider's rail bounds. */
  range: readonly [number, number];
  /** The committed filter, or undefined = no filter (every point kept).
   *  A filter whose range equals the full extent is reported as
   *  undefined: "no filter" and "full range" are the same state. */
  filter?: LayerFilter;
  /** Points passing the committed filter. */
  kept: number;
  /** Points total. */
  total: number;
  /** Slider step derived from the data's own precision — never a magic 1. */
  step: number;
}

export { matches, select };
export type { LayerFilter, LayerFilterModel };

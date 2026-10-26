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
  /** Units passing the committed filter, in the OWNER's unit — the
   *  Heatmap reports hex cells, a point layer its features. */
  kept: number;
  /** Units without the filter, in the same owner unit. */
  total: number;
  /** Slider step derived from the data's own precision — never a magic 1. */
  step: number;
}

/** The only ops a persisted filter may carry. Anything else is a record from
 *  another build (or a hand edit) and is dropped rather than re-meant. */
const FILTER_OPS = new Set(["between", "eq", "ne", "in"]);

/** Read one persisted filter node through a runtime schema. An invalid node
 *  is `undefined` (= no filter), never a partially-applied condition: a
 *  filter that dropped one malformed child would silently widen a selection. */
const parsePersistedFilter = (raw: unknown): LayerFilter => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const node = raw as Record<string, unknown>;
  if (node.kind === "atom") {
    if (typeof node.field !== "string" || !node.field) return undefined;
    if (typeof node.op !== "string" || !FILTER_OPS.has(node.op)) return undefined;
    const op = node.op as "between" | "eq" | "ne" | "in";
    if (op === "between") {
      const range = node.range;
      if (!Array.isArray(range) || range.length !== 2) return undefined;
      const [lo, hi] = range;
      if (
        typeof lo !== "number" ||
        !Number.isFinite(lo) ||
        typeof hi !== "number" ||
        !Number.isFinite(hi) ||
        lo > hi
      ) {
        return undefined;
      }
      return { kind: "atom", field: node.field, op, range: [lo, hi] };
    }
    if (op === "eq" || op === "ne") {
      const value = node.value;
      if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
      return { kind: "atom", field: node.field, op, value };
    }
    const values = node.values;
    if (
      !Array.isArray(values) ||
      values.length === 0 ||
      !values.every(v => typeof v === "number" && Number.isFinite(v))
    ) {
      return undefined;
    }
    return { kind: "atom", field: node.field, op, values: values as number[] };
  }
  if (node.kind === "and" || node.kind === "or") {
    if (!Array.isArray(node.children)) return undefined;
    const children = node.children
      .map(parsePersistedFilter)
      .filter((child): child is NonNullable<LayerFilter> => Boolean(child));
    // Empty logical nodes are "no filter" in this schema; one surviving child
    // is the child itself (no wrapper to carry).
    if (children.length === 0) return undefined;
    if (children.length === 1) return children[0];
    return { kind: node.kind, children };
  }
  return undefined;
};

/** Read a persisted per-source filter map. Keys are layer ids; invalid
 *  entries are dropped so one bad record cannot poison a whole reload. */
const parsePersistedFilters = (
  raw: unknown,
): Record<string, LayerFilter> | undefined => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const filters: Record<string, LayerFilter> = {};
  for (const [id, node] of Object.entries(raw)) {
    if (!id) continue;
    const filter = parsePersistedFilter(node);
    if (filter) filters[id] = filter;
  }
  return Object.keys(filters).length > 0 ? filters : undefined;
};
/** Slider step derived from the data's own precision — the number of
 *  decimals actually present in the field's bounds, capped at 6. A
 *  degenerate (zero-span) range gets 1: the slider renders disabled anyway. */
const filterStep = (range: readonly [number, number]): number => {
  const decimals = (v: number): number => {
    // Very small magnitudes stringify exponentially ("1e-7"), which has no
    // decimal point to count; the exponent carries the same precision.
    const exp = /e-(\d+)$/.exec(String(v));
    if (exp) return Math.min(Number(exp[1]), 6);
    const parts = String(v).split(".");
    return parts.length > 1 ? Math.min(parts[1].length, 6) : 0;
  };
  const span = range[1] - range[0];
  if (!Number.isFinite(span) || span <= 0) return 1;
  return 10 ** -Math.max(decimals(range[0]), decimals(range[1]));
};

/** Stable string key for a filter AST — same shape, same key, so a drag
 *  that keeps the same band does not invalidate a render cache. */
const filterKey = (filter: LayerFilter): string =>
  filter ? JSON.stringify(filter) : "";

/** Validate + clamp a filter AST against a snapshot: an unknown field or
 *  a range outside the field's extent degrades to "no filter"; a range
 *  equal to the full extent is the same state as "no filter" because a
 *  full-range atom would still exclude points missing the field. */
const normalizeFilter = (
  filter: LayerFilter,
  snapshot: LayerSnapshot | null,
): LayerFilter => {
  if (!filter) return undefined;
  if (filter.kind !== "atom") return filter;
  const bounds = snapshot?.ranges[filter.field];
  if (!snapshot || !snapshot.numericFields.includes(filter.field) || !bounds) {
    return undefined;
  }
  if (filter.op !== "between" || !filter.range) return filter;
  const [lo0, hi0] = bounds;
  const lo = Math.max(lo0, Math.min(hi0, filter.range[0]));
  const hi = Math.max(lo0, Math.min(hi0, filter.range[1]));
  if (lo === lo0 && hi === hi0) return undefined;
  return { ...filter, range: [lo, hi] as [number, number] };
};

/** Indices of the snapshot points that pass `filter` — the include list
 *  the aggregation reads. No filter or no snapshot → every index. */
const selectIndices = (
  snapshot: LayerSnapshot | null,
  filter: LayerFilter,
  total: number,
): Set<number> => {
  const include = new Set<number>();
  if (!filter || !snapshot) {
    for (let i = 0; i < total; i++) include.add(i);
    return include;
  }
  snapshot.points.forEach((pt, i) => {
    if (matches(pt, filter)) include.add(i);
  });
  return include;
};

/** The field a filter is bound to: the owner's preferred (aggregation)
 *  field when it exists on the snapshot, else the auto field, else the
 *  first numeric key. Read-only for the panel — one resolution path. */
const pickFilterField = (
  snapshot: LayerSnapshot | null,
  preferredField: string,
  autoFieldKey: string | null,
): string => {
  const numeric = snapshot?.numericFields ?? [];
  if (preferredField && numeric.includes(preferredField)) return preferredField;
  return autoFieldKey && numeric.includes(autoFieldKey) ? autoFieldKey : numeric[0];
};

/** Everything the filter panel renders, derived from the owner's state.
 *  The panel is a view over this model — it never reads the owner's maps.
 *  Null means "no filterable data" (no snapshot, or no numeric field).
 *
 *  `counts` lets an owner whose unit is not a snapshot point (the Heatmap
 *  counts hex cells) report its own kept/total; absent, the snapshot point
 *  count is used (a plain point layer filters its own features). */
const buildFilterModel = (
  snapshot: LayerSnapshot | null,
  filter: LayerFilter,
  preferredField: string,
  autoFieldKey: string | null,
  counts?: { kept: number; total: number },
): LayerFilterModel | null => {
  if (!snapshot || snapshot.numericFields.length === 0) return null;
  const field = pickFilterField(snapshot, preferredField, autoFieldKey);
  const range = snapshot.ranges[field] ?? [0, 0];
  return {
    field,
    range,
    filter,
    kept: counts?.kept ?? select(snapshot, filter).length,
    total: counts?.total ?? snapshot.points.length,
    step: filterStep(range),
  };
};

/** Equality for stored filters (undefined = no filter). One canonical
 *  comparison so the write path and the revalidation tail cannot disagree. */
const filtersEqual = (a: LayerFilter, b: LayerFilter): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** A filter survives a field change only while it is still bound to that
 *  field; a different effective field drops it. */
const dropStaleFilter = (prev: LayerFilter, field: string): LayerFilter =>
  prev && (prev.kind !== "atom" || prev.field === field) ? prev : undefined;

/** The persisted filter map for a record: absent when no source is
 *  filtered, so a cleared record keeps no stale key around. */
const serializedFilters = (
  filters: Map<string, LayerFilter>,
): Record<string, LayerFilter> | undefined =>
  filters.size > 0 ? Object.fromEntries(filters) : undefined;

/** Restore a record's filter map into the owner's store. The first render
 *  revalidates each entry against the rebuilt snapshot. */
const restoreFilters = (
  target: Map<string, LayerFilter>,
  saved: Record<string, LayerFilter> | undefined,
): void => {
  target.clear();
  if (!saved) return;
  for (const [layerId, filter] of Object.entries(saved)) {
    if (filter) target.set(layerId, filter);
  }
};

/** Store `next` as one source's committed filter. Returns true when the
 *  map changed (undefined always means "no filter", not a tombstone). */
const storeFilter = (
  filters: Map<string, LayerFilter>,
  sourceId: string,
  next: LayerFilter,
): boolean => {
  if (filtersEqual(filters.get(sourceId), next)) return false;
  if (next === undefined) filters.delete(sourceId);
  else filters.set(sourceId, next);
  return true;
};

/** Drop one source's filter when it is no longer bound to `field`.
 *  Returns true when the map changed. */
const dropFilterForField = (
  filters: Map<string, LayerFilter>,
  sourceId: string,
  field: string,
): boolean => {
  const prev = filters.get(sourceId);
  if (!prev || dropStaleFilter(prev, field) === prev) return false;
  filters.delete(sourceId);
  return true;
};

/** Re-align one source's stored filter with a freshly built snapshot
 *  (clamp to the current extent, drop when the field disappeared).
 *  Returns true when the map changed. */
const revalidateStoredFilter = (
  filters: Map<string, LayerFilter>,
  sourceId: string,
  snapshot: LayerSnapshot | null,
): boolean => {
  const prev = filters.get(sourceId);
  if (!prev) return false;
  return storeFilter(filters, sourceId, normalizeFilter(prev, snapshot));
};

export {
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
};
export type { LayerFilter, LayerFilterModel };

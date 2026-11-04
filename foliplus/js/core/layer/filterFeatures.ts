// core/layer/filterFeatures — generic per-feature attribute snapshot + filter set.
//
// The generic filter for ordinary data layers (GeoJSON polygons / lines /
// circles / markers) needs a per-feature field view that the point snapshot
// (snapshot.ts) does not carry: that builder only collects Marker /
// CircleMarker, while the filter must reach every geometry leaf. This module
// is the sibling builder: one pass over walkLeaf, counting every geometry
// leaf (Polygon / Polyline / CircleMarker / Marker, skipping isLabel — the
// exact `countFeatureGeometry` rule) for `total`, and collecting each one's
// feature.properties into a normalised attribute bag.
//
// §9 contract (reviewer-2 task-106, lead 2026-11-04):
//  ① Field domain: finite number → numeric; non-empty string → enum; boolean
//     → enum ("true"/"false" labels, but the bag holds the RAW boolean so it
//     stays distinguishable from a real string "true"); null / object / array
//     / NaN / ±Infinity / undefined → the key is omitted from the bag (a
//     missing field does not match — `matchesValues` returns false), the
//     feature still counts toward total.
//  ② total vs filterable set: `total` = all geometry leaf (skip isLabel,
//     ignore properties), matching `countFeatureGeometry`; the filterable
//     feature is a SUBSET of total (≥1 filterable field). A leaf with no
//     filterable field is in total but hidden whenever a filter is active
//     (empty bag → `matchesValues` false), visible when no filter.
//  ③ Two rules: no feature.properties → geometry leaf, in total, not
//     filterable; has properties but only non-filterable values → in total,
//     not filterable.
//
// No DOM, no h3 — `filterLeafSet` is pure over { LayerFilterFeatures,
// LayerFilter }, so it is unit-testable without a browser.
import { type LayerFilter, matchesValues } from "./filter.js";
import type { LabelAwareLayer } from "./type.js";
import { walkLeaf } from "./walkLeaf.js";

/** One feature leaf's normalised attribute bag. number + string + boolean
 *  (boolean is stored raw — §9 ①, never stringified, so bool true and string
 *  "true" stay distinct). */
type FilterFieldValue = number | string | boolean;

/** One feature leaf: the leaf plus its flat attribute bag (empty when the
 *  leaf has no filterable field — it still counts toward total). */
type FilterFeature = {
  readonly leaf: L.Layer;
  readonly fields: Readonly<Record<string, FilterFieldValue>>;
};

/** A layer's filterable attributes, read once and cached alongside the runtime
 *  row. `features` is every geometry leaf (Polygon / Polyline / CircleMarker
 *  / Marker, isLabel skipped); a leaf is filterable exactly when its `fields`
 *  bag is non-empty. */
type LayerFilterFeatures = {
  /** Every geometry leaf, deduped by L.stamp, in walk order. */
  readonly features: ReadonlyArray<FilterFeature>;
  /** `features.length` — the row's `countFeatureGeometry` count. */
  readonly total: number;
  /** Numeric field names, first-seen order. */
  readonly numericFields: ReadonlyArray<string>;
  /** Field name → [min, max] over finite values, for slider bounds. */
  readonly ranges: Readonly<Record<string, readonly [number, number]>>;
  /** Enum field names (string + boolean), first-seen order. */
  readonly enumFields: ReadonlyArray<string>;
  /** Field name → distinct option labels. A boolean field yields the two
   *  labels "true"/"false"; the bag still holds the raw boolean (S4c). */
  readonly enumValues: Readonly<Record<string, readonly string[]>>;
};

/** Feature leaf carrying GeoJSON properties (Path or Marker). */
type FeatureLeaf = L.Layer & { feature?: { properties?: Record<string, unknown> } };

/** Strict finite-number gate — the same gate snapshot.ts uses. */
const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** A geometry leaf per `countFeatureGeometry` (core/layer/util.ts): Polygon /
 *  Polyline / CircleMarker / Marker. A plain L.Marker without .feature still
 *  counts (it is a geometry leaf with an empty bag). */
const isGeometryLeaf = (leaf: L.Layer): boolean =>
  leaf instanceof L.Polygon ||
  leaf instanceof L.Polyline ||
  leaf instanceof L.CircleMarker ||
  leaf instanceof L.Marker;

/** First-seen field domain type. A field's type is fixed by its first value
 *  in walk order; later values of another type are omitted from the bag (they
 *  cannot match a filter on the field's domain). */
type FieldKind = "numeric" | "string" | "boolean";

/** One pass over the layer's leaves produces the feature snapshot. Walk order
 *  is preserved, L.stamp dedupes, isLabel leaves are skipped, and only
 *  geometry leaves are kept (matching `countFeatureGeometry`). Numeric extents
 *  and enum option labels are computed alongside features, never in a second
 *  walk. */
const buildFilterFeatures = (layer: L.Layer): LayerFilterFeatures => {
  const features: FilterFeature[] = [];
  const seen = new Set<number>();
  const fieldKind = new Map<string, FieldKind>();
  const numericFields: string[] = [];
  const ranges: Record<string, [number, number]> = {};
  const enumFields: string[] = [];
  const enumValues: Record<string, Set<string>> = {};

  walkLeaf(layer, (leaf: L.Layer) => {
    if ((leaf as LabelAwareLayer).isLabel) return;
    const stamp = L.stamp(leaf);
    if (seen.has(stamp)) return;
    if (!isGeometryLeaf(leaf)) return;
    seen.add(stamp);

    const props = (leaf as FeatureLeaf).feature?.properties;
    const fields: Record<string, FilterFieldValue> = {};
    if (props) {
      for (const [name, raw] of Object.entries(props)) {
        let kind = fieldKind.get(name);
        if (kind === undefined) {
          if (isFiniteNumber(raw)) kind = "numeric";
          else if (typeof raw === "string" && raw.length > 0) kind = "string";
          else if (typeof raw === "boolean") kind = "boolean";
          else continue; // null / object / array / NaN / ±Inf / undefined
          fieldKind.set(name, kind);
        }
        if (kind === "numeric") {
          if (!isFiniteNumber(raw)) continue; // wrong type later — omit
          fields[name] = raw;
          const entry = ranges[name];
          if (!entry) {
            numericFields.push(name);
            ranges[name] = [raw, raw];
          } else if (raw < entry[0]) {
            ranges[name] = [raw, entry[1]];
          } else if (raw > entry[1]) {
            ranges[name] = [entry[0], raw];
          }
        } else if (kind === "string") {
          if (typeof raw !== "string" || raw.length === 0) continue;
          fields[name] = raw;
          const set = enumValues[name];
          if (!set) {
            enumFields.push(name);
            enumValues[name] = new Set([raw]);
          } else {
            set.add(raw);
          }
        } else {
          // boolean
          if (typeof raw !== "boolean") continue;
          fields[name] = raw;
          if (!enumValues[name]) {
            enumFields.push(name);
            enumValues[name] = new Set(["true", "false"]);
          }
        }
      }
    }
    features.push({ leaf, fields });
  });

  const enumValuesOut: Record<string, readonly string[]> = {};
  for (const [name, set] of Object.entries(enumValues)) {
    enumValuesOut[name] = [...set];
  }
  return {
    features,
    total: features.length,
    numericFields,
    ranges,
    enumFields,
    enumValues: enumValuesOut,
  };
};

/** The set of leaves a filter hides. Computed once per apply and reused by
 *  the class pass (path/icon/shadow), the label walk (predicate query), and
 *  the funnel readout — one source of truth, not three walks. An absent
 *  filter hides nothing. A leaf with an empty bag (no filterable field) does
 *  not match any non-empty filter, so it is hidden while a filter is active
 *  and visible when no filter is set (§9 ②). */
const filterLeafSet = (
  features: ReadonlyArray<FilterFeature>,
  filter: LayerFilter,
): WeakSet<L.Layer> => {
  const hidden = new WeakSet<L.Layer>();
  if (!filter) return hidden;
  for (const feature of features) {
    if (!matchesValues(feature.fields, filter)) hidden.add(feature.leaf);
  }
  return hidden;
};

export { buildFilterFeatures, filterLeafSet };
export type { FilterFeature, FilterFieldValue, LayerFilterFeatures };

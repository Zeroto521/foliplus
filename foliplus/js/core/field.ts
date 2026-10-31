// Shared field enumeration for value-based fill — the numeric property
// keys a layer's features expose. Lives here (next to `classify.ts` and
// `palette.ts`) so the "By value" fill dimension and any future consumer
// share one definition of "which fields are numeric".
//
// The numeric predicate is deliberately strict: `typeof v === "number" &&
// Number.isFinite(v)` — NaN, Infinity, -Infinity, and numeric strings are
// excluded. A field whose sample value is non-finite cannot be classified
// (the breaks algorithm sorts, and non-finite values break the sort), so
// it is not offered to the picker at all.
import { walkLeaf } from "./layer/walkLeaf.js";

/** Whether a property value can drive a numeric classification.
 *
 *  `typeof number && Number.isFinite` — NaN / ±Infinity are excluded (the
 *  classify algorithm's sort would put them at an undefined position), and
 *  numeric strings are excluded (a field that is sometimes "10" and
 *  sometimes "ten" is a string column, not a number column). */
const isNumericValue = (value: unknown): boolean =>
  typeof value === "number" && Number.isFinite(value);

/** A leaf's `feature.properties`, when it has any. */
const leafProperties = (leaf: L.Layer): Record<string, unknown> | null =>
  (leaf as L.Layer & { feature?: { properties?: Record<string, unknown> } }).feature
    ?.properties ?? null;

/** Collect distinct numeric property keys across a layer's leaves, in
 *  first-seen order. Each key is sampled once; a later leaf that carries
 *  a non-finite value under the same key does not downgrade the field
 *  (the first finite sample wins — the same "type upgrade" rule
 *  `collectLabelFields` uses for label fields).
 *
 *  A field is offered only if at least one leaf carries a finite number
 *  under it. Fields whose values are all strings / null / NaN / Infinity
 *  are excluded — they cannot drive a classification. */
const numericPropertiesKeys = (layer: L.Layer): string[] => {
  const keys: string[] = [];
  const seen = new Set<string>();
  walkLeaf(layer, leaf => {
    const props = leafProperties(leaf);
    if (!props) return;
    for (const [name, value] of Object.entries(props)) {
      if (seen.has(name)) continue;
      if (!isNumericValue(value)) continue;
      seen.add(name);
      keys.push(name);
    }
  });
  return keys;
};

/** Whether a property value can drive a categorical classification.
 *
 *  A category is a non-empty string. Numeric IDs (a column of numbers that
 *  merely labels rows) are deliberately NOT categories: a "category" must be
 *  a name the reader can tell apart, and a number column is a numeric
 *  classification's input even when the user wants to color by it. The
 *  value-based fill therefore never offers a number column to the category
 *  arm — it is already the numeric arm's input. */
const isCategoryValue = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/** Collect distinct categorical property keys across a layer's leaves, in
 *  first-seen order. A field is offered only if at least one leaf carries a
 *  non-empty string under it (the same "type upgrade" rule
 *  `numericPropertiesKeys` uses for numbers). Fields whose values are all
 *  numbers / null / empty strings are excluded — a number ID column is a
 *  numeric field, not a category. */
const categoricalPropertiesKeys = (layer: L.Layer): string[] => {
  const keys: string[] = [];
  const seen = new Set<string>();
  walkLeaf(layer, leaf => {
    const props = leafProperties(leaf);
    if (!props) return;
    for (const [name, value] of Object.entries(props)) {
      if (seen.has(name)) continue;
      if (!isCategoryValue(value)) continue;
      seen.add(name);
      keys.push(name);
    }
  });
  return keys;
};

/** The distinct string values a categorical field takes across a layer, in
 *  first-seen order, with the empty string dropped and non-string values
 *  ignored (a mixed column contributes only its strings — a numeric ID value
 *  in a text column is not a category label).
 *
 *  `cap` bounds the returned domain. When the layer carries more distinct
 *  values than the cap, the result is truncated at `cap` and `overflow` is
 *  true, so the caller can paint an "other" bucket instead of silently
 *  dropping labels the user might expect to see. A cap of 0 is "no limit". */
const categoryDomain = (
  layer: L.Layer,
  field: string,
  cap = 0,
): { values: string[]; overflow: boolean } => {
  const values: string[] = [];
  const seen = new Set<string>();
  let overflow = false;
  walkLeaf(layer, leaf => {
    const props = leafProperties(leaf);
    if (!props) return;
    const value = props[field];
    if (!isCategoryValue(value)) return;
    if (seen.has(value)) return;
    if (cap > 0 && values.length >= cap) {
      overflow = true;
      return;
    }
    seen.add(value);
    values.push(value);
  });
  return { values, overflow };
};
/** Resolve a stored field name against the numeric fields a layer currently
 *  offers: the stored name wins when it is still present, otherwise the first
 *  offered field. The fill ramp paints with this rule; the heatmap's
 *  aggregation row resolves through its own manager (`effectiveField`), which
 *  adds the Python declaration and never writes the resolution back.
 *
 *  An empty list resolves to "" (no field to offer). */
const resolveField = (stored: string, fields: readonly string[]): string =>
  stored && fields.includes(stored) ? stored : (fields[0] ?? "");

export {
  categoricalPropertiesKeys,
  categoryDomain,
  isCategoryValue,
  isNumericValue,
  numericPropertiesKeys,
  resolveField,
};

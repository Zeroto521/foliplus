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

/** Resolve a stored field name against the numeric fields a layer currently
 *  offers: the stored name wins when it is still present, otherwise the first
 *  offered field. The fill ramp paints with this rule; the heatmap's
 *  aggregation row resolves through its own manager (`effectiveField`), which
 *  adds the Python declaration and never writes the resolution back.
 *
 *  An empty list resolves to "" (no field to offer). */
const resolveField = (stored: string, fields: readonly string[]): string =>
  stored && fields.includes(stored) ? stored : (fields[0] ?? "");

export { isNumericValue, numericPropertiesKeys, resolveField };

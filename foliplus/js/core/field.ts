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
import { forEachLeaf } from "./layer/util.js";

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
  forEachLeaf(layer, leaf => {
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

export { isNumericValue, numericPropertiesKeys };

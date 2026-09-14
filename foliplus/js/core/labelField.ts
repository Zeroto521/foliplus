// Shared label-field contract for the components that draw per-feature text:
// LayerControl's annotation labels (DOM markers) and HeatmapControl's hex
// labels (canvas). Both answer the same two questions — which fields a layer
// offers, and which one to fall back to when the user has not chosen — so the
// answers live here rather than drifting apart per component.

/**
 * One labelable field found on a layer's features.
 */
interface LabelField {
  /** Bare `feature.properties` key, with no prefix. */
  name: string;
  /** Sampled from the first value seen; drives the number-format affordance,
   *  which only changes the picture for numbers. */
  numeric: boolean;
}

/** A leaf's `feature.properties`, when it has any. */
const leafProperties = (leaf: L.Layer): Record<string, unknown> | null =>
  (leaf as L.Layer & { feature?: { properties?: Record<string, unknown> } }).feature
    ?.properties ?? null;

/**
 * Collect distinct property keys across `leaves`, in first-seen order, sampling
 * each key's type once.
 *
 * A later leaf may carry a number where the first carried a blank or a string:
 * the type is upgraded rather than frozen, so a mostly-empty first feature does
 * not hide the field's real type.
 *
 * Annotation label markers carry no `feature`, so they contribute nothing even
 * when the caller walks a tree that still holds them.
 */
const collectLabelFields = (leaves: Iterable<L.Layer>): LabelField[] => {
  const fields: LabelField[] = [];
  const index = new Map<string, number>();
  for (const leaf of leaves) {
    const props = leafProperties(leaf);
    if (!props) continue;
    for (const [name, value] of Object.entries(props)) {
      const at = index.get(name);
      if (at === undefined) {
        index.set(name, fields.length);
        fields.push({ name, numeric: typeof value === "number" });
      } else if (value != null) {
        fields[at].numeric = typeof value === "number";
      }
    }
  }
  return fields;
};

/**
 * Look up a field's sampled type. An unknown name is reported as non-numeric —
 * the safe answer for a control that only changes anything on numbers.
 */
const isNumericField = (fields: LabelField[], name: string): boolean =>
  fields.find(f => f.name === name)?.numeric ?? false;

/**
 * The field to use when the user has not picked one: the first numeric field,
 * because a label exists to show a value, falling back to the first field at
 * all when the layer holds no numbers.
 */
const autoLabelField = (fields: LabelField[]): string =>
  (fields.find(f => f.numeric) ?? fields[0])?.name ?? "";

export { collectLabelFields, isNumericField, autoLabelField, type LabelField };

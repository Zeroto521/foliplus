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
 * Whether a property value can be a label.
 *
 * Only a primitive can: a label renders one string, so an object would come out
 * as "[object Object]". This is also what keeps folium's own bookkeeping out of
 * the field list — a `GeoJson` given a `style_function` writes the resolved
 * style *object* into every feature's `properties.style` (folium/features.py,
 * `style_data`), and the layer reads it back with `setStyle`. It looks like a
 * column and is not one.
 */
const isLabelableValue = (value: unknown): boolean =>
  value == null || (typeof value !== "object" && typeof value !== "function");

/**
 * Property keys reserved for rendering rather than data.
 *
 * `__folium_color` is how folium's documented recipes colour a feature through
 * its properties. folium itself only passes it through, so it arrives as
 * ordinary data and a label over it would print a hex colour — worth naming
 * because, unlike a nested object, it is a primitive and the value rule alone
 * would not catch it.
 */
const RESERVED_PROPERTY_KEYS = new Set(["__folium_color"]);

/** Whether a property key names data a label could show. */
const isLabelableKey = (key: string): boolean => !RESERVED_PROPERTY_KEYS.has(key);

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
      if (!isLabelableKey(name) || !isLabelableValue(value)) continue;
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

/**
 * The value a label-field `<select>` uses to mean "let foliplus choose".
 *
 * The empty string: an explicit field is always a non-empty name, so the
 * sentinel can never collide with a real option, and a `<select>`'s own empty
 * value already reads as "nothing picked yet". Both components that offer a
 * field picker — the heatmap's aggregation field and the annotation panel's
 * label field — use it, so "auto" means one thing across the product.
 */
const AUTO_FIELD = "";

/**
 * What a label-field `<select>`'s current value means: the explicit field it
 * names, or — for the {@link AUTO_FIELD} sentinel — the shared auto pick over
 * the fields that select offered. Takes the offered `fields` rather than
 * re-deriving them, so a caller that already collected (and cached) them pays
 * nothing to resolve.
 */
const resolveSelectedField = (value: string, fields: LabelField[]): string =>
  value || autoLabelField(fields);

/**
 * Normalize a field id to its bare `feature.properties` key.
 *
 * Older HeatmapControl configs and localStorage entries stored
 * `"properties.<key>"`. The annotation style panel and the shared field
 * contract always used bare names — one form across the product. Call this
 * once on load / on any legacy value so the rest of the stack never sees
 * the prefix.
 */
const bareFieldName = (field: string): string =>
  field.startsWith("properties.") ? field.slice("properties.".length) : field;

export {
  AUTO_FIELD,
  autoLabelField,
  bareFieldName,
  collectLabelFields,
  isNumericField,
  resolveSelectedField,
  type LabelField,
};

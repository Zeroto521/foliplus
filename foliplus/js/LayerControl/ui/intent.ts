// LayerControl UI — single-source per-layer intent (LayerIntent) helpers.
//
// Thin delegates over `ui.intentStore` (`Map<id, IntentRow>`): every user-chosen
// dimension lives there. Absent key = never touched. Provenance is a separate
// axis (`IntentRow.provenance`).
import type { LayerIntent, LayerOverride } from "../type.js";
import type { LayerUI } from "./index.js";

/** The intent-key vocabulary — the one place each dimension's key is spelled.
 *  The `satisfies` guard pins every value to an existing `LayerIntent` key, so
 *  adding a dimension means touching this table and the record type together. */
const INTENT = {
  VISIBLE: "visible",
  FILL_COLOR: "fillColor",
  FILL_OPACITY: "fillOpacity",
  BORDER_COLOR: "borderColor",
  BORDER_WEIGHT: "borderWeight",
  OPACITY: "opacity",
  ZOOM_RANGE: "zoomRange",
  NAME: "name",
  ANNOTATION: "annotation",
} as const satisfies Record<string, keyof LayerIntent>;

type IntentKey = keyof LayerIntent;

/** Typed-presence rule per intent key — the one place the value vocabulary
 *  lives. An intent key's value is "live" when it has the type the record
 *  promises (0 / empty strings / empty arrays are real choices, not absence). */
const LIVE: Record<IntentKey, (value: unknown) => boolean> = {
  [INTENT.VISIBLE]: value => typeof value === "boolean",
  [INTENT.FILL_COLOR]: value => typeof value === "string",
  [INTENT.FILL_OPACITY]: value => typeof value === "number",
  [INTENT.BORDER_COLOR]: value => typeof value === "string",
  [INTENT.BORDER_WEIGHT]: value => typeof value === "number",
  [INTENT.OPACITY]: value => typeof value === "number",
  [INTENT.ZOOM_RANGE]: value => Array.isArray(value),
  [INTENT.NAME]: value => typeof value === "string",
  [INTENT.ANNOTATION]: value => value != null,
};

/** Write one intent dimension (value only — no provenance mark). */
const setIntent = <K extends IntentKey>(
  ui: LayerUI,
  id: string,
  key: K,
  value: NonNullable<LayerIntent[K]>,
): void => {
  ui.intentStore.setValue(id, key, value);
};

/** Drop one intent dimension (back to the author's default). */
const clearIntent = (ui: LayerUI, id: string, key: IntentKey): void => {
  ui.intentStore.clearValue(id, key);
};

/** The provenance-tracked style dims {@link dropIntent} clears with the
 *  layer — an identity map onto `INTENT`, so a new `LayerOverride` must pick
 *  its intent key here (a compile error until it does). `name` / `annotation`
 *  are riders outside this set, cleared by their own callers (manager delete /
 *  annotation destroy). */
const STYLE_KEYS = {
  visible: INTENT.VISIBLE,
  fillColor: INTENT.FILL_COLOR,
  fillOpacity: INTENT.FILL_OPACITY,
  borderColor: INTENT.BORDER_COLOR,
  borderWeight: INTENT.BORDER_WEIGHT,
  opacity: INTENT.OPACITY,
  zoomRange: INTENT.ZOOM_RANGE,
} as const satisfies Record<LayerOverride, IntentKey>;

/** Drop the style dimensions for one layer (user deleted the layer). */
const dropIntent = (ui: LayerUI, id: string): void => {
  for (const key of Object.values(STYLE_KEYS)) {
    ui.intentStore.clearValue(id, key);
  }
};

/** Read one intent dimension. */
const getIntent = <K extends IntentKey>(
  ui: LayerUI,
  id: string,
  key: K,
): LayerIntent[K] | undefined => {
  return ui.intentStore.get(id, key);
};

/** Whether one intent key holds a live value (typed presence). */
const hasIntentValue = (ui: LayerUI, id: string, key: IntentKey): boolean => {
  return LIVE[key](getIntent(ui, id, key));
};

/** Seed one dimension from a whole record (tests / bulk restore). */
const seedIntentMap = <K extends IntentKey>(
  ui: LayerUI,
  key: K,
  record: Record<string, NonNullable<LayerIntent[K]>>,
): void => {
  ui.intentStore.seedValues(key, record);
};

export {
  INTENT,
  LIVE,
  STYLE_KEYS,
  clearIntent,
  dropIntent,
  getIntent,
  hasIntentValue,
  seedIntentMap,
  setIntent,
};
export type { IntentKey };

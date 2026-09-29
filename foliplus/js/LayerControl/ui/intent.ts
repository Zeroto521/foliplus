// LayerControl UI — single-source per-layer intent (LayerIntent) helpers.
//
// `ui.intents` is the one record per layer: every user-chosen dimension
// lives here. Absent key = never touched. Provenance is a separate axis
// (`intentProvenance`).
import type { LayerIntent } from "../type.js";
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

/** Write one intent dimension. */
const setIntent = <K extends IntentKey>(
  ui: LayerUI,
  id: string,
  key: K,
  value: NonNullable<LayerIntent[K]>,
): void => {
  if (!ui.intents) ui.intents = {};
  const intent = (ui.intents[id] ??= {});
  intent[key] = value;
};

/** Drop one intent dimension (back to the author's default). */
const clearIntent = (ui: LayerUI, id: string, key: IntentKey): void => {
  const intent = ui.intents?.[id];
  if (!intent) return;
  delete intent[key];
  if (Object.keys(intent).length === 0) delete ui.intents[id];
};

/** Drop the style dimensions for one layer (user deleted the layer).
 *  `name` / `annotation` are cleared by their own callers (manager delete /
 *  annotation destroy) because their live sources sit outside the style set. */
const dropIntent = (ui: LayerUI, id: string): void => {
  const intent = ui.intents?.[id];
  if (!intent) return;
  delete intent[INTENT.VISIBLE];
  delete intent[INTENT.FILL_COLOR];
  delete intent[INTENT.FILL_OPACITY];
  delete intent[INTENT.BORDER_COLOR];
  delete intent[INTENT.BORDER_WEIGHT];
  delete intent[INTENT.OPACITY];
  delete intent[INTENT.ZOOM_RANGE];
  if (Object.keys(intent).length === 0) delete ui.intents[id];
};

/** Read one intent dimension. */
const getIntent = <K extends IntentKey>(
  ui: LayerUI,
  id: string,
  key: K,
): LayerIntent[K] | undefined => {
  return ui.intents?.[id]?.[key];
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
  for (const [id, value] of Object.entries(record)) {
    setIntent(ui, id, key, value);
  }
};

export {
  INTENT,
  LIVE,
  clearIntent,
  dropIntent,
  getIntent,
  hasIntentValue,
  seedIntentMap,
  setIntent,
};
export type { IntentKey };

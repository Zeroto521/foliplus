// LayerControl UI — single-source per-layer intent (LayerIntent) helpers.
//
// `ui.intents` is the one record per layer: every user-chosen dimension
// lives here. Absent key = never touched. Provenance is a separate axis
// (`intentProvenance`).
import type { LayerIntent } from "../type.js";
import type { LayerUI } from "./index.js";

type IntentKey = keyof LayerIntent;

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
  delete intent.visible;
  delete intent.fillColor;
  delete intent.fillOpacity;
  delete intent.borderColor;
  delete intent.borderWeight;
  delete intent.opacity;
  delete intent.zoomRange;
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

/** Whether one intent dimension holds a live value. */
const hasIntentValue = (ui: LayerUI, id: string, key: IntentKey): boolean => {
  const v = getIntent(ui, id, key);
  switch (key) {
    case "visible":
      return typeof v === "boolean";
    case "fillColor":
    case "borderColor":
    case "name":
      return typeof v === "string";
    case "fillOpacity":
    case "borderWeight":
    case "opacity":
      return typeof v === "number";
    case "zoomRange":
      return Array.isArray(v);
    case "annotation":
      return v != null;
  }
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

export { clearIntent, dropIntent, getIntent, hasIntentValue, seedIntentMap, setIntent };
export type { IntentKey };

// LayerControl UI — per-layer intent (LayerIntent) helpers.
//
// Thin delegates over `ui.intentStore` (`Map<id, IntentRow>`): every user-chosen
// dimension lives there. Absent key = never touched. Provenance is a separate
// axis (`IntentRow.provenance`).
//
// The intent vocabulary (INTENT / LIVE / STYLE_KEYS / IntentKey) and the
// intent-domain types sunk to `core/layer/intent.ts` — re-exported
// here so every `ui/intent.js` import keeps working unchanged.
import {
  INTENT,
  type IntentKey,
  LIVE,
  type LayerIntent,
  STYLE_KEYS,
} from "#core/layer/index.js";
import type { LayerUI } from "./surface.js";

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

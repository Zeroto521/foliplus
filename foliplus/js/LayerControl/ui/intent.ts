// LayerControl UI — per-layer intent (LayerIntent) helpers.
//
// Thin delegates over `la.intentStore` (`Map<id, IntentRow>`): every user-chosen
// dimension lives there. Absent key = never touched. Provenance is a separate
// axis (`IntentRow.provenance`).
//
// The intent vocabulary (INTENT / LIVE / STYLE_KEYS / IntentKey) and the
// intent-domain types sunk to `core/layer/intent.ts` with T270 — re-exported
// here so every `ui/intent.js` import keeps working unchanged.
import type { LayerIntent } from "#core/layer/index.js";
import { INTENT, LIVE, STYLE_KEYS } from "#core/layer/index.js";
import type { LayerAccess } from "./access.js";

type IntentKey = keyof LayerIntent;

/** Write one intent dimension (value only — no provenance mark). */
const setIntent = <K extends IntentKey>(
  la: LayerAccess,
  id: string,
  key: K,
  value: NonNullable<LayerIntent[K]>,
): void => {
  la.intentStore.setValue(id, key, value);
};

/** Drop one intent dimension (back to the author's default). */
const clearIntent = (la: LayerAccess, id: string, key: IntentKey): void => {
  la.intentStore.clearValue(id, key);
};

/** Drop the style dimensions for one layer (user deleted the layer). */
const dropIntent = (la: LayerAccess, id: string): void => {
  for (const key of Object.values(STYLE_KEYS)) {
    la.intentStore.clearValue(id, key);
  }
};

/** Read one intent dimension. */
const getIntent = <K extends IntentKey>(
  la: LayerAccess,
  id: string,
  key: K,
): LayerIntent[K] | undefined => {
  return la.intentStore.get(id, key);
};

/** Whether one intent key holds a live value (typed presence). */
const hasIntentValue = (la: LayerAccess, id: string, key: IntentKey): boolean => {
  return LIVE[key](getIntent(la, id, key));
};

/** Seed one dimension from a whole record (tests / bulk restore). */
const seedIntentMap = <K extends IntentKey>(
  la: LayerAccess,
  key: K,
  record: Record<string, NonNullable<LayerIntent[K]>>,
): void => {
  la.intentStore.seedValues(key, record);
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

// LayerControl UI — per-layer intent (LayerIntent) helpers.
//
// Thin delegates over `ui.intentStore` (`Map<id, IntentRow>`): every user-chosen
// dimension lives there. Absent key = never touched. Provenance is a separate
// axis (`IntentRow.provenance`).
//
// Also owns seeding the author's declared defaults. That is the axis
// `ui.intentStore` is deliberately *not* — a default is not user intent — so
// those helpers walk `ui.runtimeStore` instead. `seedAuthorVisible` below is
// the one entry point where folium's `?? true` for a layer whose author
// declared nothing is spelled out.
//
// The intent vocabulary (INTENT / LIVE / STYLE_KEYS / IntentKey) and the
// intent-domain types sunk to `core/layer/intent.ts` — re-exported
// here so every `ui/intent.js` import keeps working unchanged.
import {
  INTENT,
  type IntentKey,
  LIVE,
  type LayerInfo,
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

/** Seed the author's declared visibility for one layer.
 *  `?? true` is folium's own default for a layer whose author declared
 *  nothing — this helper is the only place that fallback is spelled out. */
const seedAuthorVisible = (ui: LayerUI, layerInfo: LayerInfo): void => {
  ui.runtimeStore.setAuthorVisible(layerInfo.id, layerInfo.show ?? true);
};

export {
  INTENT,
  LIVE,
  clearIntent,
  dropIntent,
  getIntent,
  hasIntentValue,
  seedAuthorVisible,
  seedIntentMap,
  setIntent,
};
export type { IntentKey };

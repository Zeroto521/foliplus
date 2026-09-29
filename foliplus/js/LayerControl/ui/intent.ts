// LayerControl UI — single-source per-layer intent (LayerIntent) write helpers.
//
// `ui.intents` is the one record per layer; the historical parallel maps
// (`visibleMap`, `fillColorMap`, …, `renamedNames`, `labelConfigs`) are kept
// in lockstep here during the migration so behaviour and tests stay stable.
// Every production write goes through `setIntent` / `clearIntent` / `dropIntent`
// so the legacy maps cannot drift.
import type { LayerIntent } from "../type.js";
import type { LayerUI } from "./index.js";

type IntentKey = keyof LayerIntent;

/** Mirror one intent field onto its legacy map (migration dual-write). */
const mirrorSet = (
  ui: LayerUI,
  id: string,
  key: IntentKey,
  value: LayerIntent[IntentKey],
): void => {
  switch (key) {
    case "visible":
      (ui.visibleMap ??= {})[id] = value as boolean;
      break;
    case "fillColor":
      (ui.fillColorMap ??= {})[id] = value as string;
      break;
    case "fillOpacity":
      (ui.fillOpacityMap ??= {})[id] = value as number;
      break;
    case "borderColor":
      (ui.borderColorMap ??= {})[id] = value as string;
      break;
    case "borderWeight":
      (ui.borderWeightMap ??= {})[id] = value as number;
      break;
    case "opacity":
      (ui.opacityMap ??= {})[id] = value as number;
      break;
    case "zoomRange":
      (ui.zoomRangeMap ??= {})[id] = value as [number, number];
      break;
    case "name":
      (ui.renamedNames ??= {})[id] = value as string;
      break;
    case "annotation":
      (ui.labelConfigs ??= {})[id] = value;
      break;
  }
};

/** Mirror one intent field's absence onto its legacy map. */
const mirrorClear = (ui: LayerUI, id: string, key: IntentKey): void => {
  switch (key) {
    case "visible":
      delete ui.visibleMap?.[id];
      break;
    case "fillColor":
      delete ui.fillColorMap?.[id];
      break;
    case "fillOpacity":
      delete ui.fillOpacityMap?.[id];
      break;
    case "borderColor":
      delete ui.borderColorMap?.[id];
      break;
    case "borderWeight":
      delete ui.borderWeightMap?.[id];
      break;
    case "opacity":
      delete ui.opacityMap?.[id];
      break;
    case "zoomRange":
      delete ui.zoomRangeMap?.[id];
      break;
    case "name":
      delete ui.renamedNames?.[id];
      break;
    case "annotation":
      delete ui.labelConfigs?.[id];
      break;
  }
};

/** Write one intent dimension and mirror it to the legacy map. */
const setIntent = <K extends IntentKey>(
  ui: LayerUI,
  id: string,
  key: K,
  value: NonNullable<LayerIntent[K]>,
): void => {
  if (!ui.intents) ui.intents = {};
  const intent = (ui.intents[id] ??= {});
  intent[key] = value;
  mirrorSet(ui, id, key, value);
};

/** Drop one intent dimension (back to the author's default) and its mirror. */
const clearIntent = (ui: LayerUI, id: string, key: IntentKey): void => {
  const intent = ui.intents?.[id];
  if (intent) {
    delete intent[key];
    if (Object.keys(intent).length === 0) delete ui.intents[id];
  }
  mirrorClear(ui, id, key);
};

/** Drop every intent dimension for one layer (user deleted the layer). */
const dropIntent = (ui: LayerUI, id: string): void => {
  delete ui.intents?.[id];
  delete ui.visibleMap?.[id];
  delete ui.fillColorMap?.[id];
  delete ui.fillOpacityMap?.[id];
  delete ui.borderColorMap?.[id];
  delete ui.borderWeightMap?.[id];
  delete ui.opacityMap?.[id];
  delete ui.zoomRangeMap?.[id];
  // name / annotation are cleared by their own callers (manager delete /
  // annotation destroy) because their live sources sit outside the style maps.
};

/** Read one intent dimension. Prefers `ui.intents`; falls back to the legacy
 *  map so a test (or older write path) that only touched the map still reads
 *  through. The fallback dies with the maps in the final commit. */
const getIntent = <K extends IntentKey>(
  ui: LayerUI,
  id: string,
  key: K,
): LayerIntent[K] | undefined => {
  const intent = ui.intents?.[id];
  if (intent && intent[key] !== undefined) return intent[key];
  switch (key) {
    case "visible":
      return ui.visibleMap?.[id] as LayerIntent[K] | undefined;
    case "fillColor":
      return ui.fillColorMap?.[id] as LayerIntent[K] | undefined;
    case "fillOpacity":
      return ui.fillOpacityMap?.[id] as LayerIntent[K] | undefined;
    case "borderColor":
      return ui.borderColorMap?.[id] as LayerIntent[K] | undefined;
    case "borderWeight":
      return ui.borderWeightMap?.[id] as LayerIntent[K] | undefined;
    case "opacity":
      return ui.opacityMap?.[id] as LayerIntent[K] | undefined;
    case "zoomRange":
      return ui.zoomRangeMap?.[id] as LayerIntent[K] | undefined;
    case "name":
      return ui.renamedNames?.[id] as LayerIntent[K] | undefined;
    case "annotation":
      return ui.labelConfigs?.[id] as LayerIntent[K] | undefined;
  }
};

/** Whether one intent dimension holds a live value (same typing rules the
 *  provenance gate uses). */
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

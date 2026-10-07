// HeatmapControl persistence — loading, applying, and clearing saved heatmap
// configuration from localStorage. Pure functions over the manager's public
// state surface.
import { bareFieldName } from "#core/labelField.js";
import type { NumberStyle } from "#foliplus/config-schema.js";
import { clampLabelSize } from "#common/form.js";
import * as Storage from "#common/storage.js";
import * as CONST from "./const.js";
import type { SavedConfig } from "./type.js";

/** The minimal manager state surface the persistence helpers write to. */
interface ManagerLike {
  selectedLayerId: string | null;
  currentAgg: string;
  currentMethod: string;
  currentScheme: string;
  numClasses: number;
  borderWeight: number;
  borderColor: string;
  currentLabelShow: boolean;
  currentLabelColor: string;
  currentLabelSize: number;
  currentLabelFormat: NumberStyle;
  currentField: string;
  hasScanned: boolean;
}

/** Load saved configuration from localStorage. */
const loadSavedConfig = (): SavedConfig | null => {
  return Storage.loadRecord<SavedConfig | null>(CONST.STORAGE.KEY, CONFIG.name);
};

/** Remove persisted configuration from localStorage. */
const clearSavedConfig = (): void => {
  Storage.removeRecord(CONST.STORAGE.KEY, CONFIG.name);
};

/** Apply a loaded config object to the manager's state. */
const applySavedConfig = (mgr: ManagerLike, saved: SavedConfig): void => {
  // A record existing at all means the user already spoke in a previous
  // session (picked a layer, or explicitly cleared the selection). Consume
  // the one-shot auto-select guard so reload does not undo that choice —
  // without this, hasScanned stays false and the single-layer auto-select
  // in buildLayerListItems re-fires after a manual clear survives reload.
  mgr.hasScanned = true;
  if (saved.agg) mgr.currentAgg = saved.agg;
  if (saved.method) mgr.currentMethod = saved.method;
  if (saved.scheme) mgr.currentScheme = saved.scheme;
  if (saved.numClasses !== undefined) {
    mgr.numClasses = Math.min(
      CONST.CLASS_COUNT.MAX,
      Math.max(CONST.CLASS_COUNT.MIN, saved.numClasses),
    );
  }
  if (saved.borderWeight !== undefined) {
    mgr.borderWeight = saved.borderWeight;
  }
  if (saved.borderColor) mgr.borderColor = saved.borderColor;
  if (saved.labelShow !== undefined) mgr.currentLabelShow = saved.labelShow;
  if (saved.labelColor) mgr.currentLabelColor = saved.labelColor;
  if (saved.labelSize !== undefined) {
    mgr.currentLabelSize = clampLabelSize(saved.labelSize);
  }
  if (saved.labelFormat) mgr.currentLabelFormat = saved.labelFormat;
  if (saved.field) mgr.currentField = bareFieldName(saved.field);
  mgr.selectedLayerId = saved.layerId ?? null;
};

export { applySavedConfig, clearSavedConfig, loadSavedConfig };

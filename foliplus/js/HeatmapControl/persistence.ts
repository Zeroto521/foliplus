// HeatmapControl persistence — loading, applying, and clearing saved heatmap
// configuration from localStorage. Pure functions over the manager's public
// state surface.
import { bareFieldName } from "#core/labelField.js";
import { clampLabelSize } from "#common/form.js";
import * as Storage from "#common/storage.js";
import * as CONST from "./const.js";
import type { ManagerLike, SavedConfig } from "./type.js";

/** Load saved configuration from localStorage. */
const loadSavedConfig = (): SavedConfig | null => {
  return Storage.loadRecord<SavedConfig | null>(CONST.STORAGE.KEY, CONFIG.name);
};

/** Remove persisted configuration from localStorage. */
const clearSavedConfig = (): void => {
  Storage.removeRecord(CONST.STORAGE.KEY, CONFIG.name);
};

/** Apply a loaded config object to the manager's state. */
const applySavedConfig = (manager: ManagerLike, saved: SavedConfig): void => {
  // A record existing at all means the user already spoke in a previous
  // session (picked a layer, or explicitly cleared the selection). Consume
  // the one-shot auto-select guard so reload does not undo that choice —
  // without this, hasScanned stays false and the single-layer auto-select
  // in buildLayerListItems re-fires after a manual clear survives reload.
  manager.hasScanned = true;
  if (saved.agg) manager.currentAgg = saved.agg;
  if (saved.method) manager.currentMethod = saved.method;
  if (saved.scheme) manager.currentScheme = saved.scheme;
  if (saved.numClasses !== undefined) {
    manager.numClasses = Math.min(
      CONST.CLASS_COUNT.MAX,
      Math.max(CONST.CLASS_COUNT.MIN, saved.numClasses),
    );
  }
  if (saved.borderWeight !== undefined) {
    manager.borderWeight = saved.borderWeight;
  }
  if (saved.borderColor) manager.borderColor = saved.borderColor;
  if (saved.labelShow !== undefined) manager.currentLabelShow = saved.labelShow;
  if (saved.labelColor) manager.currentLabelColor = saved.labelColor;
  if (saved.labelSize !== undefined) {
    manager.currentLabelSize = clampLabelSize(saved.labelSize);
  }
  if (saved.labelFormat) manager.currentLabelFormat = saved.labelFormat;
  if (saved.field) manager.currentField = bareFieldName(saved.field);
  manager.selectedLayerId = saved.layerId ?? null;
};

export { applySavedConfig, clearSavedConfig, loadSavedConfig };

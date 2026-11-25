// HeatmapControl state surface — reset, persistence binding, source metadata.
// Function expressions are installed on HeatmapManager.prototype so this is
// the manager and instance spies stay interceptable.
import * as CONST from "./const.js";
import type { HeatmapManager } from "./manager.js";
import {
  applySavedConfig as applySavedConfigFn,
  clearSavedConfig as clearSavedConfigFn,
  loadSavedConfig as loadSavedConfigFn,
  resolveClassifyMethod,
} from "./persistence.js";
import type { SavedConfig } from "./type.js";
import { EVENTS, publish } from "#core/event/index.js";
import { bareFieldName } from "#core/label/index.js";
import { CLASS_COUNT } from "#core/value/index.js";

/** Reset selection + style state to the defaults declared in `config`. Both
 *  clear entries (the panel's Clear button and LayerControl's more-menu
 *  delete) go through here, so the two can never drift apart. */
const resetState = function (this: HeatmapManager, config: ComponentConfig) {
  // Was any source carrying a filter (owned or declared)? The whole-layer
  // reset below drops the record without repainting; the notification
  // fires only when there was something to clear.
  const clearedFilter = this.filterStore
    .sources(this.layerId)
    .some(
      src =>
        this.filterStore.isOwned(this.layerId, src) ||
        this.filterStore.getFilter(this.layerId, src) !== undefined,
    );
  this.selectedLayerId = null;
  this.agg = config.agg ?? CONST.AGG.COUNT;
  this.field = "";
  // Reset returns to the declared state: the field list belongs to the
  // selection that just went away, and the resolved field must come from
  // the declaration (or stay empty), never from a stale scan.
  this.availableFields = [];
  this.invalidateEffectiveField();
  this.numClasses = config.num_classes ?? CLASS_COUNT.DEFAULT;
  this.method = resolveClassifyMethod(config.method);
  this.scheme = config.color_scheme ?? "Reds";
  // The clear wipes the row's data — every source's filter (and its
  // declaration) is a statement about data that no longer exists. The
  // store's whole-layer reset drops the record + declarations; the next
  // seed re-establishes the declaration against the fresh snapshot.
  this.filterStore.reset(this.layerId);
  this.cachedSnapshot = null;
  this.cachedSnapshotLayerId = null;
  // Reset returns the manager to the Python-declared starting state: the
  // record is about to be deleted, so re-open the one-shot guard and let
  // the declaration (and the single-layer auto-select) apply again. The
  // filter slot's ownership goes with it — the declared filter is part of
  // the declared state Reset returns to.
  this.hasScanned = false;
  if (clearedFilter) {
    publish(
      this.events,
      EVENTS.LAYER_FILTER_CHANGE,
      { id: this.layerId },
      { kind: "user", via: "panel" },
    );
  }
};

/** Load saved configuration from localStorage into this manager's state. */
const loadSavedConfig = function (this: HeatmapManager) {
  return loadSavedConfigFn();
};

/** Save the current manager state to localStorage through the write-through
 *  binding, so the flat inline-version record stays durable the moment a UI
 *  change lands. The binding reads live state at save time, so callers just
 *  signal a change without restating the fields. */
const saveConfig = function (this: HeatmapManager) {
  // The record carries `field`, so a write can be the moment the user's
  // pick changed: re-resolve on the next read instead of trusting a value
  // computed before the pick moved.
  this.invalidateEffectiveField();
  this.persist.schedule();
};

/** Flush any pending write through the binding — idempotent and teardown-safe. */
const flush = function (this: HeatmapManager) {
  this.persist.flush();
};

/** Remove persisted configuration from localStorage. */
const clearSavedConfig = function (this: HeatmapManager) {
  clearSavedConfigFn();
};

/** Drop the LayerControl-side record this draw left behind — visibility,
 *  opacity, zoom range with their provenance, plus the stored order slot —
 *  so a fresh draw of the same id starts from the author's defaults instead
 *  of inheriting the tuning the user arranged for the previous one.
 *
 * Only the panel's Clear button calls it. LayerControl's overflow Clear Data
 * reaches the same prune from `deleteLayer`, and the reload path must never
 * run it — a reload is not a clear.
 */
const clearLayerState = function (this: HeatmapManager) {
  this.map.foliplus?.LayerAPI?.dropPersistedLayerState?.(this.layerId);
};

/**
 * Publish the current source layer name + aggregation field into
 * `sourceMeta` (the object createCanvas registered), so LayerControl's
 * attributes panel can answer "where did this heatmap come from?".
 * Empty values are written too — the attrs panel drops blank rows.
 * `touchLayer` fires only when a published value actually changed, so a
 * no-op dropdown rebuild does not bump the panel's Updated stamp.
 */
const syncSourceMeta = function (this: HeatmapManager) {
  const layerName = this.selectedLayerId
    ? (this.pointLayers.find(i => i.id === this.selectedLayerId)?.name ?? "")
    : "";
  let fieldLabel = "";
  if (this.selectedLayerId && this.agg !== CONST.AGG.COUNT) {
    const key = this.effectiveField();
    if (key) fieldLabel = bareFieldName(key);
  }

  const sourceKey = this.T("meta_source_layer");
  const fieldKey = this.T("meta_agg_field");
  const changed =
    this.sourceMeta[sourceKey] !== layerName ||
    this.sourceMeta[fieldKey] !== fieldLabel;
  this.sourceMeta[sourceKey] = layerName;
  this.sourceMeta[fieldKey] = fieldLabel;

  if (!changed) return;
  // Stamp updatedAt so the panel's "Updated" row tracks the latest binding.
  // Free `map` (window.map) — same channel createCanvas / scanMapLayers use;
  // `this.map` is the Leaflet instance and may not carry the foliplus namespace.
  map.foliplus?.LayerAPI?.touchLayer?.(this.layerId);
};

/** Apply a loaded config object to the manager's state. */
const applySavedConfig = function (this: HeatmapManager, saved: SavedConfig) {
  applySavedConfigFn(this, saved);
};

const stateMethods = {
  resetState,
  loadSavedConfig,
  saveConfig,
  flush,
  clearSavedConfig,
  clearLayerState,
  syncSourceMeta,
  applySavedConfig,
};

export { stateMethods };

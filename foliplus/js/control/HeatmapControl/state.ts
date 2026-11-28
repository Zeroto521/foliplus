// HeatmapControl state — arrow functions that take the manager as their first argument.
// HeatmapManager's prototype methods delegate to them, so instance spies stay interceptable.
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
import { DEFAULT_CONFIG } from "#foliplus/config-default.js";

/** Reset selection + style state to the defaults declared in `config`. Both
 *  clear entries (the panel's Clear button and LayerControl's more-menu
 *  delete) go through here, so the two can never drift apart. */
const resetState = (m: HeatmapManager, config: ComponentConfig) => {
  // Was any source carrying a filter (owned or declared)? The whole-layer
  // reset below drops the record without repainting; the notification
  // fires only when there was something to clear.
  const clearedFilter = m.filterStore
    .sources(m.layerId)
    .some(
      src =>
        m.filterStore.isOwned(m.layerId, src) ||
        m.filterStore.getFilter(m.layerId, src) !== undefined,
    );
  m.selectedLayerId = null;
  m.agg = config.agg ?? DEFAULT_CONFIG.HeatmapControl.agg;
  m.field = "";
  // Reset returns to the declared state: the field list belongs to the
  // selection that just went away, and the resolved field must come from
  // the declaration (or stay empty), never from a stale scan.
  m.availableFields = [];
  m.invalidateEffectiveField();
  m.numClasses = config.num_classes ?? DEFAULT_CONFIG.HeatmapControl.num_classes;
  m.method = resolveClassifyMethod(config.method);
  m.scheme = config.color_scheme ?? DEFAULT_CONFIG.HeatmapControl.color_scheme;
  // The clear wipes the row's data — every source's filter (and its
  // declaration) is a statement about data that no longer exists. The
  // store's whole-layer reset drops the record + declarations; the next
  // seed re-establishes the declaration against the fresh snapshot.
  m.filterStore.reset(m.layerId);
  m.cachedSnapshot = null;
  m.cachedSnapshotLayerId = null;
  // Reset returns the manager to the Python-declared starting state: the
  // record is about to be deleted, so re-open the one-shot guard and let
  // the declaration (and the single-layer auto-select) apply again. The
  // filter slot's ownership goes with it — the declared filter is part of
  // the declared state Reset returns to.
  m.hasScanned = false;
  if (clearedFilter) {
    publish(
      m.events,
      EVENTS.LAYER_FILTER_CHANGE,
      { id: m.layerId },
      { kind: "user", via: "panel" },
    );
  }
};

/** Load saved configuration from localStorage into this manager's state. */
const loadSavedConfig = (_m: HeatmapManager) => {
  return loadSavedConfigFn();
};

/** Save the current manager state to localStorage through the write-through
 *  binding, so the flat inline-version record stays durable the moment a UI
 *  change lands. The binding reads live state at save time, so callers just
 *  signal a change without restating the fields. */
const saveConfig = (m: HeatmapManager) => {
  // The record carries `field`, so a write can be the moment the user's
  // pick changed: re-resolve on the next read instead of trusting a value
  // computed before the pick moved.
  m.invalidateEffectiveField();
  m.persist.schedule();
};

/** Flush any pending write through the binding — idempotent and teardown-safe. */
const flush = (m: HeatmapManager) => {
  m.persist.flush();
};

/** Remove persisted configuration from localStorage. */
const clearSavedConfig = (_m: HeatmapManager) => {
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
const clearLayerState = (m: HeatmapManager) => {
  m.map.foliplus?.LayerAPI?.dropPersistedLayerState?.(m.layerId);
};

/**
 * Publish the current source layer name + aggregation field into
 * `sourceMeta` (the object createCanvas registered), so LayerControl's
 * attributes panel can answer "where did this heatmap come from?".
 * Empty values are written too — the attrs panel drops blank rows.
 * `touchLayer` fires only when a published value actually changed, so a
 * no-op dropdown rebuild does not bump the panel's Updated stamp.
 */
const syncSourceMeta = (m: HeatmapManager) => {
  const layerName = m.selectedLayerId
    ? (m.pointLayers.find(i => i.id === m.selectedLayerId)?.name ?? "")
    : "";
  let fieldLabel = "";
  if (m.selectedLayerId && m.agg !== CONST.AGG.COUNT) {
    const key = m.effectiveField();
    if (key) fieldLabel = bareFieldName(key);
  }

  const sourceKey = m.T("meta_source_layer");
  const fieldKey = m.T("meta_agg_field");
  const changed =
    m.sourceMeta[sourceKey] !== layerName || m.sourceMeta[fieldKey] !== fieldLabel;
  m.sourceMeta[sourceKey] = layerName;
  m.sourceMeta[fieldKey] = fieldLabel;

  if (!changed) return;
  // Stamp updatedAt so the panel's "Updated" row tracks the latest binding.
  // Free `map` (window.map) — same channel createCanvas / scanMapLayers use;
  // `m.map` is the Leaflet instance and may not carry the foliplus namespace.
  map.foliplus?.LayerAPI?.touchLayer?.(m.layerId);
};

/** Apply a loaded config object to the manager's state. */
const applySavedConfig = (m: HeatmapManager, saved: SavedConfig) => {
  applySavedConfigFn(m, saved);
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

// HeatmapControl filter capability — the manager is the filter single owner.
// Function expressions are installed on HeatmapManager.prototype so this is
// the manager and instance spies stay interceptable.
import type { HeatmapManager } from "./manager.js";
import {
  type LayerFilter,
  dropStaleFilter,
  normalizeFilter,
  pickFilterField,
} from "#core/layer/index.js";

/** Register the shared host under a source's (layerId, name) key. A
 *  source is only ever written while selected (the panel edits the
 *  selected row), so the one host object — whose normalize/apply read the
 *  current selection at call time — is correct for every source it is
 *  registered under. Idempotent: re-selecting a source re-registers the
 *  same host (a no-op after the first call). */
const ensureFilterHost = function (this: HeatmapManager, sourceId: string) {
  this.filterStore.registerHost(this.layerId, sourceId, this.filterHost);
};

// --- Filter capability ---
//
// This manager owns the filter: the LayerControl panel reads
// `getFilterModel` and writes `setFilter` through the registry
// capabilities; there is no second write path and no second copy of
// the state (the old runtime-store + payload + manager-map trio is
// gone). LAYER_FILTER_CHANGE is a notification published after the
// local state and render have settled.

/** Follow an aggregation-field change: a stored filter belongs to the field
 *  it was written for, so a different effective field drops it. The caller
 *  repaints and publishes LAYER_FILTER_CHANGE (the panel re-reads the model,
 *  which is now a different shape, and rebuilds its rail/extent). */
const syncFilterField = function (this: HeatmapManager) {
  const sourceId = this.selectedLayerId;
  if (!sourceId) return;
  this.ensureFilterHost(sourceId);
  const field = pickFilterField(this.cachedSnapshot, this.effectiveField());
  // A filter whose field no longer matches the effective field is dropped
  // (the field list changed under it). The transform maps an unmatched
  // filter to undefined; revalidate commits the drop without applying —
  // the caller repaints and publishes LAYER_FILTER_CHANGE.
  const changed = this.filterStore.revalidate(this.layerId, sourceId, f =>
    f && dropStaleFilter(f, field) === f ? f : undefined,
  );
  if (!changed) return;
  this.cachedAgg = null;
  this.saveConfig();
};

/** The filter panel's view of this row's filter state, computed from
 *  this manager's own state — the single read path. Returns null when
 *  the row has no filterable data (no source selected, or no numeric
 *  field on the snapshot). */
const getFilterModel = function (this: HeatmapManager) {
  const sourceId = this.selectedLayerId;
  if (!sourceId) return null;
  this.getSelectedPoints(); // ensures cachedSnapshot is built for this source
  const snapshot = this.cachedSnapshot;
  if (!snapshot || snapshot.numericFields.length === 0) return null;
  // The store is the single read path: dimensions (the range rail bound to
  // the aggregation field), the committed filter (the per-source value,
  // falling back to the declaration when the user never took the slot),
  // and kept/total in the heatmap's own unit (hex cells, not source
  // points: a filter that drops points inside a cell keeps the cell; the
  // bins cache is the unfiltered cell set, the drawn features are what the
  // committed filter kept).
  this.ensureFilterHost(sourceId);
  return this.filterStore.filterModel(this.layerId, sourceId);
};

/** Write path for the filter panel. Validates the incoming atom against
 *  the current snapshot (unknown field or non-atom → no filter; range
 *  clamped into the field's extent; a range equal to the full extent
 *  means "no filter" — a full-range atom would still exclude points
 *  missing the field, which is not what dragging back to the ends
 *  means). No-op when the validated filter equals the stored one.
 *  Re-renders from the bins cache (zero h3 calls) and publishes
 *  LAYER_FILTER_CHANGE once the render has settled.
 *
 *  The render's terminal count signal and the filter notification are
 *  fan out through one SettledOperation: a throwing count consumer is
 *  raised only after the filter notification has reached its observers,
 *  so a broken subscriber cannot leave the UI reading an old model. */
const setFilter = function (this: HeatmapManager, filter: LayerFilter | undefined) {
  const sourceId = this.selectedLayerId;
  if (!sourceId) return;
  // The store is the single write path: it normalizes (the snapshot is the
  // validation baseline — build it here, cached after the first call so the
  // steady path is free), compares, commits, and runs the render-coupled
  // publish tail (SettledOperation → renderHexagons → LAYER_FILTER_CHANGE →
  // throwIfFailed) through the host's apply. Returns false exactly when the
  // old direct storeFilter early-returned, so the caller's shape is
  // unchanged.
  this.ensureFilterHost(sourceId);
  this.filterStore.setFilter(this.layerId, sourceId, filter);
};

/** One warning per declared-filter problem: the seed runs again on every
 *  rebuild of the first open, and a per-rebuild warn would flood. */
const warnDeclaredFilter = function (this: HeatmapManager, reason: string) {
  const key = `filter:${reason}`;
  if (this.declarationWarned.has(key)) return;
  this.declarationWarned.add(key);
  this.log.warn("declared filter ignored:", reason);
};

/** Seed the Python-declared filter as the starting condition.
 *
 *  Called from the layer-list build once the source is settled and before
 *  the first render. Two gates keep it from overriding the user: a persisted
 *  record that already owns the filter slot (including a record that says
 *  "cleared"), and a restored per-source filter. The factory Reset drops
 *  the ownership, so the declaration returns with the rest of the declared
 *  defaults.
 *
 *  Validation is the runtime's, not the declaration's: the AST was parsed by
 *  the same tolerant reader a stored record uses, then it is clamped to the
 *  snapshot and bound to the dimension the panel can actually edit. A
 *  declaration the panel cannot represent (an enum atom, a field the
 *  dimension does not carry, no numeric extent) is reported once and
 *  ignored — never turned into a filter that hides the layer.
 *
 *  Declaration-only seeding (no ownership): the declaration is a
 *  construction-time constant captured via setDeclaration — never
 *  written to persistence, never touched. Only a user write (setFilter)
 *  takes the slot and persists; the store keeps the user's owned value
 *  under its own key, and a declaration never survives a reload as a
 *  filter. A declaration-only slot seeds fresh each load. */
const seedDeclaredFilter = function (this: HeatmapManager) {
  const sourceId = this.selectedLayerId;
  if (!sourceId) return;
  this.ensureFilterHost(sourceId);
  // A slot the user owns (a persisted record that says "cleared" or a
  // committed value) keeps the user out; a restored per-source filter
  // (owned) also wins. Only an un-owned slot takes the declaration.
  if (this.filterStore.isOwned(this.layerId, sourceId)) return;
  if (this.filterStore.getFilter(this.layerId, sourceId) !== undefined) return;
  if (!this.declaredFilter) {
    if (this.declaredFilterInvalid) {
      this.warnDeclaredFilter("unreadable declaration");
    }
    return;
  }
  this.getSelectedPoints();
  const snapshot = this.cachedSnapshot;
  // An empty (or not-yet-built) snapshot is a *timing* state, not a data
  // defect: the seed runs from the panel build, which can precede the
  // source's first paint, and getSelectedPoints rebuilds the snapshot only
  // when the source id changed — a cache cleared by a content change can
  // still be null here. Nothing below can be judged without data: the field
  // binding would compare against an empty field list and the extent against
  // a missing range. Stay quiet (debug only) and let the next rebuild retry;
  // a report now would blame the author's declaration for an empty read and,
  // being remembered in declarationWarned, would silence the real problem
  // once the data lands.
  if (!snapshot || snapshot.points.length === 0) {
    this.log.debug("declared filter: the source snapshot is not populated yet");
    return;
  }
  const field = pickFilterField(snapshot, this.effectiveField());
  const declared = this.declaredFilter;
  if (declared.kind !== "atom") {
    // The panel's only dimension is a numeric range; a declared enum/logical
    // node has no numeric row yet (only the atom range shape is supported).
    this.warnDeclaredFilter("the panel filters a numeric range only");
    return;
  }
  if (declared.field !== field) {
    this.warnDeclaredFilter(
      `bound to "${declared.field}", the panel filters "${field}"`,
    );
    return;
  }
  // The panel needs a numeric extent to render a range on: the source has
  // points but this field carries no value on any of them, so there is no
  // row to show the declaration in — a data problem worth reporting. A
  // declaration that spans the whole extent is different — the runtime reads
  // that as "no filter" (a full-range atom would still exclude points
  // missing the field), so it is a legal no-op, not a defect.
  const bounds = snapshot.ranges[field];
  if (!bounds) {
    this.warnDeclaredFilter(`"${field}" has no usable extent`);
    return;
  }
  // A range that does not intersect the extent can never keep a point;
  // normalising it would collapse it onto one bound and silently hide the
  // data. Report it and start unfiltered — "declared" must never mean
  // "filtered to empty".
  if (declared.range) {
    const [lo, hi] = declared.range;
    if (hi < bounds[0] || lo > bounds[1]) {
      this.warnDeclaredFilter(
        `[${lo}, ${hi}] is outside "${field}"'s extent [${bounds[0]}, ${bounds[1]}]`,
      );
      return;
    }
  }
  const next = normalizeFilter(declared, snapshot);
  // Undefined here means the declaration covers the whole extent: the same
  // state as "no filter", so declare nothing and stay quiet.
  if (!next) return;
  this.filterStore.setDeclaration(this.layerId, sourceId, next);
};

/** Align the stored filter for the selected source with the freshly
 *  built snapshot — the shared tail of every content/identity change
 *  (source switch, feature add/remove, data update). Clamps a between
 *  range into the field's current extent and drops the filter when its
 *  field disappeared. Returns true when the stored filter changed, so
 *  the render tail can publish the notification. */
const revalidateFilter = function (this: HeatmapManager) {
  const sourceId = this.selectedLayerId;
  const snapshot = this.cachedSnapshot;
  if (!sourceId || !snapshot) return false;
  this.ensureFilterHost(sourceId);
  // The store aligns the current committed-or-declared value against the
  // fresh snapshot (clamp a between range into the current extent, drop a
  // filter whose field disappeared) without applying or publishing — the
  // render tail owns the repaint and the notification.
  const changed = this.filterStore.revalidate(this.layerId, sourceId, f =>
    normalizeFilter(f, snapshot),
  );
  if (!changed) return false;
  this.cachedAgg = null;
  this.saveConfig();
  return true;
};

const filterMethods = {
  ensureFilterHost,
  syncFilterField,
  getFilterModel,
  setFilter,
  warnDeclaredFilter,
  seedDeclaredFilter,
  revalidateFilter,
};

export { filterMethods };

import type { LayerRegistry } from "#core/layer/index.js";
import { type Debounced, debounce } from "#common/debounce.js";
import * as Storage from "#common/storage.js";
import * as CONST from "./const.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).

/** A dimension the user has actually set. `overrides` is the provenance half of
 *  the record: a dimension absent from it means the user never chose it, so the
 *  author's declared default stays in force. Only user actions add entries here,
 *  so a policy can never write through a user's choice -- which is what makes
 *  "the map overrides what I set" structurally impossible rather than a matter
 *  of remembering not to do it. */
type LayerOverride = "visible" | "opacity" | "zoomRange";

/** One layer's persisted intent: the values the user set, plus which dimensions
 *  they set them for. A value with no matching override is dropped on read. */
type PersistedLayerState = {
  visible?: boolean;
  opacity?: number;
  /** The handle positions the user moved, [minZoom, maxZoom]. The author's
   *  min_zoom / max_zoom is only the starting value, so it reaches this field
   *  only once the user has dragged the handles. */
  zoomRange?: [number, number];
  overrides: LayerOverride[];
};

/** Everything LayerControl persists, in one record per map. Intent only:
 *  declarations and derived state (what is actually on the map, z-indexes) are
 *  recomputed on every load and never written -- a zoom range is a declaration
 *  until the user moves the handles, which turns it into intent. */
type PersistedRecord = {
  /** Layer ids in the panel's order, or null when the user never reordered. */
  order: string[] | null;
  foldedGroups: string[];
  /** Layer id → user-assigned display name. */
  renamedNames: Record<string, string>;
  /** Layer id → annotation config (show/field/format). */
  annotations: Record<string, unknown>;
  /** Layer id → the user's per-layer intent. Empty means the user changed
   *  nothing, so every layer falls back to its declared default. */
  layers: Record<string, PersistedLayerState>;
};

/** What {@link LayerPersistence.load} returns: the record, with the sections
 *  that depend on which layers are registered filtered to those. */
type PersistedState = PersistedRecord;

/** The live sources a write reads. Supply only the dimensions you own -- a
 *  dimension you omit is left exactly as it stands in storage, so a caller that
 *  only knows the layer order cannot wipe the fold, rename, and label state it
 *  never touched. */
type LiveState = {
  order?: () => string[];
  foldedGroups?: () => string[];
  renamedNames?: () => Record<string, string>;
  annotations?: () => Record<string, unknown>;
  layers?: () => Record<string, PersistedLayerState>;
};

const emptyRecord = (): PersistedRecord => ({
  order: null,
  foldedGroups: [],
  renamedNames: {},
  annotations: {},
  layers: {},
});

/** A plain object -- the shape every record section is expected to hold. */
const asObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const OVERRIDE_VALUES: LayerOverride[] = ["visible", "opacity", "zoomRange"];

/** A stored zoom range: two finite numbers with the low end not above the
 *  high. Bounds are the map's business -- the handles are confined to the map's
 *  own range by the UI, so the record does not invent one of its own, and a
 *  range the map could no longer honour is still the user's stated choice. */
const parseZoomRange = (raw: unknown): [number, number] | null => {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const [min, max] = raw as [unknown, unknown];
  return typeof min === "number" &&
    typeof max === "number" &&
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    min <= max
    ? [min, max]
    : null;
};

/**
 * Coerce one entry of `layers`. Validates value and provenance together, so a
 * value with no matching override -- and an override with no value -- is
 * dropped: keeping the value would persist a choice the record itself says was
 * never made, and failing closed sends the layer back to its declared default.
 */
const parseLayerState = (raw: unknown): PersistedLayerState | null => {
  const data = asObject(raw);
  if (!data) return null;
  const declaredRaw = data.overrides;
  const declared = Array.isArray(declaredRaw)
    ? OVERRIDE_VALUES.filter(override => declaredRaw.includes(override))
    : [];
  const out: PersistedLayerState = { overrides: [] };
  for (const override of declared) {
    if (override === "visible") {
      if (typeof data.visible === "boolean") {
        out.visible = data.visible;
        out.overrides.push("visible");
      }
      continue;
    }
    if (override === "opacity") {
      if (
        typeof data.opacity === "number" &&
        Number.isFinite(data.opacity) &&
        data.opacity >= 0 &&
        data.opacity <= 1
      ) {
        out.opacity = data.opacity;
        out.overrides.push("opacity");
      }
      continue;
    }
    const zoomRange = parseZoomRange(data.zoomRange);
    if (zoomRange) {
      out.zoomRange = zoomRange;
      out.overrides.push("zoomRange");
    }
  }
  return out.overrides.length > 0 ? out : null;
};

/**
 * Coerce storage into a canonical record, dropping invalid entries rather than
 * failing closed as a whole: each section is independent, so a corrupt one must
 * not take the rest of the user's saved state down with it.
 */
const parseRecord = (raw: unknown): PersistedRecord => {
  const data = asObject(raw);
  if (!data) return emptyRecord();
  const record = emptyRecord();

  if (Array.isArray(data.order) && data.order.every(id => typeof id === "string")) {
    record.order = data.order as string[];
  }
  if (
    Array.isArray(data.foldedGroups) &&
    data.foldedGroups.every(group => typeof group === "string")
  ) {
    record.foldedGroups = data.foldedGroups as string[];
  }
  for (const [id, name] of Object.entries(asObject(data.renamedNames) ?? {})) {
    if (typeof name === "string") record.renamedNames[id] = name;
  }
  for (const [id, config] of Object.entries(asObject(data.annotations) ?? {})) {
    if (config !== null && typeof config === "object" && !Array.isArray(config)) {
      record.annotations[id] = config;
    }
  }
  for (const [id, rawState] of Object.entries(asObject(data.layers) ?? {})) {
    const state = parseLayerState(rawState);
    if (state) record.layers[id] = state;
  }
  return record;
};

/** Overwrite only the dimensions a caller scheduled; the rest are copied
 *  through from what storage already holds, so a caller that knows only the
 *  layer order cannot wipe the fold, rename, or label state it never read.
 *
 *  Named per dimension rather than keyed generically: PersistedRecord is a
 *  literal type, so adding a field without adding it here is a compile error. */
const mergeFields = (record: PersistedRecord, fields: LiveState): PersistedRecord => ({
  order: fields.order ? fields.order() : record.order,
  foldedGroups: fields.foldedGroups ? fields.foldedGroups() : record.foldedGroups,
  renamedNames: fields.renamedNames ? fields.renamedNames() : record.renamedNames,
  annotations: fields.annotations ? fields.annotations() : record.annotations,
  layers: fields.layers ? fields.layers() : record.layers,
});

/**
 * Single entry point for all LayerControl persistence (localStorage).
 *
 * One record per map container holds every dimension -- order, fold, names,
 * annotation config, and the per-layer intent -- behind a single debounced
 * write, so a teardown flush is one call instead of a per-dimension list and
 * adding a dimension cannot silently lose its last write.
 *
 * Reads go through {@link load} and {@link loadOrder}, writes through
 * {@link schedule}; both sides name every dimension explicitly (parseRecord and
 * mergeFields), so a new one cannot be wired on one side and forgotten on the
 * other. Storage key: <prefix>_<mapContainerId> -- map-scoped, so multi-map
 * pages keep their per-map state separate. The key lives in const.ts so tests
 * can assert on it without importing this module.
 */
class LayerPersistence {
  private readonly persistName: string;
  private readonly registry: LayerRegistry;

  private timer: Debounced | undefined;
  /** Live sources registered so far, merged across calls and never cleared.
   *  Every write therefore re-reads every dimension ever scheduled, which is
   *  what stops one caller from writing a record the other caller's dimension
   *  is missing from — a saved value cannot regress to an older one. */
  private fields: LiveState = {};

  constructor(registry: LayerRegistry) {
    this.persistName = CONF.name;
    this.registry = registry;
  }

  // ── Read ───────────────────────────────────────────────────────────

  /**
   * Load every dimension. The only full read entry point, so a new dimension
   * cannot be missed on load and nothing else calls `Storage.load`.
   *
   * Only order and annotation config are filtered against the registry: order is
   * rebuilt on every save, so an unknown id is skipped when it is applied, and
   * labels are a pure decoration, so nothing loses work if a stale id is dropped
   * here. Hidden state and names deliberately are not -- this runs from
   * `LayerUI.attachUI`, which loads before HeatmapControl and MeasureControl
   * register in their own constructor, so filtering here would drop their entries
   * on the very first attach and show the default name or re-add the layer after
   * every refresh. Stale ids are pruned elsewhere: names in `unregisterLayer`,
   * the only call that knows a layer is gone for good; hidden state in
   * `LayerUI.applyUserState`, after the late registrations have landed.
   */
  load(): PersistedState {
    const record = parseRecord(
      Storage.load<unknown>(CONST.STORAGE.KEY, this.persistName),
    );
    const ids = new Set(this.registry.layers.map(layer => layer.id));
    const annotations: Record<string, unknown> = {};
    for (const [id, config] of Object.entries(record.annotations)) {
      if (ids.has(id)) annotations[id] = config;
    }
    return {
      ...record,
      order: record.order ? record.order.filter(id => ids.has(id)) : null,
      annotations,
    };
  }

  /**
   * Load just the order dimension.
   *
   * {@link LayerManager} calls this from its own constructor, before
   * LayerControl's UI has attached, and it is the only dimension it needs. It
   * reads the same record as {@link load} -- one key either way -- so the two
   * calls still differ only in what they return, and this one runs at a
   * different moment anyway: the registry still holds only the folium-declared
   * layers, so the calls cannot be merged even if they wanted to be.
   */
  loadOrder(): string[] | null {
    const record = parseRecord(
      Storage.load<unknown>(CONST.STORAGE.KEY, this.persistName),
    );
    if (!record.order) return null;
    const ids = new Set(this.registry.layers.map(layer => layer.id));
    return record.order.filter(id => ids.has(id));
  }

  // ── Write ──────────────────────────────────────────────────────────

  /**
   * Persist the given dimensions on the one shared debounce timer. The write
   * rebuilds the whole record at flush time, reading each registered source
   * lazily so a drag / toggleAll / rename batch coalesces into a single write of
   * the final state rather than a write per step.
   *
   * The write overlay is applied on top of what storage already holds, so the
   * caller only needs to supply the dimensions it touched — a caller that only
   * knows the layer order cannot wipe the fold, rename, or label state it never
   * read. A dimension never scheduled in this session is copied through as-is.
   */
  schedule(fields: LiveState): void {
    Object.assign(this.fields, fields);
    if (!this.timer) {
      this.timer = debounce(() => {
        const record = parseRecord(
          Storage.load<unknown>(CONST.STORAGE.KEY, this.persistName),
        );
        Storage.save(
          CONST.STORAGE.KEY,
          mergeFields(record, this.fields),
          this.persistName,
        );
      }, CONST.SAVE_DEBOUNCE_MS);
    }
    this.timer();
  }

  /**
   * Write the pending record. Teardown calls this before the timer is cleared --
   * the write is debounced at 100ms, wide enough for the control to be removed
   * before the timer fires, so flush must come first or the last toggle,
   * reorder, or rename is dropped.
   */
  flushAll() {
    this.timer?.flush();
  }

  destroy() {
    // Flush first: cancel() clears the timer and would make a later flush a
    // no-op, so the write is never order-dependent on the caller.
    this.flushAll();
    this.timer?.cancel();
    this.timer = undefined;
  }
}

export { LayerPersistence };
export type {
  LiveState,
  LayerOverride,
  PersistedLayerState,
  PersistedRecord,
  PersistedState,
};
